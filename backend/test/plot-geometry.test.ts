import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type { Pool, PoolClient, QueryResult } from "pg";
import { buildApp } from "../src/application.js";
import type { AppConfig } from "../src/config.js";
import { signAccessToken } from "../src/security.js";
import type { Role } from "../src/types.js";
import { alignTrackPoints } from "../src/domain/plot-geometry.js";
import { buildBackgroundRequest } from "../src/copernicus/process-client.js";
import { defaultProcessSettings } from "../src/copernicus/process-settings.js";
import { ProcessApiError } from "../src/copernicus/process-client.js";
import {
  createSatelliteBackgroundService, parseBackgroundBbox,
} from "../src/services/satellite-background-service.js";
import type { BackgroundImage, CopernicusService } from "../src/services/copernicus-service.js";
import type { ObjectStore } from "../src/infrastructure/object-store.js";

const organizationId = "b23815e3-8701-41bc-b0a4-168f07521dd5";
const userId = "c2314a55-b213-4dce-8754-f144cd93848a";
const plotId = "37b69e74-9033-44eb-a833-cb0f8bb3fe94";
const config: AppConfig = {
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
  STORAGE_DIR: "storage",
  ADMIN_ORIGIN: "http://127.0.0.1:4300",
} as AppConfig;

const oldRing = [[36.8, 7.6], [36.801, 7.6], [36.801, 7.601], [36.8, 7.6]];
const newRing = [[36.8001, 7.6001], [36.801, 7.6], [36.801, 7.601], [36.8001, 7.6001]];
const polygon = (ring: number[][]) => ({ type: "Polygon", coordinates: [ring] });
const trackPoints = oldRing.slice(0, 3).map((position, index) => ({
  position, accuracyM: 4 + index, capturedAt: "2026-10-01T10:00:00.000Z",
}));
const plotRow = {
  id: plotId, supplier_id: null, supplier_name: null, producer: "Abebe", farm_name: "Farm A",
  area_ha: "1.2300", document_id: null, track_points: trackPoints, geofence_status: "pending",
  local_geofence_result: "pending", revision: 3, captured_at: new Date("2026-10-01T10:00:00.000Z"),
  source_updated_at: new Date("2026-10-05T10:00:00.000Z"), polygon: polygon(newRing), lat: 7.6, lng: 36.8,
  computed_area_ha: "0.55", valid: true, simple: true, duplicate_count: 0, eo_status: null, eo_phase: null,
  eo_operation_id: null, open_corrections: 0,
};

type Call = { text: string; values: unknown[] };
type Options = { revision?: number; valid?: boolean; same?: boolean; missing?: boolean };

function fakePool(role: Role, calls: Call[], options: Options): Pool {
  const client = {
    async query(text: string, values: unknown[] = []): Promise<QueryResult> {
      calls.push({ text, values });
      const rows = (result: unknown[]) => ({ rows: result, rowCount: result.length }) as unknown as QueryResult;
      if (text.includes("FROM users WHERE id")) {
        return rows([{
          active: true, organization_active: true, token_version: 0,
          organization_id: role === "system_admin" ? null : organizationId, role,
        }]);
      }
      if (text.includes("FOR UPDATE") && text.includes("FROM plots")) {
        return options.missing ? rows([]) : rows([{
          id: plotId, revision: options.revision ?? 2, area_ha: "1.2300",
          polygon: polygon(oldRing), track_points: trackPoints,
        }]);
      }
      if (text.includes("ST_OrderingEquals")) {
        return rows([{ valid: options.valid ?? true, same: options.same ?? false, area_ha: "0.5500" }]);
      }
      if (text.includes("geofences_exist")) {
        return rows([{ geofences_exist: false, covered: false, approved: false }]);
      }
      if (text.includes("UPDATE plots")) {
        return rows([{ ...plotRow, polygon: polygon(newRing), revision: 3, area_ha: "0.5500" }]);
      }
      if (text.includes("FROM plot_geometry_versions v")) {
        return rows([{
          version: 3, source: "tracehub", note: "Nach Satellitenbild", area_ha: "0.5500", polygon: polygon(newRing),
          created_by_name: "Reviewer", created_at: new Date("2026-10-05T10:00:00.000Z"),
        }]);
      }
      if (text.includes("FROM plots p")) return rows(options.missing ? [] : [plotRow]);
      return rows([]);
    },
    release() { },
  } as unknown as PoolClient;
  return { connect: async () => client } as unknown as Pool;
}

