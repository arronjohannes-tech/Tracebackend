import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { parse, requireRoles, sendData, uuidSchema } from "../http.js";
import { activationSchema, createRegistrationService, registrationApprovalSchema, registrationListSchema, registrationSchema } from "../services/registration-service.js";

export async function registerRegistrationRoutes(app: FastifyInstance, pool: Pool, config: AppConfig,
  authenticate: (request: FastifyRequest) => Promise<void>) {
  const service = createRegistrationService(pool, config, app.log);
  app.post("/api/v1/auth/registrations", { bodyLimit: 4096, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => sendData(reply, await service.register(parse(registrationSchema, request.body)), 202));
  app.post("/api/v1/auth/activate", { bodyLimit: 8192, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = parse(activationSchema, request.body);
      return sendData(reply, await service.activate(body.token, body.password, request));
    });
  const admin = async (request: FastifyRequest) => { await authenticate(request); requireRoles(request, ["system_admin"]); };
  app.get("/api/v1/admin/registrations", { preHandler: admin }, async (request, reply) =>
    sendData(reply, await service.list(request.auth!, parse(registrationListSchema, request.query))));
  app.get<{ Params: { id: string } }>("/api/v1/admin/registrations/:id", { preHandler: admin }, async (request, reply) =>
    sendData(reply, await service.get(request.auth!, parse(uuidSchema, request.params.id))));
  app.post<{ Params: { id: string } }>("/api/v1/admin/registrations/:id/approve",
    { preHandler: admin, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) =>
      sendData(reply, await service.approve(request.auth!, request, parse(uuidSchema, request.params.id), parse(registrationApprovalSchema, request.body))));
  app.post<{ Params: { id: string } }>("/api/v1/admin/registrations/:id/resend",
    { preHandler: admin, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) =>
      sendData(reply, await service.resend(request.auth!, request, parse(uuidSchema, request.params.id))));
  app.post<{ Params: { id: string } }>("/api/v1/admin/registrations/:id/deactivate",
    { preHandler: admin }, async (request, reply) =>
      sendData(reply, await service.deactivate(request.auth!, request, parse(uuidSchema, request.params.id))));
}
