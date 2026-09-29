import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile, link, unlink, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { conflict } from "../errors.js";
export interface ObjectStore {
 put(key: string, bytes: Buffer): Promise<void>;
 get(key: string): Promise<Buffer>;
 size(key: string): Promise<number>;
}
export function createObjectStore(config: AppConfig): ObjectStore {
 if (config.STORAGE_DRIVER === "s3") {
  const client = new S3Client({ region: config.S3_REGION ?? "eu-central-1", ...(config.S3_ENDPOINT ? {endpoint: config.S3_ENDPOINT, forcePathStyle: true} : {}) });
  const Bucket = config.S3_BUCKET!;
  const get = async (Key: string) => {
   const object = await client.send(new GetObjectCommand({Bucket, Key}));
   if (!object.Body) throw new Error("Object body is missing.");
   return Buffer.from(await object.Body.transformToByteArray());
  };
  return {
   get,
   async size(Key) { return (await client.send(new HeadObjectCommand({Bucket, Key}))).ContentLength ?? 0; },
   async put(Key, Body) {
    try {
     await client.send(new PutObjectCommand({Bucket, Key, Body, IfNoneMatch: "*", ChecksumSHA256: createHash("sha256").update(Body).digest("base64")}));
    } catch (error) {
     if ((error as {$metadata?: {httpStatusCode?: number}}).$metadata?.httpStatusCode !== 412) throw error;
     if (!(await get(Key)).equals(Body)) throw conflict("UPLOAD_ALREADY_USED", "Different bytes already exist for this object.");
    }
   }
  };
 }
 if (config.NODE_ENV === "production") throw new Error("Local object storage is forbidden in production.");
 const resolve = (key: string) => {
  const root = path.resolve(config.STORAGE_DIR), file = path.resolve(root, key);
  if (!file.startsWith(root + path.sep)) throw new Error("Invalid object key.");
  return file;
 };
 return {
  get: key=>readFile(resolve(key)),
  size: async key=>(await stat(resolve(key))).size,
  async put(key, bytes) {
   const file = resolve(key);
   await mkdir(path.dirname(file), {recursive: true});
   const temp = file + "." + randomUUID() + ".tmp";
   try {
    await writeFile(temp, bytes, {flag: "wx"});
    try { await link(temp, file); }
    catch (error) {
     if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
     if (!(await readFile(file)).equals(bytes)) throw conflict("UPLOAD_ALREADY_USED", "Different bytes already exist for this object.");
    }
   } finally { await unlink(temp).catch(()=>undefined); }
  }
 };
}
