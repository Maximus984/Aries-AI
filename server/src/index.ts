import dotenv from "dotenv";
import express from "express";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { HybridDualModelAdapter } from "./llm/githubModelsAdapter.js";
import { AppStore } from "./security/store.js";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env") });

const config = loadConfig();

const store = new AppStore(config.DATA_FILE, config.SESSION_TTL_HOURS);
const founder = store.ensureFounder(config.FOUNDER_EMAIL, config.FOUNDER_PASSWORD);
const admin = store.ensureSystemAccount(config.ADMIN_EMAIL, config.ADMIN_PASSWORD, "admin");
const monitor = store.ensureSystemAccount(config.MONITOR_EMAIL, config.MONITOR_PASSWORD, "staff");

const adapter = new HybridDualModelAdapter({
  timeoutMs: config.REQUEST_TIMEOUT_MS,
  githubToken: config.GITHUB_TOKEN || undefined,
  githubBaseUrl: config.GITHUB_MODELS_BASE_URL,
  geminiApiKeys: config.geminiApiKeys,
  geminiBaseUrl: config.GEMINI_API_BASE_URL,
  proLane: {
    provider: config.LANE_PRO_PROVIDER,
    model: config.LANE_PRO_MODEL,
    label: config.LANE_PRO_LABEL
  },
  flashLane: {
    provider: config.LANE_FLASH_PROVIDER,
    model: config.LANE_FLASH_MODEL,
    label: config.LANE_FLASH_LABEL
  }
});

const app = createApp({
  adapter,
  clientOrigins: config.clientOrigins,
  allowLanOrigins: config.allowLanOrigins,
  redirectRootToClientOrigin: !config.serveClientApp,
  store,
  geminiImage: {
    apiKeys: config.geminiApiKeys,
    baseUrl: config.GEMINI_API_BASE_URL,
    model: config.GEMINI_IMAGE_MODEL,
    timeoutMs: config.GEMINI_IMAGE_TIMEOUT_MS
  },
  founderTerminal: {
    cwd: config.FOUNDER_TERMINAL_CWD,
    timeoutMs: config.FOUNDER_TERMINAL_TIMEOUT_MS,
    allowedPrefixes: config.FOUNDER_TERMINAL_ALLOWED_PREFIXES.split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  },
  elevenlabs: {
    apiKey: config.ELEVENLABS_API_KEY || undefined,
    voiceId: config.ELEVENLABS_VOICE_ID,
    modelId: config.ELEVENLABS_MODEL_ID,
    baseUrl: config.ELEVENLABS_BASE_URL,
    voiceOptions: config.elevenlabsVoiceOptions
  }
});

const clientDistDir = resolve(__dirname, "../../client/dist");
const clientIndexHtml = join(clientDistDir, "index.html");
const canServeClientBuild = config.serveClientApp && existsSync(clientIndexHtml);

if (canServeClientBuild) {
  app.use(express.static(clientDistDir, { index: false }));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(clientIndexHtml);
  });
}

app.listen(config.PORT, () => {
  console.log(`Aries server listening on http://localhost:${config.PORT}`);
  console.log(`Founder account ready: ${founder.email}`);
  console.log(`Admin account ready: ${admin.email}`);
  console.log(`Monitor account ready: ${monitor.email}`);
  if (canServeClientBuild) {
    console.log(`Serving Aries website from ${clientDistDir}`);
  }
});
