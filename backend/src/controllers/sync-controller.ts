import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { authOf, parse, sendData } from "../http.js";
import { pushSchema } from "../domain/sync-contract.js";
import { createSyncService } from "../services/sync-service.js";
const pullSchema = z.object({
 cursor: z.string().regex(/^\d{1,19}$/).default("0").refine(value => BigInt(value) <= 9223372036854775807n),
 limit: z.coerce.number().int().min(1).max(1000).default(500)
});
export async function registerSyncRoutes(app: FastifyInstance, pool: Pool, authenticate: (request: FastifyRequest)=>Promise<void>) {
 const service = createSyncService(pool), protectedRoute = {preHandler: authenticate};
 app.get("/api/v1/geofences", protectedRoute, async (request,reply)=>sendData(reply, await service.geofences(authOf(request))));
 app.post("/api/v1/sync/push", protectedRoute, async (request,reply)=>sendData(reply, await service.push(authOf(request), request, parse(pushSchema, request.body))));
 app.get("/api/v1/sync/pull", protectedRoute, async (request,reply)=>{
  const query = parse(pullSchema, request.query);
  return sendData(reply, await service.pull(authOf(request), query.cursor, query.limit));
 });
}
