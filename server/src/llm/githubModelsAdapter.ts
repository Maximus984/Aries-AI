import { performance } from "node:perf_hooks";
import type { DualChatRequest, ModelLane, ModelResult, ProviderKind } from "../types.js";
import type { DualModelAdapter, DualModelResult } from "./adapter.js";

export type LaneProvider = "github" | "gemini";

export type LaneConfig = {
  provider: LaneProvider;
  model: string;
  label: string;
};

type HybridDualAdapterOptions = {
  proLane: LaneConfig;
  flashLane: LaneConfig;
  timeoutMs: number;
  githubToken?: string;
  githubBaseUrl: string;
  geminiApiKeys?: string[];
  geminiApiKey?: string;
  geminiBaseUrl: string;
  fetchImpl?: typeof fetch;
};

type GitHubModelsResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

const HISTORY_LIMIT = 20;

const normalizeErrorMessage = (error: unknown): string => {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Request timed out";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected model error";
};

const buildTemporalSystemPrompt = (request: DualChatRequest): string => {
  const serverNowIso = new Date().toISOString();
  const clientNowIso = request.clientNowIso ?? "unknown";
  const clientTimeZone = request.clientTimeZone ?? "unknown";
  const clientLocale = request.clientLocale ?? "unknown";

  return [
    "You are Aries, a professional assistant.",
    `Current server UTC time: ${serverNowIso}.`,
    `Client reported time: ${clientNowIso}.`,
    `Client reported timezone: ${clientTimeZone}.`,
    `Client reported locale: ${clientLocale}.`,
    "For time-sensitive requests, rely on these values and state timezone explicitly.",
    "If you are unsure about a fact, say you are uncertain and ask for clarification instead of guessing.",
    "When users ask for resources, provide direct HTTPS links and include relevant YouTube links when useful."
  ].join(" ");
};

const createFailureResult = (
  lane: ModelLane,
  label: string,
  provider: ProviderKind,
  providerModel: string,
  latencyMs: number,
  error: string
): ModelResult => ({
  model: lane,
  label,
  provider,
  providerModel,
  text: "",
  latencyMs,
  ok: false,
  error
});

const extractGitHubText = (payload: GitHubModelsResponse): string => {
  const raw = payload.choices?.[0]?.message?.content;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  if (Array.isArray(raw)) {
    const combined = raw
      .map((part) => part.text ?? "")
      .join("")
      .trim();

    if (combined) {
      return combined;
    }
  }

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  throw new Error("GitHub Models returned an empty response");
};

const extractGeminiText = (payload: GeminiResponse): string => {
  const text = payload.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  if (text) {
    return text;
  }

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  throw new Error("Model returned an empty response");
};

