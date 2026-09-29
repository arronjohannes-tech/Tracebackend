import test from "node:test";
import assert from "node:assert/strict";
import { readFile,readdir } from "node:fs/promises";
test("critical HTTP controllers contain no SQL, filesystem or direct provider calls",async()=>{
 for(const name of await readdir(new URL("../src/controllers/",import.meta.url))){
  const source=await readFile(new URL("../src/controllers/"+name,import.meta.url),"utf8");
  assert.doesNotMatch(source,/client\.query|withContext|node:fs|FROM documents|UPDATE operational_requests|INSERT INTO/);
 }
});
test("business services do not depend on Fastify",async()=>{
 for(const name of await readdir(new URL("../src/services/",import.meta.url))){
  const source=await readFile(new URL("../src/services/"+name,import.meta.url),"utf8");
  assert.doesNotMatch(source,/from ["']fastify["']/);
 }
});
