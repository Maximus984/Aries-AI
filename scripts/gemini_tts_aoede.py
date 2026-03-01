#!/usr/bin/env python3
"""
Synthesize speech with Google Cloud Text-to-Speech using Gemini TTS model + Aoede voice.

Defaults:
- model: gemini-2.5-flash-tts
- voice: Aoede (Chirp 3 HD)
- output: gemini_voice.mp3
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from google.cloud import texttospeech_v1 as texttospeech


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Gemini TTS (Aoede) MP3 synthesis.")
  parser.add_argument(
      "--text",
      default="Hey there! I'm Aries. I'm here to help with your ideas in a cheerful and clear way.",
      help="Text to synthesize."
  )
  parser.add_argument(
      "--style-prompt",
      default="Sound cheerful, warm, and helpful. Speak naturally with confident pacing and clear pronunciation.",
      help="Natural-language style guidance for the voice."
  )
  parser.add_argument("--voice", default="Aoede", help="Prebuilt voice name.")
  parser.add_argument("--language-code", default="en-US", help="Voice language code.")
  parser.add_argument("--model", default="gemini-2.5-flash-tts", help="Gemini TTS model name.")
  parser.add_argument("--output", default="gemini_voice.mp3", help="Output mp3 path.")
  parser.add_argument(
      "--location",
      default="global",
      help="API location (e.g. global, us, eu). Uses default endpoint for global."
  )
  return parser.parse_args()


def build_client(location: str) -> texttospeech.TextToSpeechClient:
  if location == "global":
    return texttospeech.TextToSpeechClient()
  endpoint = f"{location}-texttospeech.googleapis.com"
  return texttospeech.TextToSpeechClient(client_options={"api_endpoint": endpoint})


def maybe_apply_style_prompt(request_kwargs: dict, style_prompt: str) -> None:
  # Best-effort: newer client versions may expose structured style controls.
  # If unavailable, style guidance is prepended to input text as fallback.
  try:
    advanced_opts = texttospeech.AdvancedVoiceOptions(prompt=style_prompt)
    request_kwargs["advanced_voice_options"] = advanced_opts
    return
  except Exception:
    pass

  try:
    advanced_opts = texttospeech.AdvancedVoiceOptions(style=style_prompt)
    request_kwargs["advanced_voice_options"] = advanced_opts
  except Exception:
    # No advanced prompt field available in this SDK version.
    pass


def create_request(
    text: str,
    style_prompt: str,
    voice_name: str,
    language_code: str,
    model_name: str
) -> texttospeech.SynthesizeSpeechRequest:
  styled_text = f"[Style guidance: {style_prompt}]\n{text}"
  synthesis_input = texttospeech.SynthesisInput(text=styled_text)

  voice = texttospeech.VoiceSelectionParams(
      language_code=language_code,
      name=voice_name
  )

  audio_config = texttospeech.AudioConfig(
      audio_encoding=texttospeech.AudioEncoding.MP3
  )

  # SDK compatibility: some versions put model on request, others on audio config.
  try:
    audio_config.model_name = model_name
  except Exception:
    pass

  base_kwargs = {
      "input": synthesis_input,
      "voice": voice,
      "audio_config": audio_config
  }

  maybe_apply_style_prompt(base_kwargs, style_prompt)

  for field_name in ("model", "model_name"):
    try:
      return texttospeech.SynthesizeSpeechRequest(**base_kwargs, **{field_name: model_name})
    except Exception:
      continue

  return texttospeech.SynthesizeSpeechRequest(**base_kwargs)


def main() -> int:
  args = parse_args()

  try:
    client = build_client(args.location.strip().lower())
    request = create_request(
        text=args.text.strip(),
        style_prompt=args.style_prompt.strip(),
        voice_name=args.voice.strip(),
        language_code=args.language_code.strip(),
        model_name=args.model.strip()
    )
    response = client.synthesize_speech(request=request)
  except Exception as exc:
    print(f"[error] TTS synthesis failed: {exc}", file=sys.stderr)
    return 1

  output_path = Path(args.output).expanduser().resolve()
  output_path.parent.mkdir(parents=True, exist_ok=True)
  output_path.write_bytes(response.audio_content)
  print(f"[ok] Wrote audio: {output_path}")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
