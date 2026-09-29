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
export type UploadInput = {fileName:string; mimeType:string; size:number};
function canWrite(auth: AuthContext) {
 if (!auth.organizationId || !["org_admin","field_agent"].includes(auth.role)) throw new AppError(403,"FORBIDDEN","This account cannot upload documents.");
}
export function uploadToken(secret: string, id: string, expiry: Date): string {
 return createHmac("sha256",secret).update("tracebackend-upload:"+id+":"+expiry.toISOString()).digest("base64url");
}
export function createDocumentService(pool: Pool, config: AppConfig, store: ObjectStore = createObjectStore(config)) {
 return {
 async initiate(auth: AuthContext, audit: AuditContext, body: UploadInput, key: string) {
  canWrite(auth);
  return withContext(pool,auth,async client=>{
   await repository.lockUpload(client,auth.organizationId!,key);
   const existing=await repository.byKey(client,auth.organizationId!,key);
   if(existing && (existing.file_name!==body.fileName || existing.mime_type!==body.mimeType || Number(existing.byte_size)!==body.size)) throw conflict("IDEMPOTENCY_KEY_REUSED","Upload metadata differs.");
   const id=existing?.id??randomUUID();
   const expiry=existing && existing.upload_expires_at.getTime()>Date.now() ? existing.upload_expires_at : new Date(Date.now()+86400000);
   const token=uploadToken(config.JWT_SECRET,id,expiry);
   if(existing) await repository.renew(client,id,hashOpaqueToken(token),expiry);
   else {
    await repository.insert(client,[id,auth.organizationId,body.fileName,body.mimeType,body.size,auth.organizationId+"/"+id,hashOpaqueToken(token),key,auth.userId,expiry]);
    await writeAudit(client,audit,auth,"document.upload.initiate","document",id,{fileName:body.fileName,size:body.size});
   }
   return {documentId:id,uploadUrl:config.PUBLIC_BASE_URL+"/api/v1/documents/uploads/"+id+"/content",headers:{"Content-Type":"application/octet-stream","X-Upload-Token":token},expiresAt:expiry.toISOString()};
  });
 },
 async content(id:string,token:string,bytes:Buffer) {
  return withContext(pool,"system",async client=>{
   const document=await repository.byId(client,id);
   if(!document || document.upload_expires_at.getTime()<=Date.now() || !constantTimeEqual(document.upload_token_hash,hashOpaqueToken(token))) throw new AppError(401,"INVALID_UPLOAD_TOKEN","Upload authorization is invalid or expired.");
   if(bytes.length!==Number(document.byte_size)) throw new AppError(400,"SIZE_MISMATCH","Uploaded size differs.");
   await store.put(document.storage_key,bytes);
   await repository.received(client,id,createHash("sha256").update(bytes).digest("hex"));
  });
 },
 async complete(auth:AuthContext,audit:AuditContext,id:string) {
  canWrite(auth);
  return withContext(pool,auth,async client=>{
   const document=await repository.byId(client,id,auth.organizationId!);
   if(!document) throw notFound("Document");
   if(document.status==="completed") return {id,status:"completed"};
   if(document.status!=="uploaded") throw conflict("UPLOAD_INCOMPLETE","Upload bytes have not been received.");
   if(await store.size(document.storage_key)!==Number(document.byte_size)) throw conflict("SIZE_MISMATCH","Stored size differs.");
   await repository.complete(client,id);
   await writeAudit(client,audit,auth,"document.upload.complete","document",id);
   return {id,status:"completed"};
  });
 },
 async download(auth:AuthContext,id:string) {
  if(!auth.organizationId) throw new AppError(403,"ORGANIZATION_REQUIRED","Organization user required.");
  const document=await withContext(pool,auth,client=>repository.byId(client,id,auth.organizationId!));
  if(!document || document.status!=="completed") throw notFound("Document");
  return {bytes:await store.get(document.storage_key),mimeType:document.mime_type,fileName:document.file_name};
 }
 };
}
