import type {
  AuthSession,
  AuthUser,
  OperationalRequest,
  Organization,
  OrganizationGeofence,
  OutboxOperation,
  PullResponse,
  PushResponse,
} from "./domain";

type SuccessEnvelope<T> = { data: T; meta?: Record<string, unknown> };
type ErrorEnvelope = {
  error: { code: string; message: string; details?: unknown };
};

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type AuthPayload = {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  accessTokenExpiresAt?: string;
  user: AuthUser;
  organizations: Organization[];
  selectedOrganizationId?: string | null;
};

type SessionListener = (session: AuthSession | null) => void | Promise<void>;
export type AuthRequestScope = {
  userId: string;
  organizationId: string;
};
let currentSession: AuthSession | null = null;
let sessionListener: SessionListener | null = null;
let refreshPromise: Promise<AuthSession> | null = null;
let sessionGeneration = 0;

export function configureApiSession(
  session: AuthSession | null,
  listener: SessionListener,
): void {
  sessionGeneration++;
  refreshPromise = null;
  currentSession = session;
  sessionListener = listener;
}

async function updateSession(session: AuthSession | null): Promise<void> {
  currentSession = session;
  await sessionListener?.(session);
}

function toSession(payload: AuthPayload, previous?: AuthSession): AuthSession {
  const expiresAt = payload.accessTokenExpiresAt ??
    new Date(Date.now() + Math.max(30, payload.expiresIn ?? 300) * 1000).toISOString();
  const organizations = payload.organizations ?? previous?.organizations ?? [];
  const selected = payload.selectedOrganizationId ??
    previous?.selectedOrganizationId ??
    organizations[0]?.id ??
    null;
  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken || previous?.refreshToken || "",
    accessTokenExpiresAt: expiresAt,
    user: payload.user ?? previous?.user,
    organizations,
    selectedOrganizationId: organizations.some(({ id }) => id === selected) ? selected : null,
  };
}

export function getApiBaseUrl(): string | null {
  const value = process.env.EXPO_PUBLIC_API_URL?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}

async function refreshAccessToken(): Promise<AuthSession> {
  if (!currentSession?.refreshToken) {
    throw new ApiError("UNAUTHENTICATED", "No refresh token is available.", 401);
  }
  if (!refreshPromise) {
    const previous = currentSession;
    const generation = sessionGeneration;
    refreshPromise = request<AuthPayload>("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: previous.refreshToken }),
    }, false, false)
      .then(async (payload) => {
        if (generation !== sessionGeneration || currentSession !== previous) throw new ApiError("AUTH_SCOPE_CHANGED", "The session changed during refresh.", 409);
        const session = toSession(payload, previous);
        await updateSession(session);
        return session;
      })
      .catch(async (error) => {
        if (generation === sessionGeneration && error instanceof ApiError && error.status === 401) await updateSession(null);
        throw error;
      })
      .finally(() => {
        if (generation === sessionGeneration) refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function getCurrentAuthHeaders(
  expectedScope?: AuthRequestScope,
): Promise<Record<string, string>> {
  let session = currentSession;
  if (!session) {
    throw new ApiError("UNAUTHENTICATED", "Authentication is required.", 401);
  }
  if (!session.selectedOrganizationId) {
    throw new ApiError("ORGANIZATION_REQUIRED", "Select an organization.", 400);
  }
  if (
    expectedScope &&
    (
      session.user.id !== expectedScope.userId ||
      session.selectedOrganizationId !== expectedScope.organizationId
    )
  ) {
    throw new ApiError("AUTH_SCOPE_CHANGED", "The authenticated data scope changed.", 409);
  }
  if (Date.parse(session.accessTokenExpiresAt) <= Date.now() + 15_000) {
    session = await refreshAccessToken();
  }
  if (!session.selectedOrganizationId) {
    throw new ApiError("ORGANIZATION_REQUIRED", "Select an organization.", 400);
  }
  return {
    Authorization: `Bearer ${session.accessToken}`,
    "X-Organization-Id": session.selectedOrganizationId,
  };
}

async function request<T>(
  path: string,
  init?: RequestInit,
  protectedRequest = true,
  retryUnauthorized = true,
  expectedScope?: AuthRequestScope,
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new ApiError("NOT_CONFIGURED", "EXPO_PUBLIC_API_URL is not configured.", 0);
  }
  const authHeaders = protectedRequest ? await getCurrentAuthHeaders(expectedScope) : {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let response: Response;
  try {
  response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: controller.signal,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...authHeaders,
      ...init?.headers,
    },
  });
  } finally { clearTimeout(timer); }
  if (protectedRequest && response.status === 401 && retryUnauthorized) {
    await refreshAccessToken();
    return request<T>(path, init, true, false, expectedScope);
  }
  const body: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    !body ||
    typeof body !== "object" ||
    !("data" in body)
  ) {
    const errorBody = body as ErrorEnvelope | null;
    throw new ApiError(
      errorBody?.error?.code ?? "HTTP_ERROR",
      errorBody?.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      errorBody?.error?.details,
    );
  }
  return (body as SuccessEnvelope<T>).data;
}

