import assert from "node:assert/strict";
import test from "node:test";
import { deviceSessionExpired } from "./sessionPolicy";

test("a session expires at the idle deadline or the absolute deadline, even after activity", () => {
  const createdAt = "2026-11-17T00:00:00.000Z";
  const session = { id: "session", createdAt, expiresAt: "2026-11-18T00:00:00.000Z", idleExpiresAt: "2026-11-17T00:30:00.000Z" };
  assert.equal(deviceSessionExpired(session, Date.parse(session.idleExpiresAt) - 1), false);
  assert.equal(deviceSessionExpired(session, Date.parse(session.idleExpiresAt)), true);
  assert.equal(deviceSessionExpired({ ...session, idleExpiresAt: "2026-11-18T00:10:00.000Z" }, Date.parse(session.expiresAt)), true);
  assert.equal(deviceSessionExpired({ ...session, idleExpiresAt: "invalid" }), true);
});
