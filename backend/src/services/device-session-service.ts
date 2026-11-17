import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { queryOne, withContext } from "../db.js";
import { AppError } from "../errors.js";
import type { AuthContext } from "../types.js";

type DeviceRequest = { headers: Record<string, unknown> };
export type DeviceSessionRow = {
  id: string;
  user_id: string;
  created_at: Date;
  last_active_at: Date;
  expires_at: Date;
  idle_expires_at: Date;
  ended_at: Date | null;
};

const deviceSchema = z.object({
  id: z.string().uuid(),
  platform: z.enum(["ios", "android", "web", "unknown"]),
  version: z.string().max(80).regex(/^[\w.+-]*$/),
});

export function sessionInfo(row: DeviceSessionRow) {
  return {
    id: row.id,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    idleExpiresAt: row.idle_expires_at.toISOString(),
  };
}

export function sessionExpired(row: DeviceSessionRow, now = Date.now()): boolean {
  return Boolean(row.ended_at) || row.expires_at.getTime() <= now || row.idle_expires_at.getTime() <= now;
}

export async function pruneDeviceAudit(client: PoolClient): Promise<void> {
  await client.query(`WITH expired AS (
    UPDATE device_sessions SET ended_at=LEAST(expires_at,idle_expires_at),end_reason='expired'
    WHERE ended_at IS NULL AND LEAST(expires_at,idle_expires_at)<=now() RETURNING id,ended_at
  ) INSERT INTO device_events(session_id,action,status_code,created_at)
    SELECT id,'session.expired',401,ended_at FROM expired`);
  await client.query("DELETE FROM device_events WHERE created_at < now() - interval '30 days'");
  await client.query("DELETE FROM device_sessions WHERE created_at < now() - interval '30 days'");
}

export async function cleanupDeviceAudit(pool: Pool): Promise<void> {
  await withContext(pool, "system", pruneDeviceAudit);
}

export async function createDeviceSession(
  client: PoolClient, userId: string, organizationId: string | null, request: DeviceRequest,
): Promise<DeviceSessionRow> {
  const parsed = deviceSchema.safeParse({
    id: request.headers["x-device-id"] ?? randomUUID(),
    platform: request.headers["x-device-platform"] ?? "unknown",
    version: request.headers["x-app-version"] ?? "",
  });
  if (!parsed.success) throw new AppError(400, "INVALID_DEVICE", "Invalid device metadata.");
  await pruneDeviceAudit(client);
  const row = await queryOne<DeviceSessionRow>(client, `INSERT INTO device_sessions
    (id,user_id,organization_id,device_id,platform,app_version)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
  [randomUUID(), userId, organizationId, parsed.data.id, parsed.data.platform, parsed.data.version]);
  if (!row) throw new Error("Device session was not created.");
  await recordDeviceEvent(client, row.id, "auth.login", 200);
  return row;
}

export async function recordDeviceEvent(
  client: PoolClient, sessionId: string, action: string, statusCode: number,
  method: string | null = null, path: string | null = null,
): Promise<void> {
  await client.query(`INSERT INTO device_events(session_id,action,status_code,method,path)
    VALUES ($1,$2,$3,$4,$5)`, [sessionId, action, statusCode, method, path]);
}

export async function endDeviceSession(client: PoolClient, id: string, reason: string): Promise<void> {
  const ended = await client.query(`UPDATE device_sessions SET ended_at=now(),end_reason=$2
    WHERE id=$1 AND ended_at IS NULL RETURNING id`, [id, reason]);
  if (ended.rowCount) await recordDeviceEvent(client, id, `session.${reason}`, reason === "expired" ? 401 : 200);
}

export async function checkDeviceSession(
  pool: Pool, sessionId: string, userId: string, activity = false,
) {
  const row = await withContext(pool, "system", async (client) => {
    const current = await queryOne<DeviceSessionRow>(client,
      "SELECT * FROM device_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE", [sessionId, userId]);
    if (!current) return null;
    if (sessionExpired(current)) {
      await endDeviceSession(client, current.id, "expired");
      return null;
    }
    if (activity) {
      const updated = await queryOne<DeviceSessionRow>(client, `UPDATE device_sessions
        SET last_active_at=now(),idle_expires_at=LEAST(expires_at,now()+interval '30 minutes')
        WHERE id=$1 RETURNING *`, [current.id]);
      return updated;
    }
    return current;
  });
  if (!row) throw new AppError(401, "SESSION_EXPIRED", "Your session has ended. Sign in again.");
  return sessionInfo(row);
}

export async function sessionActivity(pool: Pool, auth: AuthContext) {
  if (!auth.sessionId) throw new AppError(401, "SESSION_REQUIRED", "Sign in again to start a device session.");
  return { session: await checkDeviceSession(pool, auth.sessionId, auth.userId, true) };
}