async function request(
  role: Role,
  req: { method: "GET" | "PUT"; url: string; payload?: unknown },
  options: Options = {},
) {
  const calls: Call[] = [];
  const app = await buildApp(config, fakePool(role, calls, options));
  const accessToken = await signAccessToken(config, {
    userId,
    organizationId: role === "system_admin" ? null : organizationId,
    role,
    tokenVersion: 0,
  });
  try {
    const response = await app.inject({
      method: req.method,
      url: req.url,
      headers: { authorization: `Bearer ${accessToken}` },
      ...(req.payload === undefined ? {} : { payload: req.payload as Record<string, unknown> }),
    });
    return { response, calls };
  } finally {
    await app.close();
  }
}

const save = (overrides: Record<string, unknown> = {}) => ({
  polygon: polygon(newRing), baseRevision: 2, note: "Nach Satellitenbild korrigiert", ...overrides,
});

test("moving a plot stores a new GeoJSON version, bumps the revision and queues a sync change", async () => {
  const { response, calls } = await request("reviewer", {
    method: "PUT", url: `/api/v1/plots/${plotId}/geometry`, payload: save(),
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().data.version, 3);
  assert.deepEqual(response.json().data.plot.polygon, polygon(newRing));

  const versions = calls.filter((call) => call.text.includes("INSERT INTO plot_geometry_versions"));
  assert.equal(versions.length, 2);
  assert.equal(versions[0]!.values[2], 2);
  assert.equal(versions[0]!.values[3], "mobile");
  assert.equal(versions[1]!.values[2], 3);
  assert.equal(versions[1]!.values[3], "tracehub");
  assert.equal(versions[1]!.values[5], userId);
  assert.equal(versions[1]!.values[4], "Nach Satellitenbild korrigiert");

  const update = calls.find((call) => call.text.includes("UPDATE plots"));
  assert.ok(update);
  assert.equal(update.values[0], organizationId);
  assert.equal(update.values[1], plotId);
  assert.deepEqual(JSON.parse(update.values[2] as string), polygon(newRing));
  const savedPoints = JSON.parse(update.values[3] as string);
  assert.deepEqual(savedPoints.map((point: { position: number[] }) => point.position), newRing.slice(0, 3));
  assert.equal(savedPoints[1].accuracyM, 5);
  assert.equal(update.values[4], 0.55);
  assert.equal(update.values[5], "pending");
  assert.ok(update.text.includes("revision = revision + 1"));

  const sync = calls.find((call) => call.text.includes("INSERT INTO sync_changes"));
  assert.ok(sync);
  assert.equal(JSON.parse(sync.values[2] as string).revision, 3);
  assert.ok(calls.some((call) => call.text.includes("INSERT INTO audit_logs")));
});

test("a stale base revision is a conflict and nothing is written", async () => {
  const { response, calls } = await request("reviewer", {
    method: "PUT", url: `/api/v1/plots/${plotId}/geometry`, payload: save(),
  }, { revision: 3 });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, "PLOT_REVISION_CONFLICT");
  assert.equal(response.json().error.details.currentRevision, 3);
  assert.ok(!calls.some((call) => call.text.includes("UPDATE plots")));
});

