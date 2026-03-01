const ENGLISH_LANG_PATTERN = /^en[-_]/i;
const CALM_VOICE_NAME_PATTERN =
  /jenny|aria|sara|samantha|ava|allison|serena|moira|natural|neural|enhanced|premium|online/i;

const normalizeSpeechText = (value: string): string =>
  value
    .replace(/\n+/g, ". ")
    .replace(/\s+/g, " ")
    .replace(/\s([,.!?;:])/g, "$1")
    .trim();

const pickCalmVoice = (voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null => {
  if (voices.length === 0) {
    return null;
  }

  const scored = voices.map((voice) => {
    let score = 0;
    if (ENGLISH_LANG_PATTERN.test(voice.lang)) {
      score += 40;
    }
    if (CALM_VOICE_NAME_PATTERN.test(voice.name)) {
      score += 35;
    }
    if (!voice.localService) {
      score += 10;
    }
    if (voice.default) {
      score += 5;
    }
    return { voice, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.voice ?? null;
};

const pickVoiceByName = (
  voices: SpeechSynthesisVoice[],
  voiceName?: string,
  voiceLang?: string
): SpeechSynthesisVoice | null => {
  if (!voiceName) {
    return null;
  }

  const exact = voices.find(
    (voice) => voice.name === voiceName && (!voiceLang || voice.lang.toLowerCase() === voiceLang.toLowerCase())
  );
  if (exact) {
    return exact;
  }

  return voices.find((voice) => voice.name === voiceName) ?? null;
};

export type BrowserSpeechVoice = {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
};

export const listBrowserSpeechVoices = (): BrowserSpeechVoice[] => {
  if (!canSpeakText()) {
    return [];
  }

  return window.speechSynthesis.getVoices().map((voice) => ({
    name: voice.name,
    lang: voice.lang,
    localService: voice.localService,
    default: voice.default
  }));
};

export const canSpeakText = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window;

export const stopTextSpeech = () => {
  if (!canSpeakText()) {
    return;
  }
  window.speechSynthesis.cancel();
};

export const speakText = (
  text: string,
  options?: {
    rate?: number;
    pitch?: number;
    volume?: number;
    voiceName?: string;
    voiceLang?: string;
    onStart?: () => void;
    onEnd?: () => void;
  }
) => {
  if (!canSpeakText()) {
    return false;
  }

  const content = normalizeSpeechText(text);
  if (!content) {
    return false;
  }

  const synthesis = window.speechSynthesis;
  synthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(content);
  const voices = synthesis.getVoices();
  const voice = pickVoiceByName(voices, options?.voiceName, options?.voiceLang) ?? pickCalmVoice(voices);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = "en-US";
  }

  utterance.rate = options?.rate ?? 0.92;
  utterance.pitch = options?.pitch ?? 0.95;
  utterance.volume = options?.volume ?? 0.95;
  utterance.onstart = () => options?.onStart?.();
  utterance.onend = () => options?.onEnd?.();
  utterance.onerror = () => options?.onEnd?.();
  synthesis.speak(utterance);
  return true;
};
