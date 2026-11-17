export const DEVICE_SESSION_IDLE_MS = 30 * 60 * 1000;
export const DEVICE_SESSION_ABSOLUTE_MS = 24 * 60 * 60 * 1000;
export const DEVICE_ACTIVITY_THROTTLE_MS = 60 * 1000;
const AUTH_SESSION_KEYS = [
  "accessToken",
  "refreshToken",
  "user",
  "selectedOrganizationId",
  "deviceSession",
  "deviceSessionLastActivityAt",
];

export function isValidDeviceSession(session) {
  return Boolean(
    session &&
    typeof session.id === "string" && session.id.length > 0 &&
    Number.isFinite(Date.parse(session.createdAt)) &&
    Number.isFinite(Date.parse(session.expiresAt)) &&
    Number.isFinite(Date.parse(session.idleExpiresAt)),
  );
}

export function deviceSessionExpired(session, lastActivityAt, now = Date.now()) {
  if (!isValidDeviceSession(session)) return true;
  const idleDeadline = Math.min(
    Date.parse(session.idleExpiresAt),
    lastActivityAt ? lastActivityAt + DEVICE_SESSION_IDLE_MS : Infinity,
  );
  const absoluteDeadline = Math.min(
    Date.parse(session.expiresAt),
    Date.parse(session.createdAt) + DEVICE_SESSION_ABSOLUTE_MS,
  );
  return now >= Math.min(absoluteDeadline, idleDeadline);
}

export function getOrCreateDeviceId(storage, cryptoApi = globalThis.crypto) {
  const key = "sctracker.deviceId";
  const stored = storage.getItem(key);
  if (stored) return stored;
  let id;
  if (cryptoApi?.randomUUID) {
    id = cryptoApi.randomUUID();
  } else {
    const bytes = new Uint8Array(16);
    if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
    else bytes.forEach((_, index) => { bytes[index] = Math.random() * 256; });
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  storage.setItem(key, id);
  return id;
}

export function clearDeviceAuth(storage) {
  for (const key of AUTH_SESSION_KEYS) storage.removeItem(key);
}
