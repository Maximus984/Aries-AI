import type { AuthUser, ChatSession, StudioImageItem } from "./types";

export const LEGACY_STORAGE_KEY = "aries.sessions.v2";
export const LEGACY_ACTIVE_SESSION_KEY = "aries.activeSession.v2";

export const STORAGE_KEY_PREFIX = "aries.sessions.byUser.v3";
export const ACTIVE_SESSION_KEY_PREFIX = "aries.activeSession.byUser.v3";

export const AUTH_TOKEN_KEY = "aries.auth.token.v1";
export const AUTH_USER_KEY = "aries.auth.user.v1";
export const STUDIO_IMAGES_KEY = "aries.studio.images.v1";
export const LIVE_VISUAL_FULLSCREEN_KEY = "aries.live.visualFullscreen.v1";
export const LIVE_VOICE_KEY_PREFIX = "aries.live.voice.byUser.v1";

const scopedKey = (prefix: string, userId: string) => `${prefix}:${userId}`;

export const saveSessions = (userId: string, sessions: ChatSession[]) => {
  localStorage.setItem(scopedKey(STORAGE_KEY_PREFIX, userId), JSON.stringify(sessions));
};

export const loadSessions = (userId: string): ChatSession[] => {
  const currentRaw = localStorage.getItem(scopedKey(STORAGE_KEY_PREFIX, userId));
  const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
  const raw = currentRaw ?? legacyRaw;

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as ChatSession[];
  } catch {
    return [];
  }
};

export const saveActiveSessionId = (userId: string, sessionId: string) => {
  localStorage.setItem(scopedKey(ACTIVE_SESSION_KEY_PREFIX, userId), sessionId);
};

export const loadActiveSessionId = (userId: string): string | null =>
  localStorage.getItem(scopedKey(ACTIVE_SESSION_KEY_PREFIX, userId)) ?? localStorage.getItem(LEGACY_ACTIVE_SESSION_KEY);

export const saveAuth = (token: string, user: AuthUser) => {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
};

export const loadAuth = (): { token: string; user: AuthUser } | null => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const userRaw = localStorage.getItem(AUTH_USER_KEY);

  if (!token || !userRaw) {
    return null;
  }

  try {
    const user = JSON.parse(userRaw) as AuthUser;
    if (!user || typeof user.email !== "string") {
      return null;
    }

    return { token, user };
  } catch {
    return null;
  }
};

export const clearAuth = () => {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
};

export const saveStudioImages = (images: StudioImageItem[]) => {
  localStorage.setItem(STUDIO_IMAGES_KEY, JSON.stringify(images));
};

export const loadStudioImages = (): StudioImageItem[] => {
  const raw = localStorage.getItem(STUDIO_IMAGES_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as StudioImageItem[];
  } catch {
    return [];
  }
};

export const saveLiveVisualFullscreenPreference = (enabled: boolean) => {
  sessionStorage.setItem(LIVE_VISUAL_FULLSCREEN_KEY, enabled ? "1" : "0");
};

export const loadLiveVisualFullscreenPreference = (): boolean => {
  const raw = sessionStorage.getItem(LIVE_VISUAL_FULLSCREEN_KEY);
  if (raw === null) {
    return true;
  }

  return raw === "1";
};

export const saveLiveVoiceSelection = (userId: string, voiceId: string) => {
  localStorage.setItem(scopedKey(LIVE_VOICE_KEY_PREFIX, userId), voiceId);
};

export const loadLiveVoiceSelection = (userId: string): string | null =>
  localStorage.getItem(scopedKey(LIVE_VOICE_KEY_PREFIX, userId));
