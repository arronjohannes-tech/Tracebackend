import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { authOf, organizationFromRequest, parse, requireRoles, sendData, uuidSchema } from "../http.js";
import {
    correctionCloseSchema,
    correctionCreateSchema,
    correctionListQuery,
    createPlotCorrectionService,
} from "../services/plot-correction-service.js";

const idParams = z.object({ id: uuidSchema });
const itemParams = z.object({ id: uuidSchema, plotId: uuidSchema });
const queryWithoutOrganization = (query: unknown) => {
    const { organizationId: _ignored, ...rest } = (query ?? {}) as Record<string, unknown>;
    return rest;
};

export async function registerPlotRoutes(
    app: FastifyInstance,
    pool: Pool,
    _config: AppConfig,
    authenticate: (request: FastifyRequest) => Promise<void>,
): Promise<void> {
    const service = createPlotCorrectionService(pool);
    const secured = { preHandler: authenticate };
    const writers = ["system_admin", "org_admin", "reviewer"] as const;

    app.get("/api/v1/plots", secured, async (request, reply) =>
        sendData(reply, await service.listPlots(authOf(request), organizationFromRequest(request))));

    app.get("/api/v1/plot-corrections", secured, async (request, reply) => {
        const filter = parse(correctionListQuery, queryWithoutOrganization(request.query));
        return sendData(reply, await service.list(authOf(request), organizationFromRequest(request), filter));
    });

    app.get("/api/v1/plot-corrections/:id", secured, async (request, reply) => {
        const { id } = parse(idParams, request.params);
        return sendData(reply, await service.get(authOf(request), organizationFromRequest(request), id));
    });

    app.post("/api/v1/plot-corrections", secured, async (request, reply) => {
        const auth = requireRoles(request, writers);
        const body = parse(correctionCreateSchema, request.body);
        return sendData(reply, await service.create(auth, request, organizationFromRequest(request), body), 201);
    });

    app.patch("/api/v1/plot-corrections/:id", secured, async (request, reply) => {
        const auth = requireRoles(request, writers);
        const { id } = parse(idParams, request.params);
        const body = parse(correctionCloseSchema, request.body);
        return sendData(reply, await service.close(auth, request, organizationFromRequest(request), id, body));
    });

    app.patch("/api/v1/plot-corrections/:id/plots/:plotId", secured, async (request, reply) => {
        const auth = requireRoles(request, writers);
        const { id, plotId } = parse(itemParams, request.params);
        const body = parse(correctionCloseSchema, request.body);
        return sendData(reply,
            await service.closePlot(auth, request, organizationFromRequest(request), id, plotId, body));
    });
}
