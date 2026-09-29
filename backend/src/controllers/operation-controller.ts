import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { authOf, parse, sendData, uuidSchema } from "../http.js";
import { createOperationService, createSchema, type OperationKind, type StoredDdsActionResponse } from "../services/operation-service.js";
function requireIdempotencyKey(request: FastifyRequest): string {
 const key = request.headers["idempotency-key"];
 if (typeof key !== "string" || key.length < 8 || key.length > 200) throw new AppError(400,"IDEMPOTENCY_KEY_REQUIRED","A valid Idempotency-Key header is required.");
 return key;
}
function sendStoredAction(reply: FastifyReply, response: StoredDdsActionResponse) {
 return response.ok ? sendData(reply, response.data, response.statusCode) : reply.code(response.statusCode).send({error: response.error});
}
export async function registerOperationRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: AppConfig,
  authenticate: (request: FastifyRequest) => Promise<void>,
): Promise<void> {
  const protectedRoute = { preHandler: authenticate };


  const service = createOperationService(pool, config);
  app.post("/api/v1/satellite/analyses", protectedRoute, async (request,reply)=>{
   const result = await service.create(authOf(request), request, "satellite", parse(createSchema, request.body), requireIdempotencyKey(request));
   return sendData(reply, result.data, result.statusCode);
  });
  app.post("/api/v1/evidence-packs", protectedRoute, async (request,reply)=>{
   const result = await service.create(authOf(request), request, "evidence_pack", parse(createSchema, request.body), requireIdempotencyKey(request));
   return sendData(reply, result.data, result.statusCode);
  });
  app.post("/api/v1/dds/drafts", protectedRoute, async (request,reply)=>{
   const result = await service.create(authOf(request), request, "dds", parse(createSchema, request.body), requireIdempotencyKey(request));
   return sendData(reply, result.data, result.statusCode);
  });
  app.post("/api/v1/dds/drafts/:id/validate", protectedRoute, async (request,reply)=>{
   const { id } = parse(z.object({id: uuidSchema}), request.params);
   return sendStoredAction(reply, await service.validate(authOf(request), request, id, requireIdempotencyKey(request)));
  });
  app.post("/api/v1/dds/drafts/:id/submit", protectedRoute, async (request,reply)=>{
   const { id } = parse(z.object({id: uuidSchema}), request.params);
   return sendStoredAction(reply, await service.submit(authOf(request), request, id, requireIdempotencyKey(request)));
  });
  app.get("/api/v1/operations/:id/download", protectedRoute, async (request,reply)=>{
   const {id}=parse(z.object({id:uuidSchema}),request.params);
   const bytes=await service.download(authOf(request),id);
   return reply.header("Content-Type","application/json").header("Content-Disposition",`attachment; filename="evidence-pack-${id}.json"`).send(bytes);
  });
  const getRoutes: Array<{ path: string; kind: OperationKind }> = [
    { path: "/api/v1/satellite/analyses/:id", kind: "satellite" },
    { path: "/api/v1/evidence-packs/:id", kind: "evidence_pack" },
    { path: "/api/v1/dds/drafts/:id", kind: "dds" },
  ];
  for (const route of getRoutes) {
    app.get(route.path, protectedRoute, async (request, reply) => {
      const auth = authOf(request);
      if (!auth.organizationId) throw new AppError(403, "ORGANIZATION_REQUIRED", "Organization user required.");
      const { id } = parse(z.object({ id: uuidSchema }), request.params);
      return sendData(reply, await service.get(auth, route.kind, id));
    });
  }

}
