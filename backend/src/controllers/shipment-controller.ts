import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { authOf, organizationFromRequest, parse, requireRoles, sendData, uuidSchema } from "../http.js";
import {
    createShipmentService,
    shipmentCreateSchema,
    shipmentPatchSchema,
} from "../services/shipment-service.js";

const idParams = z.object({ id: uuidSchema });

export async function registerShipmentRoutes(
    app: FastifyInstance,
    pool: Pool,
    _config: AppConfig,
    authenticate: (request: FastifyRequest) => Promise<void>,
): Promise<void> {
    const service = createShipmentService(pool);
    const secured = { preHandler: authenticate };
    const writers = ["system_admin", "org_admin", "reviewer"] as const;
    const removers = ["system_admin", "org_admin"] as const;

    app.get("/api/v1/shipments", secured, async (request, reply) =>
        sendData(reply, await service.list(authOf(request), organizationFromRequest(request))));

    app.get("/api/v1/shipments/:id", secured, async (request, reply) => {
        const { id } = parse(idParams, request.params);
        return sendData(reply, await service.get(authOf(request), organizationFromRequest(request), id));
    });

    app.post("/api/v1/shipments", secured, async (request, reply) => {
        const auth = requireRoles(request, writers);
        const body = parse(shipmentCreateSchema, request.body);
        return sendData(reply, await service.create(auth, request, organizationFromRequest(request), body), 201);
    });

    app.patch("/api/v1/shipments/:id", secured, async (request, reply) => {
        const auth = requireRoles(request, writers);
        const { id } = parse(idParams, request.params);
        const body = parse(shipmentPatchSchema, request.body);
        return sendData(reply, await service.update(auth, request, organizationFromRequest(request), id, body));
    });

    app.delete("/api/v1/shipments/:id", secured, async (request, reply) => {
        const auth = requireRoles(request, removers);
        const { id } = parse(idParams, request.params);
        return sendData(reply, await service.remove(auth, request, organizationFromRequest(request), id));
    });
}
