import type {
  AccountAuditRecord,
  ApiKeyCreateResponse,
  ApiKeyMetadata,
  AuthResponse,
  AuthUser,
  BannedIpRecord,
  DualChatRequest,
  DualChatResponse,
  FounderTerminalResult,
  ImageGenerationRequest,
  ImageGenerationResponse,
  GuidelinesResponse,
  LiveVoiceCatalogResponse,
  LiveTtsResponse,
  PermissionMatrix,
  SafetyReport,
  TermsResponse,
  UserRole
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const authUnavailableMessage = (): string => {
  const origin = typeof window !== "undefined" ? window.location.origin : "this client origin";
  return (
    "Auth service unavailable. Ensure server is running on http://localhost:3000 " +
    `and that CORS allows ${origin}.`
  );
};

const parseJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const authHeaders = (token: string): HeadersInit => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`
});

const isDualChatResponse = (value: unknown): value is DualChatResponse => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return Boolean(payload.sessionId && payload.pro && payload.flash);
};

const isImageGenerationResponse = (value: unknown): value is ImageGenerationResponse => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return Boolean(payload.sessionId && payload.model && Array.isArray(payload.images));
};

export const sendDualChat = async (request: DualChatRequest, token: string): Promise<DualChatResponse> => {
  const response = await fetch(`${API_BASE}/api/chat/dual`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(request)
  });

  const data = await parseJson(response);

  if (isDualChatResponse(data)) {
    return data;
  }

  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Chat request failed");
  }

  throw new Error("Unexpected service response");
};

export const generateImage = async (
  request: ImageGenerationRequest,
  token: string
): Promise<ImageGenerationResponse> => {
  const response = await fetch(`${API_BASE}/api/media/image`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(request)
  });

  const data = await parseJson(response);

  if (isImageGenerationResponse(data)) {
    return data;
  }

  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Image generation failed");
  }

  throw new Error("Unexpected service response");
};

export const fetchLiveVoices = async (token: string): Promise<LiveVoiceCatalogResponse> => {
  const response = await fetch(`${API_BASE}/api/live/voices`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Could not load live voices");
  }

  return data as LiveVoiceCatalogResponse;
};

export const synthesizeLiveVoice = async (text: string, token: string, voiceId?: string): Promise<LiveTtsResponse> => {
  const response = await fetch(`${API_BASE}/api/live/tts`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ text, voiceId })
  });

  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Voice synthesis failed");
  }

  return data as LiveTtsResponse;
};

export const checkHealth = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
};

const parseAuthResponse = (data: unknown): AuthResponse => {
  if (!data || typeof data !== "object") {
    throw new Error("Unexpected authentication response");
  }

  const payload = data as Partial<AuthResponse>;
  if (!payload.token || !payload.user) {
    throw new Error("Unexpected authentication response");
  }

  return payload as AuthResponse;
};

export const signUp = async (email: string, password: string): Promise<AuthResponse> => {
  try {
    const response = await fetch(`${API_BASE}/api/auth/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });

    const data = await parseJson(response);
    if (!response.ok) {
      throw new Error(
        (data as { error?: string } | null)?.error ??
          (response.status >= 500 || response.status === 404 ? authUnavailableMessage() : "Sign up failed")
      );
    }

    return parseAuthResponse(data);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(authUnavailableMessage());
    }
    throw error;
  }
};

export const signIn = async (email: string, password: string): Promise<AuthResponse> => {
  try {
    const response = await fetch(`${API_BASE}/api/auth/signin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });

    const data = await parseJson(response);
    if (!response.ok) {
      throw new Error(
        (data as { error?: string } | null)?.error ??
          (response.status >= 500 || response.status === 404 ? authUnavailableMessage() : "Sign in failed")
      );
    }

    return parseAuthResponse(data);
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.message === "Failed to fetch")) {
      throw new Error(authUnavailableMessage());
    }
    throw error;
  }
};

export const signOut = async (token: string): Promise<void> => {
  await fetch(`${API_BASE}/api/auth/signout`, {
    method: "POST",
    headers: authHeaders(token)
  });
};

export const fetchMe = async (token: string): Promise<AuthUser> => {
  const response = await fetch(`${API_BASE}/api/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Session expired");
  }

  const user = (data as { user?: AuthUser } | null)?.user;
  if (!user) {
    throw new Error("Invalid auth payload");
  }

  return user;
};

export const fetchPermissions = async (token: string): Promise<PermissionMatrix> => {
  const response = await fetch(`${API_BASE}/api/auth/permissions`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Could not load permissions");
  }

  return data as PermissionMatrix;
};

export const fetchTerms = async (): Promise<TermsResponse> => {
  const response = await fetch(`${API_BASE}/api/legal/terms`);
  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error("Could not load terms");
  }
  return data as TermsResponse;
};

