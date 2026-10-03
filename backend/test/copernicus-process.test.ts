import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { Pool, PoolClient, QueryResult } from "pg";
import { buildApp } from "../src/application.js";
import type { AppConfig } from "../src/config.js";
import {
  buildEvalscript,
  buildProcessRequest,
  clearTokenCache,
  createProcessClient,
  outputSize,
  ProcessApiError,
} from "../src/copernicus/process-client.js";
import {
  defaultProcessSettings,
  isAllowedHost,
  processSettingsSchema,
} from "../src/copernicus/process-settings.js";
import { decryptSecret, encryptSecret, signAccessToken } from "../src/security.js";
import { createCopernicusService } from "../src/services/copernicus-service.js";
import { createOperationService } from "../src/services/operation-service.js";
import type { Role } from "../src/types.js";

const organizationId = "b23815e3-8701-41bc-b0a4-168f07521dd5";
const otherOrganizationId = "db72b4e9-436e-498b-b6ef-670909e65b2f";
const userId = "c2314a55-b213-4dce-8754-f144cd93848a";
const plotId = "37b69e74-9033-44eb-a833-cb0f8bb3fe94";
const operationId = "11111111-1111-4111-8111-111111111111";
const polygon = { type: "Polygon" as const, coordinates: [[[14, 46], [14.2, 46], [14.2, 46.1], [14, 46.1], [14, 46]]] };
const png = Buffer.from("89504e470d0a1a0a", "hex");

const baseConfig = (storageDir = "storage"): AppConfig => ({
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 4300,
  DATABASE_URL: "postgres://unused",
  DATABASE_SSL: false,
  JWT_SECRET: "a-secret-that-is-at-least-thirty-two-bytes-long",
  JWT_ISSUER: "test",
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_DAYS: 30,
  CONFIG_ENCRYPTION_KEY: randomBytes(32),
  PUBLIC_BASE_URL: "http://127.0.0.1:4300",
  TRACEHUB_BASE_URL: "http://127.0.0.1:4173",
  STORAGE_DIR: storageDir,
  ADMIN_ORIGIN: "http://127.0.0.1:4300",
});

const credentials = { clientId: "client-1", clientSecret: "secret-1" };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

test("settings default to a Sentinel-2 true colour request against Copernicus Data Space", () => {
  const settings = defaultProcessSettings();
  assert.equal(settings.baseUrl, "https://sh.dataspace.copernicus.eu");
  assert.equal(settings.dataset, "sentinel-2-l2a");
  assert.equal(settings.preset, "true_color");
  assert.equal(settings.output.width, 512);
  assert.equal(settings.s2.harmonizeValues, true);
  assert.equal(settings.s1.speckleFilter.type, "NONE");
});

test("only https hosts of Copernicus Data Space and Sentinel Hub are accepted", () => {
  assert.ok(isAllowedHost("https://sh.dataspace.copernicus.eu"));
  assert.ok(isAllowedHost("https://services.sentinel-hub.com/oauth/token"));
  for (const bad of [
    "http://sh.dataspace.copernicus.eu",
    "https://evil.example.com",
    "https://dataspace.copernicus.eu.evil.example",
    "https://user:pw@sh.dataspace.copernicus.eu",
    "https://sh.dataspace.copernicus.eu:8443",
    "https://127.0.0.1",
    "not a url",
  ]) {
    assert.equal(isAllowedHost(bad), false, bad);
    assert.equal(processSettingsSchema.safeParse({ baseUrl: bad }).success, false, bad);
  }
});

