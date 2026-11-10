import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  registrationActions,
  registrationListUrl,
  canManageRegistrations,
  isExistingAccountReactivation,
  registrationApprovalPayload,
} from "../src/registration-management.mjs";
import {
  activationAppUrl,
  takeActivationToken,
} from "../src/mobile-activate.mjs";

test("registration list query encodes server-side search, status, and 25-row pagination", () => {
  assert.equal(
    registrationListUrl({ status: "pending", search: "  Hana & Sons  ", page: 3 }),
    "/api/v1/admin/registrations?page=3&pageSize=25&status=pending&search=Hana+%26+Sons",
  );
  assert.equal(registrationListUrl(), "/api/v1/admin/registrations?page=1&pageSize=25");
});

test("only status-appropriate registration actions are exposed", () => {
  assert.deepEqual(registrationActions({ status: "pending" }), ["approve", "deactivate"]);
  assert.deepEqual(registrationActions({ status: "disabled", userId: "existing" }), ["approve"]);
  assert.deepEqual(registrationActions({ status: "approved" }), ["resend", "deactivate"]);
  assert.deepEqual(registrationActions({ status: "active" }), ["deactivate"]);
  assert.deepEqual(registrationActions({ status: "unknown" }), []);
});

test("registration management is restricted to system administrators", () => {
  assert.equal(canManageRegistrations({ role: "system_admin" }), true);
  for (const role of ["org_admin", "reviewer", "field_agent", "auditor"]) {
    assert.equal(canManageRegistrations({ role }), false);
  }
  assert.equal(canManageRegistrations(null), false);
});

test("existing disabled accounts keep their assignment read-only during reactivation", () => {
  const registration = {
    status: "disabled",
    userId: "existing-user",
    organizationId: "current-org",
    roles: ["reviewer", "auditor"],
  };
  assert.equal(isExistingAccountReactivation(registration), true);
  assert.deepEqual(registrationApprovalPayload(registration, {
    organizationId: "different-org",
    roles: ["org_admin"],
  }), {
    organizationId: "current-org",
    roles: ["reviewer", "auditor"],
  });
  assert.equal(isExistingAccountReactivation({ status: "disabled" }), false);
  assert.equal(isExistingAccountReactivation({ status: "pending", userId: "existing-user" }), false);
  assert.deepEqual(registrationApprovalPayload({ status: "pending" }, {
    organizationId: "new-org",
    roles: ["field_agent"],
  }), { organizationId: "new-org", roles: ["field_agent"] });
});

test("activation token is read from the fragment and immediately removed from browser history", () => {
  const locationRef = { hash: `#token=${"a".repeat(31)}%2B`, pathname: "/mobile-activate.html", search: "" };
  let replacement;
  const token = takeActivationToken(locationRef, {
    replaceState: (...args) => { replacement = args; },
  });
  assert.equal(token, `${"a".repeat(31)}+`);
  assert.deepEqual(replacement, [null, "", "/mobile-activate.html"]);
});

test("activation token parser accepts only decoded tokens from 32 through 256 characters", () => {
  const parse = (length) => takeActivationToken(
    { hash: `#token=${"x".repeat(length)}`, pathname: "/mobile-activate.html", search: "" },
    { replaceState() {} },
  );
  assert.equal(parse(31), "");
  assert.equal(parse(32).length, 32);
  assert.equal(parse(256).length, 256);
  assert.equal(parse(257), "");
});

test("activation link uses only the fixed app scheme and safely encodes the token", () => {
  const link = new URL(activationAppUrl("a&redirect=https://attacker.invalid"));
  assert.equal(link.protocol, "tracehub:");
  assert.equal(link.hostname, "activate");
  assert.equal(link.searchParams.get("token"), "a&redirect=https://attacker.invalid");
  assert.deepEqual([...link.searchParams.keys()], ["token"]);
});

test("HTTPS activation page forbids referrers and does not auto-redirect", async () => {
  const [html, script, docs] = await Promise.all([
    readFile(new URL("../mobile-activate.html", import.meta.url), "utf8"),
    readFile(new URL("../src/mobile-activate.mjs", import.meta.url), "utf8"),
    readFile(new URL("../docs/registration-activation.md", import.meta.url), "utf8"),
  ]);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /mobile-activate\.mjs/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|console\.(?:log|error|warn)|location\.assign|location\.replace/);
  assert.match(script, /tracehub:\/\/activate/);
  assert.match(docs, /tracehub-ten\.vercel\.app/);
  assert.match(docs, /Do not publish placeholder association documents/);
});
