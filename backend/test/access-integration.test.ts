import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import { buildApp } from "../src/application.js";
import type { AppConfig } from "../src/config.js";
import { withContext } from "../src/db.js";
import { defaultPermission, sections } from "../src/permissions.js";
import { hashPassword, signAccessToken, verifyPassword } from "../src/security.js";
import { createPasswordResetService } from "../src/services/password-reset-service.js";
import { createRoleManagementService, matrixSchema } from "../src/services/role-management-service.js";
import { createUserManagementService, createUserSchema, updateUserSchema } from "../src/services/user-management-service.js";
import { roles, type AuthContext } from "../src/types.js";
import { createRegistrationService, registrationSchema, registrationListSchema, registrationApprovalSchema } from "../src/services/registration-service.js";
import { createGoogleMapsService } from "../src/services/google-maps-service.js";

test("user lifecycle, role isolation and reset tokens work with real PostgreSQL", { skip: process.platform !== "win32", timeout: 300_000 }, async (t) => {
  const { initdb, postgres, pg_ctl } = await import("@embedded-postgres/windows-x64");
  const root = path.resolve(".test-runtime", randomUUID());
  const data = path.join(root, "database");
  const passwordFile = path.join(root, "password");
  const password = randomBytes(24).toString("hex");
  const run = (file: string, args: string[]) => new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(output)));
  });
  await mkdir(root, { recursive: true });
  await writeFile(passwordFile, password);
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  let started = false;
  let pool: pg.Pool | undefined;
  const db = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password, database: "postgres" });
  try {
    await run(initdb, ["-D", data, "-U", "postgres", "--pwfile=" + passwordFile, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"]);
    await unlink(passwordFile);
    spawn(postgres, ["-D", data, "-h", "127.0.0.1", "-p", String(port)], { windowsHide: true, stdio: "ignore" });
    started = true;
    for (let i = 0; ; i++) {
      const probe = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password, database: "postgres" });
      try { await probe.connect(); await probe.end(); break; }
      catch (error) { await probe.end(); if (i === 100) throw error; await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    await db.connect();
    await db.query(`
      CREATE TYPE user_role AS ENUM ('system_admin','org_admin','reviewer','field_agent','auditor');
      CREATE TABLE organizations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,slug text UNIQUE,active boolean DEFAULT true,
        created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid REFERENCES organizations(id),
        email text NOT NULL,display_name text,password_hash text,role user_role NOT NULL,active boolean DEFAULT true,
        token_version integer DEFAULT 0,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
        UNIQUE(organization_id,email),
        CHECK ((role='system_admin' AND organization_id IS NULL) OR
          (role<>'system_admin' AND organization_id IS NOT NULL)));
      CREATE TABLE refresh_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,revoked_at timestamptz);
      CREATE TABLE documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_by uuid,organization_id uuid,upload_expires_at timestamptz);
      CREATE TABLE audit_logs(organization_id uuid,actor_user_id uuid,action text,resource_type text,resource_id text,
        ip inet,user_agent text,details jsonb);
      ALTER TABLE users ENABLE ROW LEVEL SECURITY; ALTER TABLE users FORCE ROW LEVEL SECURITY;
      CREATE POLICY users_tenant ON users USING (current_setting('app.is_system_admin',true)='true'
        OR organization_id=NULLIF(current_setting('app.current_organization',true),'')::uuid);
      CREATE ROLE test_app LOGIN PASSWORD '${password}';
    `);
    const org = randomUUID(), foreignOrg = randomUUID(), adminId = randomUUID(), legacyId = randomUUID();
    await db.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Test','test'),($2,'Foreign','foreign')", [org, foreignOrg]);
    const passwordHash = await hashPassword("integration-test-password");
    await db.query(`INSERT INTO users(id,organization_id,email,display_name,password_hash,role)
      VALUES($1,$2,'admin@example.com','Admin',$3,'org_admin'),($4,$2,'legacy@example.com','Legacy',$3,'auditor')`,
    [adminId, org, passwordHash, legacyId]);
    for (const migration of ["010_user_permissions.sql", "011_password_reset.sql", "012_mobile_registration.sql"]) {
      await db.query(await readFile(new URL("../migrations/" + migration, import.meta.url), "utf8"));
    }
    await db.query("GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO test_app; GRANT USAGE ON SCHEMA public TO test_app");
    pool = new pg.Pool({ host: "127.0.0.1", port, user: "test_app", password, database: "postgres", max: 5, statement_timeout: 10_000 });
    const admin: AuthContext = { userId: adminId, organizationId: org, role: "org_admin", tokenVersion: 0 };
    const system: AuthContext = { userId: adminId, organizationId: null, role: "system_admin", tokenVersion: 0 };
    const audit = { ip: "127.0.0.1", headers: {} };
    const users = createUserManagementService(pool);
    const management = createRoleManagementService(pool);
    const config: AppConfig = {
      NODE_ENV: "test", HOST: "127.0.0.1", PORT: port, DATABASE_URL: "postgres://unused", DATABASE_SSL: false,
      JWT_SECRET: "integration-test-secret-at-least-thirty-two-bytes", JWT_ISSUER: "test", ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 30, CONFIG_ENCRYPTION_KEY: randomBytes(32), PUBLIC_BASE_URL: "http://127.0.0.1",
      TRACEHUB_BASE_URL: "http://127.0.0.1", STORAGE_DIR: root, ADMIN_ORIGIN: "http://127.0.0.1",
      RESEND_API_KEY: "test-key", INVITATION_FROM_EMAIL: "test@example.com",
    };
    const app = await buildApp(config, pool);
    t.after(() => app.close());
    const request = async (auth: AuthContext, url: string) => app.inject({
      method: "GET", url, headers: { authorization: `Bearer ${await signAccessToken(config, auth)}` },
    });
    let managedId = "";
    await t.test("Google Maps migration and encrypted settings preserve tenant isolation in PostgreSQL", async () => {
      await db.query(`
        CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
        CREATE FUNCTION app_system_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
          SELECT current_setting('app.is_system_admin',true)='true' $$;
        CREATE FUNCTION app_organization_id() RETURNS uuid LANGUAGE sql STABLE AS $$
          SELECT NULLIF(current_setting('app.current_organization',true),'')::uuid $$;
      `);
      const migration = await readFile(new URL("../migrations/015_google_maps_config.sql", import.meta.url), "utf8");
      await db.query(migration);
      await db.query(migration);
      await db.query("GRANT SELECT,INSERT,UPDATE,DELETE ON organization_google_maps_config TO test_app");
      const maps = createGoogleMapsService(pool!, config);
      const key = "test-google-browser-key-for-isolated-integration";
      await maps.save(system, foreignOrg, { enabled: true, apiKey: key }, audit);
      assert.deepEqual(await maps.browserConfig(admin, foreignOrg), { enabled: false, apiKey: null });
      await assert.rejects(maps.save(admin, foreignOrg, { enabled: false }, audit),
        (error: { code?: string }) => error.code === "42501");
      await maps.save(admin, org, { enabled: true, apiKey: key }, audit);
      const stored = await db.query("SELECT api_key_ciphertext FROM organization_google_maps_config WHERE organization_id=$1", [org]);
      assert.notEqual(stored.rows[0].api_key_ciphertext, key);
      assert.deepEqual(await maps.browserConfig(admin, org), { enabled: true, apiKey: key });
      await maps.save(admin, org, { enabled: false, apiKey: null }, audit);
      assert.deepEqual(await maps.adminConfig(admin, org), { enabled: false, hasApiKey: false });
      await assert.rejects(db.query(
        "UPDATE organization_google_maps_config SET enabled=true WHERE organization_id=$1", [org]),
      (error: { code?: string }) => error.code === "23514");
    });

    await t.test("comparison migration defaults off and administration persists activation without opening tenant access", async () => {
      await db.query(`
        CREATE TABLE organization_api_config (
          organization_id uuid PRIMARY KEY REFERENCES organizations(id), satellite_enabled boolean DEFAULT false,
          satellite_endpoint text, satellite_api_key_ciphertext text, evidence_pack_enabled boolean DEFAULT false,
          eu_mode text DEFAULT 'mock', eu_endpoint text, eu_timeout_ms integer DEFAULT 15000,
          eu_username_ciphertext text, eu_password_ciphertext text, eu_client_id_ciphertext text,
          extra_config jsonb DEFAULT '{}', updated_at timestamptz DEFAULT now()
        );
        ALTER TABLE organization_api_config ENABLE ROW LEVEL SECURITY;
        ALTER TABLE organization_api_config FORCE ROW LEVEL SECURITY;
        CREATE POLICY api_config_tenant ON organization_api_config
          USING (app_system_admin() OR organization_id=app_organization_id())
          WITH CHECK (app_system_admin() OR organization_id=app_organization_id());
        GRANT SELECT,INSERT,UPDATE,DELETE ON organization_api_config TO test_app;
      `);
      const migration = await readFile(new URL("../migrations/016_satellite_comparison.sql", import.meta.url), "utf8");
      await db.query(migration);
      await db.query(migration);
      await db.query("INSERT INTO organization_api_config(organization_id) VALUES($1),($2)", [org, foreignOrg]);
      const browserPath = "/api/v1/plots/map-comparison-config";
      const initial = await request(admin, browserPath);
      assert.deepEqual(initial.json().data, { enabled: false });
      assert.match(String(initial.headers["cache-control"]), /no-store/);
      const token = await signAccessToken(config, admin);
      const save = async (organizationId: string, enabled?: boolean) => app.inject({
        method: "PUT", url: `/api/v1/admin/organizations/${organizationId}/config`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          satelliteEnabled: true, evidencePackEnabled: false,
          ...(enabled === undefined ? {} : { satelliteComparisonEnabled: enabled }),
          eu: { mode: "mock", endpoint: null, timeoutMs: 15000 },
        },
      });
      assert.equal((await save(org, true)).json().data.satelliteComparisonEnabled, true);
      assert.deepEqual((await request(admin, browserPath)).json().data, { enabled: true });
      assert.equal((await save(org)).json().data.satelliteComparisonEnabled, true);
      assert.equal((await save(foreignOrg, true)).statusCode, 403);
      assert.equal((await request(admin, `${browserPath}?organizationId=${foreignOrg}`)).statusCode, 403);
      assert.equal((await save(org, false)).statusCode, 200);
      const disabled = await request(admin, "/api/v1/plots/satellite-background?bbox=36,7,36.01,7.01&comparison=baseline");
      assert.equal(disabled.statusCode, 403);
    });

    await t.test("migration backfills legacy accounts; CRUD keeps tenant isolation and multi-role guards", async () => {
      assert.deepEqual((await db.query("SELECT assigned_roles::text[] AS assigned_roles FROM users WHERE id=$1", [legacyId])).rows[0].assigned_roles, ["auditor"]);
      const created = await users.create(admin, audit, org, createUserSchema.parse({
        email: "Worker@example.com", displayName: "Worker", password: "integration-test-password", roles: ["field_agent", "reviewer"],
      }));
      assert.ok(created);
      managedId = String(created.id);
      assert.deepEqual(created.roles, ["reviewer", "field_agent"]);
      assert.equal(created.role, "reviewer");
      assert.equal("password_hash" in created, false);
      assert.equal((await users.list(admin, foreignOrg)).length, 0);
      await assert.rejects(users.update(admin, audit, foreignOrg, managedId, updateUserSchema.parse({ active: false })), /not found/i);
      assert.equal((await request(admin, "/api/v1/admin/users?organizationId=" + foreignOrg)).statusCode, 403);
      const worker: AuthContext = { userId: managedId, organizationId: org, role: "reviewer", tokenVersion: 0 };
      assert.equal((await request(worker, "/api/v1/admin/users")).statusCode, 403);
      await assert.rejects(users.update(admin, audit, org, adminId, { active: false }), /own access/);
      await assert.rejects(users.update(admin, audit, org, adminId, { roles: ["auditor"] }), /own access/);
    });
    await t.test("system role assignment is exclusive, privileged and revokes previous sessions", async () => {
      const input = { email: "system-manager@example.com", displayName: "System manager",
        password: "integration-test-password", roles: ["system_admin"] as const };
      const body = createUserSchema.parse(input);
      await assert.rejects(users.create(admin, audit, org, body), /Only system administrators/);
      const denied = await app.inject({ method: "POST", url: "/api/v1/admin/users",
        headers: { authorization: `Bearer ${await signAccessToken(config, admin)}` }, payload: input });
      assert.equal(denied.statusCode, 403);
      const privileged = await users.create(system, audit, org, body);
      assert.ok(privileged);
      assert.deepEqual(privileged.roles, ["system_admin"]);
      assert.equal(privileged.organizationId, null);
      const actor: AuthContext = { userId: String(privileged.id), organizationId: null,
        role: "system_admin", tokenVersion: 0 };
      const candidate = await users.create(admin, audit, org, createUserSchema.parse({
        email: "promoted@example.com", displayName: "Candidate", password: "integration-test-password", roles: ["auditor"],
      }));
      assert.ok(candidate);
      const id = String(candidate.id);
      await db.query("INSERT INTO refresh_tokens(user_id) VALUES($1)", [id]);
      await assert.rejects(users.update(admin, audit, org, id, { roles: ["system_admin"] }), /Only system administrators/);
      const deniedPromotion = await app.inject({ method: "PATCH", url: "/api/v1/admin/users/" + id,
        headers: { authorization: `Bearer ${await signAccessToken(config, admin)}` },
        payload: { roles: ["system_admin"] } });
      assert.equal(deniedPromotion.statusCode, 403);
      const mixed = await app.inject({ method: "PATCH", url: "/api/v1/admin/users/" + id + "?organizationId=" + org,
        headers: { authorization: `Bearer ${await signAccessToken(config, actor)}` },
        payload: { roles: ["system_admin", "auditor"] } });
      assert.equal(mixed.statusCode, 400);
      await assert.rejects(users.update(actor, audit, org, adminId, { roles: ["system_admin"] }), /last active organization administrator/i);
      const promote = await app.inject({ method: "PATCH", url: "/api/v1/admin/users/" + id + "?organizationId=" + org,
        headers: { authorization: `Bearer ${await signAccessToken(config, actor)}` },
        payload: { roles: ["system_admin"] } });
      assert.equal(promote.statusCode, 200, promote.body);
      assert.deepEqual(promote.json().data.roles, ["system_admin"]);
      assert.equal(promote.json().data.organizationId, null);
      assert.equal((await users.list(admin, org)).some((user) => user.id === id), false);
      assert.equal((await db.query("SELECT token_version FROM users WHERE id=$1", [id])).rows[0].token_version, 1);
      assert.ok((await db.query("SELECT revoked_at FROM refresh_tokens WHERE user_id=$1", [id])).rows[0].revoked_at);
      const oldAuth: AuthContext = { userId: id, organizationId: org, role: "auditor", tokenVersion: 0 };
      assert.equal((await request(oldAuth, "/api/v1/auth/me")).statusCode, 401);
      const promotedAuth: AuthContext = { ...oldAuth, organizationId: null, role: "system_admin", tokenVersion: 1 };
      assert.equal((await request(promotedAuth, "/api/v1/admin/users?organizationId=" + foreignOrg)).statusCode, 200);
      for (const auth of [admin, actor]) {
        await assert.rejects(users.update(auth, audit, org, id, { active: false }), /not found/i);
        await assert.rejects(users.update(auth, audit, org, id, { roles: ["auditor"] }), /not found/i);
        await assert.rejects(users.update(auth, audit, org, id, {}, true), /not found/i);
      }
      await assert.rejects(users.update(actor, audit, org, actor.userId, { roles: ["auditor"] }), /own access/);
      const registration = await db.query(`INSERT INTO mobile_registrations(display_name,email,phone_country,phone_number,
        status,organization_id,assigned_roles,user_id) VALUES('Candidate','promoted@example.com','DE','+4915112345678',
        'active',$1,ARRAY['auditor'::user_role],$2) RETURNING id`, [org, id]);
      const registrations = createRegistrationService(pool!, config);
      await assert.rejects(registrations.deactivate(actor, audit, registration.rows[0].id), /protected/);
      assert.equal((await db.query("SELECT active FROM users WHERE id=$1", [id])).rows[0].active, true);
    });
    await t.test("permission matrices are tenant isolated and effective on the next authenticated request", async () => {
      const matrix = await management.get(admin, org);
      const permissions = matrix.permissions.filter((row) => row.role !== "system_admin").map(({ role, section }) => ({
        role, section, ...defaultPermission(role, section),
        ...(["reviewer", "field_agent"].includes(role) && section === "plots" ? { read: false, write: false } : {}),
      }));
      await management.save(admin, audit, org, matrixSchema.parse({ permissions }));
      const worker: AuthContext = { userId: managedId, organizationId: org, role: "reviewer", tokenVersion: 0 };
      assert.equal((await request(worker, "/api/v1/plots")).statusCode, 403);
      assert.equal((await withContext(pool!, admin, (client) => client.query("SELECT * FROM role_permissions WHERE organization_id=$1", [foreignOrg]))).rowCount, 0);
      assert.deepEqual((await management.get(system, foreignOrg)).permissions.find((row) => row.role === "reviewer" && row.section === "plots")?.read, true);
      const restored = permissions.map((row) => row.role === "field_agent" && row.section === "plots" ? { ...row, read: true } : row);
      await management.save(admin, audit, org, matrixSchema.parse({ permissions: restored }));
      const me = await request(worker, "/api/v1/auth/me");
      assert.equal(me.statusCode, 200);
      assert.deepEqual(me.json().data.permissions.plots, { read: true, write: false });
      assert.deepEqual(me.json().data.roles, ["reviewer", "field_agent"]);
      assert.equal((await withContext(pool!, admin, (client) => client.query("SELECT * FROM password_reset_tokens"))).rowCount, 0);
    });
    await t.test("name edits retain sessions; deactivation, reactivation and deletion revoke old access", async () => {
      await db.query("INSERT INTO refresh_tokens(user_id) VALUES($1)", [managedId]);
      await db.query("INSERT INTO documents(created_by,organization_id,upload_expires_at) VALUES($1,$2,now()+interval '1 day')", [managedId, org]);
      await users.update(admin, audit, org, managedId, { displayName: "Renamed" });
      assert.equal((await db.query("SELECT token_version FROM users WHERE id=$1", [managedId])).rows[0].token_version, 0);
      assert.equal((await db.query("SELECT revoked_at FROM refresh_tokens WHERE user_id=$1", [managedId])).rows[0].revoked_at, null);
      const worker: AuthContext = { userId: managedId, organizationId: org, role: "reviewer", tokenVersion: 0 };
      await users.update(admin, audit, org, managedId, { active: false });
      assert.equal((await request(worker, "/api/v1/auth/me")).statusCode, 401);
      assert.ok((await db.query("SELECT revoked_at FROM refresh_tokens WHERE user_id=$1", [managedId])).rows[0].revoked_at);
      assert.equal((await db.query("SELECT upload_expires_at <= now() AS expired FROM documents WHERE created_by=$1", [managedId])).rows[0].expired, true);
      await users.update(admin, audit, org, managedId, { active: true });
      assert.equal((await request(worker, "/api/v1/auth/me")).statusCode, 401);
      await users.update(admin, audit, org, managedId, {}, true);
      assert.equal((await users.list(admin, org)).some((row) => row.id === managedId), false);
      assert.equal((await db.query("SELECT deleted_at IS NOT NULL AS deleted FROM users WHERE id=$1", [managedId])).rows[0].deleted, true);
    });
    await t.test("concurrent administrator removals cannot delete the last active administrator", async () => {
      const second = await users.create(admin, audit, org, createUserSchema.parse({
        email: "second@example.com", displayName: "Second", password: "integration-test-password", roles: ["org_admin"],
      }));
      assert.ok(second);
      const result = await Promise.allSettled([
        users.update(system, audit, org, adminId, { active: false }),
        users.update(system, audit, org, String(second.id), { active: false }),
      ]);
      assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal((await db.query("SELECT count(*)::int AS count FROM users WHERE organization_id=$1 AND active AND 'org_admin'=ANY(assigned_roles)", [org])).rows[0].count, 1);
    });
    await t.test("reset tokens expire, are single-use under concurrency and are invalidated by account changes", async () => {
      const originalFetch = globalThis.fetch;
      let token = "";
      globalThis.fetch = async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        const url = new URL(body.text.split("\n")[0].replace("Use this link to reset your password: ", ""));
        assert.equal(url.pathname, "/index-prod.html");
        token = new URLSearchParams(url.hash.slice("#reset-password?".length)).get("token")!;
        return new Response(null, { status: 200 });
      };
      try {
        const reset = createPasswordResetService(pool!, config);
        await reset.requestReset("legacy@example.com", "test");
        await db.query("UPDATE password_reset_tokens SET expires_at=now()-interval '1 second'");
        await assert.rejects(reset.resetPassword(token, "changed-test-password"), /invalid or expired/);
        await reset.requestReset("legacy@example.com", "test");
        await users.update(system, audit, org, legacyId, { email: "updated@example.com" });
        await assert.rejects(reset.resetPassword(token, "changed-test-password"), /invalid or expired/);
        await reset.requestReset("updated@example.com", "test");
        const result = await Promise.allSettled([
          reset.resetPassword(token, "changed-test-password"),
          reset.resetPassword(token, "changed-test-password"),
        ]);
        assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
        assert.equal(await verifyPassword((await db.query("SELECT password_hash FROM users WHERE id=$1", [legacyId])).rows[0].password_hash, "changed-test-password"), true);
        await assert.rejects(reset.resetPassword(token, "another-test-password"), /invalid or expired/);
      } finally { globalThis.fetch = originalFetch; }
    });
    await t.test("mobile registrations require approval and a single-use password activation, with revocation and RLS", async () => {
      const originalFetch = globalThis.fetch;
      const registration = createRegistrationService(pool!, config);
      let token = "";
      let rejectMail = false;
      globalThis.fetch = async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        const url = new URL(body.text.split("\n").find((line: string) => line.startsWith("http")));
        assert.equal(url.pathname, "/mobile-activate.html");
        token = new URLSearchParams(url.hash.slice(1)).get("token")!;
        return new Response(null, { status: rejectMail ? 403 : 200 });
      };
      try {
        const input = registrationSchema.parse({
          displayName: "Mobile Person", email: "MOBILE@example.com", phoneCountry: "DE", phoneNumber: "01512 3456789",
        });
        assert.equal(input.phoneNumber, "+4915123456789");
        await registration.register(input);
        const duplicate = await registration.register({ ...input, displayName: "Do not replace" });
        assert.match(duplicate.message, /reviewed/);
        const listing = await registration.list(system, registrationListSchema.parse({ search: "mobile@" }));
        assert.equal(listing.total, 1);
        const id = String(listing.items[0]!.id);
        assert.equal(listing.items[0]!.displayName, "Mobile Person");
        assert.equal((await db.query("SELECT count(*)::int AS n FROM users WHERE email=$1", [input.email])).rows[0].n, 0);
        assert.equal((await withContext(pool!, admin, (client) => client.query("SELECT * FROM mobile_registrations"))).rowCount, 0);
        assert.equal((await app.inject({ method: "GET", url: "/api/v1/admin/registrations" })).statusCode, 401);
        const adminRequest = await request(admin, "/api/v1/admin/registrations");
        assert.equal(adminRequest.statusCode, 403);
        assert.equal((await app.inject({ method: "POST", url: "/api/v1/auth/registrations",
          payload: { ...input, roles: ["system_admin"] } })).statusCode, 400);
        await assert.rejects(registration.activate("x".repeat(43), "registration-password", audit), /invalid or expired/);
        await registration.approve(system, audit, id, { organizationId: org, roles: ["field_agent"] });
        assert.equal((await db.query("SELECT count(*)::int AS n FROM users WHERE email=$1", [input.email])).rows[0].n, 0);
        const firstToken = token;
        await registration.resend(system, audit, id);
        assert.notEqual(token, firstToken);
        await assert.rejects(registration.activate(firstToken, "registration-password", audit), /invalid or expired/);
        assert.equal("activation_token_hash" in await registration.get(system, id), false);
        await db.query("UPDATE mobile_registrations SET activation_expires_at=now()-interval '1 second' WHERE id=$1", [id]);
        await assert.rejects(registration.activate(token, "registration-password", audit), /invalid or expired/);
        await registration.resend(system, audit, id);
        const activated = await Promise.allSettled([
          registration.activate(token, "registration-password", audit),
          registration.activate(token, "registration-password", audit),
        ]);
        assert.equal(activated.filter((value) => value.status === "fulfilled").length, 1);
        const saved = (await db.query("SELECT * FROM users WHERE email=$1", [input.email])).rows[0];
        assert.equal(saved.active, true);
        assert.equal(saved.phone_number, input.phoneNumber);
        assert.equal(await verifyPassword(saved.password_hash, "registration-password"), true);
        assert.equal((await registration.get(system, id)).status, "active");
        await db.query("INSERT INTO refresh_tokens(id,user_id) VALUES($1,$2)", [randomUUID(), saved.id]);
        await db.query("INSERT INTO documents(created_by,organization_id,upload_expires_at) VALUES($1,$2,now()+interval '1 hour')", [saved.id, org]);
        await registration.deactivate(system, audit, id);
        assert.equal((await db.query("SELECT active FROM users WHERE id=$1", [saved.id])).rows[0].active, false);
        assert.ok((await db.query("SELECT revoked_at FROM refresh_tokens WHERE user_id=$1", [saved.id])).rows[0].revoked_at);
        assert.equal((await registration.get(system, id)).status, "disabled");
        await assert.rejects(registration.approve(system, audit, id, { organizationId: org, roles: ["auditor"] }), /preserves existing roles/);
        await db.query("UPDATE organizations SET active=false WHERE id=$1", [org]);
        await assert.rejects(registration.approve(system, audit, id, { organizationId: org, roles: ["field_agent"] }), /active organization/);
        await db.query("UPDATE organizations SET active=true WHERE id=$1", [org]);
        await registration.approve(system, audit, id, { organizationId: org, roles: ["field_agent"] });
        assert.equal((await registration.get(system, id)).status, "active");
        await users.update(system, audit, org, saved.id, { active: false }, true);
        await assert.rejects(registration.approve(system, audit, id, { organizationId: org, roles: ["field_agent"] }), /Deleted accounts/);

        await registration.register({ ...input, email: "mail-failure@example.com" });
        const pending = await registration.list(system, registrationListSchema.parse({ search: "mail-failure@" }));
        const failedId = String(pending.items[0]!.id);
        rejectMail = true;
        await assert.rejects(registration.approve(system, audit, failedId, { organizationId: org, roles: ["auditor"] }), { code: "MAIL_UNAVAILABLE" });
        assert.equal((await registration.get(system, failedId)).deliveryStatus, "failed");
        await assert.rejects(registration.activate(token, "registration-password", audit), /invalid or expired/);
        rejectMail = false;
        await registration.resend(system, audit, failedId);
        await registration.deactivate(system, audit, failedId);
        await assert.rejects(registration.activate(token, "registration-password", audit), /invalid or expired/);
        assert.equal(registrationApprovalSchema.safeParse({ organizationId: org, roles: ["system_admin"] }).success, false);
      } finally { globalThis.fetch = originalFetch; }
    });
    await app.close();
  } finally {
    await pool?.end();
    await db.end();
    if (started) await run(pg_ctl, ["-D", data, "-m", "fast", "-w", "stop"]);
    await rm(root, { recursive: true, force: true });
  }
});
