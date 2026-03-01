import cors from "cors";
import express from "express";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { AI_GUIDELINES, TERMS_OF_USE } from "./legal/content.js";
import type { DualModelAdapter } from "./llm/adapter.js";
import { detectGuardrailViolation } from "./security/guardrails.js";
import { getRoleCapabilityMatrix, hasPermission } from "./security/permissions.js";
import type { AppStore } from "./security/store.js";
import { executeFounderCommand } from "./security/terminal.js";
import type { DualChatResponse, ImageGenerationResponse, PublicApiKey, PublicUser } from "./types.js";
import {
  accountActionSchema,
  createApiKeySchema,
  createUserSchema,
  dualChatRequestSchema,
  feedbackReportSchema,
  imageGenerationRequestSchema,
  liveTtsSchema,
  reportStatusSchema,
  signInSchema,
  signUpSchema,
  terminalCommandSchema
} from "./validators.js";

type CreateAppOptions = {
  adapter: DualModelAdapter;
  clientOrigins: string[];
  allowLanOrigins: boolean;
  redirectRootToClientOrigin?: boolean;
  store: AppStore;
  geminiImage: {
    apiKeys: string[];
    baseUrl: string;
    model: string;
    timeoutMs: number;
  };
  founderTerminal: {
    cwd: string;
    timeoutMs: number;
    allowedPrefixes: string[];
  };
  elevenlabs: {
    apiKey?: string;
    voiceId: string;
    modelId: string;
    baseUrl: string;
    voiceOptions: Array<{
      voiceId: string;
      label: string;
      description?: string;
    }>;
  };
};

type ProcessDualChatOptions = {
  adapter: DualModelAdapter;
  payload: unknown;
  store: AppStore;
  user: PublicUser;
};

type ProcessImageGenerationOptions = {
  payload: unknown;
  store: AppStore;
  user: PublicUser;
  geminiImage: {
    apiKeys: string[];
    baseUrl: string;
    model: string;
    timeoutMs: number;
  };
};

type GeminiImageResponsePayload = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType?: string;
          data?: string;
        };
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

type AuthContext = {
  user: PublicUser;
  token?: string;
  apiKey?: string;
};

type ElevenLabsVoiceOption = {
  voiceId: string;
  label: string;
  description?: string;
};

const unauthorized = {
  status: 401,
  body: {
    error: "Authentication required"
  }
};

const forbidden = {
  status: 403,
  body: {
    error: "Permission denied"
  }
};

const blockedIpResponse = {
  status: 403,
  body: {
    error: "Access denied"
  }
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 180;
const RATE_LIMIT_MAX_AUTH_REQUESTS = 40;

type RateLimitBucket = {
  windowStart: number;
  count: number;
  authCount: number;
};

const getHeaderToken = (authorizationHeader: string | undefined): string | null => {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();
  return token || null;
};

const getApiKeyHeader = (headerValue: string | string[] | undefined): string | null => {
  if (!headerValue) {
    return null;
  }

  if (Array.isArray(headerValue)) {
    return headerValue[0] ?? null;
  }

  return headerValue.trim() || null;
};

const getRequestIp = (req: express.Request): string => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0]!.trim();
  }

  if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].trim();
  }

  return req.ip || req.socket.remoteAddress || "unknown";
};

const getSessionContext = (authorizationHeader: string | undefined, store: AppStore): AuthContext | null => {
  const token = getHeaderToken(authorizationHeader);
  if (!token) {
    return null;
  }

  const user = store.getUserByToken(token);
  if (!user) {
    return null;
  }

  return {
    user,
    token
  };
};

const getApiKeyContext = (apiKeyHeader: string | string[] | undefined, store: AppStore): AuthContext | null => {
  const apiKey = getApiKeyHeader(apiKeyHeader);
  if (!apiKey) {
    return null;
  }

  const user = store.getUserByApiKey(apiKey);
  if (!user) {
    return null;
  }

  return {
    user,
    apiKey
  };
};

const getAuthContext = (
  authorizationHeader: string | undefined,
  apiKeyHeader: string | string[] | undefined,
  store: AppStore
): AuthContext | null => getSessionContext(authorizationHeader, store) ?? getApiKeyContext(apiKeyHeader, store);

