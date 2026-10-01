
import { initdb, postgres, pg_ctl } from "@embedded-postgres/windows-x64";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import pg from "pg";
import { versionMatches } from "../src/domain/sync.ts";
const root=path.resolve(".test-runtime",randomUUID()),data=path.join(root,"database"),password=randomBytes(24).toString("hex"),pw=path.join(root,"password");
await mkdir(root,{recursive:true});await writeFile(pw,password);
const listener=net.createServer();await new Promise(resolve=>listener.listen(0,"127.0.0.1",resolve));
const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
function run(file,args){return new Promise((resolve,reject)=>{const child=spawn(file,args,{windowsHide:true,stdio:["ignore","pipe","pipe"]});let output="";child.stdout.on("data",chunk=>output+=chunk);child.stderr.on("data",chunk=>output+=chunk);child.on("error",reject);child.on("close",code=>code===0?resolve():reject(new Error(output)));});}
let server;let a,b,c;
try {
 await run(initdb,["-D",data,"-U","postgres","--pwfile="+pw,"--auth=scram-sha-256","--encoding=UTF8","--locale=C"]);
 await unlink(pw);
 server=spawn(postgres,["-D",data,"-h","127.0.0.1","-p",String(port)],{windowsHide:true,stdio:"ignore"});
 const options={host:"127.0.0.1",port,user:"postgres",password,database:"postgres"};
 for(let i=0;i<100;i++){const probe=new pg.Client(options);try{await probe.connect();await probe.end();break;}catch(error){await probe.end().catch(()=>{});if(i===99)throw error;await new Promise(resolve=>setTimeout(resolve,100));}}
 a=new pg.Client(options);b=new pg.Client(options);c=new pg.Client(options);
 await Promise.all([a.connect(),b.connect(),c.connect()]);
 await a.query(`CREATE TABLE suppliers(id uuid); CREATE TABLE plots(id uuid); CREATE TABLE sync_operations(id uuid);
 CREATE TABLE sync_changes(sequence_id bigserial PRIMARY KEY,organization_id uuid NOT NULL,payload jsonb);
 CREATE TABLE documents(id uuid);`);
 await a.query(await readFile(new URL("../migrations/004_mobile_consistency.sql",import.meta.url),"utf8"));
 await a.query(`CREATE TABLE organizations(id uuid PRIMARY KEY); CREATE TABLE users(id uuid PRIMARY KEY);
 ALTER TABLE suppliers ADD COLUMN organization_id uuid;
 CREATE FUNCTION app_system_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
 CREATE FUNCTION app_organization_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;`);
 await a.query(await readFile(new URL("../migrations/005_supplier_invitations.sql",import.meta.url),"utf8"));
 const invitedOrg=randomUUID(),inviter=randomUUID();
 await a.query("INSERT INTO organizations(id) VALUES($1)",[invitedOrg]);
 await a.query("INSERT INTO users(id) VALUES($1)",[inviter]);
 await a.query(`INSERT INTO supplier_invitations(organization_id,legal_name,email,token_hash,expires_at,created_by)
 VALUES($1,'Coffee Union','coffee@example.com','test-hash',now()+interval '7 days',$2)`,[invitedOrg,inviter]);
 assert.equal((await a.query("SELECT legal_name FROM supplier_invitations WHERE token_hash='test-hash'")).rows[0].legal_name,"Coffee Union");
 assert.equal((await a.query("SELECT count(*)::int AS count FROM pg_policies WHERE tablename='supplier_invitations'")).rows[0].count,1);
 console.log("PASS: supplier invitation migration creates usable tenant-scoped invitation and supplier fields.");
 const org=randomUUID();
 await a.query("BEGIN");
 const first=(await a.query("INSERT INTO sync_changes(organization_id,payload) VALUES($1,'{}') RETURNING sequence_id",[org])).rows[0].sequence_id;
 await b.query("BEGIN");
 let finished=false;
 const secondPromise=b.query("INSERT INTO sync_changes(organization_id,payload) VALUES($1,'{}') RETURNING sequence_id",[org]).then(result=>{finished=true;return result.rows[0].sequence_id;});
 for(let i=0;i<100;i++){const lock=await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'",[b.processID]);if(lock.rows[0].n>0)break;if(i===99)throw new Error("Writer did not wait for tenant lock.");await new Promise(resolve=>setTimeout(resolve,20));}
 assert.equal(finished,false);
 assert.equal((await c.query("SELECT count(*)::int AS n FROM sync_changes")).rows[0].n,0);
 await a.query("COMMIT");
 const second=await secondPromise;
 assert.ok(BigInt(second)>BigInt(first));
 assert.equal((await c.query("SELECT sequence_id FROM sync_changes")).rows.length,1);
 await b.query("COMMIT");
 assert.equal((await c.query("SELECT sequence_id FROM sync_changes WHERE sequence_id>$1",[first])).rows[0].sequence_id,second);
 console.log("PASS: later writer waits until earlier tenant transaction commits; cursor sees both changes.");
 await a.query("BEGIN");const rolled=(await a.query("INSERT INTO sync_changes(organization_id,payload) VALUES($1,'{}') RETURNING sequence_id",[org])).rows[0].sequence_id;await a.query("ROLLBACK");
 const next=(await c.query("INSERT INTO sync_changes(organization_id,payload) VALUES($1,'{}') RETURNING sequence_id",[org])).rows[0].sequence_id;
 assert.ok(BigInt(next)>BigInt(rolled));
 assert.equal((await c.query("SELECT count(*)::int AS n FROM sync_changes")).rows[0].n,3);
 console.log("PASS: rollback gaps do not lose committed changes.");
 assert.equal(versionMatches(2,1),false);assert.equal(versionMatches(2,2),true);
 console.log("PASS: server revision comparison rejects stale edits independently of device time.");
 console.log("Integration checks: 4 passed, 0 failed. Real PostgreSQL; migrations 004-005 on minimal tables. PostGIS/full migration not covered.");
} finally {
 await Promise.allSettled([a?.query("ROLLBACK"),b?.query("ROLLBACK")]);
 await Promise.allSettled([a?.end(),b?.end(),c?.end()]);
 if(server) await run(pg_ctl,["-D",data,"-m","fast","-w","stop"]).catch(()=>server.kill());
}
