import type { PoolClient, QueryResultRow } from "pg";
import { queryOne, queryMany } from "../db.js";
export function selectRecords<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[]) {
 return client.query<T>("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", values);
}
export function selectDdsActions<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[]) {
 return queryOne<T>(client, `SELECT id, operation_id, action, idempotency_key, status, response
       FROM dds_actions
      WHERE organization_id = $1 AND idempotency_key = $2
      FOR UPDATE`, values);
}
export function insertDdsActions<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[]) {
 return queryOne<T>(client, `INSERT INTO dds_actions(
       organization_id, operation_id, action, idempotency_key, status, created_by
     ) VALUES ($1, $2, $3, $4, 'processing', $5)
     RETURNING id, operation_id, action, idempotency_key, status, response`, values);
}
export function updateDdsActions<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[]) {
 return client.query<T>(`UPDATE dds_actions
        SET status = $2, response = $3::jsonb, error_code = $4
      WHERE id = $1`, values);
}
export function selectPlots<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[]) {
 return queryOne<T>(client, "SELECT count(*)::int AS count FROM plots WHERE organization_id = $1 AND id = ANY($2::uuid[])", values);
}
export function selectPlots2<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[]) {
 return queryOne<T>(client, "SELECT count(*)::int AS count FROM plots WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND geofence_status NOT IN ('inside', 'approved')", values);
}
export function selectOperationalRequests<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[], part0: string) {
 return queryOne<T>(client, `SELECT * FROM operational_requests
      WHERE id = $1 AND organization_id = $2 AND kind = $3 ${part0}`, values);
}
export function selectOperationalRequests2<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[]) {
 return queryOne<T>(client, `SELECT * FROM operational_requests
          WHERE organization_id = $1 AND kind = $2 AND idempotency_key = $3`, values);
}
export function selectOrganizationApiConfig<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[]) {
 return queryOne<T>(client, `SELECT satellite_enabled, evidence_pack_enabled
           FROM organization_api_config WHERE organization_id = $1`, values);
}
export function insertOperationalRequests<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[]) {
 return queryOne<T>(client, `INSERT INTO operational_requests(
           organization_id, kind, subject_id, status, phase, message,
           idempotency_key, created_by, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING *`, values);
}
export function insertReviewRequests<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[]) {
 return client.query<T>(`INSERT INTO review_requests(organization_id, subject_type, subject_id, requested_by)
           VALUES ($1, 'dds', $2, $3)`, values);
}
export function updateOperationalRequests<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[]) {
 return queryOne<T>(client, `UPDATE operational_requests
                SET status = 'completed', phase = 'validated',
                    message = 'DDS draft is structurally valid and awaits reviewer approval.'
              WHERE id = $1 RETURNING *`, values);
}
export function selectReviewRequests<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[]) {
 return queryOne<T>(client, `SELECT status FROM review_requests
            WHERE organization_id = $1 AND subject_type = 'dds' AND subject_id = $2`, values);
}
export function selectOrganizationApiConfig2<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[]) {
 return queryOne<T>(client, "SELECT * FROM organization_api_config WHERE organization_id = $1", values);
}
export function updateOperationalRequests2<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[]) {
 return client.query<T>(`UPDATE operational_requests
              SET status = 'processing', phase = 'submitting',
                  message = 'DDS submission is in progress.'
            WHERE id = $1`, values);
}
export function selectDdsActions2<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[]) {
 return queryOne<T>(client, `SELECT id, operation_id, action, idempotency_key, status, response
             FROM dds_actions WHERE id = $1 FOR UPDATE`, values);
}
export function updateOperationalRequests3<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[]) {
 return queryOne<T>(client, `UPDATE operational_requests
              SET status = 'completed', phase = 'submitted', external_reference = $2,
                  message = $3
            WHERE id = $1 RETURNING *`, values);
}
export function selectDdsActions3<T extends QueryResultRow = QueryResultRow>(client: PoolClient, values: unknown[]) {
 return queryOne<T>(client, `SELECT id, operation_id, action, idempotency_key, status, response
             FROM dds_actions WHERE id = $1 FOR UPDATE`, values);
}
export async function lockOperationKey(client: PoolClient, organizationId: string, kind: string, key: string) {
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["operation:"+organizationId+":"+kind+":"+key]);
}
export function finishAuxiliary<T extends QueryResultRow>(client: PoolClient, id:string, phase:string, message:string, downloadUrl:string|null, metadata:unknown) {
 return queryOne<T>(client,"UPDATE operational_requests SET status='completed',phase=$2,message=$3,download_url=$4,metadata=metadata || $5::jsonb WHERE id=$1 RETURNING *",[id,phase,message,downloadUrl,JSON.stringify(metadata)]);
}
export function scopedPlotGeofences(client: PoolClient, org:string, plotIds:string[]) {
 return queryMany<{id:string; polygon:unknown; covered:boolean; geofences_exist:boolean; approved_hashes:string[]}>(client,`
 SELECT p.id, ST_AsGeoJSON(p.polygon)::jsonb AS polygon,
 EXISTS(SELECT 1 FROM geofences g WHERE g.organization_id=p.organization_id AND g.active) AS geofences_exist,
 EXISTS(SELECT 1 FROM geofences g WHERE g.organization_id=p.organization_id AND g.active AND ST_Covers(g.polygon,p.polygon)) AS covered,
 ARRAY(SELECT v.payload_hash FROM geofence_violations v WHERE v.organization_id=p.organization_id AND v.entity_id=p.id AND v.status='approved') AS approved_hashes
 FROM plots p WHERE p.organization_id=$1 AND p.id=ANY($2::uuid[])`,[org,plotIds]);
}
