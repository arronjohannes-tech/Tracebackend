import assert from "node:assert/strict";
import test from "node:test";
import { assignableUserRoles, isProtectedSystemUser, selectUserRoles } from "../src/access-management.mjs";

test("only system administrators receive the privileged assignment option", () => {
  assert.deepEqual(assignableUserRoles({ role: "system_admin" }),
    ["system_admin", "org_admin", "reviewer", "field_agent", "auditor"]);
  for (const actor of [undefined, { role: "org_admin" }, { role: "reviewer", roles: ["system_admin"] }]) {
    assert.equal(assignableUserRoles(actor).includes("system_admin"), false);
  }
});

test("system role selection is exclusive while organization roles combine", () => {
  assert.deepEqual(selectUserRoles(["org_admin", "auditor"], "system_admin", true), ["system_admin"]);
  assert.deepEqual(selectUserRoles(["system_admin"], "auditor", true), ["auditor"]);
  assert.deepEqual(selectUserRoles(["reviewer"], "auditor", true), ["reviewer", "auditor"]);
  assert.deepEqual(selectUserRoles(["auditor"], "auditor", true), ["auditor"]);
  assert.deepEqual(selectUserRoles(["system_admin"], "system_admin", false), []);
});

test("existing privileged accounts stay protected", () => {
  assert.equal(isProtectedSystemUser({ role: "system_admin" }), true);
  assert.equal(isProtectedSystemUser({ roles: ["system_admin"] }), true);
  assert.equal(isProtectedSystemUser({ role: "org_admin" }), false);
  assert.equal(isProtectedSystemUser(null), false);
});
