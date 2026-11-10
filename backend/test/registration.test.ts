import assert from "node:assert/strict";
import test from "node:test";
import { activationSchema, registrationApprovalSchema, registrationListSchema, registrationSchema } from "../src/services/registration-service.js";

test("registration normalizes names, email and international phone numbers", () => {
  const parsed = registrationSchema.parse({ displayName: " Ada ", email: "ADA@example.com", phoneCountry: "DE", phoneNumber: "015123456789" });
  assert.equal(parsed.displayName, "Ada");
  assert.equal(parsed.email, "ada@example.com");
  assert.equal(parsed.phoneNumber, "+4915123456789");
});
test("registration rejects invalid countries, mismatched phones and privilege inputs", () => {
  const valid = { displayName: "Ada", email: "ada@example.com", phoneCountry: "DE", phoneNumber: "+4915123456789" };
  for (const extra of [{ phoneCountry: "XX" }, { phoneCountry: "US" }, { phoneNumber: "123" },
    { phoneNumber: "Call +4915123456789" }, { phoneNumber: "+4915123456789 ext. 1" },
    { roles: ["system_admin"] }, { organizationId: "chosen" }]) {
    assert.equal(registrationSchema.safeParse({ ...valid, ...extra }).success, false);
  }
});
test("approval excludes system administrators and requires unique roles", () => {
  const organizationId = "c2314a55-b213-4dce-8754-f144cd93848a";
  for (const roles of [[], ["system_admin"], ["auditor", "auditor"]]) {
    assert.equal(registrationApprovalSchema.safeParse({ organizationId, roles }).success, false);
  }
  assert.equal(registrationApprovalSchema.safeParse({ organizationId, roles: ["field_agent"] }).success, true);
});
test("activation and list inputs enforce password length and bounded pagination", () => {
  assert.equal(activationSchema.safeParse({ token: "x".repeat(43), password: "short" }).success, false);
  assert.equal(registrationListSchema.safeParse({ page: 0 }).success, false);
  assert.equal(registrationListSchema.safeParse({ pageSize: 101 }).success, false);
  assert.deepEqual(registrationListSchema.parse({}), { search: "", page: 1, pageSize: 25 });
});
