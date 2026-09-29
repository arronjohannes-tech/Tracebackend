import type { PoolClient } from "pg";
import { queryOne, queryMany } from "../db.js";
import { conflict } from "../errors.js";
import { geometryHash } from "../geo.js";
import type { GeoJsonPolygon } from "../types.js";
import { versionMatches } from "../domain/sync.js";
import { classifyGeofenceResult, type PushOperation, type GeofenceCheckResult, type GeofenceEvaluation } from "../domain/sync-contract.js";
export function supplierJson(row: Record<string, unknown>) {
  return {
    id: row.id,
    revision: Number(row.revision),
    name: row.name,
    region: row.region,
    producerCount: row.producer_count,
    plotCount: row.plot_count,
    updatedAt: row.source_updated_at instanceof Date
      ? row.source_updated_at.toISOString()
      : row.source_updated_at,
    syncStatus: "synced",
  };
}

export function plotJson(row: Record<string, unknown>) {
  return {
    id: row.id,
    revision: Number(row.revision),
    ...(row.supplier_id ? { supplierId: row.supplier_id } : {}),
    producer: row.producer,
    farmName: row.farm_name,
    areaHa: String(row.area_ha),
    polygon: row.polygon,
    geofenceStatus: row.geofence_status,
    localGeofenceResult: row.local_geofence_result,
    capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : row.captured_at,
    updatedAt: row.source_updated_at instanceof Date
      ? row.source_updated_at.toISOString()
      : row.source_updated_at,
    syncStatus: "synced",
  };
}

export async function checkGeofence(
  client: PoolClient,
  organizationId: string,
  operation: Extract<PushOperation, { entityType: "plot" }>,
  polygon: GeoJsonPolygon,
): Promise<GeofenceCheckResult> {
  const hash = geometryHash(polygon);
  const check = await queryOne<{ geofences_exist: boolean; covered: boolean; approved: boolean }>(
    client,
    `SELECT
       EXISTS(SELECT 1 FROM geofences WHERE organization_id = $1 AND active) AS geofences_exist,
       EXISTS(
         SELECT 1 FROM geofences
          WHERE organization_id = $1 AND active
            AND ST_Covers(polygon, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))
       ) AS covered,
       EXISTS(
         SELECT 1 FROM geofence_violations
          WHERE organization_id = $1 AND entity_type = 'plot'
            AND entity_id = $3 AND payload_hash = $4
            AND status = 'approved'
       ) AS approved`,
    [organizationId, JSON.stringify(polygon), operation.entityId, hash],
  );
  const evaluation = classifyGeofenceResult({
    geofencesExist: Boolean(check?.geofences_exist),
    covered: Boolean(check?.covered),
    approved: Boolean(check?.approved),
  });
  if (evaluation.geofenceStatus !== "review_required") {
    return { ...evaluation, violationId: null };
  }
  const violation = await queryOne<{ id: string }>(client,
    `INSERT INTO geofence_violations(
       organization_id, entity_type, entity_id, payload_hash, geometry, reason
     ) VALUES (
       $1, 'plot', $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326),
       'Plot is outside all active organization geofences'
     )
     ON CONFLICT (organization_id, entity_type, entity_id, payload_hash)
     DO UPDATE SET reason = EXCLUDED.reason
     RETURNING id`,
    [organizationId, operation.entityId, hash, JSON.stringify(polygon)]);
  return { ...evaluation, violationId: violation!.id };
}

