import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import type { Pool } from "pg";
import { buildApp } from "../src/application.js";
import type { AppConfig } from "../src/config.js";
import { decryptSecret, signAccessToken } from "../src/security.js";
import type { Role } from "../src/types.js";

const organizationId = randomUUID();
const foreignOrganizationId = randomUUID();
const config: AppConfig = {
  NODE_ENV: "test", HOST: "127.0.0.1", PORT: 4300, DATABASE_URL: "postgres://unused", DATABASE_SSL: false,
  JWT_SECRET: "google-maps-test-secret-at-least-thirty-two-bytes", JWT_ISSUER: "test",
  ACCESS_TOKEN_TTL_SECONDS: 900, REFRESH_TOKEN_TTL_DAYS: 30, CONFIG_ENCRYPTION_KEY: randomBytes(32),
  PUBLIC_BASE_URL: "http://127.0.0.1:4300", TRACEHUB_BASE_URL: "http://127.0.0.1:4173",
  STORAGE_DIR: "storage", ADMIN_ORIGIN: "http://127.0.0.1:4300",
};
const browserKey = "AIza" + "test-browser-key".repeat(3);

async function harness(t: test.TestContext) {
  let actorRole: Role = "org_admin";
  let canReadPlots = true;
  const rows = new Map<string, { enabled: boolean; api_key_ciphertext: string | null }>();
  const audits: string[] = [];
  const client = {
    async query(text: string, values: unknown[] = []) {
      if (text.includes("FROM users WHERE id")) return { rows: [{
        active: true, organization_active: true, token_version: 0,
        organization_id: actorRole === "system_admin" ? null : organizationId, role: actorRole,
        assigned_roles: [actorRole],
      }] };
      if (text.includes("FROM role_permissions")) return { rows: canReadPlots ? [] : [{
        role: actorRole, section: "plots", can_read: false, can_write: false,
      }] };
      if (text.startsWith("INSERT INTO organization_google_maps_config")) {
        if (!rows.has(String(values[0]))) rows.set(String(values[0]), { enabled: false, api_key_ciphertext: null });
      } else if (text.startsWith("SELECT enabled,api_key_ciphertext")) {
        const row = rows.get(String(values[0]));
        return { rows: row ? [row] : [] };
      } else if (text.startsWith("UPDATE organization_google_maps_config")) {
        const ciphertext = values[2];
        if (ciphertext !== null && typeof ciphertext !== "string") throw new Error("Unexpected test ciphertext");
        rows.set(String(values[0]), { enabled: Boolean(values[1]), api_key_ciphertext: ciphertext });
      } else if (text.includes("INSERT INTO audit_logs")) {
        audits.push(String(values[7]));
      } else if (!["BEGIN", "COMMIT", "ROLLBACK"].includes(text) && !text.includes("set_config")) {
        throw new Error("Unexpected test query");
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const app = await buildApp(config, pool);
  t.after(() => app.close());
  const request = async (role: Role | null, url: string, payload?: object) => {
    if (role) actorRole = role;
    const token = role ? await signAccessToken(config, {
      userId: "11111111-1111-4111-8111-111111111111",
      organizationId: role === "system_admin" ? null : organizationId, role, tokenVersion: 0,
    }) : null;
    return app.inject({
      method: payload ? "PUT" : "GET", url, ...(payload ? { payload } : {}),
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  };
  return { request, rows, audits, denyPlotRead: () => { canReadPlots = false; } };
}
const adminPath = `/api/v1/admin/organizations/${organizationId}/google-maps`;
const plotPath = "/api/v1/plots/google-maps-config";

test("Google Maps configuration encrypts, preserves, replaces and clears browser keys without exposing them in admin or audit", async (t) => {
  const { request, rows, audits } = await harness(t);
  const empty = await request("org_admin", adminPath);
  assert.deepEqual(empty.json().data, { enabled: false, hasApiKey: false });
  const saved = await request("org_admin", adminPath, { enabled: true, apiKey: browserKey });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().data, { enabled: true, hasApiKey: true });
  const ciphertext = rows.get(organizationId)!.api_key_ciphertext!;
  assert.notEqual(ciphertext, browserKey);
  assert.equal(decryptSecret(config.CONFIG_ENCRYPTION_KEY, ciphertext), browserKey);
  assert.ok(!saved.body.includes(browserKey));
  assert.ok(!audits.join().includes(browserKey));
  const admin = await request("org_admin", adminPath);
  assert.ok(!admin.body.includes(browserKey));
  await request("org_admin", adminPath, { enabled: false });
  assert.equal(rows.get(organizationId)!.api_key_ciphertext, ciphertext);
  const disabled = await request("reviewer", plotPath);
  assert.deepEqual(disabled.json().data, { enabled: false, apiKey: null });
  await request("org_admin", adminPath, { enabled: true, apiKey: browserKey + "-new" });
  const browser = await request("field_agent", plotPath);
  assert.equal(browser.statusCode, 200);
  assert.equal(browser.json().data.apiKey, browserKey + "-new");
  assert.match(String(browser.headers["cache-control"]), /no-store/);
  await request("org_admin", adminPath, { enabled: false, apiKey: null });
  assert.equal(rows.get(organizationId)!.api_key_ciphertext, null);
});

test("enabling or clearing an enabled configuration requires a key and rejects malformed input", async (t) => {
  const { request, rows } = await harness(t);
  const missing = await request("org_admin", adminPath, { enabled: true });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error.code, "GOOGLE_MAPS_KEY_REQUIRED");
  await request("org_admin", adminPath, { enabled: true, apiKey: browserKey });
  const clear = await request("org_admin", adminPath, { enabled: true, apiKey: null });
  assert.equal(clear.statusCode, 400);
  assert.equal(clear.json().error.code, "GOOGLE_MAPS_KEY_REQUIRED");
  assert.equal(rows.get(organizationId)!.enabled, true);
  for (const apiKey of ["short", "a".repeat(257), "a".repeat(30) + "<script>"]) {
    const invalid = await request("org_admin", adminPath, { enabled: true, apiKey });
    assert.equal(invalid.statusCode, 400);
  }
});

test("map settings require administration rights and browser keys require tenant-scoped plot read permission", async (t) => {
  const { request, denyPlotRead } = await harness(t);
  assert.equal((await request(null, plotPath)).statusCode, 401);
  assert.equal((await request(null, adminPath)).statusCode, 401);
  assert.equal((await request("reviewer", adminPath)).statusCode, 403);
  assert.equal((await request("reviewer", adminPath, { enabled: true, apiKey: browserKey })).statusCode, 403);
  const foreignPath = `/api/v1/admin/organizations/${foreignOrganizationId}/google-maps`;
  assert.equal((await request("org_admin", foreignPath, { enabled: true, apiKey: browserKey })).statusCode, 403);
  assert.equal((await request("field_agent", `${plotPath}?organizationId=${foreignOrganizationId}`)).statusCode, 403);
  assert.equal((await request("system_admin", foreignPath, { enabled: true, apiKey: browserKey })).statusCode, 200);
  const systemRead = await request("system_admin", `${plotPath}?organizationId=${foreignOrganizationId}`);
  assert.equal(systemRead.json().data.apiKey, browserKey);
  assert.deepEqual((await request("reviewer", plotPath)).json().data, { enabled: false, apiKey: null });
  denyPlotRead();
  assert.equal((await request("reviewer", plotPath)).statusCode, 403);
});
