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
import { createPlotGeometryService, geometryUpdateSchema } from "../services/plot-geometry-service.js";
import { createGoogleMapsService } from "../services/google-maps-service.js";
import {
    backgroundQuerySchema,
    createSatelliteBackgroundService,
    parseBackgroundBbox,
} from "../services/satellite-background-service.js";

const idParams = z.object({ id: uuidSchema });
const itemParams = z.object({ id: uuidSchema, plotId: uuidSchema });
const queryWithoutOrganization = (query: unknown) => {
    const { organizationId: _ignored, ...rest } = (query ?? {}) as Record<string, unknown>;
    return rest;
};

export async function registerPlotRoutes(
    app: FastifyInstance,
    pool: Pool,
    config: AppConfig,
    authenticate: (request: FastifyRequest) => Promise<void>,
): Promise<void> {
    const service = createPlotCorrectionService(pool);
    const geometryService = createPlotGeometryService(pool);
    const backgroundService = createSatelliteBackgroundService(pool, config);
    const googleMaps = createGoogleMapsService(pool, config);
    const secured = { preHandler: authenticate };
    const writers = ["system_admin", "org_admin", "reviewer"] as const;

    app.get("/api/v1/plots/map-comparison-config", secured, async (request, reply) => {
        reply.header("Cache-Control", "private, no-store");
        return sendData(reply, await backgroundService.configuration(authOf(request), organizationFromRequest(request)));
    });

    app.get("/api/v1/plots/google-maps-config", secured, async (request, reply) => {
        reply.header("Cache-Control", "private, no-store");
        return sendData(reply, await googleMaps.browserConfig(authOf(request), organizationFromRequest(request)));
    });

    app.get("/api/v1/plots", secured, async (request, reply) =>
        sendData(reply, await service.listPlots(authOf(request), organizationFromRequest(request))));
    app.get("/api/v1/plots/satellite-background", {
        preHandler: authenticate,
        config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    }, async (request, reply) => {
        const { bbox, size, comparison } = parse(backgroundQuerySchema, queryWithoutOrganization(request.query));
        const image = await backgroundService.get(
            authOf(request), organizationFromRequest(request), parseBackgroundBbox(bbox), size, comparison);
        reply.header("Cache-Control", comparison ? "private, no-store" : "private, max-age=3600");
        return sendData(reply, image);
    });

    app.get("/api/v1/plots/:id/versions", secured, async (request, reply) => {
        const { id } = parse(idParams, request.params);
        return sendData(reply, await geometryService.versions(authOf(request), organizationFromRequest(request), id));
    });

    app.put("/api/v1/plots/:id/geometry", secured, async (request, reply) => {
        const auth = requireRoles(request, writers);
        const { id } = parse(idParams, request.params);
        const body = parse(geometryUpdateSchema, request.body);
        return sendData(reply, await geometryService.update(auth, request, organizationFromRequest(request), id, body));
    });

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