export async function applySupplier(
  client: PoolClient,
  organizationId: string,
  operation: Extract<PushOperation, { entityType: "supplier" }>,
) {
  const existing = await queryOne<Record<string, unknown>>(client,
    "SELECT * FROM suppliers WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    [organizationId, operation.entityId]);
  if (
    existing && !versionMatches(Number(existing.revision), operation.baseVersion)
  ) {
    return { conflict: supplierJson(existing) };
  }
  if (!existing && operation.baseVersion !== 0) throw conflict("ENTITY_VERSION_MISSING", "The referenced base version does not exist.");
  const row = await queryOne<Record<string, unknown>>(client,
    `INSERT INTO suppliers(
       id, organization_id, name, region, producer_count, plot_count, source_updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (organization_id, id) DO UPDATE SET
       revision = suppliers.revision + 1,
       name = EXCLUDED.name, region = EXCLUDED.region,
       producer_count = EXCLUDED.producer_count, plot_count = EXCLUDED.plot_count,
       source_updated_at = EXCLUDED.source_updated_at
     RETURNING *`,
    [
      operation.entityId,
      organizationId,
      operation.payload.name,
      operation.payload.region,
      operation.payload.producerCount,
      operation.payload.plotCount,
      operation.payload.updatedAt,
    ]);
  const payload = supplierJson(row!);
  await client.query(
    "INSERT INTO sync_changes(organization_id, entity_type, entity_id, payload) VALUES ($1, 'supplier', $2, $3::jsonb)",
    [organizationId, operation.entityId, JSON.stringify(payload)],
  );
  return { payload };
}

export async function applyPlot(
  client: PoolClient,
  organizationId: string,
  operation: Extract<PushOperation, { entityType: "plot" }>,
  polygon: GeoJsonPolygon,
  geofence: GeofenceEvaluation,
) {
  const existing = await queryOne<Record<string, unknown>>(client,
    `SELECT *, ST_AsGeoJSON(polygon)::jsonb AS polygon
       FROM plots WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [organizationId, operation.entityId]);
  if (
    existing && !versionMatches(Number(existing.revision), operation.baseVersion)
  ) {
    return { conflict: plotJson(existing) };
  }
  if (!existing && operation.baseVersion !== 0) throw conflict("ENTITY_VERSION_MISSING", "The referenced base version does not exist.");
  const row = await queryOne<Record<string, unknown>>(client,
    `INSERT INTO plots(
       id, organization_id, supplier_id, producer, farm_name, area_ha,
       polygon, geofence_status, local_geofence_result, captured_at, source_updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       ST_SetSRID(ST_GeomFromGeoJSON($7), 4326), $8, $9, $10, $11
     )
     ON CONFLICT (organization_id, id) DO UPDATE SET
       revision = plots.revision + 1,
       supplier_id = EXCLUDED.supplier_id, producer = EXCLUDED.producer,
       farm_name = EXCLUDED.farm_name, area_ha = EXCLUDED.area_ha,
       polygon = EXCLUDED.polygon, geofence_status = EXCLUDED.geofence_status,
       local_geofence_result = EXCLUDED.local_geofence_result,
       captured_at = EXCLUDED.captured_at,
       source_updated_at = EXCLUDED.source_updated_at
     RETURNING *, ST_AsGeoJSON(polygon)::jsonb AS polygon`,
    [
      operation.entityId,
      organizationId,
      operation.payload.supplierId ?? null,
      operation.payload.producer,
      operation.payload.farmName,
      operation.payload.areaHa,
      JSON.stringify(polygon),
      geofence.geofenceStatus,
      geofence.localGeofenceResult,
      operation.payload.capturedAt,
      operation.payload.updatedAt,
    ]);
  const payload = plotJson(row!);
  await client.query(
    "INSERT INTO sync_changes(organization_id, entity_type, entity_id, payload) VALUES ($1, 'plot', $2, $3::jsonb)",
    [organizationId, operation.entityId, JSON.stringify(payload)],
  );
  return { payload };
}


export async function lockTenantSync(client: PoolClient, organizationId: string) {
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["sync:" + organizationId]);
}
export function previousOperation(client: PoolClient, organizationId: string, key: string) {
 return queryOne<{operation_id: string; request_hash: string | null; response: { accepted?: boolean; remote?: unknown; resource?: unknown }}>(client,
 "SELECT operation_id, request_hash, response FROM sync_operations WHERE organization_id = $1 AND idempotency_key = $2", [organizationId, key]);
}
export async function saveOperation(client: PoolClient, organizationId: string, op: PushOperation, hash: string, response: unknown) {
 await client.query("INSERT INTO sync_operations(organization_id, idempotency_key, operation_id, response, request_hash) VALUES ($1, $2, $3, $4::jsonb, $5)", [organizationId, op.idempotencyKey, op.id, JSON.stringify(response), hash]);
}
export function getChanges(client: PoolClient, organizationId: string, cursor: string, limit: number) {
 return queryMany<{sequence_id: string; entity_type: "supplier" | "plot"; payload: unknown}>(client,
 "SELECT sequence_id::text AS sequence_id, entity_type, payload FROM sync_changes WHERE organization_id = $1 AND sequence_id > $2::bigint ORDER BY sequence_id LIMIT $3", [organizationId, cursor, limit]);
}
export function getGeofences(client: PoolClient, organizationId: string) {
 return queryMany(client, `SELECT id, organization_id AS "organizationId", name, ST_AsGeoJSON(polygon)::jsonb AS polygon, updated_at AS "updatedAt" FROM geofences WHERE organization_id = $1 AND active = true ORDER BY name`, [organizationId]);
}