test("invalid, unchanged and malformed geometries are rejected", async () => {
  const bowTie = [[36.8, 7.6], [36.801, 7.601], [36.801, 7.6], [36.8, 7.601], [36.8, 7.6]];
  const invalid = await request("reviewer", {
    method: "PUT", url: `/api/v1/plots/${plotId}/geometry`, payload: save({ polygon: polygon(bowTie) }),
  }, { valid: false });
  assert.equal(invalid.response.statusCode, 422);
  assert.equal(invalid.response.json().error.code, "INVALID_GEOMETRY");
  assert.ok(!invalid.calls.some((call) => call.text.includes("UPDATE plots")));

  const same = await request("reviewer", {
    method: "PUT", url: `/api/v1/plots/${plotId}/geometry`, payload: save({ polygon: polygon(oldRing) }),
  }, { same: true });
  assert.equal(same.response.statusCode, 400);
  assert.equal(same.response.json().error.code, "NO_CHANGE");

  for (const payload of [
    save({ polygon: { type: "Point", coordinates: [1, 2] } }),
    save({ polygon: { type: "Polygon", coordinates: [oldRing, oldRing] } }),
    save({ baseRevision: 0 }),
    save({ note: "x".repeat(501) }),
    { polygon: polygon(newRing) },
  ]) {
    const { response } = await request("reviewer", {
      method: "PUT", url: `/api/v1/plots/${plotId}/geometry`, payload,
    });
    assert.equal(response.statusCode, 400, JSON.stringify(payload).slice(0, 80));
  }
});

test("only writers may move plots and unknown plots are 404", async () => {
  for (const role of ["field_agent", "auditor"] as const) {
    const { response } = await request(role, {
      method: "PUT", url: `/api/v1/plots/${plotId}/geometry`, payload: save(),
    });
    assert.equal(response.statusCode, 403, role);
  }
  const missing = await request("org_admin", {
    method: "PUT", url: `/api/v1/plots/${plotId}/geometry`, payload: save(),
  }, { missing: true });
  assert.equal(missing.response.statusCode, 404);
});

test("versions list the stored GeoJSON versions and the captured geometry as current baseline", async () => {
  const { response } = await request("auditor", { method: "GET", url: `/api/v1/plots/${plotId}/versions` });
  assert.equal(response.statusCode, 200);
  const versions = response.json().data;
  assert.deepEqual(versions.map((item: { version: number }) => item.version), [3]);
  assert.equal(versions[0].source, "tracehub");
  assert.equal(versions[0].createdBy, "Reviewer");
  assert.deepEqual(versions[0].polygon, polygon(newRing));
});

test("track points follow polygon vertices only when they line up one-to-one", () => {
  const aligned = alignTrackPoints(oldRing, newRing, trackPoints);
  assert.deepEqual(aligned.map((point) => point.position), newRing.slice(0, 3));
  assert.equal(aligned[2]!.accuracyM, 6);
  const shifted = trackPoints.map((point) => ({ ...point, position: [point.position[0]! + 0.5, point.position[1]!] as [number, number] }));
  assert.equal(alignTrackPoints(oldRing, newRing, shifted), shifted);
  assert.equal(alignTrackPoints(oldRing, [...newRing, [1, 1]], trackPoints), trackPoints);
  assert.equal(alignTrackPoints(oldRing, newRing, trackPoints.slice(0, 2)).length, 2);
});

test("the background request is an unclipped true-colour Sentinel-2 JPEG for the bounding box", () => {
  const settings = { ...defaultProcessSettings(), dataset: "sentinel-1-grd" as const, preset: "sar_vv" as const };
  const { request, timeRange } = buildBackgroundRequest(settings, [36.79, 7.59, 36.81, 7.61], new Date("2026-11-01T00:00:00Z"));
  assert.deepEqual(request.input.bounds.bbox, [36.79, 7.59, 36.81, 7.61]);
  assert.ok(!("geometry" in request.input.bounds));
  assert.equal(request.input.data[0]!.type, "sentinel-2-l2a");
  assert.equal(request.output.responses[0]!.format.type, "image/jpeg");
  assert.ok(request.evalscript.includes("B04"));
  assert.ok(Math.max(request.output.width, request.output.height) === 1024);
  assert.ok(Date.parse(timeRange.to) - Date.parse(timeRange.from) >= 60 * 86_400_000);
  assert.ok(!("timeRange" in request));
});

