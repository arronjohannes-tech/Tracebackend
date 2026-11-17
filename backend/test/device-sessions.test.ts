import assert from "node:assert/strict";
import test from "node:test";
import { sessionExpired } from "../src/services/device-session-service.js";
import { auditCsv, deviceAuditQuerySchema } from "../src/services/device-audit-service.js";

test("device expiry respects exact idle and absolute boundaries and revocation", () => {
  const row = {
    id: "s", user_id: "u", created_at: new Date(0), last_active_at: new Date(0),
    expires_at: new Date(86_400_000), idle_expires_at: new Date(1_800_000), ended_at: null,
  };
  assert.equal(sessionExpired(row, 1_799_999), false);
  assert.equal(sessionExpired(row, 1_800_000), true);
  assert.equal(sessionExpired({ ...row, idle_expires_at: new Date(90_000_000) }, 86_400_000), true);
  assert.equal(sessionExpired({ ...row, ended_at: new Date(1) }, 2), true);
});

test("device audit filters reject inverted date ranges and unbounded pages", () => {
  assert.equal(deviceAuditQuerySchema.safeParse({ from: "2026-11-18T00:00:00Z", to: "2026-11-17T00:00:00Z" }).success, false);
  assert.equal(deviceAuditQuerySchema.safeParse({ limit: 101 }).success, false);
  assert.equal(deviceAuditQuerySchema.safeParse({ deviceId: "not-an-id" }).success, false);
  assert.equal(deviceAuditQuerySchema.safeParse({ platform: "web", outcome: "error", limit: "25" }).success, true);
});

test("CSV audit exports escape quotes and neutralize spreadsheet formulas", () => {
  const output = auditCsv([{
    id: "e", sessionId: "s", deviceId: "d", userId: "u", userName: '=HYPERLINK("unsafe")',
    email: "person@example.com", organizationId: null, platform: "web", appVersion: "1.0",
    action: "change.error", method: "PUT", path: "/api/v1/users/:id",
    statusCode: 400, createdAt: new Date("2026-11-17T00:00:00Z"),
  }]);
  assert.ok(output.includes(`"'=HYPERLINK(""unsafe"")"`));
  assert.ok(output.includes('"2026-11-17T00:00:00.000Z"'));
});