const createImageErrorMessage = (status: number, payload: GeminiImageResponsePayload): string => {
  const raw = payload.error?.message ?? `Image request failed (${status})`;
  if (raw.toLowerCase().includes("api key not valid")) {
    return "Invalid service key. Update server/.env with a valid key and restart the service.";
  }
  return raw;
};

const USER_SAFE_FAILURE_MESSAGE = "Aries couldn't complete that request right now. Please try again.";

const OPERATIONAL_SIGNAL_PATTERN =
  /\b(api\s*key|service\s*key|credential|quota|rate\s*limit|limit\s*exceeded|429|billing|forbidden|unauthorized|timed\s*out|unavailable|overloaded|capacity)\b/i;

const unique = (values: string[]): string[] =>
  values.filter((value, index, list) => list.indexOf(value) === index);

const sanitizeFailureForUser = (message: string, user: PublicUser): string =>
  user.role === "user" ? USER_SAFE_FAILURE_MESSAGE : message;

const toOperationalSignals = (messages: string[]): string[] => {
  const normalized = messages
    .map((message) => message.trim())
    .filter((message) => message.length > 0);
  const matched = normalized.filter((message) => OPERATIONAL_SIGNAL_PATTERN.test(message));
  if (matched.length > 0) {
    return unique(matched).slice(0, 6);
  }

  return normalized.length > 0 ? unique(normalized).slice(0, 3) : ["service-failure"];
};

const createOperationalReport = (input: {
  store: AppStore;
  user: PublicUser;
  source: "chat" | "image" | "live-tts";
  prompt: string;
  signals: string[];
}) => {
  input.store.createReport({
    category: "operations",
    message: `[${input.source}] ${input.prompt}`,
    matched: input.signals,
    userId: input.user.id,
    userEmail: input.user.email
  });
};

