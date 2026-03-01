import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { dirname } from "node:path";
import type {
  AccountAuditRecord,
  AccountStatus,
  ApiKeyRecord,
  AppData,
  BannedIpRecord,
  PublicApiKey,
  PublicUser,
  RemovedEmailRecord,
  ReportStatus,
  SafetyCategory,
  SafetyReport,
  SessionRecord,
  UserRecord,
  UserRole
} from "../types.js";

const DEFAULT_DATA: AppData = {
  users: [],
  sessions: [],
  reports: [],
  apiKeys: [],
  blockedEmails: [],
  bannedIps: [],
  accountAudit: []
};

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const hashPassword = (password: string, salt: string): string => scryptSync(password, salt, 64).toString("hex");

const safeEqualHex = (a: string, b: string): boolean => {
  const aBuffer = Buffer.from(a, "hex");
  const bBuffer = Buffer.from(b, "hex");
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return timingSafeEqual(aBuffer, bBuffer);
};

const createPasswordRecord = (password: string): { passwordSalt: string; passwordHash: string } => {
  const passwordSalt = randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, passwordSalt);
  return { passwordSalt, passwordHash };
};

const toPublicUser = (user: UserRecord): PublicUser => ({
  id: user.id,
  email: user.email,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
  lastSignInAt: user.lastSignInAt,
  lastSignInIp: user.lastSignInIp,
  signInCount: user.signInCount,
  bannedAt: user.bannedAt,
  bannedReason: user.bannedReason
});

const hashApiKey = (apiKey: string): string => createHash("sha256").update(apiKey).digest("hex");

const generateApiKey = (): string => `aries_live_${randomBytes(28).toString("hex")}`;

type CreateReportInput = {
  category: SafetyCategory;
  message: string;
  matched: string[];
  userId?: string;
  userEmail?: string;
};

export class AppStore {
  private readonly filePath: string;
  private readonly sessionTtlHours: number;
  private data: AppData;

  constructor(filePath: string, sessionTtlHours: number) {
    this.filePath = filePath;
    this.sessionTtlHours = sessionTtlHours;
    this.data = this.load();
  }

  ensureAccount(email: string, password: string, role: UserRole): PublicUser {
    const normalizedEmail = normalizeEmail(email);
    const existing = this.data.users.find((user) => user.email === normalizedEmail);

    if (existing) {
      if (existing.role !== role || existing.status !== "active") {
        existing.role = role;
        existing.status = "active";
        existing.bannedAt = undefined;
        existing.bannedReason = undefined;
        existing.bannedByUserId = undefined;
        this.persist();
      }
      return toPublicUser(existing);
    }

    const user = this.createUserInternal(normalizedEmail, password, role);
    return toPublicUser(user);
  }

  ensureSystemAccount(email: string, password: string, role: UserRole): PublicUser {
    const normalizedEmail = normalizeEmail(email);
    const existing = this.data.users.find((user) => user.email === normalizedEmail);

    if (!existing) {
      const created = this.createUserInternal(normalizedEmail, password, role);
      return toPublicUser(created);
    }

    const expectedHash = hashPassword(password, existing.passwordSalt);
    const shouldUpdatePassword = !safeEqualHex(existing.passwordHash, expectedHash);
    const shouldUpdateRole = existing.role !== role;
    const shouldActivate = existing.status !== "active";

    if (shouldUpdatePassword || shouldUpdateRole || shouldActivate) {
      if (shouldUpdatePassword) {
        const credential = createPasswordRecord(password);
        existing.passwordSalt = credential.passwordSalt;
        existing.passwordHash = credential.passwordHash;
      }

      if (shouldUpdateRole) {
        existing.role = role;
      }

      if (shouldActivate) {
        existing.status = "active";
        existing.bannedAt = undefined;
        existing.bannedReason = undefined;
        existing.bannedByUserId = undefined;
      }

      this.persist();
    }

    return toPublicUser(existing);
  }

  ensureFounder(email: string, password: string): PublicUser {
    return this.ensureSystemAccount(email, password, "founder");
  }

