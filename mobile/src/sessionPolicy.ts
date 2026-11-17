export type DeviceSession = {
  id: string;
  createdAt: string;
  expiresAt: string;
  idleExpiresAt: string;
};

export function deviceSessionExpired(session: DeviceSession, now = Date.now()): boolean {
  const absolute = Date.parse(session.expiresAt);
  const idle = Date.parse(session.idleExpiresAt);
  return !Number.isFinite(absolute) || !Number.isFinite(idle) || now >= Math.min(absolute, idle);
}