test("settings reject incompatible dataset, preset and filter combinations", () => {
  const rejected = [
    { preset: "sar_vv" },
    { dataset: "sentinel-1-grd", preset: "ndvi" },
    { dataset: "sentinel-1-grd", preset: "sar_vv", s1Filter: { polarization: "HH" } },
    { dataset: "sentinel-1-grd", preset: "sar_vv", mosaickingOrder: "leastCC" },
    { preset: "custom" },
    { preset: "custom", evalscript: "function setup() {}" },
    { output: { width: 2501 } },
    { s1: { radiometricTerrainOversampling: 5 } },
    { s1: { speckleFilter: { type: "LEE", windowSizeX: 8, windowSizeY: 3 } } },
    { maxPlotsPerRun: 21 },
  ];
  for (const value of rejected) {
    assert.equal(processSettingsSchema.safeParse(value).success, false, JSON.stringify(value));
  }
  assert.ok(processSettingsSchema.safeParse({ preset: "custom", evalscript: "//VERSION=3\nfunction setup(){}" }).success);
  assert.ok(processSettingsSchema.safeParse({
    dataset: "sentinel-1-grd", preset: "sar_vv",
    s1: { speckleFilter: { type: "LEE", windowSizeX: 5, windowSizeY: 5 }, orthorectify: true, backCoeff: "GAMMA0_TERRAIN" },
  }).success);
});

test("output size keeps the plot aspect ratio and the longest side", () => {
  assert.deepEqual(outputSize([0, 0, 2, 1], 512), { width: 512, height: 256 });
  assert.deepEqual(outputSize([0, 0, 1, 2], 512), { width: 256, height: 512 });
  const wide = outputSize([14, 46, 14.2, 46.1], 512);
  assert.equal(wide.width, 512);
  assert.ok(wide.height > 300 && wide.height < 400);
  assert.deepEqual(outputSize([5, 5, 5, 6], 300), { width: 1, height: 300 });
});

test("a Sentinel-2 request follows the Process API schema", () => {
  const settings = processSettingsSchema.parse({ maxCloudCoverage: 20, lookbackDays: 10 });
  const now = new Date("2026-10-01T12:00:00.000Z");
  const request = buildProcessRequest(settings, polygon, now);
  assert.deepEqual(request.input.bounds.bbox, [14, 46, 14.2, 46.1]);
  assert.equal(request.input.bounds.geometry.type, "Polygon");
  assert.equal(request.input.bounds.properties.crs, "http://www.opengis.net/def/crs/OGC/1.3/CRS84");
  const [data] = request.input.data;
  assert.equal(data!.type, "sentinel-2-l2a");
  assert.deepEqual(data!.dataFilter, {
    timeRange: { from: "2026-09-21T12:00:00.000Z", to: "2026-10-01T12:00:00.000Z" },
    mosaickingOrder: "mostRecent",
    maxCloudCoverage: 20,
  });
  assert.deepEqual(data!.processing, { harmonizeValues: true, upsampling: "NEAREST", downsampling: "NEAREST" });
  assert.equal(request.output.width, 512);
  assert.ok(request.output.height >= 1 && request.output.height <= 2500);
  assert.deepEqual(request.output.responses, [{ identifier: "default", format: { type: "image/png" } }]);
  assert.match(request.evalscript, /^\/\/VERSION=3/);
  assert.match(request.evalscript, /bands: 4/);
  assert.match(request.evalscript, /dataMask/);
});

test("JPEG output drops the alpha band and sets the quality", () => {
  const settings = processSettingsSchema.parse({ output: { format: "image/jpeg", jpegQuality: 70 } });
  const request = buildProcessRequest(settings, polygon);
  assert.deepEqual(request.output.responses[0]!.format, { type: "image/jpeg", quality: 70 });
  assert.match(request.evalscript, /bands: 3/);
  assert.doesNotMatch(buildEvalscript(settings), /sample\.dataMask\]/);
});

test("a Sentinel-1 request carries filters and processing options, DEM options only when orthorectified", () => {
  const settings = processSettingsSchema.parse({
    dataset: "sentinel-1-grd", preset: "sar_vv", mosaickingOrder: "leastRecent",
    s1Filter: { acquisitionMode: "IW", polarization: "DV", orbitDirection: "ASCENDING", resolution: "HIGH" },
    s1: { speckleFilter: { type: "LEE", windowSizeX: 5, windowSizeY: 5 }, backCoeff: "SIGMA0_ELLIPSOID" },
  });
  const [data] = buildProcessRequest(settings, polygon).input.data;
  assert.equal(data!.type, "sentinel-1-grd");
  assert.deepEqual(data!.dataFilter, {
    timeRange: (data!.dataFilter as { timeRange: unknown }).timeRange,
    mosaickingOrder: "leastRecent",
    acquisitionMode: "IW", polarization: "DV", orbitDirection: "ASCENDING", resolution: "HIGH",
  });
  assert.deepEqual(data!.processing, {
    speckleFilter: { type: "LEE", windowSizeX: 5, windowSizeY: 5 },
    backCoeff: "SIGMA0_ELLIPSOID", orthorectify: false, upsampling: "NEAREST", downsampling: "NEAREST",
  });
  const terrain = processSettingsSchema.parse({
    dataset: "sentinel-1-grd", preset: "sar_vv", s1: { orthorectify: true, demInstance: "COPERNICUS_30", radiometricTerrainOversampling: 3 },
  });
  const processing = buildProcessRequest(terrain, polygon).input.data[0]!.processing as Record<string, unknown>;
  assert.equal(processing.demInstance, "COPERNICUS_30");
  assert.equal(processing.radiometricTerrainOversampling, 3);
});