export async function login(
  email: string,
  password: string,
  organizationSlug?: string,
): Promise<AuthSession> {
  const payload = await request<AuthPayload>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      ...(organizationSlug ? { organizationSlug } : {}),
    }),
  }, false);
  const session = toSession(payload);
  await updateSession(session);
  return session;
}

export async function refreshSession(): Promise<AuthSession> {
  return refreshAccessToken();
}

export async function logout(): Promise<void> {
  const refreshToken = currentSession?.refreshToken;
  try {
    if (currentSession) {
      await request<void>("/api/v1/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
    }
  } finally {
    await updateSession(null);
  }
}

export async function selectOrganization(organizationId: string): Promise<AuthSession> {
  if (!currentSession?.organizations.some(({ id }) => id === organizationId)) {
    throw new ApiError("INVALID_ORGANIZATION", "The selected organization is not available.", 400);
  }
  const session = { ...currentSession, selectedOrganizationId: organizationId };
  await updateSession(session);
  return session;
}

export function getOrganizationGeofences(): Promise<OrganizationGeofence[]> {
  return request("/api/v1/geofences");
}

export function pushOperations(
  deviceId: string,
  operations: OutboxOperation[],
  expectedScope?: AuthRequestScope,
) {
  return request<PushResponse>("/api/v1/sync/push", {
    method: "POST",
    headers: { "Idempotency-Key": operations.map((item) => item.idempotencyKey).join(",") },
    body: JSON.stringify({ deviceId, operations: operations.map(operation => ({ ...operation, baseVersion: operation.baseVersion ?? operation.payload.revision ?? 0 })) }),
  }, true, true, expectedScope);
}

export function pullChanges(cursor: string | null, expectedScope?: AuthRequestScope) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return request<PullResponse>(`/api/v1/sync/pull${query}`, undefined, true, true, expectedScope);
}

export async function uploadDocument(asset: {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  idempotencyKey: string;
}) {
  const initiation = await request<{
    documentId: string;
    uploadUrl: string;
    headers?: Record<string, string>;
  }>("/api/v1/documents/uploads", {
    method: "POST",
    headers: { "Idempotency-Key": asset.idempotencyKey },
    body: JSON.stringify({
      fileName: asset.name,
      mimeType: asset.mimeType,
      size: asset.size,
    }),
  });
  const { uploadFile } = await import("./services/native-upload");
  const upload = await uploadFile(initiation.uploadUrl, asset.uri, initiation.headers ?? {});
  if (!upload.ok) {
    throw new ApiError("UPLOAD_FAILED", `Upload failed with status ${upload.status}.`, upload.status);
  }
  return request<{ id: string; status: string }>(
    `/api/v1/documents/uploads/${encodeURIComponent(initiation.documentId)}/complete`,
    {
      method: "POST",
      headers: { "Idempotency-Key": asset.idempotencyKey },
      body: JSON.stringify({}),
    },
  );
}

export function requestOperation(
  kind: OperationalRequest["kind"],
  subjectId: string,
  idempotencyKey: string,
  plotIds?: string[],
) {
  const paths = {
    satellite: "/api/v1/satellite/analyses",
    evidence_pack: "/api/v1/evidence-packs",
    dds: "/api/v1/dds/drafts",
  };
  return request<OperationalRequest>(paths[kind], {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ subjectId, ...(kind === "dds" ? { plotIds } : {}) }),
  });
}

export function validateDds(id: string, idempotencyKey: string) {
  return request<OperationalRequest>(`/api/v1/dds/drafts/${encodeURIComponent(id)}/validate`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({}),
  });
}

export function submitDds(id: string, idempotencyKey: string) {
  return request<OperationalRequest>(`/api/v1/dds/drafts/${encodeURIComponent(id)}/submit`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({}),
  });
}

export function getOperation(kind: OperationalRequest["kind"], id: string) {
  const roots = {
    satellite: "/api/v1/satellite/analyses",
    evidence_pack: "/api/v1/evidence-packs",
    dds: "/api/v1/dds/drafts",
  };
  return request<OperationalRequest>(`${roots[kind]}/${encodeURIComponent(id)}`);
}
