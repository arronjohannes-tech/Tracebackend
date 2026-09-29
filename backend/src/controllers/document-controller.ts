import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { parse, authOf, sendData, uuidSchema } from "../http.js";
import { createDocumentService } from "../services/document-service.js";
const input=z.object({fileName:z.string().trim().min(1).max(255),mimeType:z.string().min(1).max(150),size:z.number().int().min(1).max(52428800)});
const params=z.object({documentId:uuidSchema});
export async function registerDocumentRoutes(app:FastifyInstance,pool:Pool,config:AppConfig,authenticate:(request:FastifyRequest)=>Promise<void>) {
 const service=createDocumentService(pool,config), secured={preHandler:authenticate};
 app.post("/api/v1/documents/uploads",secured,async(request,reply)=>{
  const key=parse(z.string().min(8).max(200),request.headers["idempotency-key"]);
  return sendData(reply,await service.initiate(authOf(request),request,parse(input,request.body),key),201);
 });
 app.put("/api/v1/documents/uploads/:documentId/content",async(request,reply)=>{
  const {documentId}=parse(params,request.params);
  const token=parse(z.string().min(20).max(512),request.headers["x-upload-token"]);
  if(!Buffer.isBuffer(request.body)) throw new AppError(415,"INVALID_UPLOAD","Raw upload bytes are required.");
  await service.content(documentId,token,request.body);
  return reply.code(204).send();
 });
 app.post("/api/v1/documents/uploads/:documentId/complete",secured,async(request,reply)=>{
  const {documentId}=parse(params,request.params);
  return sendData(reply,await service.complete(authOf(request),request,documentId));
 });
 app.get("/api/v1/documents/:documentId",secured,async(request,reply)=>{
  const {documentId}=parse(params,request.params);
  const result=await service.download(authOf(request),documentId);
  return reply.header("Content-Type",result.mimeType).header("Content-Disposition","attachment; filename*=UTF-8''"+encodeURIComponent(result.fileName)).send(result.bytes);
 });
}
