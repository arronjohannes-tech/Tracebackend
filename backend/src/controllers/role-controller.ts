import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { organizationFromRequest, parse, requireRoles, sendData } from "../http.js";
import { createRoleManagementService, matrixSchema } from "../services/role-management-service.js";

export async function registerRoleRoutes(app: FastifyInstance, pool: Pool,
  authenticate: (request: FastifyRequest) => Promise<void>) {
  const service = createRoleManagementService(pool);
  app.get("/api/v1/admin/roles", { preHandler: authenticate }, async (request, reply) => {
    const auth = requireRoles(request, ["system_admin", "org_admin"]);
    const organizationId = organizationFromRequest(request);
    return sendData(reply, await service.get(auth, organizationId));
  });
  app.put("/api/v1/admin/roles", { preHandler: authenticate }, async (request, reply) => {
    const auth = requireRoles(request, ["system_admin", "org_admin"]);
    const organizationId = organizationFromRequest(request);
    const body = parse(matrixSchema, request.body);
    return sendData(reply, await service.save(auth, request, organizationId, body));
  });
}
