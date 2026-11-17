import type { FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "./config.js";
import type { AuthContext, Role } from "./types.js";
import { verifyAccessToken } from "./security.js";
import { AppError } from "./errors.js";
import { queryOne, withContext } from "./db.js";
import { assertOrganizationHeader } from "./services/auth-service.js";
import { assertPermission, loadPermissions, routeSection } from "./permissions.js";
import { checkDeviceSession } from "./services/device-session-service.js";
export { organizationSelection, assertOrganizationHeader } from "./services/auth-service.js";
export { registerAuthRoutes } from "./controllers/auth-controller.js";
export function createAuthenticator(pool: Pool, config: AppConfig) {
  return async function authenticate(request: FastifyRequest): Promise<void> {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new AppError(401, "UNAUTHORIZED", "A Bearer access token is required.");
    }
    let claims: AuthContext;
    try {
      claims = await verifyAccessToken(config, authorization.slice(7));
    } catch {
      throw new AppError(401, "INVALID_ACCESS_TOKEN", "The access token is invalid or expired.");
    }
    assertOrganizationHeader(request.headers["x-organization-id"], claims);
    if (claims.sessionId) await checkDeviceSession(pool, claims.sessionId, claims.userId);
    const current = await withContext(pool, "system", (client) =>
      queryOne<{ active: boolean; organization_active: boolean; token_version: number; organization_id: string | null; role: Role; assigned_roles: Role[] }>(
        client,
        "SELECT active, token_version, organization_id, role, assigned_roles::text[] AS assigned_roles, CASE WHEN role = 'system_admin' THEN true ELSE EXISTS(SELECT 1 FROM organizations o WHERE o.id = users.organization_id AND o.active) END AS organization_active FROM users WHERE id = $1 AND deleted_at IS NULL",
        [claims.userId],
      ));
    if (
      !current?.active ||
      !current.organization_active ||
      current.token_version !== claims.tokenVersion ||
      current.organization_id !== claims.organizationId ||
      current.role !== claims.role
    ) {
      throw new AppError(401, "INVALID_ACCESS_TOKEN", "The access token is no longer valid.");
    }
    claims.roles = current.assigned_roles ?? [current.role];
    claims.permissions = await withContext(pool, "system", (client) =>
      loadPermissions(client, claims.roles!, current.organization_id));
    request.auth = claims;
    const section = routeSection(request.url.split("?")[0]!);
    if (section) assertPermission(claims, section, !["GET", "HEAD"].includes(request.method));
  };
}
