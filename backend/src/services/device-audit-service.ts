import type { Pool } from "pg";
import { z } from "zod";
import { queryMany, queryOne, withContext } from "../db.js";
import { AppError, forbidden } from "../errors.js";
import type { AuthContext } from "../types.js";
import { pruneDeviceAudit } from "./device-session-service.js";

export const deviceAuditQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  action: z.string().trim().max(120).optional(),
  platform: z.enum(["ios", "android", "web", "unknown"]).optional(),
  outcome: z.enum(["success", "error"]).optional(),
  search: z.string().trim().max(120).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  format: z.enum(["json", "csv"]).default("json"),
}).refine((value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to),
  { message: "The start date must not be after the end date." });

type AuditQuery = z.infer<typeof deviceAuditQuerySchema>;
type Summary = { events: number; errors: number; devices: number; sessions: number; activeSessions: number };
type EventRow = {
  id: string; sessionId: string; deviceId: string; userId: string; userName: string;
  email: string; organizationId: string | null; platform: string; appVersion: string;
  action: string; method: string | null; path: string | null; statusCode: number; createdAt: Date;
};

export function auditCsv(rows: readonly EventRow[]): string {
  const keys: (keyof EventRow)[] = [
    "id", "createdAt", "userId", "userName", "email", "organizationId", "deviceId",
    "platform", "appVersion", "sessionId", "action", "method", "path", "statusCode",
  ];
  const cell = (value: unknown) => {
    let text = value instanceof Date ? value.toISOString() : String(value ?? "");
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [keys.map(cell).join(","), ...rows.map((row) => keys.map((key) => cell(row[key])).join(","))].join("\r\n");
}

export async function getDeviceAudit(pool: Pool, auth: AuthContext, query: AuditQuery) {
  if (auth.role !== "system_admin" && auth.role !== "org_admin") throw forbidden();
  if (auth.role !== "system_admin" && query.organizationId && query.organizationId !== auth.organizationId) throw forbidden();
  await withContext(pool, "system", pruneDeviceAudit);
  return withContext(pool, auth, async (client) => {
    const values: unknown[] = [];
    const conditions = ["e.created_at >= now() - interval '30 days'"];
    const filter = (column: string, value: unknown) => {
      if (value !== undefined) { values.push(value); conditions.push(`${column} = $${values.length}`); }
    };
    filter("s.organization_id", auth.role === "system_admin" ? query.organizationId : auth.organizationId);
    filter("s.user_id", query.userId);
    filter("s.device_id", query.deviceId);
    filter("s.id", query.sessionId);
    filter("e.action", query.action || undefined);
    filter("s.platform", query.platform);
    if (query.outcome) conditions.push(query.outcome === "error" ? "e.status_code >= 400" : "e.status_code < 400");
    for (const [value, operator] of [[query.from, ">="], [query.to, "<="]] as const) {
      if (value) { values.push(value); conditions.push(`e.created_at ${operator} $${values.length}::timestamptz`); }
    }
    if (query.search) {
      values.push(`%${query.search.replace(/[\\%_]/g, "\\$&")}%`);
      conditions.push(`concat_ws(' ',u.display_name,u.email,s.device_id::text,s.platform,e.action,e.path) ILIKE $${values.length}`);
    }
    const source = `FROM device_events e JOIN device_sessions s ON s.id=e.session_id
      JOIN users u ON u.id=s.user_id WHERE ${conditions.join(" AND ")}`;
    const active = "s.ended_at IS NULL AND s.expires_at>now() AND s.idle_expires_at>now()";
    const summary = await queryOne<Summary>(client, `SELECT count(*)::int AS events,
      count(*) FILTER(WHERE e.status_code>=400)::int AS errors,
      count(DISTINCT s.device_id)::int AS devices,count(DISTINCT s.id)::int AS sessions,
      count(DISTINCT s.id) FILTER(WHERE ${active})::int AS "activeSessions" ${source}`, values);
    if (!summary) throw new Error("Device audit summary was not returned.");
    if (query.format === "csv" && summary.events > 10000) {
      throw new AppError(400, "EXPORT_TOO_LARGE", "Limit the filters to at most 10,000 events before exporting.");
    }
    const eventColumns = `e.id,s.id AS "sessionId",s.device_id AS "deviceId",s.user_id AS "userId",
      u.display_name AS "userName",u.email,s.organization_id AS "organizationId",s.platform,
      s.app_version AS "appVersion",e.action,e.method,e.path,e.status_code AS "statusCode",e.created_at AS "createdAt"`;
    const rows = await queryMany<EventRow>(client, `SELECT ${eventColumns} ${source}
      ORDER BY e.created_at DESC,e.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, query.format === "csv" ? 10000 : query.limit, query.format === "csv" ? 0 : (query.page - 1) * query.limit]);
    if (query.format === "csv") return auditCsv(rows);
    const sessions = await queryMany(client, `SELECT s.id,s.device_id AS "deviceId",s.user_id AS "userId",
      u.display_name AS "userName",u.email,s.organization_id AS "organizationId",s.platform,s.app_version AS "appVersion",
      s.created_at AS "createdAt",s.last_active_at AS "lastActiveAt",s.expires_at AS "expiresAt",
      s.idle_expires_at AS "idleExpiresAt",s.ended_at AS "endedAt",s.end_reason AS "endReason",
      CASE WHEN s.ended_at IS NOT NULL AND s.end_reason<>'expired' THEN 'revoked'
        WHEN ${active} THEN 'active' ELSE 'expired' END AS status
      FROM device_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.id IN (SELECT s.id ${source})
      ORDER BY s.created_at DESC LIMIT 100`, values);
    const timeline = await queryMany(client, `SELECT to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,
      count(*)::int AS events,count(*) FILTER(WHERE e.status_code>=400)::int AS errors ${source}
      GROUP BY day ORDER BY day`, values);
    return {
      events: rows, sessions, total: summary.events, page: query.page, limit: query.limit,
      summary: { ...summary, errorRate: summary.events ? Math.round(summary.errors / summary.events * 10000) / 100 : 0 },
      timeline,
    };
  });
}