test("a custom evalscript is sent unchanged", () => {
  const evalscript = "//VERSION=3\nfunction setup(){return {input:['B08'],output:{bands:1}}}\nfunction evaluatePixel(s){return [s.B08]}";
  const settings = processSettingsSchema.parse({ preset: "custom", evalscript });
  assert.equal(buildProcessRequest(settings, polygon).evalscript, evalscript);
});

test("the client fetches a token once, reuses it and sends the Process API request", async () => {
  clearTokenCache();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = createProcessClient({
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return String(url).includes("identity.")
        ? json({ access_token: "tok-1", expires_in: 600 })
        : new Response(png, { status: 200, headers: { "Content-Type": "image/png" } });
    }) as typeof fetch,
  });
  const settings = defaultProcessSettings();
  const body = buildProcessRequest(settings, polygon);
  const first = await client.process(settings, credentials, body);
  await client.process(settings, credentials, body);
  assert.equal(first.contentType, "image/png");
  assert.ok(first.bytes.equals(png));
  const tokenCalls = calls.filter((call) => call.url.includes("identity."));
  assert.equal(tokenCalls.length, 1);
  const form = new URLSearchParams(String(tokenCalls[0]!.init.body));
  assert.equal(form.get("grant_type"), "client_credentials");
  assert.equal(form.get("client_id"), "client-1");
  const processCall = calls.find((call) => call.url.endsWith("/process/v1"))!;
  assert.equal(processCall.url, "https://sh.dataspace.copernicus.eu/process/v1");
  const headers = processCall.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer tok-1");
  assert.equal(headers.Accept, "image/png");
  assert.equal(processCall.init.redirect, "error");
  assert.equal(JSON.parse(String(processCall.init.body)).input.data[0].type, "sentinel-2-l2a");
});

test("an expired token is refreshed and a 401 triggers one retry with a new token", async () => {
  clearTokenCache();
  let clock = 1_000_000;
  let tokens = 0;
  let unauthorizedOnce = true;
  const client = createProcessClient({
    now: () => clock,
    fetch: (async (url: string) => {
      if (String(url).includes("identity.")) {
        tokens += 1;
        return json({ access_token: `tok-${tokens}`, expires_in: 100 });
      }
      if (unauthorizedOnce) {
        unauthorizedOnce = false;
        return json({ error: { message: "expired" } }, 401);
      }
      return new Response(png, { status: 200, headers: { "Content-Type": "image/png" } });
    }) as typeof fetch,
  });
  const settings = defaultProcessSettings();
  await client.process(settings, credentials, buildProcessRequest(settings, polygon));
  assert.equal(tokens, 2);
  clock += 200_000;
  await client.getToken(settings, credentials);
  assert.equal(tokens, 3);
});

