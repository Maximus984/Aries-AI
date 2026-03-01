import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
  CLIENT_ORIGINS: z.string().trim().optional().default(""),
  ALLOW_LAN_ORIGINS: z.string().trim().optional().default(""),
  DATA_FILE: z.string().trim().min(1).default("server/data/app-data.json"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 365).default(24 * 30),
  FOUNDER_EMAIL: z.string().trim().email().max(254).default("founder@aries.local"),
  FOUNDER_PASSWORD: z.string().min(8).max(200).default("AriesFounder!2026"),
  ADMIN_EMAIL: z.string().trim().email().max(254).default("admin@aries.local"),
  ADMIN_PASSWORD: z.string().min(8).max(200).default("AriesAdmin!2026"),
  MONITOR_EMAIL: z.string().trim().email().max(254).default("monitor@aries.local"),
  MONITOR_PASSWORD: z.string().min(8).max(200).default("AriesMonitor!2026"),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  FOUNDER_TERMINAL_CWD: z.string().trim().min(1).default("."),
  FOUNDER_TERMINAL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  FOUNDER_TERMINAL_ALLOWED_PREFIXES: z
    .string()
    .trim()
    .min(1)
    .default("pwd,ls,cd,cat,rg,sed,find,head,tail,wc,echo,touch,mkdir,cp,mv,npm,node,npx,git"),

  GITHUB_TOKEN: z.string().trim().optional().default(""),
  GITHUB_MODELS_BASE_URL: z.string().url().default("https://models.inference.ai.azure.com"),

  GEMINI_API_KEY: z.string().trim().optional().default(""),
  GEMINI_API_KEYS: z.string().trim().optional().default(""),
  GEMINI_API_BASE_URL: z.string().url().default("https://generativelanguage.googleapis.com/v1beta/models"),
  GEMINI_IMAGE_MODEL: z.string().trim().min(1).default("gemini-2.0-flash-preview-image-generation"),
  GEMINI_IMAGE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(60000),

  ELEVENLABS_API_KEY: z.string().trim().optional().default(""),
  ELEVENLABS_VOICE_ID: z.string().trim().min(1).default("OYTbf65OHHFELVut7v2H"),
  ELEVENLABS_MODEL_ID: z.string().trim().min(1).default("eleven_multilingual_v2"),
  ELEVENLABS_BASE_URL: z.string().url().default("https://api.elevenlabs.io/v1"),
  ELEVENLABS_VOICE_OPTIONS: z.string().trim().optional().default(""),

  LANE_PRO_PROVIDER: z.enum(["github", "gemini"]).default("gemini"),
  LANE_PRO_MODEL: z.string().trim().min(1).default("gemini-2.5-pro"),
  LANE_PRO_LABEL: z.string().trim().min(1).max(40).default("Aries Quality"),

  LANE_FLASH_PROVIDER: z.enum(["github", "gemini"]).default("gemini"),
  LANE_FLASH_MODEL: z.string().trim().min(1).default("gemini-2.5-flash"),
  LANE_FLASH_LABEL: z.string().trim().min(1).max(40).default("Aries Speed")
});

type RawAppConfig = z.infer<typeof envSchema>;

export type AppConfig = RawAppConfig & {
  geminiApiKeys: string[];
  clientOrigins: string[];
  allowLanOrigins: boolean;
  elevenlabsVoiceOptions: Array<{ voiceId: string; label: string; description?: string }>;
};

const isPlaceholderSecret = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("your_gemini_api_key_here") ||
    normalized.includes("your_primary_key_here") ||
    normalized.includes("your_backup_key_here") ||
    normalized.includes("your_github_personal_access_token_here") ||
    normalized.startsWith("your_")
  );
};

const parseGeminiKeys = (single: string, multiple: string): string[] => {
  const unique = new Set<string>();
  const fromMultiple = multiple
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && !isPlaceholderSecret(value));

  for (const key of fromMultiple) {
    unique.add(key);
  }

  if (single.trim().length > 0 && !isPlaceholderSecret(single)) {
    unique.add(single.trim());
  }

  return [...unique];
};

const toNormalizedOrigin = (value: string): string => {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Origin must use http/https protocol: ${value}`);
  }
  return `${parsed.protocol}//${parsed.host}`;
};

const parseClientOrigins = (single: string, multiple: string): string[] => {
  const unique = new Set<string>();
  const list = multiple
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (single.trim().length > 0) {
    list.push(single.trim());
  }

  for (const origin of list) {
    unique.add(toNormalizedOrigin(origin));
  }

  return [...unique];
};

const parseBoolish = (value: string, fallback: boolean): boolean => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(normalized);
};

const parseElevenlabsVoiceOptions = (
  defaultVoiceId: string,
  optionsRaw: string
): Array<{ voiceId: string; label: string; description?: string }> => {
  const parsed: Array<{ voiceId: string; label: string; description?: string }> = [];
  for (const entry of optionsRaw.split(",").map((value) => value.trim()).filter((value) => value.length > 0)) {
    const [voiceIdRaw = "", labelRaw = "", descriptionRaw = ""] = entry.split("|").map((part) => part.trim());
    if (!voiceIdRaw) {
      continue;
    }

    parsed.push({
      voiceId: voiceIdRaw,
      label: labelRaw || "Aries Voice",
      description: descriptionRaw || undefined
    });
  }

  const unique = new Map<string, { voiceId: string; label: string; description?: string }>();
  for (const voice of parsed) {
    unique.set(voice.voiceId, voice);
  }

  if (!unique.has(defaultVoiceId)) {
    unique.set(defaultVoiceId, {
      voiceId: defaultVoiceId,
      label: "Aries Signature",
      description: "Balanced premium voice"
    });
  }

  return [...unique.values()];
};

export const loadConfig = (): AppConfig => {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const config = parsed.data;
  const usingGitHub = config.LANE_PRO_PROVIDER === "github" || config.LANE_FLASH_PROVIDER === "github";
  const usingGemini = config.LANE_PRO_PROVIDER === "gemini" || config.LANE_FLASH_PROVIDER === "gemini";

  if (usingGitHub && (!config.GITHUB_TOKEN || isPlaceholderSecret(config.GITHUB_TOKEN))) {
    throw new Error("Invalid environment configuration: GITHUB_TOKEN is required when a lane uses provider 'github'");
  }

  const geminiApiKeys = parseGeminiKeys(config.GEMINI_API_KEY, config.GEMINI_API_KEYS);

  if (usingGemini && geminiApiKeys.length === 0) {
    throw new Error(
      "Invalid environment configuration: set real GEMINI_API_KEY or GEMINI_API_KEYS values in server/.env when a lane uses provider 'gemini'"
    );
  }

  const fallbackAllowLan = config.NODE_ENV !== "production";
  const allowLanOrigins = parseBoolish(config.ALLOW_LAN_ORIGINS, fallbackAllowLan);
  const clientOrigins = parseClientOrigins(config.CLIENT_ORIGIN, config.CLIENT_ORIGINS);
  const elevenlabsVoiceOptions = parseElevenlabsVoiceOptions(config.ELEVENLABS_VOICE_ID, config.ELEVENLABS_VOICE_OPTIONS);

  return {
    ...config,
    geminiApiKeys,
    clientOrigins,
    allowLanOrigins,
    elevenlabsVoiceOptions
  };
};
