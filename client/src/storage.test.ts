import { beforeEach, describe, expect, it } from "vitest";
import {
  loadLiveVisualFullscreenPreference,
  loadLiveVoiceSelection,
  loadActiveSessionId,
  loadSessions,
  loadStudioImages,
  saveLiveVisualFullscreenPreference,
  saveLiveVoiceSelection,
  saveActiveSessionId,
  saveSessions,
  saveStudioImages
} from "./storage";
import type { ChatSession, StudioImageItem } from "./types";

const fixture: ChatSession[] = [
  {
    sessionId: "s1",
    title: "Test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    turns: [
      {
        id: "t1",
        userText: "hello",
        createdAt: "2026-01-01T00:00:00.000Z",
        pro: {
          model: "gemini-pro",
          text: "hi",
          latencyMs: 100,
          ok: true
        },
        flash: {
          model: "gemini-flash",
          text: "hi",
          latencyMs: 50,
          ok: true
        }
      }
    ]
  }
];

const imageFixture: StudioImageItem[] = [
  {
    id: "img-1",
    prompt: "Modern workspace",
    createdAt: "2026-01-01T00:00:00.000Z",
    model: "gemini-2.0-flash-preview-image-generation",
    latencyMs: 1200,
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,abc123"
  }
];

describe("storage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("persists and restores chat sessions per user", () => {
    saveSessions("user-1", fixture);
    const restored = loadSessions("user-1");

    expect(restored).toEqual(fixture);
    expect(loadSessions("user-2")).toEqual([]);
  });

  it("persists and restores active session id per user", () => {
    saveActiveSessionId("user-1", "s1");
    expect(loadActiveSessionId("user-1")).toBe("s1");
    expect(loadActiveSessionId("user-2")).toBeNull();
  });

  it("persists and restores generated studio images", () => {
    saveStudioImages(imageFixture);
    const restored = loadStudioImages();

    expect(restored).toEqual(imageFixture);
  });

  it("defaults live visual fullscreen preference to true", () => {
    expect(loadLiveVisualFullscreenPreference()).toBe(true);
  });

  it("persists and restores live visual fullscreen session preference", () => {
    saveLiveVisualFullscreenPreference(true);
    expect(loadLiveVisualFullscreenPreference()).toBe(true);

    saveLiveVisualFullscreenPreference(false);
    expect(loadLiveVisualFullscreenPreference()).toBe(false);
  });

  it("persists live voice selection per user", () => {
    saveLiveVoiceSelection("user-1", "eleven:voice-abc");

    expect(loadLiveVoiceSelection("user-1")).toBe("eleven:voice-abc");
    expect(loadLiveVoiceSelection("user-2")).toBeNull();
  });
});
