import type { PoolClient, QueryResultRow } from "pg";
import { queryMany, queryOne } from "../db.js";
import type { GeoJsonPolygon } from "../types.js";

export type CopernicusConfigRow = {
  organization_id: string;
  enabled: boolean;
  client_id_ciphertext: string | null;
  client_secret_ciphertext: string | null;
  settings: unknown;
  updated_at: Date;
};

export function selectConfig(client: PoolClient, organizationId: string) {
  return queryOne<CopernicusConfigRow>(client,
    "SELECT * FROM organization_copernicus_process_config WHERE organization_id = $1",
    [organizationId]);
}

export function upsertConfig(
  client: PoolClient,
  values: {
    organizationId: string;
    enabled: boolean;
    clientId: string | null | undefined;
    clientSecret: string | null | undefined;
    settings: unknown;
  },
) {
  return queryOne<CopernicusConfigRow>(client,
    `INSERT INTO organization_copernicus_process_config
       (organization_id, enabled, client_id_ciphertext, client_secret_ciphertext, settings)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (organization_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       client_id_ciphertext = CASE WHEN $6 THEN EXCLUDED.client_id_ciphertext
                                   ELSE organization_copernicus_process_config.client_id_ciphertext END,
       client_secret_ciphertext = CASE WHEN $7 THEN EXCLUDED.client_secret_ciphertext
                                       ELSE organization_copernicus_process_config.client_secret_ciphertext END,
       settings = EXCLUDED.settings
     RETURNING *`,
    [
      values.organizationId,
      values.enabled,
      values.clientId ?? null,
      values.clientSecret ?? null,
      JSON.stringify(values.settings),
      values.clientId !== undefined,
      values.clientSecret !== undefined,
    ]);
}

export function selectSatelliteEnabled(client: PoolClient, organizationId: string) {
  return queryOne<{ satellite_enabled: boolean }>(client,
    "SELECT satellite_enabled FROM organization_api_config WHERE organization_id = $1",
    [organizationId]);
}

export function selectPlotPolygons(client: PoolClient, organizationId: string, plotIds: string[]) {
  return queryMany<{ id: string; polygon: GeoJsonPolygon }>(client,
    `SELECT id, ST_AsGeoJSON(polygon)::jsonb AS polygon
       FROM plots WHERE organization_id = $1 AND id = ANY($2::uuid[])
      ORDER BY array_position($2::uuid[], id)`,
    [organizationId, plotIds]);
}

export function markProcessing<T extends QueryResultRow>(client: PoolClient, id: string, message: string) {
  return queryOne<T>(client,
    `UPDATE operational_requests
        SET status = 'processing', phase = 'requesting', message = $2
      WHERE id = $1 RETURNING *`,
    [id, message]);
}

export function finishProcess<T extends QueryResultRow>(
  client: PoolClient,
  id: string,
  status: "completed" | "failed",
  phase: string,
  message: string,
  metadata: unknown,
) {
  return queryOne<T>(client,
    `UPDATE operational_requests
        SET status = $2, phase = $3, message = $4, metadata = metadata || $5::jsonb
      WHERE id = $1 RETURNING *`,
    [id, status, phase, message, JSON.stringify(metadata)]);
}