export class HybridDualModelAdapter implements DualModelAdapter {
  private readonly proLane: LaneConfig;
  private readonly flashLane: LaneConfig;
  private readonly timeoutMs: number;
  private readonly githubToken?: string;
  private readonly githubBaseUrl: string;
  private readonly geminiApiKeys: string[];
  private readonly geminiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HybridDualAdapterOptions) {
    this.proLane = options.proLane;
    this.flashLane = options.flashLane;
    this.timeoutMs = options.timeoutMs;
    this.githubToken = options.githubToken;
    this.githubBaseUrl = options.githubBaseUrl;
    this.geminiApiKeys = [
      ...(options.geminiApiKeys ?? []),
      ...(options.geminiApiKey ? [options.geminiApiKey] : [])
    ]
      .map((value) => value.trim())
      .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
    this.geminiBaseUrl = options.geminiBaseUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateDual(request: DualChatRequest): Promise<DualModelResult> {
    const [proResult, flashResult] = await Promise.allSettled([
      this.runLane("gemini-pro", this.proLane, request),
      this.runLane("gemini-flash", this.flashLane, request)
    ]);

    return {
      pro:
        proResult.status === "fulfilled"
          ? proResult.value
          : createFailureResult(
              "gemini-pro",
              this.proLane.label,
              this.proLane.provider,
              this.proLane.model,
              0,
              normalizeErrorMessage(proResult.reason)
            ),
      flash:
        flashResult.status === "fulfilled"
          ? flashResult.value
          : createFailureResult(
              "gemini-flash",
              this.flashLane.label,
              this.flashLane.provider,
              this.flashLane.model,
              0,
              normalizeErrorMessage(flashResult.reason)
            )
    };
  }

  private async runLane(lane: ModelLane, laneConfig: LaneConfig, request: DualChatRequest): Promise<ModelResult> {
    if (laneConfig.provider === "github") {
      return this.runGitHubLane(lane, laneConfig, request);
    }
    return this.runGeminiLane(lane, laneConfig, request);
  }

  private async runGitHubLane(lane: ModelLane, laneConfig: LaneConfig, request: DualChatRequest): Promise<ModelResult> {
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      if (!this.githubToken) {
        return createFailureResult(lane, laneConfig.label, "github", laneConfig.model, 0, "GITHUB_TOKEN is not configured");
      }

      const messages = [
        { role: "system" as const, content: buildTemporalSystemPrompt(request) },
        ...request.history.slice(-HISTORY_LIMIT).map((entry) => ({ role: entry.role, content: entry.content })),
        { role: "user" as const, content: request.message }
      ];

      const response = await this.fetchImpl(`${this.githubBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.githubToken}`
        },
        body: JSON.stringify({
          model: laneConfig.model,
          messages,
          temperature: 0.2
        }),
        signal: controller.signal
      });

      const latencyMs = Math.round(performance.now() - startedAt);
      const payload = (await response.json()) as GitHubModelsResponse;

      if (!response.ok) {
        const message = payload.error?.message || `GitHub Models request failed (${response.status})`;
        return createFailureResult(lane, laneConfig.label, "github", laneConfig.model, latencyMs, message);
      }

      return {
        model: lane,
        label: laneConfig.label,
        provider: "github",
        providerModel: laneConfig.model,
        text: extractGitHubText(payload),
        latencyMs,
        ok: true
      };
    } catch (error) {
      const latencyMs = Math.round(performance.now() - startedAt);
      return createFailureResult(lane, laneConfig.label, "github", laneConfig.model, latencyMs, normalizeErrorMessage(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  private async runGeminiLane(lane: ModelLane, laneConfig: LaneConfig, request: DualChatRequest): Promise<ModelResult> {
    if (this.geminiApiKeys.length === 0) {
      return createFailureResult(lane, laneConfig.label, "gemini", laneConfig.model, 0, "Service key is not configured");
    }

    const contents = [
      ...request.history.slice(-HISTORY_LIMIT).map((entry) => ({
        role: entry.role === "assistant" ? "model" : "user",
        parts: [{ text: entry.content }]
      })),
      {
        role: "user",
        parts: [{ text: request.message }]
      }
    ];

    let totalLatencyMs = 0;
    let lastError = "Model request failed";

    for (const key of this.geminiApiKeys) {
      const startedAt = performance.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(`${this.geminiBaseUrl}/${laneConfig.model}:generateContent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-goog-api-key": key
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: buildTemporalSystemPrompt(request) }]
            },
            contents,
            generationConfig: {
              temperature: 0.2
            }
          }),
          signal: controller.signal
        });

        const latencyMs = Math.round(performance.now() - startedAt);
        totalLatencyMs += latencyMs;
        const payload = (await response.json()) as GeminiResponse;

        if (response.ok) {
          return {
            model: lane,
            label: laneConfig.label,
            provider: "gemini",
            providerModel: laneConfig.model,
            text: extractGeminiText(payload),
            latencyMs: totalLatencyMs,
            ok: true
          };
        }

        const rawMessage = payload.error?.message || `Model request failed (${response.status})`;
        lastError = rawMessage.toLowerCase().includes("api key not valid")
          ? "Invalid service key. Update server/.env with a valid key and restart the service."
          : rawMessage;
      } catch (error) {
        const latencyMs = Math.round(performance.now() - startedAt);
        totalLatencyMs += latencyMs;
        lastError = normalizeErrorMessage(error);
      } finally {
        clearTimeout(timeout);
      }
    }

    return createFailureResult(lane, laneConfig.label, "gemini", laneConfig.model, totalLatencyMs, lastError);
  }
}
