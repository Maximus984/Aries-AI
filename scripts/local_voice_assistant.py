#!/usr/bin/env python3
"""
Aries local real-time voice chatbot with:
- SpeechRecognition + PocketSphinx (local STT)
- Vosk wake-word gating ("Aries wake up")
- Ollama (llama3 default) for responses
- LangChain local RAG from local text files
- Coqui XTTS v2 voice cloning
- webrtcvad interruption while TTS plays

Behavior:
- Assistant listens only after wake phrase is detected.
- If user speech is detected for >= 500ms while Aries speaks, playback stops immediately
  and queued speech is cleared.
- Response sentiment controls XTTS style:
  - Positive: faster + higher pitch
  - Negative: slower + lower pitch
- Guardrail layer runs before TTS:
  - keyword-based restricted-topic check
  - prepends disclaimer for high-risk requests
  - logs timestamped prompts to local usage_audit.log
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import re
import signal
import sys
import threading
import time
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    import speech_recognition as sr
except Exception as exc:  # pragma: no cover
    print(
        "[fatal] Could not import SpeechRecognition.\n"
        "Install with: pip install SpeechRecognition\n"
        f"Details: {exc}"
    )
    sys.exit(1)

try:
    import pocketsphinx  # noqa: F401  # pylint: disable=unused-import
except Exception as exc:  # pragma: no cover
    print(
        "[fatal] PocketSphinx is required for local STT.\n"
        "Install with: pip install pocketsphinx\n"
        f"Details: {exc}"
    )
    sys.exit(1)

try:
    import pygame
except Exception as exc:  # pragma: no cover
    print(
        "[fatal] Could not import pygame for local audio playback.\n"
        "Install with: pip install pygame\n"
        f"Details: {exc}"
    )
    sys.exit(1)

try:
    import torch
except Exception as exc:  # pragma: no cover
    print(f"[fatal] Could not import torch: {exc}")
    sys.exit(1)

try:
    import webrtcvad
except Exception as exc:  # pragma: no cover
    print(
        "[fatal] Could not import webrtcvad.\n"
        "Install with: pip install webrtcvad\n"
        f"Details: {exc}"
    )
    sys.exit(1)

try:
    from vosk import KaldiRecognizer, Model as VoskModel
except Exception as exc:  # pragma: no cover
    print(
        "[fatal] Could not import Vosk.\n"
        "Install with: pip install vosk\n"
        f"Details: {exc}"
    )
    sys.exit(1)

try:
    from TTS.api import TTS
except Exception as exc:  # pragma: no cover
    print(
        "[fatal] Could not import Coqui TTS.\n"
        "Install with: pip install TTS\n"
        f"Details: {exc}"
    )
    sys.exit(1)

try:
    from langchain_community.document_loaders import TextLoader
    from langchain_community.embeddings import OllamaEmbeddings
    from langchain_community.vectorstores import FAISS
    from langchain_text_splitters import RecursiveCharacterTextSplitter
except Exception as exc:  # pragma: no cover
    print(
        "[fatal] Could not import LangChain RAG dependencies.\n"
        "Install with: pip install langchain langchain-community langchain-text-splitters faiss-cpu\n"
        f"Details: {exc}"
    )
    sys.exit(1)


POSITIVE_WORDS = {
    "good",
    "great",
    "awesome",
    "excellent",
    "happy",
    "love",
    "nice",
    "amazing",
    "perfect",
    "success",
    "wonderful",
    "fantastic",
    "win",
    "beautiful",
    "brilliant",
}

NEGATIVE_WORDS = {
    "bad",
    "terrible",
    "awful",
    "sad",
    "angry",
    "hate",
    "horrible",
    "problem",
    "issue",
    "error",
    "fail",
    "failure",
    "broken",
    "worse",
    "worst",
    "upset",
}

HIGH_RISK_AUDIO_DISCLAIMER = (
    "As an AI assistant, I have generated the following information for educational use..."
)

RESTRICTED_TOPIC_KEYWORDS = {
    "illegal instructions": [
        "how to make meth",
        "build a bomb",
        "credit card fraud",
        "steal password",
        "buy illegal drugs",
        "money laundering",
        "bypass law enforcement",
        "counterfeit",
    ],
    "hate speech": [
        "ethnic cleansing",
        "lynch ",
        "kill all ",
        "race war",
        "white supremacy",
        "nazi propaganda",
    ],
    "violent wrongdoing": [
        "how to kill",
        "hide a body",
        "assassinate",
        "mass shooting",
        "terror attack",
    ],
}


@dataclass(frozen=True)
class VoiceStyle:
    sentiment: str
    emotion: str
    speed: float
    pitch_semitones: float


def normalize_text(text: str) -> str:
    return " ".join(text.strip().split())


def http_json_post(url: str, payload: dict[str, Any], timeout_seconds: int) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(req, timeout=timeout_seconds) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP {err.code}: {detail or err.reason}") from err
    except URLError as err:
        raise RuntimeError(f"Network error reaching {url}: {err}") from err

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as err:
        raise RuntimeError("Service returned invalid JSON.") from err

    if not isinstance(parsed, dict):
        raise RuntimeError("Service response was not a JSON object.")
    return parsed


def http_json_get(url: str, timeout_seconds: int) -> dict[str, Any]:
    req = Request(url, method="GET")
    try:
        with urlopen(req, timeout=timeout_seconds) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP {err.code}: {detail or err.reason}") from err
    except URLError as err:
        raise RuntimeError(f"Network error reaching {url}: {err}") from err

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as err:
        raise RuntimeError("Service returned invalid JSON.") from err

    if not isinstance(parsed, dict):
        raise RuntimeError("Service response was not a JSON object.")
    return parsed


def ensure_ollama_model(host: str, model: str, timeout_seconds: int) -> None:
    tags_url = f"{host.rstrip('/')}/api/tags"
    payload = http_json_get(tags_url, timeout_seconds=timeout_seconds)

    models = payload.get("models")
    if not isinstance(models, list):
        raise RuntimeError("Ollama /api/tags did not include a models list.")

    names: list[str] = []
    for model_entry in models:
        if isinstance(model_entry, dict):
            name = model_entry.get("name")
            if isinstance(name, str) and name.strip():
                names.append(name.strip())

    wanted = model.strip()
    found = any(name == wanted or name.startswith(f"{wanted}:") for name in names)
    if not found:
        available = ", ".join(names[:10]) if names else "(none)"
        raise RuntimeError(
            f"Ollama model '{wanted}' is not available. Run: ollama pull {wanted}. "
            f"Available: {available}"
        )


def ollama_chat(host: str, model: str, messages: list[dict[str, str]], timeout_seconds: int) -> str:
    url = f"{host.rstrip('/')}/api/chat"
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
    }
    response = http_json_post(url, payload=payload, timeout_seconds=timeout_seconds)
    message_obj = response.get("message")
    if not isinstance(message_obj, dict):
        raise RuntimeError("Ollama response missing message object.")

    content = message_obj.get("content")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("Ollama returned an empty message.")

    return content.strip()


def classify_sentiment_style(text: str) -> VoiceStyle:
    tokens = re.findall(r"[a-z']+", text.lower())
    score = 0
    for token in tokens:
        if token in POSITIVE_WORDS:
            score += 1
        elif token in NEGATIVE_WORDS:
            score -= 1

    if score >= 2:
        return VoiceStyle(sentiment="positive", emotion="happy", speed=1.08, pitch_semitones=1.25)
    if score <= -2:
        return VoiceStyle(sentiment="negative", emotion="sad", speed=0.92, pitch_semitones=-1.25)
    return VoiceStyle(sentiment="neutral", emotion="neutral", speed=1.0, pitch_semitones=0.0)


def detect_restricted_topics(text: str) -> tuple[bool, list[str]]:
    lowered = normalize_text(text).lower()
    if not lowered:
        return False, []

    matches: list[str] = []
    for category, keywords in RESTRICTED_TOPIC_KEYWORDS.items():
        for keyword in keywords:
            if keyword in lowered:
                matches.append(f"{category}:{keyword.strip()}")
                break

    return len(matches) > 0, matches


def load_tts(model_name: str, prefer_cuda: bool) -> tuple[Any, str]:
    use_cuda = bool(prefer_cuda and torch.cuda.is_available())
    initial_device = "cuda" if use_cuda else "cpu"
    print(f"[tts] Loading '{model_name}' on {initial_device}...")
    tts = TTS(model_name=model_name, progress_bar=False)

    if use_cuda:
        try:
            tts = tts.to("cuda")
            print("[tts] CUDA enabled.")
            return tts, "cuda"
        except Exception as err:
            print(f"[tts] CUDA failed ({err}). Falling back to CPU.")

    tts = tts.to("cpu")
    print("[tts] Using CPU.")
    return tts, "cpu"


def _tts_to_file_with_fallback(tts: Any, text: str, speaker_wav: str, output_wav: str, language: str, style: VoiceStyle) -> None:
    base_kwargs = {
        "text": text,
        "speaker_wav": speaker_wav,
        "language": language,
        "file_path": output_wav,
    }

    attempts = (
        {"emotion": style.emotion, "speed": style.speed},
        {"speed": style.speed},
        {"emotion": style.emotion},
        {},
    )

    last_error: Exception | None = None
    for extra in attempts:
        try:
            tts.tts_to_file(**base_kwargs, **extra)
            return
        except Exception as err:  # pragma: no cover
            last_error = err
            message = str(err).lower()
            unsupported = "unexpected keyword argument" in message or "got an unexpected keyword" in message
            if unsupported:
                continue
            if extra:
                continue
            raise

    if last_error is not None:
        raise last_error


def apply_speed_and_pitch_to_wav(input_wav: str, output_wav: str, speed: float, pitch_semitones: float) -> None:
    with wave.open(input_wav, "rb") as source:
        channels = source.getnchannels()
        sample_width = source.getsampwidth()
        frame_rate = source.getframerate()
        frames = source.readframes(source.getnframes())

    pitch_ratio = 2 ** (pitch_semitones / 12.0)
    combined_ratio = max(0.65, min(1.35, speed * pitch_ratio))
    new_rate = int(frame_rate * combined_ratio)
    new_rate = max(8000, min(96000, new_rate))

    with wave.open(output_wav, "wb") as target:
        target.setnchannels(channels)
        target.setsampwidth(sample_width)
        target.setframerate(new_rate)
        target.writeframes(frames)


def synthesize_to_file(
    tts: Any,
    device: str,
    text: str,
    speaker_wav: str,
    output_wav: str,
    language: str,
    style: VoiceStyle,
) -> tuple[Any, str]:
    raw_output = f"{output_wav}.raw.wav"
    try:
        _tts_to_file_with_fallback(
            tts=tts,
            text=text,
            speaker_wav=speaker_wav,
            output_wav=raw_output,
            language=language,
            style=style,
        )
        apply_speed_and_pitch_to_wav(raw_output, output_wav, speed=style.speed, pitch_semitones=style.pitch_semitones)
        return tts, device
    except Exception as err:
        if device != "cuda":
            raise
        print(f"[tts] CUDA synthesis failed ({err}). Retrying on CPU...")
        tts = tts.to("cpu")
        _tts_to_file_with_fallback(
            tts=tts,
            text=text,
            speaker_wav=speaker_wav,
            output_wav=raw_output,
            language=language,
            style=style,
        )
        apply_speed_and_pitch_to_wav(raw_output, output_wav, speed=style.speed, pitch_semitones=style.pitch_semitones)
        return tts, "cpu"
    finally:
        try:
            if os.path.exists(raw_output):
                os.remove(raw_output)
        except OSError:
            pass


class RealtimeVoiceBot:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.shutdown_event = threading.Event()
        self.is_speaking = threading.Event()
        self.playback_interrupt_event = threading.Event()

        self.stt_queue: queue.Queue[str | None] = queue.Queue(maxsize=args.queue_size)
        self.tts_queue: queue.Queue[dict[str, Any] | None] = queue.Queue(maxsize=args.queue_size)
        self.tts_queue_lock = threading.Lock()

        self.history_lock = threading.Lock()
        self.history: list[dict[str, str]] = [
            {
                "role": "system",
                "content": "You are Aries, a concise helpful local assistant. If uncertain, say so clearly.",
            }
        ]

        self.last_text_lock = threading.Lock()
        self.last_transcript = ""
        self.last_transcript_ts = 0.0

        self.wake_lock = threading.Lock()
        self.wake_active_until = 0.0
        self.wake_phrase = normalize_text(args.wake_phrase).lower()

        self.recognizer = sr.Recognizer()
        self.recognizer.energy_threshold = args.energy_threshold
        self.recognizer.pause_threshold = args.pause_threshold
        self.recognizer.dynamic_energy_threshold = not args.no_dynamic_energy

        self.vad = webrtcvad.Vad(max(0, min(3, args.vad_aggressiveness)))
        self.vosk_model: VoskModel | None = None
        self.vosk_recognizer: KaldiRecognizer | None = None

        self.rag_retriever: Any = None

        self.stop_listening_cb: Callable[[bool], None] | None = None
        self.workers: list[threading.Thread] = []

        self.tts: Any = None
        self.tts_device = "cpu"
        self.audit_log_path = Path(self.args.audit_log).expanduser().resolve()

    def startup_checks(self) -> None:
        if not os.path.isfile(self.args.reference_wav):
            raise RuntimeError(
                f"Reference WAV not found at '{self.args.reference_wav}'. "
                "Place a voice sample there before running."
            )

        print("[check] Verifying Ollama chat model...")
        ensure_ollama_model(self.args.ollama_host, self.args.model, timeout_seconds=self.args.timeout)
        print("[check] Chat model is available.")

        if self.args.rag_enabled:
            print("[check] Verifying Ollama embedding model for RAG...")
            ensure_ollama_model(self.args.ollama_host, self.args.rag_embedding_model, timeout_seconds=self.args.timeout)
            print("[check] Embedding model is available.")

        if not os.path.isdir(self.args.vosk_model_path):
            raise RuntimeError(
                f"Vosk model path does not exist: {self.args.vosk_model_path}\n"
                "Download a Vosk model and set --vosk-model-path."
            )
        self.vosk_model = VoskModel(self.args.vosk_model_path)
        self.vosk_recognizer = KaldiRecognizer(self.vosk_model, 16000)
        print("[check] Vosk wake-word recognizer ready.")

        self.tts, self.tts_device = load_tts(self.args.xtts_model, prefer_cuda=not self.args.cpu)
        print(f"[audit] Writing local usage log to: {self.audit_log_path}")

        print("[check] Building local RAG index...")
        self._build_rag_index()

        print("[check] Initializing audio playback...")
        pygame.mixer.init()
        print("[check] Audio playback ready.")

    def _build_rag_index(self) -> None:
        if not self.args.rag_enabled:
            self.rag_retriever = None
            print("[rag] Disabled by configuration.")
            return

        rag_dir = Path(self.args.rag_dir)
        if not rag_dir.exists() or not rag_dir.is_dir():
            self.rag_retriever = None
            print(f"[rag] Directory not found ({rag_dir}). Continuing without RAG.")
            return

        file_paths: list[Path] = []
        for extension in self.args.rag_extensions:
            file_paths.extend(rag_dir.rglob(f"*{extension}"))
        file_paths = [path for path in file_paths if path.is_file()]

        if not file_paths:
            self.rag_retriever = None
            print(f"[rag] No files found in {rag_dir} for extensions: {', '.join(self.args.rag_extensions)}.")
            return

        documents = []
        for path in file_paths:
            try:
                documents.extend(TextLoader(str(path), encoding="utf-8").load())
            except UnicodeDecodeError:
                documents.extend(TextLoader(str(path), autodetect_encoding=True).load())

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.args.rag_chunk_size,
            chunk_overlap=self.args.rag_chunk_overlap,
        )
        chunks = splitter.split_documents(documents)
        if not chunks:
            self.rag_retriever = None
            print("[rag] No text chunks produced. Continuing without RAG.")
            return

        embeddings = OllamaEmbeddings(
            base_url=self.args.ollama_host,
            model=self.args.rag_embedding_model,
        )
        vector = FAISS.from_documents(chunks, embeddings)
        self.rag_retriever = vector.as_retriever(search_kwargs={"k": self.args.rag_top_k})
        print(f"[rag] Indexed {len(chunks)} chunks from {len(file_paths)} file(s).")

    def _audit_log(self, event: str, prompt: str, detail: str = "") -> None:
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime())
        prompt_one_line = normalize_text(prompt).replace("|", "/")
        detail_one_line = normalize_text(detail).replace("|", "/")
        entry = f"{timestamp} | event={event} | prompt={prompt_one_line}"
        if detail_one_line:
            entry += f" | detail={detail_one_line}"

        try:
            self.audit_log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.audit_log_path.open("a", encoding="utf-8") as handle:
                handle.write(entry + "\n")
        except OSError as err:
            print(f"[audit] Could not write audit log: {err}")

    def _trimmed_history(self) -> list[dict[str, str]]:
        if self.args.max_history_messages <= 0:
            return list(self.history)

        base = self.history[:1]
        tail = self.history[1:][-self.args.max_history_messages :]
        return base + tail

    def _is_wake_active(self) -> bool:
        with self.wake_lock:
            return time.monotonic() < self.wake_active_until

    def _arm_wake_window(self) -> None:
        with self.wake_lock:
            self.wake_active_until = time.monotonic() + self.args.wake_window_seconds

    def _consume_wake_window(self) -> None:
        with self.wake_lock:
            self.wake_active_until = 0.0

    def _process_wake_word(self, pcm_16k: bytes) -> None:
        if self.vosk_recognizer is None:
            return

        detected_text = ""
        if self.vosk_recognizer.AcceptWaveform(pcm_16k):
            try:
                payload = json.loads(self.vosk_recognizer.Result())
                detected_text = normalize_text(str(payload.get("text", ""))).lower()
            except Exception:
                detected_text = ""
        else:
            try:
                partial = json.loads(self.vosk_recognizer.PartialResult())
                detected_text = normalize_text(str(partial.get("partial", ""))).lower()
            except Exception:
                detected_text = ""

        if not detected_text:
            return

        if self.wake_phrase in detected_text:
            was_active = self._is_wake_active()
            self._arm_wake_window()
            if not was_active:
                print(f"[wake] Detected wake phrase '{self.args.wake_phrase}'. Listening for next command...")

    def _voice_detected_over_threshold(self, pcm_16k: bytes) -> bool:
        frame_ms = self.args.vad_frame_ms
        sample_rate = 16000
        bytes_per_sample = 2
        frame_bytes = int(sample_rate * (frame_ms / 1000.0) * bytes_per_sample)
        if frame_bytes <= 0:
            return False

        consecutive_ms = 0
        for start in range(0, len(pcm_16k) - frame_bytes + 1, frame_bytes):
            frame = pcm_16k[start : start + frame_bytes]
            try:
                is_speech = self.vad.is_speech(frame, sample_rate)
            except Exception:
                is_speech = False

            if is_speech:
                consecutive_ms += frame_ms
                if consecutive_ms >= self.args.vad_interrupt_ms:
                    return True
            else:
                consecutive_ms = 0

        return False

    def _interrupt_tts_and_clear_queue(self, reason: str) -> None:
        if not self.is_speaking.is_set():
            return

        print(f"[vad] {reason}. Stopping Aries output now.")
        self.playback_interrupt_event.set()
        try:
            pygame.mixer.music.stop()
        except Exception:
            pass

        dropped = 0
        with self.tts_queue_lock:
            sentinel_found = False
            while True:
                try:
                    item = self.tts_queue.get_nowait()
                except queue.Empty:
                    break
                if item is None:
                    sentinel_found = True
                    continue
                dropped += 1

            if sentinel_found:
                try:
                    self.tts_queue.put_nowait(None)
                except queue.Full:
                    pass

        if dropped > 0:
            print(f"[vad] Cleared {dropped} queued response(s).")

    def _retrieve_rag_context(self, query: str) -> str:
        if self.rag_retriever is None:
            return ""

        try:
            docs = self.rag_retriever.invoke(query)
        except Exception as err:
            print(f"[rag-error] Retrieval failed: {err}")
            return ""

        context_parts: list[str] = []
        for doc in docs:
            source = str(doc.metadata.get("source", "local"))
            snippet = normalize_text(str(doc.page_content))
            if not snippet:
                continue
            snippet = snippet[: self.args.rag_chunk_char_limit]
            context_parts.append(f"[{source}] {snippet}")

        context = "\n\n".join(context_parts)
        return context[: self.args.rag_context_char_limit]

    def _on_audio(self, recognizer: sr.Recognizer, audio: sr.AudioData) -> None:
        if self.shutdown_event.is_set():
            return

        try:
            pcm_16k = audio.get_raw_data(convert_rate=16000, convert_width=2)
        except Exception:
            return

        self._process_wake_word(pcm_16k)

        if self.is_speaking.is_set() and self._voice_detected_over_threshold(pcm_16k):
            self._interrupt_tts_and_clear_queue("User speech detected during playback")
            return

        if not self._is_wake_active():
            return

        if self.is_speaking.is_set():
            return

        try:
            text = recognizer.recognize_sphinx(audio)
        except sr.UnknownValueError:
            return
        except sr.RequestError as err:
            print(f"[stt-error] PocketSphinx failure: {err}")
            return

        clean = normalize_text(text)
        if len(clean) < self.args.min_chars:
            return

        now = time.monotonic()
        with self.last_text_lock:
            is_dup = clean == self.last_transcript and (now - self.last_transcript_ts) < self.args.dedupe_seconds
            if is_dup:
                return
            self.last_transcript = clean
            self.last_transcript_ts = now

        self._consume_wake_window()
        try:
            self.stt_queue.put_nowait(clean)
            print(f"\nYou: {clean}")
            self._audit_log("user-prompt", clean)
        except queue.Full:
            print("[stt] queue is full; dropping transcript chunk.")

    def _llm_worker(self) -> None:
        while not self.shutdown_event.is_set():
            try:
                transcript = self.stt_queue.get(timeout=0.25)
            except queue.Empty:
                continue

            if transcript is None:
                break

            try:
                context = self._retrieve_rag_context(transcript)

                with self.history_lock:
                    self.history.append({"role": "user", "content": transcript})
                    messages = self._trimmed_history()

                if context and messages:
                    context_message = {
                        "role": "system",
                        "content": (
                            "Use the following local context when relevant. "
                            "If context conflicts with known facts, say so clearly.\n\n"
                            f"{context}"
                        ),
                    }
                    messages = messages[:-1] + [context_message, messages[-1]]

                reply = ollama_chat(
                    host=self.args.ollama_host,
                    model=self.args.model,
                    messages=messages,
                    timeout_seconds=self.args.timeout,
                )
                print(f"Aries: {reply}\n")

                with self.history_lock:
                    self.history.append({"role": "assistant", "content": reply})

                prompt_high_risk, prompt_matches = detect_restricted_topics(transcript)
                reply_high_risk, reply_matches = detect_restricted_topics(reply)
                high_risk = prompt_high_risk or reply_high_risk
                risk_matches = [*prompt_matches, *reply_matches]
                spoken_text = (
                    f"{HIGH_RISK_AUDIO_DISCLAIMER} {reply}"
                    if high_risk
                    else reply
                )

                if high_risk:
                    self._audit_log(
                        "high-risk-response",
                        transcript,
                        detail=f"matches={','.join(risk_matches) if risk_matches else 'none'}",
                    )
                    print("[guardrail] High-risk content detected. Disclaimer prepended to spoken output.")

                style = classify_sentiment_style(reply)
                print(f"[voice] sentiment={style.sentiment}, speed={style.speed:.2f}, pitch={style.pitch_semitones:+.2f}st")

                try:
                    self.tts_queue.put(
                        {
                            "text": spoken_text,
                            "style": style,
                            "risk_matches": risk_matches,
                        },
                        timeout=1.0,
                    )
                except queue.Full:
                    print("[tts] queue is full; dropping assistant response.")
            except Exception as err:
                print(f"[llm-error] {err}")

    def _play_audio_blocking(self, wav_path: str) -> None:
        self.playback_interrupt_event.clear()
        self.is_speaking.set()
        try:
            pygame.mixer.music.load(wav_path)
            pygame.mixer.music.play()
            while pygame.mixer.music.get_busy():
                if self.shutdown_event.is_set() or self.playback_interrupt_event.is_set():
                    pygame.mixer.music.stop()
                    break
                time.sleep(0.02)
        finally:
            self.is_speaking.clear()
            self.playback_interrupt_event.clear()

    def _tts_worker(self) -> None:
        while not self.shutdown_event.is_set():
            try:
                item = self.tts_queue.get(timeout=0.25)
            except queue.Empty:
                continue

            if item is None:
                break

            text = str(item.get("text", "")).strip()
            style = item.get("style")
            if not isinstance(style, VoiceStyle):
                style = classify_sentiment_style(text)

            if not text:
                continue

            tts_high_risk, tts_matches = detect_restricted_topics(text)
            if tts_high_risk and not text.startswith(HIGH_RISK_AUDIO_DISCLAIMER):
                text = f"{HIGH_RISK_AUDIO_DISCLAIMER} {text}"
                self._audit_log(
                    "tts-guardrail-injected",
                    text,
                    detail=f"matches={','.join(tts_matches) if tts_matches else 'none'}",
                )

            try:
                self.tts, self.tts_device = synthesize_to_file(
                    tts=self.tts,
                    device=self.tts_device,
                    text=text,
                    speaker_wav=self.args.reference_wav,
                    output_wav=self.args.output_wav,
                    language=self.args.language,
                    style=style,
                )
                print(f"[audio] Saved: {os.path.abspath(self.args.output_wav)}")
                self._play_audio_blocking(self.args.output_wav)
            except Exception as err:
                print(f"[tts-error] {err}")

    def _start_workers(self) -> None:
        llm_thread = threading.Thread(target=self._llm_worker, name="llm-worker", daemon=True)
        tts_thread = threading.Thread(target=self._tts_worker, name="tts-worker", daemon=True)
        self.workers = [llm_thread, tts_thread]
        for worker in self.workers:
            worker.start()

    def _start_microphone(self) -> None:
        microphone = sr.Microphone()
        with microphone as source:
            print(f"[stt] Calibrating ambient noise for {self.args.calibration_seconds:.1f}s...")
            self.recognizer.adjust_for_ambient_noise(source, duration=self.args.calibration_seconds)

        print("[stt] Background microphone capture started.")
        self.stop_listening_cb = self.recognizer.listen_in_background(
            microphone,
            self._on_audio,
            phrase_time_limit=self.args.phrase_time_limit,
        )

    def run(self) -> int:
        self.startup_checks()
        self._start_workers()
        self._start_microphone()

        print("\nAries local real-time voice bot is running.")
        print(f"Say '{self.args.wake_phrase}' before each command.")
        print("Press Ctrl+C to stop.\n")

        while not self.shutdown_event.is_set():
            time.sleep(0.2)
        return 0

    def shutdown(self) -> None:
        if self.shutdown_event.is_set():
            return

        self.shutdown_event.set()
        print("\n[shutdown] Stopping Aries local voice bot...")

        if self.stop_listening_cb is not None:
            try:
                self.stop_listening_cb(wait_for_stop=False)
            except Exception:
                pass
            self.stop_listening_cb = None

        self.playback_interrupt_event.set()
        try:
            pygame.mixer.music.stop()
        except Exception:
            pass

        for target_queue in (self.stt_queue, self.tts_queue):
            try:
                target_queue.put_nowait(None)
            except queue.Full:
                pass

        for worker in self.workers:
            worker.join(timeout=2.0)

        if pygame.mixer.get_init():
            pygame.mixer.quit()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Aries local real-time voice bot: wake-word + VAD + RAG + XTTS."
    )

    parser.add_argument("--ollama-host", default="http://127.0.0.1:11434", help="Ollama base URL")
    parser.add_argument("--model", default="llama3", help="Ollama chat model")
    parser.add_argument("--timeout", type=int, default=120, help="Ollama request timeout seconds")

    parser.add_argument("--reference-wav", default="reference.wav", help="Voice cloning reference WAV")
    parser.add_argument("--output-wav", default="response.wav", help="Output WAV file path")
    parser.add_argument("--xtts-model", default="tts_models/multilingual/multi-dataset/xtts_v2", help="XTTS model id")
    parser.add_argument("--language", default="en", help="XTTS language code")
    parser.add_argument("--cpu", action="store_true", help="Force CPU mode for XTTS")

    parser.add_argument("--wake-phrase", default="Aries wake up", help="Wake phrase required before command capture")
    parser.add_argument("--wake-window-seconds", type=float, default=8.0, help="Seconds to accept command after wake")
    parser.add_argument(
        "--vosk-model-path",
        default="models/vosk-model-small-en-us-0.15",
        help="Path to local Vosk model directory",
    )

    parser.add_argument("--vad-aggressiveness", type=int, default=2, help="webrtcvad aggressiveness (0-3)")
    parser.add_argument("--vad-frame-ms", type=int, default=30, help="VAD frame duration (10, 20, 30)")
    parser.add_argument("--vad-interrupt-ms", type=int, default=500, help="Speech duration to interrupt TTS playback")

    parser.add_argument("--phrase-time-limit", type=float, default=1.5, help="Seconds per STT chunk")
    parser.add_argument("--energy-threshold", type=int, default=280, help="SpeechRecognition energy threshold")
    parser.add_argument("--pause-threshold", type=float, default=0.8, help="SpeechRecognition pause threshold")
    parser.add_argument("--calibration-seconds", type=float, default=0.8, help="Ambient noise calibration duration")
    parser.add_argument("--no-dynamic-energy", action="store_true", help="Disable dynamic energy thresholding")

    parser.add_argument("--min-chars", type=int, default=2, help="Minimum recognized command length")
    parser.add_argument("--dedupe-seconds", type=float, default=1.2, help="Duplicate command suppression window")
    parser.add_argument("--queue-size", type=int, default=32, help="Queue size for STT and TTS workers")
    parser.add_argument("--max-history-messages", type=int, default=24, help="Maximum non-system history messages")
    parser.add_argument("--audit-log", default="usage_audit.log", help="Local compliance audit log file")

    parser.add_argument(
        "--rag-enabled",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Enable local RAG retrieval",
    )
    parser.add_argument("--rag-dir", default="rag_data", help="Local folder containing RAG text files")
    parser.add_argument(
        "--rag-extensions",
        nargs="+",
        default=[".txt", ".md", ".markdown"],
        help="File extensions to index for RAG",
    )
    parser.add_argument("--rag-top-k", type=int, default=4, help="Number of retrieved chunks")
    parser.add_argument("--rag-chunk-size", type=int, default=900, help="RAG chunk size")
    parser.add_argument("--rag-chunk-overlap", type=int, default=120, help="RAG chunk overlap")
    parser.add_argument("--rag-embedding-model", default="nomic-embed-text", help="Ollama embedding model for RAG")
    parser.add_argument("--rag-chunk-char-limit", type=int, default=600, help="Per chunk character cap in prompt")
    parser.add_argument("--rag-context-char-limit", type=int, default=2400, help="Total RAG context character cap")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.vad_frame_ms not in {10, 20, 30}:
        print("[fatal] --vad-frame-ms must be one of: 10, 20, 30")
        return 1

    bot = RealtimeVoiceBot(args)

    def _handle_signal(_sig: int, _frame: Any) -> None:
        bot.shutdown()

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    try:
        return bot.run()
    except KeyboardInterrupt:
        return 0
    except Exception as err:
        print(f"[fatal] {err}")
        return 1
    finally:
        bot.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
