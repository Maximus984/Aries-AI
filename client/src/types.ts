export type ModelLane = "gemini-pro" | "gemini-flash";
export type ProviderKind = "github" | "gemini" | "safety";

export type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
  model?: ModelLane;
};

export type DualChatRequest = {
  sessionId: string;
  message: string;
  history: HistoryMessage[];
  clientNowIso?: string;
  clientTimeZone?: string;
  clientLocale?: string;
};

export type ModelResult = {
  model: ModelLane;
  text: string;
  latencyMs: number;
  ok: boolean;
  error?: string;
  provider?: ProviderKind;
  providerModel?: string;
  label?: string;
};

export type DualChatResponse = {
  sessionId: string;
  timestamp: string;
  pro: ModelResult;
  flash: ModelResult;
  blocked?: boolean;
  reportId?: string;
};

export type ImageGenerationRequest = {
  sessionId: string;
  prompt: string;
  count?: number;
};

export type GeneratedImage = {
  mimeType: string;
  base64: string;
};

export type ImageGenerationResponse = {
  sessionId: string;
  timestamp: string;
  prompt: string;
  model: string;
  provider: "gemini";
  latencyMs: number;
  ok: boolean;
  images: GeneratedImage[];
  text?: string;
  error?: string;
  blocked?: boolean;
  reportId?: string;
};

export type StudioImageItem = {
  id: string;
  prompt: string;
  createdAt: string;
  model: string;
  latencyMs: number;
  note?: string;
  mimeType: string;
  dataUrl: string;
};

export type LiveMicErrorCode = "not-allowed" | "not-found" | "insecure-context" | "unsupported" | "start-failed";

export type AutoScrollContext = "chat" | "live";

export type LiveSpeakerState = "idle" | "user-speaking" | "processing" | "assistant-speaking";

export type LiveIntroState = "idle" | "playing" | "done" | "error";

export type LiveVoiceProvider = "elevenlabs" | "browser";

export type LiveVoiceOption = {
  id: string;
  label: string;
  provider: LiveVoiceProvider;
  voiceId?: string;
  browserVoiceName?: string;
  lang?: string;
  description?: string;
  isDefault?: boolean;
};

export type LiveVoiceCatalogResponse = {
  configured: boolean;
  voices: LiveVoiceOption[];
};

export type ChatTurn = {
  id: string;
  userText: string;
  createdAt: string;
  pro?: ModelResult;
  flash?: ModelResult;
  blocked?: boolean;
  reportId?: string;
};

export type ChatSession = {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ChatTurn[];
};

export type UserRole = "founder" | "admin" | "staff" | "user";
export type AccountStatus = "active" | "banned";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  createdAt: string;
  lastSignInAt?: string;
  lastSignInIp?: string;
  signInCount?: number;
  bannedAt?: string;
  bannedReason?: string;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
};

export type TermsResponse = {
  title: string;
  version: string;
  updatedAt: string;
  content: string[];
};

export type GuidelineSection = {
  title: string;
  items: string[];
};

export type GuidelinesResponse = {
  title: string;
  updatedAt: string;
  sections: GuidelineSection[];
};

export type SafetyReport = {
  id: string;
  category: "self-harm" | "violence" | "operations" | "feedback";
  message: string;
  matched: string[];
  createdAt: string;
  status: "new" | "reviewed" | "closed";
  userId?: string;
  userEmail?: string;
};

export type AccountAuditRecord = {
  id: string;
  createdAt: string;
  action:
    | "signup"
    | "signin"
    | "signout"
    | "create-user"
    | "ban-user"
    | "kick-user"
    | "create-api-key"
    | "revoke-api-key"
    | "report-feedback"
    | "terminal-command";
  actorUserId?: string;
  actorEmail?: string;
  targetUserId?: string;
  targetEmail?: string;
  ip?: string;
  note?: string;
};

export type BannedIpRecord = {
  ip: string;
  bannedAt: string;
  reason: string;
  byUserId?: string;
  targetUserId?: string;
};

export type PermissionMatrix = {
  role: UserRole;
  allowed: string[];
  denied: string[];
  roleHierarchy: UserRole[];
};

export type ApiKeyMetadata = {
  id: string;
  ownerUserId: string;
  ownerEmail: string;
  label: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export type ApiKeyCreateResponse = {
  apiKey: string;
  metadata: ApiKeyMetadata;
};

export type FounderTerminalResult = {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type LiveTtsResponse = {
  provider: "elevenlabs";
  voiceId: string;
  audioBase64: string;
  mimeType: string;
};
