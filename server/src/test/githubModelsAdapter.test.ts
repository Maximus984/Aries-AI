import { describe, expect, it, vi } from "vitest";
import { HybridDualModelAdapter } from "../llm/githubModelsAdapter.js";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

describe("HybridDualModelAdapter", () => {
  it("supports GitHub and Gemini lanes in one request", async () => {
    const fetchMock = vi.fn(async (input: FetchInput, init?: FetchInit) => {
      const url = String(input);

      if (url.endsWith("/chat/completions")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "ChatGPT response" } }] }), {
          status: 200
        });
      }

      if (url.includes(":generateContent")) {
        const body = JSON.parse((init?.body as string) ?? "{}") as { contents?: Array<{ parts?: Array<{ text?: string }> }> };
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.["X-goog-api-key"] || headers?.["x-goog-api-key"]).toBe("gem_test");
        expect(body.contents?.length).toBeGreaterThan(0);
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Gemini response" }] } }]
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ error: { message: "Unexpected URL" } }), { status: 404 });
    });

    const adapter = new HybridDualModelAdapter({
      timeoutMs: 5000,
      githubToken: "ghp_test",
      githubBaseUrl: "https://example.com",
      geminiApiKey: "gem_test",
      geminiBaseUrl: "https://gemini.example/models",
      proLane: {
        provider: "github",
        model: "openai/gpt-4.1",
        label: "ChatGPT"
      },
      flashLane: {
        provider: "gemini",
        model: "gemini-2.5-pro",
        label: "Gemini"
      },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    const result = await adapter.generateDual({
      sessionId: "session-1",
      message: "Compare this",
      history: [{ role: "user", content: "Prior question" }]
    });

    expect(result.pro.ok).toBe(true);
    expect(result.pro.text).toBe("ChatGPT response");
    expect(result.pro.provider).toBe("github");
    expect(result.flash.ok).toBe(true);
    expect(result.flash.text).toBe("Gemini response");
    expect(result.flash.provider).toBe("gemini");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns partial failure when one lane errors", async () => {
    const fetchMock = vi.fn(async (input: FetchInput) => {
      const url = String(input);
      if (url.endsWith("/chat/completions")) {
        return new Response(JSON.stringify({ error: { message: "GitHub lane unavailable" } }), { status: 503 });
      }

      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Gemini still works" }] } }]
        }),
        { status: 200 }
      );
    });

    const adapter = new HybridDualModelAdapter({
      timeoutMs: 5000,
      githubToken: "ghp_test",
      githubBaseUrl: "https://example.com",
      geminiApiKey: "gem_test",
      geminiBaseUrl: "https://gemini.example/models",
      proLane: {
        provider: "github",
        model: "openai/gpt-4.1",
        label: "ChatGPT"
      },
      flashLane: {
        provider: "gemini",
        model: "gemini-2.5-pro",
        label: "Gemini"
      },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    const result = await adapter.generateDual({
      sessionId: "session-2",
      message: "Hello",
      history: []
    });

    expect(result.pro.ok).toBe(false);
    expect(result.pro.error).toContain("GitHub lane unavailable");
    expect(result.flash.ok).toBe(true);
  });

  it("falls back to the next Gemini key when the first key fails", async () => {
    let geminiAttempt = 0;
    const fetchMock = vi.fn(async (input: FetchInput, init?: FetchInit) => {
      const url = String(input);

      if (url.endsWith("/chat/completions")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "Primary lane response" } }] }), {
          status: 200
        });
      }

      if (url.includes(":generateContent")) {
        geminiAttempt += 1;
        const headers = init?.headers as Record<string, string> | undefined;
        if (geminiAttempt === 1) {
          expect(headers?.["X-goog-api-key"] || headers?.["x-goog-api-key"]).toBe("bad_key");
          return new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 });
        }

        expect(headers?.["X-goog-api-key"] || headers?.["x-goog-api-key"]).toBe("good_key");
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Recovered via fallback key" }] } }]
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ error: { message: "Unexpected URL" } }), { status: 404 });
    });

    const adapter = new HybridDualModelAdapter({
      timeoutMs: 5000,
      githubToken: "ghp_test",
      githubBaseUrl: "https://example.com",
      geminiApiKeys: ["bad_key", "good_key"],
      geminiBaseUrl: "https://gemini.example/models",
      proLane: {
        provider: "github",
        model: "openai/gpt-4.1",
        label: "Primary"
      },
      flashLane: {
        provider: "gemini",
        model: "gemini-2.5-pro",
        label: "Fallback lane"
      },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    const result = await adapter.generateDual({
      sessionId: "session-fallback",
      message: "test fallback",
      history: []
    });

    expect(result.pro.ok).toBe(true);
    expect(result.flash.ok).toBe(true);
    expect(result.flash.text).toBe("Recovered via fallback key");
    expect(geminiAttempt).toBe(2);
  });

  it("maps timeout to structured errors", async () => {
    const fetchMock = vi.fn(
      async (_input: FetchInput, init?: FetchInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        })
    );

    const adapter = new HybridDualModelAdapter({
      timeoutMs: 10,
      githubToken: "ghp_test",
      githubBaseUrl: "https://example.com",
      geminiApiKey: "gem_test",
      geminiBaseUrl: "https://gemini.example/models",
      proLane: {
        provider: "github",
        model: "openai/gpt-4.1",
        label: "ChatGPT"
      },
      flashLane: {
        provider: "gemini",
        model: "gemini-2.5-pro",
        label: "Gemini"
      },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    const result = await adapter.generateDual({
      sessionId: "session-3",
      message: "timeout",
      history: []
    });

    expect(result.pro.ok).toBe(false);
    expect(result.pro.error).toBe("Request timed out");
    expect(result.flash.ok).toBe(false);
    expect(result.flash.error).toBe("Request timed out");
  });

  it("injects temporal grounding into lane payloads", async () => {
    let githubBody: Record<string, unknown> | null = null;
    let geminiBody: Record<string, unknown> | null = null;

    const fetchMock = vi.fn(async (input: FetchInput, init?: FetchInit) => {
      const url = String(input);

      if (url.endsWith("/chat/completions")) {
        githubBody = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
      }

      if (url.includes(":generateContent")) {
        geminiBody = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "ok" }] } }]
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ error: { message: "Unexpected URL" } }), { status: 404 });
    });

    const adapter = new HybridDualModelAdapter({
      timeoutMs: 5000,
      githubToken: "ghp_test",
      githubBaseUrl: "https://example.com",
      geminiApiKey: "gem_test",
      geminiBaseUrl: "https://gemini.example/models",
      proLane: {
        provider: "github",
        model: "openai/gpt-4.1",
        label: "Primary"
      },
      flashLane: {
        provider: "gemini",
        model: "gemini-2.5-pro",
        label: "Secondary"
      },
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    await adapter.generateDual({
      sessionId: "session-timing",
      message: "What time is it?",
      history: [],
      clientNowIso: "2026-02-28T16:10:00.000Z",
      clientTimeZone: "America/Los_Angeles",
      clientLocale: "en-US"
    });

    const githubMessages = (githubBody?.messages as Array<{ role?: string; content?: string }> | undefined) ?? [];
    expect(githubMessages[0]?.role).toBe("system");
    expect(githubMessages[0]?.content).toContain("Client reported timezone");

    const geminiSystemInstruction = geminiBody?.systemInstruction as { parts?: Array<{ text?: string }> } | undefined;
    expect(geminiSystemInstruction?.parts?.[0]?.text).toContain("Current server UTC time");
  });
});
