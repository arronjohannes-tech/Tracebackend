import type { PoolClient } from "pg";
import { queryOne } from "../db.js";
import type { Role } from "../types.js";
export type DocumentRow = {
 id: string; organization_id: string; storage_key: string; file_name: string; mime_type: string;
 byte_size: number; status: string; upload_token_hash: string; upload_expires_at: Date;
 plot_id: string | null;
};
export async function lockUpload(client: PoolClient, organizationId: string, key: string) {
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["upload:"+organizationId+":"+key]);
}
export function byKey(client: PoolClient, org: string, key: string) {
 return queryOne<DocumentRow>(client, "SELECT * FROM documents WHERE organization_id = $1 AND idempotency_key = $2 FOR UPDATE", [org,key]);
}
export function byId(client: PoolClient, id: string, org?: string) {
 return queryOne<DocumentRow>(client, "SELECT * FROM documents WHERE id = $1 AND ($2::uuid IS NULL OR organization_id = $2) FOR UPDATE", [id, org ?? null]);
}
export function uploadOwner(client: PoolClient, id: string) {
 return queryOne<{ id: string; organization_id: string; role: Role; assigned_roles: Role[]; token_version: number }>(
  client, `SELECT u.id, u.organization_id, u.role, u.assigned_roles::text[] AS assigned_roles, u.token_version FROM users u
   JOIN documents d ON d.created_by=u.id AND d.organization_id=u.organization_id
   JOIN organizations o ON o.id=u.organization_id
   WHERE d.id=$1 AND u.active AND u.deleted_at IS NULL AND o.active`, [id]);
}
export async function insert(client: PoolClient, values: unknown[]) {
 await client.query("INSERT INTO documents(id,organization_id,file_name,mime_type,byte_size,storage_key,upload_token_hash,idempotency_key,created_by,upload_expires_at,plot_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",values);
}
export function plotExists(client: PoolClient, org: string, plotId: string) {
 return queryOne<{ id: string }>(client, "SELECT id FROM plots WHERE organization_id=$1 AND id=$2 FOR KEY SHARE", [org, plotId]);
}
export async function listForPlot(client: PoolClient, org: string, plotId: string) {
 const result = await client.query<{ id: string; plot_id: string; file_name: string; mime_type: string; byte_size: string; created_at: Date }>(
  "SELECT id,plot_id,file_name,mime_type,byte_size,created_at FROM documents WHERE organization_id=$1 AND plot_id=$2 AND status='completed' ORDER BY created_at DESC", [org, plotId]);
 return result.rows;
}
export async function renew(client: PoolClient,id: string,hash: string,expiry: Date) {
 await client.query("UPDATE documents SET upload_token_hash=$2,upload_expires_at=$3 WHERE id=$1",[id,hash,expiry]);
}
export async function received(client: PoolClient,id: string,digest: string) {
 await client.query("UPDATE documents SET status=CASE WHEN status='completed' THEN status ELSE 'uploaded' END,sha256=$2 WHERE id=$1",[id,digest]);
}
export async function complete(client: PoolClient,id: string) {
 await client.query("UPDATE documents SET status='completed' WHERE id=$1",[id]);
}
