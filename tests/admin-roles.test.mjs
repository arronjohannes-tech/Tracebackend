import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedTabsForRole,
  canAdministerOrganization,
} from "../admin/roles.js";

test("admin role matrix starts each role on an authorized tab", () => {
  assert.equal(allowedTabsForRole("system_admin")[0], "users");
  assert.equal(allowedTabsForRole("org_admin")[0], "users");
  assert.equal(allowedTabsForRole("reviewer")[0], "geofences");
  assert.equal(allowedTabsForRole("auditor")[0], "geofences");
  assert.deepEqual(allowedTabsForRole("field_agent"), []);
});

test("only administrator roles receive mutating organization controls", () => {
  assert.equal(canAdministerOrganization("system_admin"), true);
  assert.equal(canAdministerOrganization("org_admin"), true);
  assert.equal(canAdministerOrganization("reviewer"), false);
  assert.equal(canAdministerOrganization("auditor"), false);
});

test("only organization administrators can open the Copernicus Process tab", () => {
  assert.ok(allowedTabsForRole("system_admin").includes("copernicus"));
  assert.ok(allowedTabsForRole("org_admin").includes("copernicus"));
  for (const role of ["reviewer", "auditor", "field_agent"]) {
    assert.equal(allowedTabsForRole(role).includes("copernicus"), false, role);
  }
  assert.ok(allowedTabsForRole("org_admin").includes("config"), "existing API / EU tab stays");
});