  createUser(email: string, password: string, role: UserRole): PublicUser {
    const normalizedEmail = normalizeEmail(email);
    const blocked = this.data.blockedEmails.some((entry) => entry.email === normalizedEmail);
    if (blocked) {
      throw new Error("This email address cannot be used");
    }

    const existing = this.data.users.find((user) => user.email === normalizedEmail);
    if (existing) {
      throw new Error("Email is already registered");
    }

    const user = this.createUserInternal(normalizedEmail, password, role);
    return toPublicUser(user);
  }

  signIn(email: string, password: string): PublicUser | null {
    const normalizedEmail = normalizeEmail(email);
    const user = this.data.users.find((candidate) => candidate.email === normalizedEmail);
    if (!user) {
      return null;
    }

    if (user.status === "banned") {
      return null;
    }

    const computed = hashPassword(password, user.passwordSalt);
    if (!safeEqualHex(user.passwordHash, computed)) {
      return null;
    }

    return toPublicUser(user);
  }

  createSession(userId: string): string {
    this.cleanupExpiredSessions();

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + this.sessionTtlHours * 60 * 60 * 1000);
    const token = randomBytes(32).toString("hex");

    const session: SessionRecord = {
      token,
      userId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    this.data.sessions.push(session);
    this.persist();
    return token;
  }

  getUserByToken(token: string): PublicUser | null {
    this.cleanupExpiredSessions();

    const session = this.data.sessions.find((entry) => entry.token === token);
    if (!session) {
      return null;
    }

    const user = this.data.users.find((entry) => entry.id === session.userId);
    if (!user || user.status === "banned") {
      this.revokeSession(token);
      return null;
    }

    return toPublicUser(user);
  }

  revokeSession(token: string): void {
    const previousCount = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((entry) => entry.token !== token);
    if (this.data.sessions.length !== previousCount) {
      this.persist();
    }
  }

  getUserById(userId: string): PublicUser | null {
    const user = this.data.users.find((entry) => entry.id === userId);
    return user ? toPublicUser(user) : null;
  }

  getUserByEmail(email: string): PublicUser | null {
    const normalized = normalizeEmail(email);
    const user = this.data.users.find((entry) => entry.email === normalized);
    return user ? toPublicUser(user) : null;
  }