const callGeminiImageVariant = async (input: {
  apiKeys: string[];
  baseUrl: string;
  model: string;
  prompt: string;
  timeoutMs: number;
}): Promise<{ images: Array<{ mimeType: string; base64: string }>; text: string; latencyMs: number }> => {
  let totalLatencyMs = 0;
  let lastError = "Image generation failed";

  for (const apiKey of input.apiKeys) {
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const response = await fetch(`${input.baseUrl}/${input.model}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: input.prompt }]
            }
          ],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"]
          }
        }),
        signal: controller.signal
      });

      const latencyMs = Math.round(performance.now() - startedAt);
      totalLatencyMs += latencyMs;
      const payload = (await response.json()) as GeminiImageResponsePayload;

      if (!response.ok) {
        lastError = createImageErrorMessage(response.status, payload);
        continue;
      }

      const parts = payload.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
      const images = parts
        .map((part) => part.inlineData)
        .filter((part): part is { mimeType?: string; data?: string } => Boolean(part?.data))
        .map((inlineData) => ({
          mimeType: inlineData.mimeType ?? "image/png",
          base64: inlineData.data ?? ""
        }))
        .filter((image) => image.base64.length > 0);

      const text = parts
        .map((part) => part.text ?? "")
        .join("\n")
        .trim();

      if (images.length === 0) {
        lastError = payload.error?.message ?? "Model returned no image data. Try a more descriptive prompt.";
        continue;
      }

      return {
        images,
        text,
        latencyMs: totalLatencyMs
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startedAt);
      totalLatencyMs += latencyMs;
      if (error instanceof DOMException && error.name === "AbortError") {
        lastError = "Image generation timed out";
      } else if (error instanceof Error) {
        lastError = error.message;
      } else {
        lastError = "Image generation failed";
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(lastError);
};

const callElevenLabsTts = async (input: {
  apiKey: string;
  baseUrl: string;
  voiceId: string;
  modelId: string;
  text: string;
}): Promise<{ audioBase64: string; mimeType: string }> => {
  const response = await fetch(`${input.baseUrl}/text-to-speech/${input.voiceId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": input.apiKey
    },
    body: JSON.stringify({
      text: input.text,
      model_id: input.modelId,
      voice_settings: {
        stability: 0.36,
        similarity_boost: 0.9,
        style: 0.3,
        use_speaker_boost: true
      }
    })
  });

  if (!response.ok) {
    let detail = `ElevenLabs request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { detail?: { message?: string } | string };
      if (typeof payload.detail === "string") {
        detail = payload.detail;
      } else if (payload.detail?.message) {
        detail = payload.detail.message;
      }
    } catch {
      // ignore parse errors and keep default error text
    }
    throw new Error(detail);
  }

  const bytes = Buffer.from(await response.arrayBuffer()).toString("base64");
  return {
    audioBase64: bytes,
    mimeType: "audio/mpeg"
  };
};

const toPublicLiveVoiceOptions = (voices: ElevenLabsVoiceOption[], defaultVoiceId: string) =>
  voices.map((voice) => ({
    id: `eleven:${voice.voiceId}`,
    provider: "elevenlabs" as const,
    voiceId: voice.voiceId,
    label: voice.label,
    description: voice.description,
    isDefault: voice.voiceId === defaultVoiceId
  }));

export const processDualChatRequest = async ({ adapter, payload, store, user }: ProcessDualChatOptions) => {
  const parsed = dualChatRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: "Invalid request payload",
        details: parsed.error.flatten()
      }
    };
  }

  const guardrail = detectGuardrailViolation(parsed.data.message);
  if (guardrail.blocked && guardrail.category) {
    const report = store.createReport({
      category: guardrail.category,
      message: parsed.data.message,
      matched: guardrail.matched,
      userId: user.id,
      userEmail: user.email
    });

    const blockedResponse: DualChatResponse = {
      sessionId: parsed.data.sessionId,
      timestamp: new Date().toISOString(),
      blocked: true,
      reportId: report.id,
      pro: {
        model: "gemini-pro",
        label: "Guardrail",
        provider: "safety",
        providerModel: "safety-block",
        text: "",
        latencyMs: 0,
        ok: false,
        error:
          "This request violates Aries safety guardrails (self-harm/violence). The request has been blocked and reported to admins."
      },
      flash: {
        model: "gemini-flash",
        label: "Guardrail",
        provider: "safety",
        providerModel: "safety-block",
        text: "",
        latencyMs: 0,
        ok: false,
        error:
          "This request violates Aries safety guardrails (self-harm/violence). The request has been blocked and reported to admins."
      }
    };

    return {
      status: 200,
      body: blockedResponse
    };
  }

  try {
    const result = await adapter.generateDual(parsed.data);
    const response: DualChatResponse = {
      sessionId: parsed.data.sessionId,
      timestamp: new Date().toISOString(),
      pro: result.pro,
      flash: result.flash
    };

    const failedLaneErrors = [response.pro.error, response.flash.error].filter(
      (message): message is string => typeof message === "string" && message.trim().length > 0
    );
    if (failedLaneErrors.length > 0) {
      createOperationalReport({
        store,
        user,
        source: "chat",
        prompt: parsed.data.message,
        signals: toOperationalSignals(failedLaneErrors)
      });
    }

    if (user.role === "user") {
      if (!response.pro.ok) {
        response.pro.error = USER_SAFE_FAILURE_MESSAGE;
      }

      if (!response.flash.ok) {
        response.flash.error = USER_SAFE_FAILURE_MESSAGE;
      }
    }

    const bothFailed = !response.pro.ok && !response.flash.ok;

    return {
      status: bothFailed ? 502 : 200,
      body: response
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    createOperationalReport({
      store,
      user,
      source: "chat",
      prompt: parsed.data.message,
      signals: toOperationalSignals([message])
    });

    const safeMessage = sanitizeFailureForUser(message, user);
    const failedResponse: DualChatResponse = {
      sessionId: parsed.data.sessionId,
      timestamp: new Date().toISOString(),
      pro: {
        model: "gemini-pro",
        text: "",
        latencyMs: 0,
        ok: false,
        error: safeMessage
      },
      flash: {
        model: "gemini-flash",
        text: "",
        latencyMs: 0,
        ok: false,
        error: safeMessage
      }
    };

    return {
      status: 502,
      body: failedResponse
    };
  }
};

export const processImageGenerationRequest = async ({
  payload,
  store,
  user,
  geminiImage
}: ProcessImageGenerationOptions) => {
  const parsed = imageGenerationRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: "Invalid request payload",
        details: parsed.error.flatten()
      }
    };
  }

  const guardrail = detectGuardrailViolation(parsed.data.prompt);
  if (guardrail.blocked && guardrail.category) {
    const report = store.createReport({
      category: guardrail.category,
      message: parsed.data.prompt,
      matched: guardrail.matched,
      userId: user.id,
      userEmail: user.email
    });

    const blockedResponse: ImageGenerationResponse = {
      sessionId: parsed.data.sessionId,
      timestamp: new Date().toISOString(),
      prompt: parsed.data.prompt,
      model: geminiImage.model,
      provider: "gemini",
      latencyMs: 0,
      ok: false,
      images: [],
      blocked: true,
      reportId: report.id,
      error:
        "This request violates Aries safety guardrails (self-harm/violence). The request has been blocked and reported to admins."
    };

    return {
      status: 200,
      body: blockedResponse
    };
  }

  if (geminiImage.apiKeys.length === 0) {
    createOperationalReport({
      store,
      user,
      source: "image",
      prompt: parsed.data.prompt,
      signals: ["Service key is not configured"]
    });

    const unavailableResponse: ImageGenerationResponse = {
      sessionId: parsed.data.sessionId,
      timestamp: new Date().toISOString(),
      prompt: parsed.data.prompt,
      model: geminiImage.model,
      provider: "gemini",
      latencyMs: 0,
      ok: false,
      images: [],
      error: sanitizeFailureForUser("Service key is not configured", user)
    };

    return {
      status: 503,
      body: unavailableResponse
    };
  }

  const attempts = Array.from({ length: parsed.data.count }, () =>
    callGeminiImageVariant({
      apiKeys: geminiImage.apiKeys,
      baseUrl: geminiImage.baseUrl,
      model: geminiImage.model,
      prompt: parsed.data.prompt,
      timeoutMs: geminiImage.timeoutMs
    })
  );

  const settled = await Promise.allSettled(attempts);
  const successful = settled.filter(
    (entry): entry is PromiseFulfilledResult<{ images: Array<{ mimeType: string; base64: string }>; text: string; latencyMs: number }> =>
      entry.status === "fulfilled"
  );

  const totalLatency = successful.reduce((sum, result) => sum + result.value.latencyMs, 0);
  const images = successful.flatMap((result) => result.value.images);
  const firstText = successful.find((result) => result.value.text.trim().length > 0)?.value.text;
  const failed = settled.filter(
    (entry): entry is PromiseRejectedResult => entry.status === "rejected"
  );

  if (images.length === 0) {
    const errorMessage = failed[0]?.reason instanceof Error ? failed[0].reason.message : "Image generation failed";
    createOperationalReport({
      store,
      user,
      source: "image",
      prompt: parsed.data.prompt,
      signals: toOperationalSignals([errorMessage])
    });

    const failedResponse: ImageGenerationResponse = {
      sessionId: parsed.data.sessionId,
      timestamp: new Date().toISOString(),
      prompt: parsed.data.prompt,
      model: geminiImage.model,
      provider: "gemini",
      latencyMs: Math.max(totalLatency, 0),
      ok: false,
      images: [],
      error: sanitizeFailureForUser(errorMessage, user)
    };

    return {
      status: 502,
      body: failedResponse
    };
  }

  const response: ImageGenerationResponse = {
    sessionId: parsed.data.sessionId,
    timestamp: new Date().toISOString(),
    prompt: parsed.data.prompt,
    model: geminiImage.model,
    provider: "gemini",
    latencyMs: Math.max(totalLatency, 0),
    ok: true,
    images,
    text: firstText,
    error:
      failed.length > 0
        ? `${failed.length} variation${failed.length === 1 ? "" : "s"} failed while others succeeded.`
        : undefined
  };

  if (failed.length > 0) {
    const reasons = failed.map((entry) => (entry.reason instanceof Error ? entry.reason.message : "Variation failed"));
    createOperationalReport({
      store,
      user,
      source: "image",
      prompt: parsed.data.prompt,
      signals: toOperationalSignals(reasons)
    });

    if (user.role === "user") {
      response.error = undefined;
    }
  }

  return {
    status: 200,
    body: response
  };
};

const canCreateRole = (creator: PublicUser, targetRole: "admin" | "staff" | "user"): boolean => {
  if (targetRole === "admin") {
    return hasPermission(creator.role, "users:create:admin");
  }

  if (targetRole === "staff") {
    return hasPermission(creator.role, "users:create:staff");
  }

  return hasPermission(creator.role, "users:create:user");
};

const canModerateTarget = (actor: PublicUser, target: PublicUser): boolean => {
  if (target.role === "founder") {
    return actor.role === "founder";
  }

  if (actor.role === "founder") {
    return true;
  }

  if (actor.role === "admin") {
    return target.role === "staff" || target.role === "user";
  }

  return false;
};

const canManageApiKey = (actor: PublicUser, key: PublicApiKey): boolean => {
  if (hasPermission(actor.role, "apikeys:view:any")) {
    return true;
  }

  return hasPermission(actor.role, "apikeys:view:own") && key.ownerUserId === actor.id;
};

const normalizeOrigin = (origin: string): string | null => {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
};

const parseIPv4 = (hostname: string): number[] | null => {
  const cleaned = hostname.startsWith("::ffff:") ? hostname.slice("::ffff:".length) : hostname;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(cleaned)) {
    return null;
  }

  const parts = cleaned.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts;
};

const isLanHostname = (hostname: string): boolean => {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower === "::1") {
    return true;
  }

  const ipv4 = parseIPv4(lower);
  if (!ipv4) {
    return false;
  }

  const [first, second] = ipv4;
  if (first === 127) {
    return true;
  }
  if (first === 10) {
    return true;
  }
  if (first === 192 && second === 168) {
    return true;
  }
  return first === 172 && second >= 16 && second <= 31;
};

export const isAllowedCorsOrigin = (
  origin: string | undefined,
  allowedOrigins: Set<string>,
  allowLanOrigins: boolean
): boolean => {
  if (!origin) {
    return true;
  }

  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return false;
  }

  if (allowedOrigins.has(normalized)) {
    return true;
  }

  if (!allowLanOrigins) {
    return false;
  }

  const parsed = new URL(normalized);
  if (parsed.protocol !== "http:") {
    return false;
  }

  return isLanHostname(parsed.hostname);
};

export const createApp = ({
  adapter,
  clientOrigins,
  allowLanOrigins,
  redirectRootToClientOrigin,
  store,
  geminiImage,
  founderTerminal,
  elevenlabs
}: CreateAppOptions) => {
  const app = express();
  const rateLimitBuckets = new Map<string, RateLimitBucket>();
  const defaultClientOrigin = clientOrigins[0] ?? "http://localhost:5173";
  const shouldRedirectRootToClientOrigin = redirectRootToClientOrigin ?? true;
  const liveVoiceCatalog = toPublicLiveVoiceOptions(elevenlabs.voiceOptions, elevenlabs.voiceId);
  const allowedLiveVoiceIds = new Set(liveVoiceCatalog.map((voice) => voice.voiceId ?? ""));
  const allowedOrigins = new Set(
    clientOrigins
      .map((origin) => normalizeOrigin(origin))
      .filter((origin): origin is string => Boolean(origin))
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        if (isAllowedCorsOrigin(origin ?? undefined, allowedOrigins, allowLanOrigins)) {
          callback(null, true);
          return;
        }

        callback(new Error(`CORS origin not allowed: ${origin ?? "unknown"}`));
      },
      methods: ["GET", "POST", "PATCH", "OPTIONS"],
      credentials: false
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.disable("x-powered-by");
  app.set("trust proxy", true);

  if (shouldRedirectRootToClientOrigin) {
    app.get("/", (_req, res) => {
      res.redirect(302, defaultClientOrigin);
    });
  }

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "microphone=(self), camera=()");
    next();
  });

  app.use((req, res, next) => {
    if (!req.path.startsWith("/api")) {
      return next();
    }

    const ip = getRequestIp(req);
    if (store.isIpBanned(ip)) {
      return res.status(blockedIpResponse.status).json(blockedIpResponse.body);
    }

    return next();
  });

  app.use((req, res, next) => {
    if (!req.path.startsWith("/api")) {
      return next();
    }

    const ip = getRequestIp(req);
    const now = Date.now();
    const bucket = rateLimitBuckets.get(ip);
    if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      rateLimitBuckets.set(ip, { windowStart: now, count: 1, authCount: req.path.startsWith("/api/auth") ? 1 : 0 });
      return next();
    }

    bucket.count += 1;
    if (req.path.startsWith("/api/auth")) {
      bucket.authCount += 1;
    }

    if (bucket.count > RATE_LIMIT_MAX_REQUESTS || bucket.authCount > RATE_LIMIT_MAX_AUTH_REQUESTS) {
      return res.status(429).json({
        error: "Too many requests. Please wait a moment and try again."
      });
    }

    return next();
  });

  app.get("/api/health", (_req, res) => {
    const imageReady = geminiImage.apiKeys.length > 0;
    const voiceReady = Boolean(elevenlabs.apiKey);
    const checks = {
      api: "ok",
      chat: "ok",
      image: imageReady ? "ok" : "degraded",
      liveVoice: voiceReady ? "ok" : "fallback"
    };

    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      checks,
      betaReady: checks.api === "ok" && checks.chat === "ok",
      diagnostics: {
        allowLanOrigins,
        allowedOrigins: [...allowedOrigins],
        imageKeysConfigured: geminiImage.apiKeys.length,
        elevenLabsConfigured: voiceReady
      }
    });
  });

  app.get("/api/legal/terms", (_req, res) => {
    res.status(200).json(TERMS_OF_USE);
  });

  app.get("/api/legal/guidelines", (_req, res) => {
    res.status(200).json(AI_GUIDELINES);
  });

  app.get("/api/live/voices", (req, res) => {
    const auth = getAuthContext(req.headers.authorization, req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    if (!hasPermission(auth.user.role, "chat:use")) {
      return res.status(forbidden.status).json(forbidden.body);
    }

    return res.status(200).json({
      configured: Boolean(elevenlabs.apiKey),
      voices: elevenlabs.apiKey ? liveVoiceCatalog : []
    });
  });

  app.post("/api/auth/signup", (req, res) => {
    const parsed = signUpSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid signup payload",
        details: parsed.error.flatten()
      });
    }

    try {
      const user = store.createUser(parsed.data.email, parsed.data.password, "user");
      const token = store.createSession(user.id);
      store.addAuditEvent({
        action: "signup",
        actorUserId: user.id,
        actorEmail: user.email,
        targetUserId: user.id,
        targetEmail: user.email,
        ip: getRequestIp(req)
      });
      const signedIn = store.recordSignIn(user.id, getRequestIp(req)) ?? user;

      return res.status(201).json({ token, user: signedIn });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create account";
      return res.status(409).json({ error: message });
    }
  });

  app.post("/api/auth/signin", (req, res) => {
    const parsed = signInSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid signin payload",
        details: parsed.error.flatten()
      });
    }

    const user = store.signIn(parsed.data.email, parsed.data.password);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const ip = getRequestIp(req);
    const token = store.createSession(user.id);
    const signedIn = store.recordSignIn(user.id, ip) ?? user;
    store.addAuditEvent({
      action: "signin",
      actorUserId: user.id,
      actorEmail: user.email,
      targetUserId: user.id,
      targetEmail: user.email,
      ip
    });
    return res.status(200).json({ token, user: signedIn });
  });

  app.post("/api/auth/signout", (req, res) => {
    const session = getSessionContext(req.headers.authorization, store);
    if (!session) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    store.revokeSession(session.token!);
    store.addAuditEvent({
      action: "signout",
      actorUserId: session.user.id,
      actorEmail: session.user.email,
      targetUserId: session.user.id,
      targetEmail: session.user.email,
      ip: getRequestIp(req)
    });
    return res.status(200).json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    const auth = getAuthContext(req.headers.authorization, req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    return res.status(200).json({ user: auth.user });
  });

  app.get("/api/auth/permissions", (req, res) => {
    const auth = getAuthContext(req.headers.authorization, req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    return res.status(200).json({
      ...getRoleCapabilityMatrix(auth.user.role),
      roleHierarchy: ["founder", "admin", "staff", "user"]
    });
  });

  app.post("/api/reports/feedback", (req, res) => {
    const auth = getAuthContext(req.headers.authorization, req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    if (!hasPermission(auth.user.role, "reports:create:feedback")) {
      return res.status(forbidden.status).json(forbidden.body);
    }

    const parsed = feedbackReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid feedback payload",
        details: parsed.error.flatten()
      });
    }

    const report = store.createReport({
      category: "feedback",
      message: parsed.data.message,
      matched: parsed.data.page ? [`page:${parsed.data.page}`] : ["user-feedback"],
      userId: auth.user.id,
      userEmail: auth.user.email
    });

    store.addAuditEvent({
      action: "report-feedback",
      actorUserId: auth.user.id,
      actorEmail: auth.user.email,
      targetUserId: auth.user.id,
      targetEmail: auth.user.email,
      ip: getRequestIp(req),
      note: parsed.data.page ? `page=${parsed.data.page}` : undefined
    });

    return res.status(201).json({
      ok: true,
      reportId: report.id
    });
  });

  app.get("/api/admin/reports", (req, res) => {
    const auth = getAuthContext(req.headers.authorization, req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    if (!hasPermission(auth.user.role, "reports:view")) {
      return res.status(forbidden.status).json(forbidden.body);
    }

    return res.status(200).json({ reports: store.listReports() });
  });

  app.patch("/api/admin/reports/:reportId", (req, res) => {
    const auth = getAuthContext(req.headers.authorization, req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    if (!hasPermission(auth.user.role, "reports:manage")) {
      return res.status(forbidden.status).json(forbidden.body);
    }

    const parsed = reportStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid report update payload", details: parsed.error.flatten() });
    }

    const updated = store.updateReportStatus(req.params.reportId, parsed.data.status);
    if (!updated) {
      return res.status(404).json({ error: "Report not found" });
    }

    return res.status(200).json({ report: updated });
  });

  app.get("/api/admin/audit", (req, res) => {
    const auth = getAuthContext(req.headers.authorization, req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    if (!hasPermission(auth.user.role, "users:view")) {
      return res.status(forbidden.status).json(forbidden.body);
    }

    return res.status(200).json({
      audit: store.listAccountAudit()
    });
  });

  app.get("/api/admin/banned-ips", (req, res) => {
    const auth = getAuthContext(req.headers.authorization, req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    if (!hasPermission(auth.user.role, "users:view")) {
      return res.status(forbidden.status).json(forbidden.body);
    }

    return res.status(200).json({
      bannedIps: store.listBannedIps()
    });
  });

  app.get("/api/admin/users", (req, res) => {
    const auth = getAuthContext(req.headers.authorization, req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    if (!hasPermission(auth.user.role, "users:view")) {
      return res.status(forbidden.status).json(forbidden.body);
    }

    return res.status(200).json({ users: store.listUsers() });
  });

  app.post("/api/admin/users", (req, res) => {
    const auth = getAuthContext(req.headers.authorization, req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid user creation payload",
        details: parsed.error.flatten()
      });
    }

    if (!canCreateRole(auth.user, parsed.data.role)) {
      return res.status(forbidden.status).json(forbidden.body);
    }

    try {
      const user = store.createUser(parsed.data.email, parsed.data.password, parsed.data.role);
      return res.status(201).json({ user });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create user";
      return res.status(409).json({ error: message });
    }
  });

  app.get("/api/admin/api-keys", (req, res) => {
    const auth = getAuthContext(req.headers.authorization, req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    if (hasPermission(auth.user.role, "apikeys:view:any")) {
      return res.status(200).json({ apiKeys: store.listApiKeys() });
    }

    if (hasPermission(auth.user.role, "apikeys:view:own")) {
      return res.status(200).json({ apiKeys: store.listApiKeysForUser(auth.user.id) });
    }

    return res.status(forbidden.status).json(forbidden.body);
  });

  app.post("/api/admin/api-keys", (req, res) => {
    const auth = getAuthContext(req.headers.authorization, req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    const parsed = createApiKeySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid access key payload", details: parsed.error.flatten() });
    }

    let owner = auth.user;

    if (parsed.data.ownerEmail) {
      if (!hasPermission(auth.user.role, "apikeys:create:any")) {
        return res.status(forbidden.status).json(forbidden.body);
      }

      const found = store.getUserByEmail(parsed.data.ownerEmail);
      if (!found) {
        return res.status(404).json({ error: "Owner account not found" });
      }

      owner = found;
    } else if (!hasPermission(auth.user.role, "apikeys:create:own")) {
      return res.status(forbidden.status).json(forbidden.body);
    }

    if (owner.role === "user") {
      return res.status(400).json({ error: "Access keys can only be issued for founder, admin, or staff accounts" });
    }

    const created = store.createApiKey(owner.id, parsed.data.label);

    return res.status(201).json({
      apiKey: created.apiKey,
      metadata: created.metadata
    });
  });

  app.patch("/api/admin/api-keys/:apiKeyId/revoke", (req, res) => {
    const auth = getAuthContext(req.headers.authorization, req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    const allKeys = store.listApiKeys();
    const key = allKeys.find((entry) => entry.id === req.params.apiKeyId);
    if (!key) {
      return res.status(404).json({ error: "Access key not found" });
    }

    if (!canManageApiKey(auth.user, key)) {
      return res.status(forbidden.status).json(forbidden.body);
    }

    const revoked = store.revokeApiKey(req.params.apiKeyId);
    if (!revoked) {
      return res.status(404).json({ error: "Access key not found" });
    }

    return res.status(200).json({ apiKey: revoked });
  });

  app.post("/api/founder/terminal/exec", async (req, res) => {
    const session = getSessionContext(req.headers.authorization, store);
    if (!session) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    if (!hasPermission(session.user.role, "terminal:execute")) {
      return res.status(forbidden.status).json(forbidden.body);
    }

    const parsed = terminalCommandSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid terminal payload", details: parsed.error.flatten() });
    }

    try {
      const result = await executeFounderCommand({
        command: parsed.data.command,
        cwd: resolve(founderTerminal.cwd),
        timeoutMs: founderTerminal.timeoutMs,
        allowedPrefixes: founderTerminal.allowedPrefixes
      });

      return res.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not execute command";
      return res.status(400).json({ error: message });
    }
  });

  app.post("/api/live/tts", async (req, res) => {
    const auth = getAuthContext(req.headers.authorization, req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    if (!hasPermission(auth.user.role, "chat:use")) {
      return res.status(forbidden.status).json(forbidden.body);
    }

    const parsed = liveTtsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid TTS payload", details: parsed.error.flatten() });
    }

    const requestedVoiceId = parsed.data.voiceId?.trim();
    if (requestedVoiceId && !allowedLiveVoiceIds.has(requestedVoiceId)) {
      return res.status(400).json({ error: "Selected voice is not available" });
    }

    const voiceId = requestedVoiceId && allowedLiveVoiceIds.has(requestedVoiceId) ? requestedVoiceId : elevenlabs.voiceId;

    if (!elevenlabs.apiKey) {
      createOperationalReport({
        store,
        user: auth.user,
        source: "live-tts",
        prompt: parsed.data.text,
        signals: ["Premium voice is not configured on this server"]
      });
      return res.status(503).json({ error: sanitizeFailureForUser("Premium voice is not configured on this server", auth.user) });
    }

    try {
      const audio = await callElevenLabsTts({
        apiKey: elevenlabs.apiKey,
        baseUrl: elevenlabs.baseUrl,
        voiceId,
        modelId: elevenlabs.modelId,
        text: parsed.data.text
      });

      return res.status(200).json({
        provider: "elevenlabs",
        voiceId,
        ...audio
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Voice synthesis failed";
      createOperationalReport({
        store,
        user: auth.user,
        source: "live-tts",
        prompt: parsed.data.text,
        signals: toOperationalSignals([message])
      });
      return res.status(502).json({ error: sanitizeFailureForUser(message, auth.user) });
    }
  });

  app.post("/api/external/chat/dual", async (req, res) => {
    const auth = getApiKeyContext(req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json({ error: "Valid x-aries-api-key is required" });
    }

    if (!hasPermission(auth.user.role, "chat:use")) {
      return res.status(forbidden.status).json(forbidden.body);
    }

    const result = await processDualChatRequest({
      adapter,
      payload: req.body,
      store,
      user: auth.user
    });

    return res.status(result.status).json(result.body);
  });

  app.post("/api/external/media/image", async (req, res) => {
    const auth = getApiKeyContext(req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json({ error: "Valid x-aries-api-key is required" });
    }

    if (!hasPermission(auth.user.role, "chat:use")) {
      return res.status(forbidden.status).json(forbidden.body);
    }

    const result = await processImageGenerationRequest({
      payload: req.body,
      store,
      user: auth.user,
      geminiImage
    });

    return res.status(result.status).json(result.body);
  });

  app.post("/api/chat/dual", async (req, res) => {
    const auth = getAuthContext(req.headers.authorization, req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    if (!hasPermission(auth.user.role, "chat:use")) {
      return res.status(forbidden.status).json(forbidden.body);
    }

    const result = await processDualChatRequest({
      adapter,
      payload: req.body,
      store,
      user: auth.user
    });
    return res.status(result.status).json(result.body);
  });

  app.post("/api/media/image", async (req, res) => {
    const auth = getAuthContext(req.headers.authorization, req.headers["x-aries-api-key"], store);
    if (!auth) {
      return res.status(unauthorized.status).json(unauthorized.body);
    }

    if (!hasPermission(auth.user.role, "chat:use")) {
      return res.status(forbidden.status).json(forbidden.body);
    }

    const result = await processImageGenerationRequest({
      payload: req.body,
      store,
      user: auth.user,
      geminiImage
    });

    return res.status(result.status).json(result.body);
  });

  return app;
};
