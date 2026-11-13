import type { PoolClient } from "pg";
import { queryMany, queryOne } from "../db.js";
import type { GeoJsonPolygon } from "../types.js";

export type StoredTrackPoint = {
    position: [number, number];
    accuracyM: number | null;
    capturedAt: string;
};

export type LockedPlot = {
    id: string;
    revision: number;
    area_ha: string;
    polygon: GeoJsonPolygon;
    track_points: StoredTrackPoint[];
};

type VersionRow = {
    version: number;
    source: "mobile" | "tracehub";
    note: string;
    area_ha: string;
    polygon: GeoJsonPolygon;
    created_by_name: string | null;
    created_at: Date;
};

export function lockPlot(client: PoolClient, organizationId: string, plotId: string) {
    return queryOne<LockedPlot>(client,
        `SELECT id, revision, area_ha, ST_AsGeoJSON(polygon)::jsonb AS polygon, track_points
           FROM plots WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [organizationId, plotId]);
}

export async function validateGeometry(client: PoolClient, plotId: string, organizationId: string, polygon: GeoJsonPolygon) {
    const result = await queryOne<{ valid: boolean; same: boolean; area_ha: string }>(client,
        `WITH candidate AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($3), 4326) AS geom)
         SELECT ST_IsValid(c.geom) AS valid,
                ST_OrderingEquals(c.geom, p.polygon) AS same,
                GREATEST(0.0001, round((ST_Area(c.geom::geography) / 10000)::numeric, 4)) AS area_ha
           FROM candidate c, plots p
          WHERE p.organization_id = $1 AND p.id = $2`,
        [organizationId, plotId, JSON.stringify(polygon)]);
    return { valid: Boolean(result?.valid), same: Boolean(result?.same), areaHa: Number(result?.area_ha ?? 0) };
}

export async function insertVersion(
    client: PoolClient,
    organizationId: string,
    plotId: string,
    version: number,
    values: {
        source: "mobile" | "tracehub";
        note: string;
        userId: string | null;
        areaHa: number | string;
        trackPoints: unknown;
    } & ({ polygon: GeoJsonPolygon } | { fromPlot: true }),
) {
    const common = [organizationId, plotId, version, values.source, values.note, values.userId,
        values.areaHa, JSON.stringify(values.trackPoints)];
    if ("fromPlot" in values) {
        await client.query(
            `INSERT INTO plot_geometry_versions
               (organization_id, plot_id, version, polygon, source, note, created_by, area_ha, track_points, created_at)
             SELECT organization_id, id, $3, polygon, $4, $5, $6, $7, $8::jsonb, source_updated_at
               FROM plots WHERE organization_id = $1 AND id = $2
             ON CONFLICT (organization_id, plot_id, version) DO NOTHING`,
            common);
        return;
    }
    await client.query(
        `INSERT INTO plot_geometry_versions
           (organization_id, plot_id, version, polygon, source, note, created_by, area_ha, track_points)
         VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($9), 4326), $4, $5, $6, $7, $8::jsonb)`,
        [...common, JSON.stringify(values.polygon)]);
}

export function updatePlotGeometry(
    client: PoolClient,
    organizationId: string,
    plotId: string,
    values: {
        polygon: GeoJsonPolygon;
        trackPoints: StoredTrackPoint[];
        areaHa: number;
        geofenceStatus: string;
        localGeofenceResult: string;
    },
) {
    return queryOne<Record<string, unknown>>(client,
        `UPDATE plots
            SET polygon = ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), track_points = $4::jsonb,
                area_ha = $5, geofence_status = $6, local_geofence_result = $7,
                revision = revision + 1, source_updated_at = now()
          WHERE organization_id = $1 AND id = $2
          RETURNING *, ST_AsGeoJSON(polygon)::jsonb AS polygon`,
        [organizationId, plotId, JSON.stringify(values.polygon), JSON.stringify(values.trackPoints),
            values.areaHa, values.geofenceStatus, values.localGeofenceResult]);
}

export async function recordSyncChange(
    client: PoolClient,
    organizationId: string,
    plotId: string,
    payload: unknown,
) {
    await client.query(
        "INSERT INTO sync_changes(organization_id, entity_type, entity_id, payload) VALUES ($1, 'plot', $2, $3::jsonb)",
        [organizationId, plotId, JSON.stringify(payload)]);
}

export async function listVersions(client: PoolClient, organizationId: string, plotId: string) {
    const rows = await queryMany<VersionRow>(client,
        `SELECT v.version, v.source, v.note, v.area_ha, ST_AsGeoJSON(v.polygon)::jsonb AS polygon,
                u.display_name AS created_by_name, v.created_at
           FROM plot_geometry_versions v
           LEFT JOIN users u ON u.id = v.created_by
          WHERE v.organization_id = $1 AND v.plot_id = $2
          ORDER BY v.version DESC`,
        [organizationId, plotId]);
    return rows.map((row) => ({
        version: Number(row.version),
        source: row.source,
        note: row.note,
        areaHa: String(row.area_ha),
        polygon: row.polygon,
        createdBy: row.created_by_name,
        createdAt: row.created_at.toISOString(),
    }));
}