  listUsers(): PublicUser[] {
    return this.data.users.map(toPublicUser).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  recordSignIn(userId: string, ip?: string): PublicUser | null {
    const user = this.data.users.find((entry) => entry.id === userId);
    if (!user) {
      return null;
    }

    user.lastSignInAt = new Date().toISOString();
    user.lastSignInIp = ip?.trim() || user.lastSignInIp;
    user.signInCount = (user.signInCount ?? 0) + 1;
    this.persist();
    return toPublicUser(user);
  }

  isIpBanned(ip: string): boolean {
    const normalizedIp = ip.trim();
    return this.data.bannedIps.some((entry) => entry.ip === normalizedIp);
  }

  listBannedIps(): BannedIpRecord[] {
    return [...this.data.bannedIps].sort((a, b) => b.bannedAt.localeCompare(a.bannedAt));
  }

  listAccountAudit(limit = 300): AccountAuditRecord[] {
    return [...this.data.accountAudit]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, Math.min(limit, 1000)));
  }

  addAuditEvent(event: Omit<AccountAuditRecord, "id" | "createdAt">): AccountAuditRecord {
    const entry: AccountAuditRecord = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...event
    };

    this.data.accountAudit.push(entry);
    if (this.data.accountAudit.length > 5000) {
      this.data.accountAudit = this.data.accountAudit.slice(-5000);
    }
    this.persist();
    return entry;
  }

  banUser(input: {
    targetUserId: string;
    actorUserId: string;
    actorEmail?: string;
    reason: string;
  }): PublicUser | null {
    const user = this.data.users.find((entry) => entry.id === input.targetUserId);
    if (!user) {
      return null;
    }

    user.status = "banned";
    user.bannedAt = new Date().toISOString();
    user.bannedReason = input.reason;
    user.bannedByUserId = input.actorUserId;

    this.data.sessions = this.data.sessions.filter((entry) => entry.userId !== user.id);

    if (user.lastSignInIp && !this.isIpBanned(user.lastSignInIp)) {
      this.data.bannedIps.push({
        ip: user.lastSignInIp,
        bannedAt: new Date().toISOString(),
        reason: input.reason,
        byUserId: input.actorUserId,
        targetUserId: user.id
      });
    }

    this.data.blockedEmails = this.appendBlockedEmail(this.data.blockedEmails, {
      email: user.email,
      removedAt: new Date().toISOString(),
      reason: "banned",
      byUserId: input.actorUserId,
      note: input.reason
    });

    this.data.accountAudit.push({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      action: "ban-user",
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      targetUserId: user.id,
      targetEmail: user.email,
      ip: user.lastSignInIp,
      note: input.reason
    });

    this.persist();
    return toPublicUser(user);
  }

  kickUser(input: {
    targetUserId: string;
    actorUserId: string;
    actorEmail?: string;
    reason: string;
  }): { removedEmail: string } | null {
    const user = this.data.users.find((entry) => entry.id === input.targetUserId);
    if (!user) {
      return null;
    }

    const removedEmail = user.email;

    this.data.users = this.data.users.filter((entry) => entry.id !== input.targetUserId);
    this.data.sessions = this.data.sessions.filter((entry) => entry.userId !== input.targetUserId);
    this.data.apiKeys = this.data.apiKeys.filter((entry) => entry.ownerUserId !== input.targetUserId);
    this.data.blockedEmails = this.appendBlockedEmail(this.data.blockedEmails, {
      email: removedEmail,
      removedAt: new Date().toISOString(),
      reason: "kicked",
      byUserId: input.actorUserId,
      note: input.reason
    });

    this.data.accountAudit.push({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      action: "kick-user",
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      targetUserId: input.targetUserId,
      targetEmail: removedEmail,
      note: input.reason
    });

    this.persist();
    return { removedEmail };
  }

  createApiKey(ownerUserId: string, label: string): { apiKey: string; metadata: PublicApiKey } {
    const owner = this.data.users.find((entry) => entry.id === ownerUserId);
    if (!owner) {
      throw new Error("Owner user not found");
    }

    if (owner.status === "banned") {
      throw new Error("Owner account is banned");
    }

    const apiKey = generateApiKey();
    const keyPrefix = apiKey.slice(0, 16);

    const record: ApiKeyRecord = {
      id: randomUUID(),
      ownerUserId,
      label,
      keyPrefix,
      keyHash: hashApiKey(apiKey),
      createdAt: new Date().toISOString()
    };

    this.data.apiKeys.push(record);
    this.persist();

    return {
      apiKey,
      metadata: {
        id: record.id,
        ownerUserId: record.ownerUserId,
        ownerEmail: owner.email,
        label: record.label,
        keyPrefix: record.keyPrefix,
        createdAt: record.createdAt,
        lastUsedAt: record.lastUsedAt,
        revokedAt: record.revokedAt
      }
    };
  }

  getUserByApiKey(apiKey: string): PublicUser | null {
    const hash = hashApiKey(apiKey);
    const record = this.data.apiKeys.find((entry) => entry.keyHash === hash && !entry.revokedAt);
    if (!record) {
      return null;
    }

    record.lastUsedAt = new Date().toISOString();
    this.persist();

    const owner = this.data.users.find((entry) => entry.id === record.ownerUserId);
    if (!owner || owner.status === "banned") {
      return null;
    }

    return toPublicUser(owner);
  }

  listApiKeysForUser(userId: string): PublicApiKey[] {
    const usersById = new Map(this.data.users.map((user) => [user.id, user]));
    return this.data.apiKeys
      .filter((entry) => entry.ownerUserId === userId)
      .map((entry) => ({
        id: entry.id,
        ownerUserId: entry.ownerUserId,
        ownerEmail: usersById.get(entry.ownerUserId)?.email ?? "unknown",
        label: entry.label,
        keyPrefix: entry.keyPrefix,
        createdAt: entry.createdAt,
        lastUsedAt: entry.lastUsedAt,
        revokedAt: entry.revokedAt
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listApiKeys(): PublicApiKey[] {
    const usersById = new Map(this.data.users.map((user) => [user.id, user]));
    return this.data.apiKeys
      .map((entry) => ({
        id: entry.id,
        ownerUserId: entry.ownerUserId,
        ownerEmail: usersById.get(entry.ownerUserId)?.email ?? "unknown",
        label: entry.label,
        keyPrefix: entry.keyPrefix,
        createdAt: entry.createdAt,
        lastUsedAt: entry.lastUsedAt,
        revokedAt: entry.revokedAt
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  revokeApiKey(apiKeyId: string): PublicApiKey | null {
    const record = this.data.apiKeys.find((entry) => entry.id === apiKeyId);
    if (!record) {
      return null;
    }

    record.revokedAt = new Date().toISOString();
    this.persist();

    const owner = this.data.users.find((entry) => entry.id === record.ownerUserId);

    return {
      id: record.id,
      ownerUserId: record.ownerUserId,
      ownerEmail: owner?.email ?? "unknown",
      label: record.label,
      keyPrefix: record.keyPrefix,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
      revokedAt: record.revokedAt
    };
  }

  createReport(input: CreateReportInput): SafetyReport {
    const report: SafetyReport = {
      id: randomUUID(),
      category: input.category,
      message: input.message,
      matched: input.matched,
      createdAt: new Date().toISOString(),
      status: "new",
      userId: input.userId,
      userEmail: input.userEmail
    };

    this.data.reports.push(report);
    this.persist();
    return report;
  }

  listReports(): SafetyReport[] {
    return [...this.data.reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  updateReportStatus(reportId: string, status: ReportStatus): SafetyReport | null {
    const report = this.data.reports.find((entry) => entry.id === reportId);
    if (!report) {
      return null;
    }

    report.status = status;
    this.persist();
    return report;
  }

  private appendBlockedEmail(entries: RemovedEmailRecord[], candidate: RemovedEmailRecord): RemovedEmailRecord[] {
    const normalized = normalizeEmail(candidate.email);
    const filtered = entries.filter((entry) => normalizeEmail(entry.email) !== normalized);
    return [...filtered, { ...candidate, email: normalized }];
  }

  private createUserInternal(email: string, password: string, role: UserRole): UserRecord {
    const credential = createPasswordRecord(password);

    const user: UserRecord = {
      id: randomUUID(),
      email,
      passwordSalt: credential.passwordSalt,
      passwordHash: credential.passwordHash,
      role,
      status: "active",
      createdAt: new Date().toISOString(),
      signInCount: 0
    };

    this.data.users.push(user);
    this.persist();
    return user;
  }

  private cleanupExpiredSessions(): void {
    const nowIso = new Date().toISOString();
    const previousCount = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((entry) => entry.expiresAt > nowIso);
    if (this.data.sessions.length !== previousCount) {
      this.persist();
    }
  }

  private load(): AppData {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<AppData>;
      const users: UserRecord[] = Array.isArray(parsed.users)
        ? parsed.users.map((entry) => {
            const maybeUser = entry as Partial<UserRecord>;
            const status: AccountStatus = maybeUser.status === "banned" ? "banned" : "active";
            return {
              ...maybeUser,
              status
            } as UserRecord;
          })
        : [];

      return {
        users,
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        reports: Array.isArray(parsed.reports) ? parsed.reports : [],
        apiKeys: Array.isArray(parsed.apiKeys) ? parsed.apiKeys : [],
        blockedEmails: Array.isArray(parsed.blockedEmails) ? parsed.blockedEmails : [],
        bannedIps: Array.isArray(parsed.bannedIps) ? parsed.bannedIps : [],
        accountAudit: Array.isArray(parsed.accountAudit) ? parsed.accountAudit : []
      };
    } catch {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(DEFAULT_DATA, null, 2), "utf8");
      return {
        users: [],
        sessions: [],
        reports: [],
        apiKeys: [],
        blockedEmails: [],
        bannedIps: [],
        accountAudit: []
      };
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }
}
