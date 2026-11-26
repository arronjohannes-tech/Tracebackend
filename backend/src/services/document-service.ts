import { createHmac, createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { AuthContext } from "../types.js";
import { writeAudit, type AuditContext } from "../audit.js";
import { withContext } from "../db.js";
import { AppError, conflict, notFound } from "../errors.js";
import { constantTimeEqual, hashOpaqueToken } from "../security.js";
import { createObjectStore, type ObjectStore } from "../infrastructure/object-store.js";
import * as repository from "../repositories/document-repository.js";
import { assertPermission, hasRole, loadPermissions } from "../permissions.js";
export type UploadInput = { fileName: string; mimeType: string; size: number; plotId?: string | undefined };
function canWrite(auth: AuthContext) {
    if (!auth.organizationId || !hasRole(auth, ["org_admin", "field_agent"])) throw new AppError(403, "FORBIDDEN", "This account cannot upload documents.");
}
export function uploadToken(secret: string, id: string, expiry: Date): string {
    return createHmac("sha256", secret).update("tracebackend-upload:" + id + ":" + expiry.toISOString()).digest("base64url");
}
export function createDocumentService(pool: Pool, config: AppConfig, store: ObjectStore = createObjectStore(config)) {
    return {
        async initiate(auth: AuthContext, audit: AuditContext, body: UploadInput, key: string) {
            canWrite(auth);
            return withContext(pool, auth, async client => {
                await repository.lockUpload(client, auth.organizationId!, key);
                const existing = await repository.byKey(client, auth.organizationId!, key);
                if (existing && (existing.file_name !== body.fileName || existing.mime_type !== body.mimeType || Number(existing.byte_size) !== body.size || existing.plot_id !== (body.plotId ?? null))) throw conflict("IDEMPOTENCY_KEY_REUSED", "Upload metadata differs.");
                if (body.plotId && !await repository.plotExists(client, auth.organizationId!, body.plotId)) throw notFound("Plot");
                const id = existing?.id ?? randomUUID();
                const expiry = existing && existing.upload_expires_at.getTime() > Date.now() ? existing.upload_expires_at : new Date(Date.now() + 86400000);
                const token = uploadToken(config.JWT_SECRET, id, expiry);
                if (existing) await repository.renew(client, id, hashOpaqueToken(token), expiry);
                else {
                    await repository.insert(client, [id, auth.organizationId, body.fileName, body.mimeType, body.size, auth.organizationId + "/" + id, hashOpaqueToken(token), key, auth.userId, expiry, body.plotId ?? null]);
                    await writeAudit(client, audit, auth, "document.upload.initiate", "document", id, { fileName: body.fileName, size: body.size });
                }
                return { documentId: id, uploadUrl: config.PUBLIC_BASE_URL + "/api/v1/documents/uploads/" + id + "/content", headers: { "Content-Type": "application/octet-stream", "X-Upload-Token": token }, expiresAt: expiry.toISOString() };
            });
        },
        async listForPlot(auth: AuthContext, plotId: string) {
            if (!auth.organizationId) throw new AppError(403, "ORGANIZATION_REQUIRED", "Organization user required.");
            assertPermission(auth, "dds", false);
            return withContext(pool, auth, async client => {
                if (!await repository.plotExists(client, auth.organizationId!, plotId)) throw notFound("Plot");
                const rows = await repository.listForPlot(client, auth.organizationId!, plotId);
                return rows.map(row => ({
                    id: row.id, plotId: row.plot_id, fileName: row.file_name,
                    mimeType: row.mime_type, size: Number(row.byte_size),
                    status: "uploaded" as const, createdAt: row.created_at.toISOString(),
                }));
            });
        },
        async content(id: string, token: string, bytes: Buffer) {
            return withContext(pool, "system", async client => {
                const document = await repository.byId(client, id);
                if (!document || document.upload_expires_at.getTime() <= Date.now() || !constantTimeEqual(document.upload_token_hash, hashOpaqueToken(token))) throw new AppError(401, "INVALID_UPLOAD_TOKEN", "Upload authorization is invalid or expired.");
                const owner = await repository.uploadOwner(client, id);
                if (!owner) throw new AppError(401, "INVALID_UPLOAD_TOKEN", "Upload authorization is no longer valid.");
                const auth: AuthContext = {
                    userId: owner.id, organizationId: owner.organization_id, role: owner.role,
                    roles: owner.assigned_roles, tokenVersion: owner.token_version,
                    permissions: await loadPermissions(client, owner.assigned_roles, owner.organization_id),
                };
                canWrite(auth);
                assertPermission(auth, "dds", true);
                if (bytes.length !== Number(document.byte_size)) throw new AppError(400, "SIZE_MISMATCH", "Uploaded size differs.");
                await store.put(document.storage_key, bytes);
                await repository.received(client, id, createHash("sha256").update(bytes).digest("hex"));
            });
        },
        async complete(auth: AuthContext, audit: AuditContext, id: string) {
            canWrite(auth);
            return withContext(pool, auth, async client => {
                const document = await repository.byId(client, id, auth.organizationId!);
                if (!document) throw notFound("Document");
                if (document.status === "completed") return { id, status: "completed" };
                if (document.status !== "uploaded") throw conflict("UPLOAD_INCOMPLETE", "Upload bytes have not been received.");
                if (await store.size(document.storage_key) !== Number(document.byte_size)) throw conflict("SIZE_MISMATCH", "Stored size differs.");
                await repository.complete(client, id);
                await writeAudit(client, audit, auth, "document.upload.complete", "document", id);
                return { id, status: "completed" };
            });
        },
        async download(auth: AuthContext, id: string) {
            if (!auth.organizationId) throw new AppError(403, "ORGANIZATION_REQUIRED", "Organization user required.");
            const document = await withContext(pool, auth, client => repository.byId(client, id, auth.organizationId!));
            if (!document || document.status !== "completed") throw notFound("Document");
            return { bytes: await store.get(document.storage_key), mimeType: document.mime_type, fileName: document.file_name };
        },
        async downloadUrl(auth: AuthContext, id: string) {
            if (!auth.organizationId) throw new AppError(403, "ORGANIZATION_REQUIRED", "Organization user required.");
            const document = await withContext(pool, auth, client => repository.byId(client, id, auth.organizationId!));
            if (!document || document.status !== "completed") throw notFound("Document");
            const url = await store.presignGet(document.storage_key, 300);
            if (!url) throw conflict("PRESIGNED_URL_UNAVAILABLE", "Presigned document URLs require S3 object storage.");
            return { url, expiresIn: 300 };
        }
    };
}
