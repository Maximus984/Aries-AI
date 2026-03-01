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

export type UserRole = "founder" | "admin" | "staff" | "user";

export type Permission =
  | "chat:use"
  | "reports:view"
  | "reports:manage"
  | "reports:create:feedback"
  | "users:create:user"
  | "users:create:staff"
  | "users:create:admin"
  | "users:view"
  | "users:ban"
  | "users:kick"
  | "apikeys:create:own"
  | "apikeys:create:any"
  | "apikeys:view:own"
  | "apikeys:view:any"
  | "terminal:execute";

export type AccountStatus = "active" | "banned";

export type UserRecord = {
  id: string;
  email: string;
  passwordSalt: string;
  passwordHash: string;
  role: UserRole;
  status: AccountStatus;
  createdAt: string;
  lastSignInAt?: string;
  lastSignInIp?: string;
  signInCount?: number;
  bannedAt?: string;
  bannedReason?: string;
  bannedByUserId?: string;
};

export type PublicUser = {
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

export type SessionRecord = {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

export type ApiKeyRecord = {
  id: string;
  ownerUserId: string;
  label: string;
  keyPrefix: string;
  keyHash: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export type PublicApiKey = {
  id: string;
  ownerUserId: string;
  ownerEmail: string;
  label: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export type SafetyCategory = "self-harm" | "violence" | "operations" | "feedback";
export type ReportStatus = "new" | "reviewed" | "closed";

export type SafetyReport = {
  id: string;
  category: SafetyCategory;
  message: string;
  matched: string[];
  createdAt: string;
  status: ReportStatus;
  userId?: string;
  userEmail?: string;
};

export type RemovedEmailRecord = {
  email: string;
  removedAt: string;
  reason: "kicked" | "banned";
  byUserId?: string;
  note?: string;
};

export type BannedIpRecord = {
  ip: string;
  bannedAt: string;
  reason: string;
  byUserId?: string;
  targetUserId?: string;
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

export type AppData = {
  users: UserRecord[];
  sessions: SessionRecord[];
  reports: SafetyReport[];
  apiKeys: ApiKeyRecord[];
  blockedEmails: RemovedEmailRecord[];
  bannedIps: BannedIpRecord[];
  accountAudit: AccountAuditRecord[];
};