export const fetchGuidelines = async (): Promise<GuidelinesResponse> => {
  const response = await fetch(`${API_BASE}/api/legal/guidelines`);
  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error("Could not load guidelines");
  }
  return data as GuidelinesResponse;
};

export const fetchReports = async (token: string): Promise<SafetyReport[]> => {
  const response = await fetch(`${API_BASE}/api/admin/reports`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Could not load reports");
  }

  return ((data as { reports?: SafetyReport[] } | null)?.reports ?? []) as SafetyReport[];
};

export const submitFeedbackReport = async (
  token: string,
  input: { message: string; page?: string }
): Promise<{ ok: boolean; reportId: string }> => {
  const response = await fetch(`${API_BASE}/api/reports/feedback`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input)
  });

  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Could not submit feedback");
  }

  const payload = data as { ok?: boolean; reportId?: string } | null;
  if (!payload?.ok || !payload.reportId) {
    throw new Error("Unexpected feedback response");
  }

  return { ok: payload.ok, reportId: payload.reportId };
};

export const updateReportStatus = async (
  token: string,
  reportId: string,
  status: "new" | "reviewed" | "closed"
): Promise<void> => {
  const response = await fetch(`${API_BASE}/api/admin/reports/${reportId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ status })
  });

  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Could not update report");
  }
};

export const fetchUsers = async (token: string): Promise<AuthUser[]> => {
  const response = await fetch(`${API_BASE}/api/admin/users`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Could not load users");
  }

  return ((data as { users?: AuthUser[] } | null)?.users ?? []) as AuthUser[];
};

export const createUserAsAdmin = async (
  token: string,
  input: { email: string; password: string; role: Exclude<UserRole, "founder"> }
): Promise<void> => {
  const response = await fetch(`${API_BASE}/api/admin/users`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input)
  });

  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Could not create user");
  }
};

export const fetchApiKeys = async (token: string): Promise<ApiKeyMetadata[]> => {
  const response = await fetch(`${API_BASE}/api/admin/api-keys`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Could not load access keys");
  }

  return ((data as { apiKeys?: ApiKeyMetadata[] } | null)?.apiKeys ?? []) as ApiKeyMetadata[];
};

export const createApiKey = async (
  token: string,
  input: { label: string; ownerEmail?: string }
): Promise<ApiKeyCreateResponse> => {
  const response = await fetch(`${API_BASE}/api/admin/api-keys`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input)
  });

  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Could not create access key");
  }

  return data as ApiKeyCreateResponse;
};

export const revokeApiKey = async (token: string, apiKeyId: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/api/admin/api-keys/${apiKeyId}/revoke`, {
    method: "PATCH",
    headers: authHeaders(token)
  });

  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Could not revoke access key");
  }
};

export const executeFounderCommand = async (token: string, command: string): Promise<FounderTerminalResult> => {
  const response = await fetch(`${API_BASE}/api/founder/terminal/exec`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ command })
  });

  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Command failed");
  }

  return data as FounderTerminalResult;
};

export const fetchAccountAudit = async (token: string): Promise<AccountAuditRecord[]> => {
  const response = await fetch(`${API_BASE}/api/admin/audit`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Could not load audit records");
  }

  return ((data as { audit?: AccountAuditRecord[] } | null)?.audit ?? []) as AccountAuditRecord[];
};

export const fetchBannedIps = async (token: string): Promise<BannedIpRecord[]> => {
  const response = await fetch(`${API_BASE}/api/admin/banned-ips`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Could not load banned IPs");
  }

  return ((data as { bannedIps?: BannedIpRecord[] } | null)?.bannedIps ?? []) as BannedIpRecord[];
};
