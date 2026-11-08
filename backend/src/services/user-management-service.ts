import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { writeAudit, type AuditContext } from "../audit.js";
import { queryMany, queryOne, withContext } from "../db.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { hashPassword } from "../security.js";
import { roles, type AuthContext, type Role } from "../types.js";

const managedRole = z.enum(roles).exclude(["system_admin"]);
const roleList = z.array(managedRole).min(1).max(4).refine((value) => new Set(value).size === value.length);
export const createUserSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(1024),
  role: managedRole.optional(),
  roles: roleList.optional(),
  active: z.boolean().default(true),
}).refine((value) => value.role || value.roles, "At least one role is required.");
export const updateUserSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()).optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(12).max(1024).optional(),
  role: managedRole.optional(),
  roles: roleList.optional(),
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0);

const fields = `id, organization_id AS "organizationId", email, display_name AS "displayName",
  role, assigned_roles::text[] AS roles, active, created_at AS "createdAt", updated_at AS "updatedAt"`;
const primaryRole = (values: Role[]) => roles.find((role) => values.includes(role))!;
const canonicalRoles = (values: readonly Role[]) => roles.filter((role) => values.includes(role));

export async function assertRemainingAdministrator(client: PoolClient, organizationId: string, userId: string,
  nextRoles: readonly Role[], active: boolean) {
  const current = await queryOne<{ active: boolean; assigned_roles: Role[] }>(client,
    "SELECT active, assigned_roles::text[] AS assigned_roles FROM users WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL", [userId, organizationId]);
  if (!current) throw notFound("User");
  if (current.active && current.assigned_roles.includes("org_admin") && (!active || !nextRoles.includes("org_admin"))) {
    const remaining = await queryOne<{ count: number }>(client,
      `SELECT count(*)::int AS count FROM users WHERE organization_id = $1 AND id <> $2
        AND active AND deleted_at IS NULL AND 'org_admin' = ANY(assigned_roles)`, [organizationId, userId]);
    if (!remaining?.count) throw conflict("LAST_ADMIN", "The last active organization administrator must be retained.");
  }
}

export function createUserManagementService(pool: Pool) {
  return {
    list: (auth: AuthContext, organizationId: string) => withContext(pool, auth, (client) =>
      queryMany(client, `SELECT ${fields} FROM users WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY email`, [organizationId])),
    async create(auth: AuthContext, audit: AuditContext, organizationId: string, body: z.infer<typeof createUserSchema>) {
      if (body.role && body.roles && !body.roles.includes(body.role)) throw badRequest("ROLE_MISMATCH", "Primary role must be assigned.");
      const selected = canonicalRoles(body.roles ?? [body.role!]);
      const passwordHash = await hashPassword(body.password);
      return withContext(pool, auth, async (client) => {
        await client.query("SELECT id FROM organizations WHERE id = $1 FOR UPDATE", [organizationId]);
        const user = await queryOne(client,
          `INSERT INTO users(organization_id,email,display_name,password_hash,role,assigned_roles,active)
            VALUES ($1,$2,$3,$4,$5,$6::user_role[],$7) RETURNING ${fields}`,
          [organizationId, body.email, body.displayName, passwordHash, primaryRole(selected), selected, body.active]);
        await writeAudit(client, audit, auth, "user.create", "user", String(user!.id), { organizationId, roles: selected });
        return user;
      });
    },
    async update(auth: AuthContext, audit: AuditContext, organizationId: string, userId: string,
      body: z.infer<typeof updateUserSchema>, deleting = false) {
      if (userId === auth.userId && (deleting || body.active === false || body.roles || body.role)) {
        throw badRequest("SELF_ACCESS_CHANGE", "You cannot remove your own access or change your own roles.");
      }
      if (body.role && body.roles && !body.roles.includes(body.role)) throw badRequest("ROLE_MISMATCH", "Primary role must be assigned.");
      const passwordHash = body.password ? await hashPassword(body.password) : null;
      return withContext(pool, auth, async (client) => {
        await client.query("SELECT id FROM organizations WHERE id = $1 FOR UPDATE", [organizationId]);
        const current = await queryOne<{ assigned_roles: Role[]; active: boolean; email: string }>(client,
          "SELECT assigned_roles::text[] AS assigned_roles, active, email FROM users WHERE id=$1 AND organization_id=$2 AND role <> 'system_admin' AND deleted_at IS NULL FOR UPDATE", [userId, organizationId]);
        if (!current) throw notFound("User");
        const requested = body.roles ?? (body.role ? [body.role] : current.assigned_roles);
        const selected = canonicalRoles(requested);
        const active = deleting ? false : body.active ?? current.active;
        await assertRemainingAdministrator(client, organizationId, userId, selected, active);
        const user = await queryOne(client, `UPDATE users SET email=COALESCE($3,email),
          display_name=COALESCE($4,display_name), password_hash=COALESCE($5,password_hash),
          role=$6, assigned_roles=$7::user_role[], active=$8,
          token_version=token_version + CASE WHEN $5::text IS NOT NULL OR email <> COALESCE($3,email)
            OR assigned_roles <> $7::user_role[] OR active <> $8 OR $9 THEN 1 ELSE 0 END,
          deleted_at=CASE WHEN $9 THEN now() ELSE deleted_at END, updated_at=now()
          WHERE id=$1 AND organization_id=$2 RETURNING ${fields}`,
          [userId, organizationId, body.email ?? null, body.displayName ?? null, passwordHash,
            primaryRole(selected), selected, active, deleting]);
        const sessionChanged = deleting || Boolean(passwordHash) ||
          (body.email !== undefined && body.email !== current.email) || active !== current.active ||
          selected.length !== current.assigned_roles.length || selected.some((role) => !current.assigned_roles.includes(role));
        if (sessionChanged) {
          await client.query("UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1", [userId]);
          await client.query("UPDATE documents SET upload_expires_at=now() WHERE created_by=$1 AND organization_id=$2", [userId, organizationId]);
        }
        await writeAudit(client, audit, auth, deleting ? "user.delete" : "user.update", "user", userId,
          { organizationId, roles: selected, active, passwordChanged: Boolean(passwordHash) });
        return user;
      });
    },
  };
}
