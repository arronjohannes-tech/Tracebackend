import type { PoolClient } from "pg";
import { queryMany } from "../db.js";
import { validatePlot } from "../domain/plot-validation.js";

type PlotRow = {
    id: string;
    supplier_id: string | null;
    supplier_name: string | null;
    producer: string;
    farm_name: string;
    area_ha: string;
    geofence_status: string;
    local_geofence_result: string;
    revision: number;
    captured_at: Date;
    source_updated_at: Date;
    polygon: { type: "Polygon"; coordinates: number[][][] };
    lat: number | null;
    lng: number | null;
    computed_area_ha: string | number | null;
    valid: boolean;
    simple: boolean;
    duplicate_count: number;
    eo_status: string | null;
    eo_phase: string | null;
    open_corrections: number;
};

export function plotDetailJson(row: PlotRow) {
    const areaHa = Number(row.area_ha);
    return {
        id: row.id,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        producer: row.producer,
        farmName: row.farm_name,
        areaHa: String(row.area_ha),
        geofenceStatus: row.geofence_status,
        localGeofenceResult: row.local_geofence_result,
        revision: Number(row.revision),
        polygon: row.polygon,
        centroid: row.lat === null || row.lng === null ? null : { lat: Number(row.lat), lng: Number(row.lng) },
        capturedAt: row.captured_at.toISOString(),
        updatedAt: row.source_updated_at.toISOString(),
        openCorrectionCount: Number(row.open_corrections),
        validation: validatePlot({
            geofenceStatus: row.geofence_status,
            areaHa,
            computedAreaHa: Number(row.computed_area_ha ?? 0),
            valid: row.valid,
            simple: row.simple,
            duplicateCount: Number(row.duplicate_count),
            eoStatus: row.eo_status,
            eoPhase: row.eo_phase,
        }),
    };
}

// Plots are duplicates when another plot of the organization covers at least 90 % of the smaller one.
export async function listPlots(client: PoolClient, organizationId: string) {
    const rows = await queryMany<PlotRow>(client, `
    SELECT p.id, p.supplier_id, s.name AS supplier_name, p.producer, p.farm_name, p.area_ha,
           p.geofence_status, p.local_geofence_result, p.revision, p.captured_at, p.source_updated_at,
           ST_AsGeoJSON(p.polygon)::jsonb AS polygon,
           ST_Y(ST_Centroid(p.polygon)) AS lat, ST_X(ST_Centroid(p.polygon)) AS lng,
           ST_Area(p.polygon::geography) / 10000 AS computed_area_ha,
           ST_IsValid(p.polygon) AS valid, ST_IsSimple(p.polygon) AS simple,
           (SELECT count(*)::int FROM plots o
             WHERE o.organization_id = p.organization_id AND o.id <> p.id
               AND o.polygon && p.polygon AND ST_Intersects(o.polygon, p.polygon)
               AND ST_Area(ST_Intersection(o.polygon, p.polygon))
                   >= 0.9 * LEAST(ST_Area(o.polygon), ST_Area(p.polygon))) AS duplicate_count,
           eo.status AS eo_status, eo.phase AS eo_phase,
           (SELECT count(*)::int FROM plot_correction_items i
             WHERE i.organization_id = p.organization_id AND i.plot_id = p.id AND i.status = 'open') AS open_corrections
      FROM plots p
      LEFT JOIN suppliers s ON s.organization_id = p.organization_id AND s.id = p.supplier_id
      LEFT JOIN LATERAL (
        SELECT r.status, r.phase FROM operational_requests r
         WHERE r.organization_id = p.organization_id AND r.kind = 'satellite'
           AND (r.subject_id = p.id::text
                OR r.metadata->'results' @> jsonb_build_array(jsonb_build_object('plotId', p.id::text)))
         ORDER BY r.updated_at DESC LIMIT 1
      ) eo ON true
     WHERE p.organization_id = $1
     ORDER BY p.source_updated_at DESC, p.id
     LIMIT 500
  `, [organizationId]);
    return rows.map(plotDetailJson);
}
