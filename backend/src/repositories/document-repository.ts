import type { PoolClient } from "pg";
import { queryOne } from "../db.js";
export type DocumentRow = {
 id: string; organization_id: string; storage_key: string; file_name: string; mime_type: string;
 byte_size: number; status: string; upload_token_hash: string; upload_expires_at: Date;
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
export async function insert(client: PoolClient, values: unknown[]) {
 await client.query("INSERT INTO documents(id,organization_id,file_name,mime_type,byte_size,storage_key,upload_token_hash,idempotency_key,created_by,upload_expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",values);
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