test("failures are reported without leaking credentials", async () => {
  clearTokenCache();
  const settings = defaultProcessSettings();
  const failingToken = createProcessClient({
    fetch: (async () => json({ error_description: "Invalid client credentials" }, 401)) as typeof fetch,
  });
  await assert.rejects(
    failingToken.getToken(settings, credentials),
    (error: unknown) => error instanceof ProcessApiError && error.stage === "token"
      && /Invalid client credentials/.test(error.message) && !error.message.includes("secret-1"),
  );
  clearTokenCache();
  const failingProcess = createProcessClient({
    fetch: (async (url: string) => String(url).includes("identity.")
      ? json({ access_token: "tok", expires_in: 300 })
      : json({ error: { status: 400, message: "Invalid evalscript" } }, 400)) as typeof fetch,
  });
  await assert.rejects(
    failingProcess.process(settings, credentials, buildProcessRequest(settings, polygon)),
    (error: unknown) => error instanceof ProcessApiError && error.stage === "process" && error.status === 400
      && /Invalid evalscript/.test(error.message),
  );
  const unreachable = createProcessClient({ fetch: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
  clearTokenCache();
  await assert.rejects(unreachable.getToken(settings, credentials), /could not be sent/);
});

test("the client refuses hosts outside Copernicus even if a stored setting is tampered with", async () => {
  clearTokenCache();
  let called = false;
  const client = createProcessClient({ fetch: (async () => { called = true; return json({}); }) as typeof fetch });
  const settings = { ...defaultProcessSettings(), tokenUrl: "https://attacker.example/token" };
  await assert.rejects(client.getToken(settings, credentials), /not an allowed Copernicus host/);
  assert.equal(called, false);
});

/* ---------- admin routes ---------- */

type Call = { text: string; values: unknown[] };

function adminPool(role: Role, calls: Call[], stored: { row: Record<string, unknown> | null }, satelliteEnabled = true): Pool {
  const client = {
    async query(text: string, values: unknown[] = []): Promise<QueryResult> {
      calls.push({ text, values });
      if (text.includes("FROM users WHERE id")) {
        return { rows: [{ active: true, organization_active: true, token_version: 0, organization_id: role === "system_admin" ? null : organizationId, role }], rowCount: 1 } as QueryResult;
      }
      if (text.includes("FROM organization_copernicus_process_config")) {
        return { rows: stored.row ? [stored.row] : [], rowCount: stored.row ? 1 : 0 } as unknown as QueryResult;
      }
      if (text.includes("FROM organization_api_config")) {
        return { rows: [{ satellite_enabled: satelliteEnabled }], rowCount: 1 } as unknown as QueryResult;
      }
      if (text.includes("INSERT INTO organization_copernicus_process_config")) {
        const previous = stored.row;
        stored.row = {
          organization_id: values[0],
          enabled: values[1],
          client_id_ciphertext: values[5] ? values[2] : previous?.client_id_ciphertext ?? null,
          client_secret_ciphertext: values[6] ? values[3] : previous?.client_secret_ciphertext ?? null,
          settings: JSON.parse(String(values[4])),
          updated_at: new Date("2026-10-03T00:00:00.000Z"),
        };
        return { rows: [stored.row], rowCount: 1 } as unknown as QueryResult;
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult;
    },
    release() { },
  } as unknown as PoolClient;
  return { connect: async () => client } as unknown as Pool;
}

async function adminRequest(
  config: AppConfig,
  role: Role,
  options: { method: "GET" | "PUT" | "POST"; url: string; payload?: Record<string, unknown> },
  stored: { row: Record<string, unknown> | null } = { row: null },
  calls: Call[] = [],
) {
  const app = await buildApp(config, adminPool(role, calls, stored));
  const token = await signAccessToken(config, {
    userId, organizationId: role === "system_admin" ? null : organizationId, role, tokenVersion: 0,
  });
  try {
    const response = await app.inject({
      method: options.method,
      url: options.url,
      headers: { authorization: `Bearer ${token}` },
      ...(options.payload ? { payload: options.payload } : {}),
    });
    return { response, calls, stored };
  } finally {
    await app.close();
  }
}

const base = `/api/v1/admin/organizations/${organizationId}/copernicus-process`;

test("administrators read defaults when nothing is stored", async () => {
  const { response } = await adminRequest(baseConfig(), "org_admin", { method: "GET", url: base });
  assert.equal(response.statusCode, 200);
  const data = response.json().data;
  assert.equal(data.enabled, false);
  assert.equal(data.configured, false);
  assert.equal(data.active, false);
  assert.equal(data.satelliteEnabled, true);
  assert.equal(data.settings.dataset, "sentinel-2-l2a");
  assert.equal(data.hasClientId, false);
});

test("the configuration is limited to administrators of the own organization", async () => {
  for (const role of ["reviewer", "auditor", "field_agent"] as const) {
    const { response } = await adminRequest(baseConfig(), role, { method: "GET", url: base });
    assert.equal(response.statusCode, 403, role);
  }
  const other = await adminRequest(baseConfig(), "org_admin", {
    method: "GET", url: `/api/v1/admin/organizations/${otherOrganizationId}/copernicus-process`,
  });
  assert.equal(other.response.statusCode, 403);
  const system = await adminRequest(baseConfig(), "system_admin", {
    method: "GET", url: `/api/v1/admin/organizations/${otherOrganizationId}/copernicus-process`,
  });
  assert.equal(system.response.statusCode, 200);
});

test("saving stores encrypted credentials and never returns them", async () => {
  const config = baseConfig();
  const stored = { row: null as Record<string, unknown> | null };
  const { response, calls } = await adminRequest(config, "org_admin", {
    method: "PUT", url: base,
    payload: { enabled: true, clientId: "my-client", clientSecret: "my-secret", settings: { dataset: "sentinel-2-l2a", preset: "ndvi", lookbackDays: 14 } },
  }, stored);
  assert.equal(response.statusCode, 200);
  const data = response.json().data;
  assert.equal(data.enabled, true);
  assert.equal(data.configured, true);
  assert.equal(data.active, true);
  assert.equal(data.settings.preset, "ndvi");
  assert.equal(data.settings.lookbackDays, 14);
  assert.doesNotMatch(response.body, /my-client|my-secret/);
  const row = stored.row!;
  assert.match(String(row.client_id_ciphertext), /^v1:/);
  assert.equal(decryptSecret(config.CONFIG_ENCRYPTION_KEY, String(row.client_secret_ciphertext)), "my-secret");
  assert.ok(calls.some((call) => call.text.includes("INSERT INTO audit_logs")));
  const audit = calls.find((call) => call.text.includes("INSERT INTO audit_logs"))!;
  assert.doesNotMatch(JSON.stringify(audit.values), /my-secret/);
});

test("an omitted secret keeps the stored value and null clears it", async () => {
  const config = baseConfig();
  const stored = { row: null as Record<string, unknown> | null };
  await adminRequest(config, "org_admin", {
    method: "PUT", url: base, payload: { enabled: true, clientId: "id-1", clientSecret: "secret-1", settings: {} },
  }, stored);
  const original = stored.row!.client_secret_ciphertext;
  const kept = await adminRequest(config, "org_admin", {
    method: "PUT", url: base, payload: { enabled: true, settings: { preset: "true_color" } },
  }, stored);
  assert.equal(kept.response.statusCode, 200);
  assert.equal(stored.row!.client_secret_ciphertext, original);
  const cleared = await adminRequest(config, "org_admin", {
    method: "PUT", url: base, payload: { enabled: false, clientSecret: null, settings: {} },
  }, stored);
  assert.equal(cleared.response.statusCode, 200);
  assert.equal(stored.row!.client_secret_ciphertext, null);
  assert.equal(cleared.response.json().data.configured, false);
});

test("enabling without credentials and invalid settings are rejected", async () => {
  const noCredentials = await adminRequest(baseConfig(), "org_admin", {
    method: "PUT", url: base, payload: { enabled: true, settings: {} },
  });
  assert.equal(noCredentials.response.statusCode, 400);
  assert.equal(noCredentials.response.json().error.code, "CREDENTIALS_REQUIRED");
  for (const settings of [
    { baseUrl: "https://evil.example.com" },
    { tokenUrl: "http://identity.dataspace.copernicus.eu/token" },
    { dataset: "sentinel-1-grd", preset: "ndvi" },
    { output: { width: 9000 } },
    { dataset: "landsat" },
  ]) {
    const { response } = await adminRequest(baseConfig(), "org_admin", {
      method: "PUT", url: base, payload: { enabled: false, settings },
    });
    assert.equal(response.statusCode, 400, JSON.stringify(settings));
    assert.equal(response.json().error.code, "VALIDATION_ERROR");
  }
});

test("the existing API/EU configuration endpoint is not affected", async () => {
  const { response } = await adminRequest(baseConfig(), "org_admin", {
    method: "GET", url: `/api/v1/admin/organizations/${organizationId}/config`,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.satelliteEnabled, true);
  assert.equal("settings" in response.json().data, false);
});

/* ---------- connection test and analysis ---------- */

function stubClient(behaviour: { token?: () => Promise<string>; process?: () => Promise<{ bytes: Buffer; contentType: string }> } = {}) {
  const requests: unknown[] = [];
  return {
    requests,
    client: {
      getToken: behaviour.token ?? (async () => "token"),
      process: async (_settings: unknown, _credentials: unknown, body: unknown) => {
        requests.push(body);
        return (behaviour.process ?? (async () => ({ bytes: png, contentType: "image/png" })))();
      },
    } as unknown as ReturnType<typeof createProcessClient>,
  };
}

function realStoredConfig(config: AppConfig, enabled = true) {
  return {
    row: {
      organization_id: organizationId,
      enabled,
      client_id_ciphertext: encryptSecret(config.CONFIG_ENCRYPTION_KEY, "id-1"),
      client_secret_ciphertext: encryptSecret(config.CONFIG_ENCRYPTION_KEY, "secret-1"),
      settings: { preset: "ndvi" },
      updated_at: new Date(),
    } as Record<string, unknown> | null,
  };
}

const auditContext = { ip: "127.0.0.1", headers: {} };
const orgAdmin = { userId, organizationId, role: "org_admin" as const, tokenVersion: 0 };

test("the connection test reports success with content type and size", async () => {
  const config = baseConfig();
  const { client, requests } = stubClient();
  const service = createCopernicusService(adminPool("org_admin", [], realStoredConfig(config)), config, client);
  const result = await service.test(orgAdmin, auditContext, organizationId);
  assert.equal(result.ok, true);
  assert.equal(result.stage, null);
  assert.equal((result as { contentType: string }).contentType, "image/png");
  assert.equal((result as { bytes: number }).bytes, png.length);
  const request = requests[0] as { output: { width: number; height: number } };
  assert.ok(request.output.width <= 64 && request.output.height <= 64);
});

test("the connection test names the failing stage and handles missing credentials", async () => {
  const config = baseConfig();
  const failing = stubClient({ token: async () => { throw new ProcessApiError("token", "Authentication failed (HTTP 401): bad"); } });
  const service = createCopernicusService(adminPool("org_admin", [], realStoredConfig(config)), config, failing.client);
  const result = await service.test(orgAdmin, auditContext, organizationId);
  assert.equal(result.ok, false);
  assert.equal(result.stage, "token");
  const empty = createCopernicusService(adminPool("org_admin", [], { row: null }), config, failing.client);
  const missing = await empty.test(orgAdmin, auditContext, organizationId);
  assert.equal(missing.ok, false);
  assert.equal(missing.stage, "config");
});

test("analysis stores one image per plot, honours the plot limit and records failures", async () => {
  const config = baseConfig();
  const { client } = stubClient();
  const service = createCopernicusService(adminPool("org_admin", [], realStoredConfig(config)), config, client);
  const runtime = {
    settings: processSettingsSchema.parse({ maxPlotsPerRun: 2 }),
    credentials,
  };
  const saved: string[] = [];
  const plots = [
    { id: "p1", polygon },
    { id: "p2", polygon: { type: "Polygon", coordinates: [] } },
    { id: "p3", polygon },
  ];
  const outcome = await service.analyse(runtime, plots, async (id, _bytes, extension) => {
    saved.push(`${id}.${extension}`);
    return `satellite/${id}.${extension}`;
  });
  assert.deepEqual(saved, ["p1.png"]);
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0]!.plotId, "p1");
  assert.equal(outcome.failures.length, 1);
  assert.equal(outcome.failures[0]!.plotId, "p2");
  assert.deepEqual(outcome.skippedPlotIds, ["p3"]);
});

/* ---------- satellite operation flow ---------- */

function operationPool(options: { enabled: boolean; plots: Array<{ id: string; polygon: unknown }>; process: boolean }, calls: Call[]) {
  let operation: Record<string, unknown> | null = null;
  const client = {
    async query(text: string, values: unknown[] = []): Promise<QueryResult> {
      calls.push({ text, values });
      const rows = (list: unknown[]) => ({ rows: list, rowCount: list.length }) as unknown as QueryResult;
      if (text.includes("FROM users WHERE id")) {
        return rows([{ active: true, organization_active: true, token_version: 0, organization_id: organizationId, role: "org_admin" }]);
      }
      if (text.includes("FROM organization_api_config")) return rows([{ satellite_enabled: options.enabled, evidence_pack_enabled: true }]);
      if (text.includes("WHERE organization_id = $1 AND kind = $2 AND idempotency_key = $3")) return rows([]);
      if (text.includes("INSERT INTO operational_requests")) {
        operation = {
          id: operationId, organization_id: organizationId, kind: "satellite", subject_id: values[2], status: values[3],
          phase: null, download_url: null, message: null, metadata: {}, external_reference: null, updated_at: new Date(),
        };
        return rows([operation]);
      }
      if (text.includes("FROM operational_requests") && text.includes("kind = $3")) return rows([operation]);
      if (text.includes("ST_AsGeoJSON")) return rows(options.plots);
      if (text.includes("status = 'processing'")) { operation = { ...operation!, status: "processing", phase: "requesting" }; return rows([operation]); }
      if (text.includes("SET status = $2, phase = $3")) {
        operation = { ...operation!, status: values[1], phase: values[2], message: values[3], metadata: { ...(operation!.metadata as object), ...JSON.parse(String(values[4])) }, updated_at: new Date() };
        return rows([operation]);
      }
      if (text.includes("SET status='completed',phase=$2")) {
        operation = { ...operation!, status: "completed", phase: values[1], message: values[2], metadata: { ...(operation!.metadata as object), ...JSON.parse(String(values[4])) } };
        return rows([operation]);
      }
      return rows([]);
    },
    release() { },
  } as unknown as PoolClient;
  return { connect: async () => client } as unknown as Pool;
}

async function runSatellite(options: { enabled: boolean; plots: Array<{ id: string; polygon: unknown }>; process: boolean }, body: { subjectId: string; plotIds?: string[] }, processBehaviour?: () => Promise<{ bytes: Buffer; contentType: string }>) {
  const storage = await mkdtemp(path.join(tmpdir(), "sat-"));
  const config = baseConfig(storage);
  const calls: Call[] = [];
  const pool = operationPool(options, calls);
  const { client } = stubClient(processBehaviour ? { process: processBehaviour } : {});
  const copernicus = createCopernicusService(pool, config, client);
  copernicus.loadRuntime = async () => options.process
    ? { settings: processSettingsSchema.parse({ preset: "ndvi" }), credentials }
    : null;
  const service = createOperationService(pool, config, copernicus);
  const result = await service.create(orgAdmin, auditContext, "satellite", body, "idem-key-12345");
  return { result, storage, calls, service, config };
}

test("without the Copernicus integration the satellite request keeps the previous mock behaviour", async () => {
  const { result } = await runSatellite({ enabled: true, plots: [], process: false }, { subjectId: plotId });
  assert.equal(result.data.status, "completed");
  assert.equal(result.data.phase, "mock_screened");
  assert.equal("results" in result.data, false);
});

test("with the integration active a satellite request fetches and stores imagery per plot", async () => {
  const { result, storage, service, config } = await runSatellite(
    { enabled: true, plots: [{ id: plotId, polygon }], process: true },
    { subjectId: plotId },
  );
  assert.equal(result.statusCode, 201);
  assert.equal(result.data.status, "completed");
  assert.equal(result.data.phase, "analysed");
  const [image] = (result.data as unknown as { results: Array<{ plotId: string; url: string; contentType: string; bytes: number }> }).results;
  assert.equal(image!.plotId, plotId);
  assert.equal(image!.url, `/api/v1/satellite/analyses/${operationId}/images/${plotId}`);
  assert.equal(image!.contentType, "image/png");
  const stored = await readFile(path.join(storage, "satellite", organizationId, operationId, `${plotId}.png`));
  assert.ok(stored.equals(png));
  assert.equal(JSON.stringify(result.data).includes("storagePath"), false);
  assert.ok(config);
  assert.ok(service);
});

test("a satellite request fails clearly when no plot matches or the API rejects every plot", async () => {
  const none = await runSatellite({ enabled: true, plots: [], process: true }, { subjectId: "not-a-plot" });
  assert.equal(none.result.data.status, "failed");
  assert.match(String(none.result.data.message), /No plots/);
  const rejected = await runSatellite(
    { enabled: true, plots: [{ id: plotId, polygon }], process: true },
    { subjectId: plotId },
    async () => { throw new ProcessApiError("process", "Process API returned HTTP 400: Invalid evalscript", 400); },
  );
  assert.equal(rejected.result.data.status, "failed");
  assert.match(String(rejected.result.data.message), /Invalid evalscript/);
  assert.deepEqual((rejected.result.data as unknown as { failures: unknown[] }).failures.length, 1);
});

/* ---------- admin UI ---------- */

test("the admin form mapping round-trips every settings variant through the server schema", async () => {
  const { pathToFileURL } = await import("node:url");
  const form = await import(pathToFileURL(path.resolve("..", "admin", "copernicus-form.js")).href) as {
    settingsToValues: (settings: unknown) => Record<string, unknown>;
    valuesToSettings: (values: Record<string, unknown>) => unknown;
    presetFor: (dataset: string, preset: string) => string;
  };
  const variants = [
    {},
    { preset: "ndvi", output: { format: "image/jpeg", jpegQuality: 60, width: 1024 } },
    { preset: "custom", evalscript: "//VERSION=3\nfunction setup(){}" },
    {
      dataset: "sentinel-1-grd", preset: "sar_vv", mosaickingOrder: "leastRecent",
      s1Filter: { acquisitionMode: null, polarization: "VV", orbitDirection: "DESCENDING", resolution: null },
      s1: { speckleFilter: { type: "LEE", windowSizeX: 5, windowSizeY: 7 }, orthorectify: true, backCoeff: "GAMMA0_TERRAIN", demInstance: "COPERNICUS_30", radiometricTerrainOversampling: 3, upsampling: "BICUBIC", downsampling: "BILINEAR" },
    },
  ];
  for (const variant of variants) {
    const settings = processSettingsSchema.parse(variant);
    const roundTripped = processSettingsSchema.parse(form.valuesToSettings(form.settingsToValues(settings)));
    // The form has one interpolation pair, so the inactive dataset follows the active one.
    assert.deepEqual(roundTripped.output, settings.output);
    assert.equal(roundTripped.dataset, settings.dataset);
    assert.equal(roundTripped.preset, settings.preset);
    assert.deepEqual(roundTripped.s1Filter, settings.s1Filter);
    assert.deepEqual(roundTripped.s1.speckleFilter, settings.s1.speckleFilter);
  }
  assert.equal(form.presetFor("sentinel-1-grd", "ndvi"), "sar_vv");
  assert.equal(form.presetFor("sentinel-2-l2a", "sar_vv"), "true_color");
  assert.equal(form.presetFor("sentinel-2-l2a", "custom"), "custom");
});

test("the admin app serves the Copernicus tab and its form module to administrators only", async () => {
  const app = await buildApp(baseConfig(), { query: async () => ({ rows: [] }) } as unknown as Pool);
  try {
    const page = await app.inject({ method: "GET", url: "/admin/" });
    assert.match(page.body, /data-tab="copernicus"/);
    assert.match(page.body, /id="copernicus-form"/);
    const script = await app.inject({ method: "GET", url: "/admin/copernicus-form.js" });
    assert.equal(script.statusCode, 200);
    assert.match(script.headers["content-type"] ?? "", /javascript/);
    assert.match(script.body, /valuesToSettings/);
  } finally {
    await app.close();
  }
  const roles = await import("../../admin/roles.js" as string) as { allowedTabsForRole: (role: string) => string[] };
  for (const role of ["system_admin", "org_admin"]) assert.ok(roles.allowedTabsForRole(role).includes("copernicus"), role);
  for (const role of ["reviewer", "auditor", "field_agent"]) assert.equal(roles.allowedTabsForRole(role).includes("copernicus"), false, role);
});
