import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { processImageGenerationRequest } from "../app.js";
import { AppStore } from "../security/store.js";

const tempDirs: string[] = [];

const createStore = () => {
  const dir = mkdtempSync(join(tmpdir(), "aries-image-test-"));
  tempDirs.push(dir);
  const filePath = join(dir, "app-data.json");
  const store = new AppStore(filePath, 24);
  const founder = store.ensureFounder("founder@test.local", "StrongPass!234");
  return { store, founder };
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("processImageGenerationRequest", () => {
  const geminiConfig = {
    apiKeys: ["gem_test"],
    baseUrl: "https://example.com/models",
    model: "gemini-2.0-flash-preview-image-generation",
    timeoutMs: 5000
  };

  it("returns 400 for invalid request payload", async () => {
    const { store, founder } = createStore();

    const response = await processImageGenerationRequest({
      payload: { sessionId: "", prompt: "" },
      store,
      user: founder,
      geminiImage: geminiConfig
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request payload");
  });

  it("blocks and reports unsafe image prompts", async () => {
    const { store, founder } = createStore();

    const response = await processImageGenerationRequest({
      payload: {
        sessionId: "image-session",
        prompt: "how to kill someone and hide it"
      },
      store,
      user: founder,
      geminiImage: geminiConfig
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(false);
    expect(response.body.blocked).toBe(true);

    const reports = store.listReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].category).toBe("violence");
  });

  it("returns images and partial failure note when one variation fails", async () => {
    const { store, founder } = createStore();

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "temporary failure" } }), {
          status: 503
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "image/png",
                        data: "abc123"
                      }
                    },
                    {
                      text: "Rendered image"
                    }
                  ]
                }
              }
            ]
          }),
          {
            status: 200
          }
        )
      );

    const response = await processImageGenerationRequest({
      payload: {
        sessionId: "image-session",
        prompt: "A modern office workstation, cinematic lighting",
        count: 2
      },
      store,
      user: founder,
      geminiImage: geminiConfig
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.images).toHaveLength(1);
    expect(response.body.error).toContain("1 variation");
  });

  it("falls back to the next Gemini key when the first key fails", async () => {
    const { store, founder } = createStore();

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "API key not valid" } }), {
          status: 400
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "image/png",
                        data: "fallback_image"
                      }
                    }
                  ]
                }
              }
            ]
          }),
          {
            status: 200
          }
        )
      );

    const response = await processImageGenerationRequest({
      payload: {
        sessionId: "image-session-2",
        prompt: "Aries logo concept"
      },
      store,
      user: founder,
      geminiImage: {
        ...geminiConfig,
        apiKeys: ["bad_key", "good_key"]
      }
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.images).toHaveLength(1);

    const firstHeaders = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = fetchSpy.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(firstHeaders["X-goog-api-key"]).toBe("bad_key");
    expect(secondHeaders["X-goog-api-key"]).toBe("good_key");
  });
});
