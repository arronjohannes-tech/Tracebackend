import type { PoolClient } from "pg";
import { queryMany } from "./db.js";
import { forbidden } from "./errors.js";
import type { AuthContext, Role } from "./types.js";

export const sections = ["overview", "suppliers", "plots", "shipments", "risk", "dds", "guide", "users", "roles"] as const;
export type Section = typeof sections[number];
export type Permission = { read: boolean; write: boolean };
export type Permissions = Record<Section, Permission>;
export type PermissionRow = { role: Role; section: Section; can_read: boolean; can_write: boolean };
export const assignedRoles = (auth: Pick<AuthContext, "role" | "roles">): readonly Role[] => auth.roles ?? [auth.role];
export const hasRole = (auth: Pick<AuthContext, "role" | "roles">, roles: readonly Role[]) =>
  assignedRoles(auth).some((role) => roles.includes(role));

export function defaultPermission(role: Role, section: Section): Permission {
  if (role === "system_admin" || role === "org_admin") return { read: true, write: true };
  if (section === "users" || section === "roles") return { read: false, write: false };
  return { read: true, write: role === "reviewer" || role === "field_agent" };
}

export function effectivePermissions(userRoles: readonly Role[], rows: readonly PermissionRow[]): Permissions {
  return Object.fromEntries(sections.map((section) => {
    const permissions = userRoles.map((role) => {
      if (role === "system_admin" || (role === "org_admin" && ["users", "roles"].includes(section))) {
        return { read: true, write: true };
      }
      if (["users", "roles"].includes(section) && role !== "org_admin") return { read: false, write: false };
      const row = rows.find((item) => item.role === role && item.section === section);
      return row ? { read: row.can_read, write: row.can_read && row.can_write } : defaultPermission(role, section);
    });
    return [section, { read: permissions.some((p) => p.read), write: permissions.some((p) => p.write) }];
  })) as Permissions;
}

export async function loadPermissions(client: PoolClient, roles: readonly Role[], organizationId: string | null) {
  const rows = organizationId ? await queryMany<PermissionRow>(client,
    "SELECT role, section, can_read, can_write FROM role_permissions WHERE organization_id = $1", [organizationId]) : [];
  return effectivePermissions(roles, rows);
}

export function assertPermission(auth: AuthContext, section: Section, write = false): void {
  const permission = auth.permissions?.[section] ?? effectivePermissions(assignedRoles(auth), [])[section];
  if (!(write ? permission.write : permission.read)) throw forbidden("Access to this section is not allowed.");
}

export function routeSection(path: string): Section | null {
  if (/\/auth(?:\/|$)|\/organization$|\/admin\/organizations$/.test(path)) return null;
  if (/\/users(?:\/|$)/.test(path)) return "users";
  if (/\/roles(?:\/|$)/.test(path)) return "roles";
  if (/\/dashboard$/.test(path)) return null; // Response is filtered per section.
  if (/\/shipments(?:\/|$)/.test(path)) return "shipments";
  if (/\/supplier/.test(path)) return "suppliers";
  if (/\/plots|\/plot-corrections|\/satellite|\/geofences|\/sync/.test(path)) return "plots";
  if (/\/reviews|\/audit-logs/.test(path)) return "risk";
  if (/\/documents|\/operations|\/evidence-packs|\/dds/.test(path)) return "dds";
  if (/\/config|\/copernicus/.test(path)) return "roles";
  return null;
}
