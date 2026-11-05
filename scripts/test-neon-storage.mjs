import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { Files } from "files-sdk";
import { neon } from "files-sdk/neon";

const root = new URL("../", import.meta.url);
const envFile = new URL(existsSync(new URL(".env", root)) ? ".env" : ".env.local", root);
const env = parse(await readFile(envFile));
for (const name of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_ENDPOINT_URL_S3", "AWS_REGION"]) {
  assert.ok(env[name], `${name} is missing; run neon env pull first.`);
}

const files = new Files({
  adapter: neon({
    bucket: "uploads",
    endpoint: env.AWS_ENDPOINT_URL_S3,
    region: env.AWS_REGION,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  }),
});
const source = new URL("fixtures/neon-upload.txt", import.meta.url);
const body = await readFile(source);
const prefix = `verification/${randomUUID()}/`;
const key = `${prefix}neon-upload.txt`;
await files.upload(key, body, { contentType: "text/plain; charset=utf-8" });
const listing = await files.list({ prefix });
assert.equal(listing.items.length, 1, "The uploaded file must appear in the bucket listing.");
assert.equal(listing.items[0].key, key);
assert.equal(listing.items[0].size, body.length);
const downloaded = await files.download(key);
const received = Buffer.from(await downloaded.arrayBuffer());
assert.deepEqual(received, body, "Downloaded bytes must match the source file.");
console.log(JSON.stringify({
  bucket: "uploads",
  key,
  source: fileURLToPath(source),
  bytes: received.length,
  listed: true,
  verified: true,
  contents: received.toString("utf8"),
}, null, 2));
