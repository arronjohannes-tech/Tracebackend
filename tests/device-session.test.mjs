import test from "node:test";
import assert from "node:assert/strict";
import {
  DEVICE_SESSION_ABSOLUTE_MS,
  DEVICE_SESSION_IDLE_MS,
  clearDeviceAuth,
  deviceSessionExpired,
  getOrCreateDeviceId,
  isValidDeviceSession,
} from "../src/device-session.mjs";

const createdAt = "2026-01-01T00:00:00.000Z";
const session = {
  id: "session-id",
  createdAt,
  expiresAt: new Date(Date.parse(createdAt) + DEVICE_SESSION_ABSOLUTE_MS).toISOString(),
  idleExpiresAt: new Date(Date.parse(createdAt) + DEVICE_SESSION_IDLE_MS).toISOString(),
};

test("validates the session deadlines returned by auth", () => {
  assert.equal(isValidDeviceSession(session), true);
  assert.equal(isValidDeviceSession({ id: "session-id" }), false);
});

test("expires at the earlier of the idle and absolute deadlines", () => {
  const start = Date.parse(createdAt);
  assert.equal(deviceSessionExpired(session, start, start + DEVICE_SESSION_IDLE_MS - 1), false);
  assert.equal(deviceSessionExpired(session, start, start + DEVICE_SESSION_IDLE_MS), true);
  assert.equal(deviceSessionExpired(session, start, start + DEVICE_SESSION_ABSOLUTE_MS), true);
});

test("device id persists and is created only once", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const cryptoApi = { randomUUID: () => "persistent-device-id" };
  assert.equal(getOrCreateDeviceId(storage, cryptoApi), "persistent-device-id");
  assert.equal(getOrCreateDeviceId(storage, cryptoApi), "persistent-device-id");
});

test("clears authentication state without deleting other session-local drafts", () => {
  const values = new Map([
    ["accessToken", "secret"],
    ["deviceSession", JSON.stringify(session)],
    ["userDraft", "keep"],
  ]);
  clearDeviceAuth({ removeItem: (key) => values.delete(key) });
  assert.equal(values.has("accessToken"), false);
  assert.equal(values.get("userDraft"), "keep");
});
