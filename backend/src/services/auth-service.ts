import * as repository from "../repositories/auth-repository.js";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { writeAudit, type AuditContext } from "../audit.js";
import { queryMany, queryOne, withContext } from "../db.js";
import { AppError, badRequest } from "../errors.js";

import {
  constantTimeEqual,
  createRefreshToken,
  hashOpaqueToken,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from "../security.js";
import type { AuthContext, Role } from "../types.js";
import type { Permissions } from "../permissions.js";
import {
  createDeviceSession, endDeviceSession, recordDeviceEvent, sessionExpired, sessionInfo,
  type DeviceSessionRow,
} from "./device-session-service.js";

type UserRow = {
  id: string;
  organization_id: string | null;
  organization_name?: string | null;
  email: string;
  display_name: string;
  password_hash: string;
  role: Role;
  active: boolean;
  token_version: number;
  assigned_roles?: Role[];
  permissions?: Permissions;
};

export const loginSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(1024),
  organizationSlug: z.string().min(2).max(63).optional(),
});
export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(512) });

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    organizationId: user.organization_id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    roles: user.assigned_roles ?? [user.role],
    permissions: user.permissions,
  };
}

export function organizationSelection(
  user: Pick<UserRow, "role" | "organization_id" | "organization_name">,
) {
  if (
    user.role === "system_admin" ||
    !user.organization_id ||
    !user.organization_name
  ) {
    return { organizations: [], selectedOrganizationId: null };
  }
  return {
    organizations: [{ id: user.organization_id, name: user.organization_name }],
    selectedOrganizationId: user.organization_id,
  };
}

export function assertOrganizationHeader(
  header: string | string[] | undefined,
  claims: AuthContext,
): void {
  if (header === undefined) return;
  if (
    typeof header !== "string" ||
    !claims.organizationId ||
    header !== claims.organizationId
  ) {
    throw new AppError(
      403,
      "ORGANIZATION_MISMATCH",
      "X-Organization-Id does not match the authenticated organization.",
    );
  }
}

async function issueTokens(
  pool: Pool,
  config: AppConfig,
  user: UserRow,
  request: AuditContext,
) {
  const session = await withContext(pool, "system", async (client) => {
    const device = await createDeviceSession(client, user.id, user.organization_id, request);
    const refresh = createRefreshToken();
    await repository.insertRefreshTokens(client, [
      refresh.id, device.id, user.id, user.organization_id, refresh.hash, null, device.expires_at,
    ]);
    return { device, refresh };
  });
  const auth: AuthContext = {
    userId: user.id,
    organizationId: user.organization_id,
    role: user.role,
    tokenVersion: user.token_version,
    sessionId: session.device.id,
  };
  return {
    accessToken: await signAccessToken(config, auth),
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: session.refresh.serialized,
    refreshExpiresAt: session.device.expires_at.toISOString(),
    session: sessionInfo(session.device),
    user: publicUser(user),
    ...organizationSelection(user),
  };
}


