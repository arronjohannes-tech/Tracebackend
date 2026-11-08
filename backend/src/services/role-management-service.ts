import type { Pool } from "pg";
import { z } from "zod";
import { writeAudit, type AuditContext } from "../audit.js";
import { queryMany, withContext } from "../db.js";
import { defaultPermission, sections, type PermissionRow } from "../permissions.js";
import { roles, type AuthContext } from "../types.js";

export const matrixSchema = z.object({
  permissions: z.array(z.object({
    role: z.enum(roles).exclude(["system_admin"]),
    section: z.enum(sections),
    read: z.boolean(),
    write: z.boolean(),
  }).refine((row) => !row.write || row.read, "Editing requires visibility.")
    .refine((row) => !["users", "roles"].includes(row.section) ||
      (row.role === "org_admin" ? row.read && row.write : !row.read && !row.write),
    "Administration is reserved for administrators and cannot be disabled for them."))
    .length(4 * sections.length)
    .refine((rows) => new Set(rows.map((row) => `${row.role}:${row.section}`)).size === rows.length),
});

export function createRoleManagementService(pool: Pool) {
  return {
    async get(auth: AuthContext, organizationId: string) {
      const rows = await withContext(pool, auth, (client) => queryMany<PermissionRow>(client,
        "SELECT role, section, can_read, can_write FROM role_permissions WHERE organization_id=$1", [organizationId]));
      return { roles, sections, permissions: roles.flatMap((role) =>
        sections.map((section) => {
          const row = rows.find((item) => item.role === role && item.section === section);
          const locked = role === "system_admin" || ["users", "roles"].includes(section);
          return { role, section, ...(row && !locked ? { read: row.can_read, write: row.can_write } : defaultPermission(role, section)), locked };
        })) };
    },
    async save(auth: AuthContext, audit: AuditContext, organizationId: string, body: z.infer<typeof matrixSchema>) {
      await withContext(pool, auth, async (client) => {
        await client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [organizationId]);
        for (const row of body.permissions) {
          await client.query(`INSERT INTO role_permissions(organization_id,role,section,can_read,can_write)
            VALUES ($1,$2,$3,$4,$5) ON CONFLICT (organization_id,role,section)
            DO UPDATE SET can_read=EXCLUDED.can_read, can_write=EXCLUDED.can_write`,
          [organizationId, row.role, row.section, row.read, row.write]);
        }
        await writeAudit(client, audit, auth, "roles.update", "organization", organizationId, { organizationId, ...body });
      });
      return { saved: true };
    },
  };
}
