import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { authOf, organizationFromRequest, sendData } from "../http.js";
import { createDashboardService } from "../services/dashboard-service.js";

export async function registerDashboardRoutes(
    app: FastifyInstance,
    pool: Pool,
    _config: AppConfig,
    authenticate: (request: FastifyRequest) => Promise<void>,
): Promise<void> {
    const service = createDashboardService(pool);
    app.get("/api/v1/dashboard", { preHandler: authenticate }, async (request, reply) =>
        sendData(reply, await service.get(authOf(request), organizationFromRequest(request))));
    app.get("/api/v1/organization", { preHandler: authenticate }, async (request, reply) =>
        sendData(reply, await service.organization(authOf(request), organizationFromRequest(request))));
}
