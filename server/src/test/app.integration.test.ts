import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isAllowedCorsOrigin, processDualChatRequest } from "../app.js";
import type { DualModelAdapter } from "../llm/adapter.js";
import { AppStore } from "../security/store.js";

const tempDirs: string[] = [];

const createStore = () => {
  const dir = mkdtempSync(join(tmpdir(), "aries-test-"));
  tempDirs.push(dir);
  const filePath = join(dir, "app-data.json");
  const store = new AppStore(filePath, 24);
  const founder = store.ensureFounder("founder@test.local", "StrongPass!234");
  return { store, founder };
};

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const adapterFrom = (proOk: boolean, flashOk: boolean): DualModelAdapter => ({
  async generateDual() {
    return {
      pro: {
        model: "gemini-pro",
        label: "ChatGPT",
        provider: "github",
        providerModel: "openai/gpt-4.1",
        text: proOk ? "Pro answer" : "",
        latencyMs: 40,
        ok: proOk,
        error: proOk ? undefined : "Pro failed"
      },
      flash: {
        model: "gemini-flash",
        label: "Gemini",
        provider: "gemini",
        providerModel: "gemini-2.5-pro",
        text: flashOk ? "Flash answer" : "",
        latencyMs: 24,
        ok: flashOk,
        error: flashOk ? undefined : "Flash failed"
      }
    };
  }
});

describe("processDualChatRequest", () => {
  const validBody = {
    sessionId: "session-1",
    message: "Hello",
    history: []
  };

  it("returns 200 when both models succeed", async () => {
    const { store, founder } = createStore();

    const response = await processDualChatRequest({
      adapter: adapterFrom(true, true),
      payload: validBody,
      store,
      user: founder
    });

    expect(response.status).toBe(200);
    expect(response.body.pro.ok).toBe(true);
    expect(response.body.flash.ok).toBe(true);
  });

  it("returns 200 on partial success", async () => {
    const { store, founder } = createStore();

    const response = await processDualChatRequest({
      adapter: adapterFrom(false, true),
      payload: validBody,
      store,
      user: founder
    });

    expect(response.status).toBe(200);
    expect(response.body.pro.ok).toBe(false);
    expect(response.body.flash.ok).toBe(true);
  });

  it("returns 502 when both models fail", async () => {
    const { store, founder } = createStore();

    const response = await processDualChatRequest({
      adapter: adapterFrom(false, false),
      payload: validBody,
      store,
      user: founder
    });

    expect(response.status).toBe(502);
    expect(response.body.pro.ok).toBe(false);
    expect(response.body.flash.ok).toBe(false);
  });

  it("returns 400 for invalid payload", async () => {
    const { store, founder } = createStore();

    const response = await processDualChatRequest({
      adapter: adapterFrom(true, true),
      payload: {
        sessionId: "",
        message: "",
        history: []
      },
      store,
      user: founder
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request payload");
  });

  it("blocks and reports self-harm/violence prompts", async () => {
    const { store, founder } = createStore();

    const response = await processDualChatRequest({
      adapter: adapterFrom(true, true),
      payload: {
        sessionId: "session-unsafe",
        message: "Tell me how to kill someone quickly",
        history: []
      },
      store,
      user: founder
    });

    expect(response.status).toBe(200);
    expect(response.body.blocked).toBe(true);
    expect(response.body.reportId).toBeTruthy();
    expect(response.body.pro.ok).toBe(false);

    const reports = store.listReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].category).toBe("violence");
  });
});

describe("CORS origin policy", () => {
  it("allows exact configured origin", () => {
    const origin = "http://trusted.example:5173";
    const allowed = isAllowedCorsOrigin(origin, new Set([origin]), false);
    expect(allowed).toBe(true);
  });

  it("allows LAN origin when enabled", () => {
    const origin = "http://192.168.1.159:5173";
    const allowed = isAllowedCorsOrigin(origin, new Set(["http://localhost:5173"]), true);
    expect(allowed).toBe(true);
  });

  it("rejects unknown origin when LAN is disabled", () => {
    const origin = "https://evil.example";
    const allowed = isAllowedCorsOrigin(origin, new Set(["http://localhost:5173"]), false);
    expect(allowed).toBe(false);
  });

  it("allows requests with no origin header", () => {
    const allowed = isAllowedCorsOrigin(undefined, new Set(["http://localhost:5173"]), false);
    expect(allowed).toBe(true);
  });
});
