import type { Pool } from "pg";
import { z } from "zod";
import { writeAudit, type AuditContext } from "../audit.js";
import { withContext } from "../db.js";
import { AppError, badRequest, conflict, notFound } from "../errors.js";
import { alignTrackPoints, MAX_RING_POSITIONS } from "../domain/plot-geometry.js";
import { parsePolygon } from "../geo.js";
import * as geometry from "../repositories/plot-geometry-repository.js";
import * as plots from "../repositories/plot-repository.js";
import { checkGeofence, lockTenantSync, plotJson } from "../repositories/sync-repository.js";
import type { AuthContext } from "../types.js";

export const geometryUpdateSchema = z.object({
    polygon: z.unknown(),
    baseRevision: z.number().int().min(1),
    note: z.string().trim().max(500).default(""),
});

export function createPlotGeometryService(pool: Pool) {
    return {
        async versions(auth: AuthContext, organizationId: string, plotId: string) {
            return withContext(pool, auth, async (client) => {
                const [plot] = await plots.listPlots(client, organizationId, plotId);
                if (!plot) throw notFound("Plot");
                const stored = await geometry.listVersions(client, organizationId, plotId);
                // A plot that was never edited in Tracehub still has its captured geometry as current version.
                if (stored.some((item) => item.version === plot.revision)) return stored;
                return [{
                    version: plot.revision,
                    source: "mobile" as const,
                    note: "",
                    areaHa: plot.areaHa,
                    polygon: plot.polygon,
                    createdBy: null,
                    createdAt: plot.updatedAt,
                }, ...stored];
            });
        },

        update(
            auth: AuthContext,
            audit: AuditContext,
            organizationId: string,
            plotId: string,
            input: z.infer<typeof geometryUpdateSchema>,
        ) {
            const polygon = parsePolygon(input.polygon);
            if (polygon.coordinates.length !== 1) {
                throw badRequest("INVALID_GEOMETRY", "A plot polygon must not contain holes.");
            }
            if (polygon.coordinates[0]!.length > MAX_RING_POSITIONS) {
                throw badRequest("INVALID_GEOMETRY", "The polygon has too many positions.");
            }
            return withContext(pool, auth, async (client) => {
                await lockTenantSync(client, organizationId);
                const current = await geometry.lockPlot(client, organizationId, plotId);
                if (!current) throw notFound("Plot");
                if (Number(current.revision) !== input.baseRevision) {
                    throw conflict("PLOT_REVISION_CONFLICT",
                        "The plot was changed in the meantime. Reload it before saving the new position.",
                        { currentRevision: Number(current.revision) });
                }
                const checked = await geometry.validateGeometry(client, plotId, organizationId, polygon);
                if (!checked.valid) {
                    throw new AppError(422, "INVALID_GEOMETRY",
                        "The polygon is not valid, for example because its edges cross each other.");
                }
                if (checked.same) throw badRequest("NO_CHANGE", "The polygon was not changed.");

                const oldRevision = Number(current.revision);
                const trackPoints = current.track_points ?? [];
                await geometry.insertVersion(client, organizationId, plotId, oldRevision, {
                    source: "mobile", note: "", userId: null, areaHa: current.area_ha,
                    trackPoints, fromPlot: true,
                });
                const nextTrackPoints = alignTrackPoints(current.polygon.coordinates[0]!, polygon.coordinates[0]!, trackPoints);
                const fence = await checkGeofence(client, organizationId, { entityId: plotId }, polygon);
                const row = await geometry.updatePlotGeometry(client, organizationId, plotId, {
                    polygon,
                    trackPoints: nextTrackPoints,
                    areaHa: checked.areaHa,
                    geofenceStatus: fence.geofenceStatus,
                    localGeofenceResult: fence.localGeofenceResult,
                });
                const version = Number(row!.revision);
                await geometry.insertVersion(client, organizationId, plotId, version, {
                    source: "tracehub", note: input.note, userId: auth.userId, areaHa: checked.areaHa,
                    trackPoints: nextTrackPoints, polygon,
                });
                await geometry.recordSyncChange(client, organizationId, plotId, plotJson(row!));
                await writeAudit(client, audit, auth, "plot.geometry.update", "plot", plotId, {
                    organizationId,
                    fromVersion: oldRevision,
                    toVersion: version,
                    areaHa: checked.areaHa,
                    geofenceStatus: fence.geofenceStatus,
                });
                const [plot] = await plots.listPlots(client, organizationId, plotId);
                return { version, plot: plot! };
            });
        },
    };
}
