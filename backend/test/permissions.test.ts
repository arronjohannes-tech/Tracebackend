import assert from "node:assert/strict";
import test from "node:test";
import { assertPermission, defaultPermission, effectivePermissions, hasRole, routeSection, sections } from "../src/permissions.js";
import { matrixSchema } from "../src/services/role-management-service.js";
import { createUserSchema, updateUserSchema } from "../src/services/user-management-service.js";
import { roles } from "../src/types.js";

test("permissions preserve legacy defaults and combine grants across assigned roles", () => {
  const defaults = effectivePermissions(["auditor"], []);
  assert.deepEqual(defaults.plots, { read: true, write: false });
  assert.deepEqual(defaults.users, { read: false, write: false });
  const rows = [{ role: "reviewer" as const, section: "plots" as const, can_read: false, can_write: false }];
  assert.equal(effectivePermissions(["reviewer"], rows).plots.read, false);
  assert.equal(effectivePermissions(["reviewer", "field_agent"], rows).plots.write, true);
  assert.equal(hasRole({ role: "reviewer", roles: ["reviewer", "field_agent"] }, ["field_agent"]), true);
  assert.throws(() => assertPermission({ userId: "user", organizationId: "org", role: "reviewer",
    tokenVersion: 0, permissions: effectivePermissions(["reviewer"], rows) }, "plots"), /not allowed/);
});

test("administration rights cannot be delegated or disabled by stored overrides", () => {
  for (const role of roles) {
    for (const section of ["users", "roles"] as const) {
      const permission = effectivePermissions([role], [{ role, section, can_read: true, can_write: true }])[section];
      assert.equal(permission.write, role === "system_admin" || role === "org_admin");
    }
  }
  assert.equal(effectivePermissions(["org_admin"], [{ role: "org_admin", section: "users", can_read: false, can_write: false }]).users.write, true);
});

test("role matrix validates complete unique pairs, visibility and protected administrator cells", () => {
  const permissions = roles.filter((role) => role !== "system_admin").flatMap((role) =>
    sections.map((section) => ({ role, section, ...defaultPermission(role, section) })));
  assert.equal(matrixSchema.safeParse({ permissions }).success, true);
  assert.equal(matrixSchema.safeParse({ permissions: permissions.slice(1) }).success, false);
  assert.equal(matrixSchema.safeParse({ permissions: [permissions[0], ...permissions.slice(0, -1)] }).success, false);
  for (const replacement of [
    { role: "auditor", section: "plots", read: false, write: true },
    { role: "reviewer", section: "users", read: true, write: true },
    { role: "org_admin", section: "roles", read: false, write: false },
  ]) {
    assert.equal(matrixSchema.safeParse({ permissions: permissions.map((row) =>
      row.role === replacement.role && row.section === replacement.section ? replacement : row) }).success, false);
  }
});

test("user schemas reject absent, duplicate or system roles and empty updates", () => {
  const body = { email: "USER@example.com", displayName: " User ", password: "a-long-test-password" };
  assert.equal(createUserSchema.safeParse(body).success, false);
  assert.equal(createUserSchema.safeParse({ ...body, roles: ["system_admin"] }).success, false);
  assert.equal(createUserSchema.safeParse({ ...body, roles: ["auditor", "auditor"] }).success, false);
  assert.equal(createUserSchema.parse({ ...body, roles: ["reviewer", "auditor"] }).email, "user@example.com");
  assert.equal(updateUserSchema.safeParse({}).success, false);
});

test("API sections map nested tenant routes and leave combined endpoints filtered by their services", () => {
  for (const [path, section] of [
    ["/api/v1/admin/organizations/org/users", "users"],
    ["/api/v1/admin/roles", "roles"],
    ["/api/v1/satellite/analyses/id/images/plot", "plots"],
    ["/api/v1/shipments/id", "shipments"],
    ["/api/v1/documents/uploads/id/complete", "dds"],
    ["/api/v1/admin/reviews/id", "risk"],
    ["/api/v1/organization", null],
    ["/api/v1/auth/me", null],
    ["/api/v1/dashboard", null],
  ] as const) assert.equal(routeSection(path), section);
});