test("background bounding boxes are validated and snapped", () => {
  assert.deepEqual(parseBackgroundBbox("36.7900012,7.59,36.81,7.61"), [36.79, 7.59, 36.81, 7.61]);
  for (const bad of ["1,2,3", "5,5,4,6", "36,7,37,8", "36.8,7.6,36.80001,7.60001", "190,0,191,1"]) {
    assert.throws(() => parseBackgroundBbox(bad), (error: { code?: string }) => Boolean(error.code), bad);
  }
});

test("the background route validates its query and reports an unconfigured satellite service", async () => {
  const bad = await request("field_agent", { method: "GET", url: "/api/v1/plots/satellite-background?bbox=1,2" });
  assert.equal(bad.response.statusCode, 400);
  const large = await request("field_agent", { method: "GET", url: "/api/v1/plots/satellite-background?bbox=36,7,37,8" });
  assert.equal(large.response.statusCode, 400);
  assert.equal(large.response.json().error.code, "BBOX_TOO_LARGE");
  const unconfigured = await request("field_agent", {
    method: "GET", url: "/api/v1/plots/satellite-background?bbox=36.79,7.59,36.81,7.61",
  });
  assert.equal(unconfigured.response.statusCode, 409);
  assert.equal(unconfigured.response.json().error.code, "SATELLITE_NOT_CONFIGURED");
});

function backgroundService(options: { fail?: boolean; cached?: BackgroundImage } = {}) {
  const image: BackgroundImage = {
    bbox: [36.79, 7.59, 36.81, 7.61], contentType: "image/jpeg", image: "AAAA",
    from: "2026-09-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z",
  };
  const stored = new Map<string, Buffer>();
  if (options.cached) stored.set("preset", Buffer.from(JSON.stringify(options.cached)));
  let fetches = 0;
  const store: ObjectStore = {
    async put(key, bytes) { stored.set(key, bytes); },
    async get(key) {
      const hit = options.cached ? stored.get("preset")! : stored.get(key);
      if (!hit) throw new Error("missing");
      return hit;
    },
    async size() { return 0; },
    async presignGet() { return null; },
  };
  const copernicus = {
    async loadRuntime() { return { settings: defaultProcessSettings(), credentials: { clientId: "a", clientSecret: "b" } }; },
    async backgroundImage() {
      fetches += 1;
      if (options.fail) throw new ProcessApiError("process", "Process API returned HTTP 403: denied", 403);
      return image;
    },
  } as unknown as CopernicusService;
  const client = { async query() { return { rows: [], rowCount: 0 }; }, release() { } } as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as Pool;
  const service = createSatelliteBackgroundService(pool, config, copernicus, () => store, () => new Date("2026-11-13T12:00:00Z"));
  return { service, image, stored, fetches: () => fetches };
}
const auth = { userId, organizationId, role: "reviewer" as Role, tokenVersion: 0 };

test("a fetched background image is cached and served from the cache afterwards", async () => {
  const { service, image, stored, fetches } = backgroundService();
  assert.deepEqual(await service.get(auth, organizationId, image.bbox), image);
  assert.equal(stored.size, 1);
  assert.ok([...stored.keys()][0]!.startsWith(`satellite-background/${organizationId}/`));
  assert.deepEqual(await service.get(auth, organizationId, image.bbox), image);
  assert.equal(fetches(), 1);
});

test("provider failures become a 502 and a configured cache entry skips the provider", async () => {
  const failing = backgroundService({ fail: true });
  await assert.rejects(failing.service.get(auth, organizationId, [36.79, 7.59, 36.81, 7.61]),
    (error: { statusCode?: number; code?: string }) => error.statusCode === 502 && error.code === "SATELLITE_UNAVAILABLE");
  const cached = backgroundService({
    fail: true,
    cached: { bbox: [36.79, 7.59, 36.81, 7.61], contentType: "image/jpeg", image: "BBBB", from: "a", to: "b" },
  });
  assert.equal((await cached.service.get(auth, organizationId, [36.79, 7.59, 36.81, 7.61])).image, "BBBB");
  assert.equal(cached.fetches(), 0);
});
