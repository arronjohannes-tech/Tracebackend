import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { processConfigUpdateSchema } from "../copernicus/process-settings.js";
import { organizationFor, parse, requireRoles, sendData, uuidSchema } from "../http.js";
import { createCopernicusService, type CopernicusService } from "../services/copernicus-service.js";

const params = z.object({ organizationId: uuidSchema });

export async function registerCopernicusRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: AppConfig,
  authenticate: (request: FastifyRequest) => Promise<void>,
  service: CopernicusService = createCopernicusService(pool, config),
): Promise<void> {
  const secured = { preHandler: authenticate };
  const base = "/api/v1/admin/organizations/:organizationId/copernicus-process";

  const authorize = (request: FastifyRequest) => {
    const auth = requireRoles(request, ["system_admin", "org_admin"]);
    const { organizationId } = parse(params, request.params);
    return { auth, organizationId: organizationFor(request, organizationId) };
  };

  app.get(base, secured, async (request, reply) => {
    const { auth, organizationId } = authorize(request);
    return sendData(reply, await service.get(auth, organizationId));
  });

  app.put(base, secured, async (request, reply) => {
    const { auth, organizationId } = authorize(request);
    const body = parse(processConfigUpdateSchema, request.body);
    return sendData(reply, await service.update(auth, request, organizationId, body));
  });

  app.post(`${base}/test`, {
    ...secured,
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const { auth, organizationId } = authorize(request);
    return sendData(reply, await service.test(auth, request, organizationId));
  });
}
