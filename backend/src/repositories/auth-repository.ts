import type { PoolClient, QueryResultRow } from "pg";
import { queryOne, queryMany } from "../db.js";
export function insertRefreshTokens<T extends QueryResultRow = QueryResultRow>(client:PoolClient,values:unknown[]) { return client.query<T>(`INSERT INTO refresh_tokens
        (id, family_id, user_id, organization_id, token_hash, rotated_from_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,values); }
export function selectUsers<T extends QueryResultRow = QueryResultRow>(client:PoolClient,values:unknown[]) { return queryMany<T>(client,`SELECT u.*, o.name AS organization_name
           FROM users u
           LEFT JOIN organizations o ON o.id = u.organization_id
          WHERE lower(u.email) = $1
            AND ($2::text IS NULL OR o.slug = $2)
            AND u.active = true
            AND (o.active = true OR u.role = 'system_admin')
          LIMIT 2`,values); }
export function selectRefreshTokens<T extends QueryResultRow = QueryResultRow>(client:PoolClient,values:unknown[]) { return queryOne<T>(client,"SELECT * FROM refresh_tokens WHERE id = $1 FOR UPDATE",values); }
export function updateRefreshTokens<T extends QueryResultRow = QueryResultRow>(client:PoolClient,values:unknown[]) { return client.query<T>("UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = $1",values); }
export function updateRefreshTokens2<T extends QueryResultRow = QueryResultRow>(client:PoolClient,values:unknown[]) { return client.query<T>("UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1",values); }
export function selectUsers2<T extends QueryResultRow = QueryResultRow>(client:PoolClient,values:unknown[]) { return queryOne<T>(client,`SELECT u.*, o.name AS organization_name
           FROM users u
           LEFT JOIN organizations o ON o.id = u.organization_id
          WHERE u.id = $1
            AND u.active = true
            AND (u.role = 'system_admin' OR o.active = true)`,values); }
export function updateRefreshTokens3<T extends QueryResultRow = QueryResultRow>(client:PoolClient,values:unknown[]) { return client.query<T>("UPDATE refresh_tokens SET used_at = now() WHERE id = $1",values); }
export function insertRefreshTokens2<T extends QueryResultRow = QueryResultRow>(client:PoolClient,values:unknown[]) { return client.query<T>(`INSERT INTO refresh_tokens
          (id, family_id, user_id, organization_id, token_hash, rotated_from_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,values); }
export function updateRefreshTokens4<T extends QueryResultRow = QueryResultRow>(client:PoolClient,values:unknown[]) { return client.query<T>(`UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
          WHERE family_id = (
            SELECT family_id FROM refresh_tokens WHERE token_hash = $1 AND user_id = $2
          )`,values); }
export function selectUsers3<T extends QueryResultRow = QueryResultRow>(client:PoolClient,values:unknown[]) { return queryOne<T>(client,"SELECT * FROM users WHERE id = $1",values); }