export function createAuthService(pool: Pool, config: AppConfig) {
 return {
 async login(body:z.infer<typeof loginSchema>,request:AuditContext) {
    const users = await withContext(pool, "system", (client) =>
      repository.selectUsers<UserRow>(client,[body.email, body.organizationSlug ?? null]));
    if (users.length !== 1 || !(await verifyPassword(users[0]!.password_hash, body.password))) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email, password, or organization.");
    }
    const user = users[0]!;
    const tokens = await issueTokens(pool, config, user, request);
    const auth: AuthContext = {
      userId: user.id,
      organizationId: user.organization_id,
      role: user.role,
      tokenVersion: user.token_version,
    };
    await withContext(pool, "system", (client) =>
      writeAudit(client, request, auth, "auth.login", "user", user.id));
    return tokens;
},
 async refresh(refreshToken:string) {
    const [id] = refreshToken.split(".");
    if (!id || !z.string().uuid().safeParse(id).success) {
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "The refresh token is invalid.");
    }
    const nextRefresh = createRefreshToken();
    const result = await withContext(pool, "system", async (client) => {
      const token = await repository.selectRefreshTokens<{
        id: string;
        family_id: string;
        token_hash: string;
        used_at: Date | null;
        revoked_at: Date | null;
        expires_at: Date;
        user_id: string;
      }>(client,[id]);
      if (!token || !constantTimeEqual(token.token_hash, hashOpaqueToken(refreshToken))) {
        throw new AppError(401, "INVALID_REFRESH_TOKEN", "The refresh token is invalid.");
      }
      if (token.used_at || token.revoked_at) {
        await repository.updateRefreshTokens(client,[token.family_id]);
        await endDeviceSession(client, token.family_id, "revoked");
        return { error: "reuse" as const };
      }
      const session = await queryOne<DeviceSessionRow>(client,
        "SELECT * FROM device_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE", [token.family_id, token.user_id]);
      if (!session || sessionExpired(session)) {
        await endDeviceSession(client, token.family_id, "expired");
        await repository.updateRefreshTokens(client, [token.family_id]);
        return { error: "session" as const };
      }
      if (token.expires_at.getTime() <= Date.now()) {
        await repository.updateRefreshTokens2(client,[token.id]);
        return { error: "expired" as const };
      }
      const user = await repository.selectUsers2<UserRow>(client,[token.user_id]);
      if (!user) {
        throw new AppError(
          401,
          "INVALID_REFRESH_TOKEN",
          "The user or organization is inactive.",
        );
      }
      await repository.updateRefreshTokens3(client,[token.id]);
      await repository.insertRefreshTokens2(client,[
          nextRefresh.id,
          token.family_id,
          user.id,
          user.organization_id,
          nextRefresh.hash,
          token.id,
          session.expires_at,
        ]);
      await recordDeviceEvent(client, session.id, "session.refresh", 200);
      return { token, user, session, error: null };
    });
    if (result.error === "reuse") {
      throw new AppError(401, "REFRESH_TOKEN_REUSE", "Refresh token reuse was detected; the session was revoked.");
    }
    if (result.error === "expired") {
      throw new AppError(401, "REFRESH_TOKEN_EXPIRED", "The refresh token has expired.");
    }
    if (result.error === "session") {
      throw new AppError(401, "SESSION_EXPIRED", "Your session has ended. Sign in again.");
    }
    const auth: AuthContext = {
      userId: result.user.id,
      organizationId: result.user.organization_id,
      role: result.user.role,
      tokenVersion: result.user.token_version,
      sessionId: result.session.id,
    };
    return {
      accessToken: await signAccessToken(config, auth),
      expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: nextRefresh.serialized,
      refreshExpiresAt: result.session.expires_at.toISOString(),
      session: sessionInfo(result.session),
      user: publicUser(result.user),
      ...organizationSelection(result.user),
    };
},
 async logout(auth:AuthContext,request:AuditContext,refreshToken:string) {
    const tokenHash = hashOpaqueToken(refreshToken);
    await withContext(pool, "system", async (client) => {
      await repository.updateRefreshTokens4(client,[tokenHash, auth.userId]);
      if (auth.sessionId) await endDeviceSession(client, auth.sessionId, "logout");
      await writeAudit(client, request, auth, "auth.logout", "user", auth.userId);
    });
    return { loggedOut: true };
},
 async me(auth:AuthContext) {
    const user = await withContext(pool, auth, (client) =>
      repository.selectUsers3<UserRow>(client,[auth.userId]));
    if (!user) throw badRequest("USER_NOT_FOUND", "The authenticated user no longer exists.");
    return publicUser({ ...user, assigned_roles: auth.roles ?? [user.role],
      ...(auth.permissions ? { permissions: auth.permissions } : {}) });
}
 };
}
