import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { authOf, organizationFor, sendData } from "../http.js";
import { createDashboardService } from "../services/dashboard-service.js";

export async function registerDashboardRoutes(
    app: FastifyInstance,
    pool: Pool,
    _config: AppConfig,
    authenticate: (request: FastifyRequest) => Promise<void>,
): Promise<void> {
    const service = createDashboardService(pool);
    app.get("/api/v1/dashboard", { preHandler: authenticate }, async (request, reply) => {
        const requestedOrganization = request.headers["x-organization-id"];
        const organizationId = organizationFor(
            request,
            typeof requestedOrganization === "string" ? requestedOrganization : undefined,
        );
        return sendData(reply, await service.get(authOf(request), organizationId));
    });
}
