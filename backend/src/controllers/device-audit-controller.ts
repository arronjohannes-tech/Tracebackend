import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { parse, requireRoles, sendData } from "../http.js";
import { constantTimeEqual } from "../security.js";
import { deviceAuditQuerySchema, getDeviceAudit } from "../services/device-audit-service.js";
import { cleanupDeviceAudit } from "../services/device-session-service.js";

export async function registerDeviceAuditRoutes(
  app: FastifyInstance, pool: Pool, config: AppConfig, authenticate: (request: FastifyRequest) => Promise<void>,
) {
  app.get("/api/v1/admin/users/device-audit", { preHandler: authenticate }, async (request, reply) => {
    const auth = requireRoles(request, ["system_admin", "org_admin"]);
    const query = parse(deviceAuditQuerySchema, request.query);
    const data = await getDeviceAudit(pool, auth, query);
    reply.header("Cache-Control", "no-store");
    if (typeof data === "string") {
      return reply.header("Content-Disposition", 'attachment; filename="device-audit.csv"')
        .type("text/csv; charset=utf-8").send(data);
    }
    return sendData(reply, data);
  });
  app.get("/api/cron/device-audit-retention", async (request, reply) => {
    if (!config.CRON_SECRET) throw new AppError(503, "NOT_CONFIGURED", "Audit retention cron is not configured.");
    if (!constantTimeEqual(request.headers.authorization ?? "", `Bearer ${config.CRON_SECRET}`)) {
      throw new AppError(401, "UNAUTHORIZED", "Cron authorization is required.");
    }
    await cleanupDeviceAudit(pool);
    return sendData(reply, { purged: true });
  });
}
