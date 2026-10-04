import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import type { Pool, PoolClient, QueryResult } from "pg";
import { buildApp } from "../src/application.js";
import type { AppConfig } from "../src/config.js";
import { signAccessToken } from "../src/security.js";
import type { Role } from "../src/types.js";

const organizationId = "b23815e3-8701-41bc-b0a4-168f07521dd5";
const otherOrganizationId = "db72b4e9-436e-498b-b6ef-670909e65b2f";
const userId = "c2314a55-b213-4dce-8754-f144cd93848a";
const plotA = "37b69e74-9033-44eb-a833-cb0f8bb3fe94";
const plotB = "5a4c1c2c-7b5c-4a9c-8f0e-0e4c2f6b9d11";
const supplierId = "0f5c2d5e-4a5e-4d57-8a5e-0b1b6a1c7e22";
const requestId = "9d1d8b3c-2d0e-4e53-9a52-6f1c5d7b8a33";
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
};

const polygon = {
  type: "Polygon",
  coordinates: [[[36.8, 7.6], [36.801, 7.6], [36.801, 7.601], [36.8, 7.601], [36.8, 7.6]]],
};
const plotRow = {
  id: plotA, supplier_id: supplierId, supplier_name: "Kaffa Cooperative", producer: "Abebe",
  farm_name: "Farm A", area_ha: "1.2300", geofence_status: "inside", local_geofence_result: "inside",
  revision: 2, captured_at: new Date("2026-10-01T10:00:00.000Z"),
  source_updated_at: new Date("2026-10-02T10:00:00.000Z"), polygon, lat: 7.6005, lng: 36.8005,
  computed_area_ha: "1.2300", valid: true, simple: true, duplicate_count: 1,
  eo_status: null, eo_phase: null, open_corrections: 1,
};
const requestRow = (overrides: Record<string, unknown> = {}) => ({
  id: requestId, scope: "group", group_type: "supplier", group_key: supplierId,
  group_label: "Kaffa Cooperative", category: "geometry", message: "Bitte Grenzen neu erfassen.",
  status: "open", requested_by: userId, requested_by_name: "Reviewer", resolved_by_name: null,
  resolution_note: "", resolved_at: null, created_at: new Date("2026-10-03T10:00:00.000Z"),
  updated_at: new Date("2026-10-03T10:00:00.000Z"), ...overrides,
});
type Call = { text: string; values: unknown[] };

function fakePool(
  role: Role,
  calls: Call[],
  targetPlots: Array<{ id: string; revision: number }>,
  failClose = false,
): Pool {
  const client = {
    async query(text: string, values: unknown[] = []): Promise<QueryResult> {
      calls.push({ text, values });
      const rows = (result: unknown[]) => ({ rows: result, rowCount: result.length }) as unknown as QueryResult;
      const correctionItems = targetPlots.map((plot) => ({
        request_id: requestId, plot_id: plot.id, status: "open", resolved_at: null, plot_updated: plot.id === plotA,
      }));
      if (text.includes("FROM users WHERE id")) {
        return rows([{
          active: true, organization_active: true, token_version: 0,
          organization_id: role === "system_admin" ? null : organizationId, role,
        }]);
      }
      if (text.includes("SELECT id, revision FROM plots")) return rows(targetPlots);
      if (text.includes("SELECT name FROM suppliers")) {
        return rows(values[1] === supplierId ? [{ name: "Kaffa Cooperative" }] : []);
      }
      if (text.includes("INSERT INTO plot_correction_requests")) return rows([{ id: requestId }]);
      if (text.includes("FROM plots p")) return rows([plotRow]);
      if (text.includes("FROM plot_correction_requests r")) return rows([requestRow()]);
      if (text.includes("FROM plot_correction_items i")) return rows(correctionItems);
      if (text.includes("UPDATE plot_correction_requests")) return rows(failClose ? [] : [{ id: requestId }]);
      if (text.includes("UPDATE plot_correction_items")) return rows(failClose ? [] : [{ plot_id: plotA }]);
      if (text.includes("count(*)::int AS open")) return rows([{ open: 1 }]);
      return rows([]);
    },
    release() { },
  } as unknown as PoolClient;
  return { connect: async () => client } as unknown as Pool;
}

async function request(
  role: Role,
  options: { method: "GET" | "POST" | "PATCH"; url: string; payload?: unknown },
  targetPlots = [{ id: plotA, revision: 2 }, { id: plotB, revision: 1 }],
  failClose = false,
) {
  const calls: Call[] = [];
  const app = await buildApp(config, fakePool(role, calls, targetPlots, failClose));
  const accessToken = await signAccessToken(config, {
    userId,
    organizationId: role === "system_admin" ? null : organizationId,
    role,
    tokenVersion: 0,
  });
  try {
    const response = await app.inject({
      method: options.method,
      url: options.url,
      headers: { authorization: `Bearer ${accessToken}` },
      ...(options.payload === undefined ? {} : { payload: options.payload as Record<string, unknown> }),
    });
    return { response, calls };
  } finally {
    await app.close();
  }
}

test("plots are listed with polygon, centroid and computed validation", async () => {
  const { response } = await request("field_agent", { method: "GET", url: "/api/v1/plots" });
  assert.equal(response.statusCode, 200);
  const [plot] = response.json().data;
  assert.deepEqual(plot.polygon, polygon);
  assert.deepEqual(plot.centroid, { lat: 7.6005, lng: 36.8005 });
  assert.equal(plot.openCorrectionCount, 1);
  assert.equal(plot.validation.geofence.state, "ok");
  assert.equal(plot.validation.area.state, "ok");
  assert.equal(plot.validation.duplicate.state, "fail");
  assert.equal(plot.validation.eo.state, "pending");
});

test("a correction request for a single plot stores one item with the criticised revision", async () => {
  const { response, calls } = await request("reviewer", {
    method: "POST",
    url: "/api/v1/plot-corrections",
    payload: { scope: "plot", plotId: plotA, category: "geometry", message: "  Polygon prüfen  " },
  }, [{ id: plotA, revision: 2 }]);
  assert.equal(response.statusCode, 201);
  const insert = calls.find((call) => call.text.includes("INSERT INTO plot_correction_requests"));
  assert.ok(insert);
  assert.deepEqual(insert.values.slice(0, 7), [organizationId, "plot", null, null, "", "geometry", "Polygon prüfen"]);
  const items = calls.find((call) => call.text.includes("INSERT INTO plot_correction_items"));
  assert.ok(items);
  assert.deepEqual(items.values, [organizationId, requestId, [plotA], [2]]);
  assert.ok(calls.some((call) => call.text.includes("INSERT INTO audit_logs")));
  assert.equal(response.json().data.plotCount, 1);
});

test("group requests resolve the supplier name and every plot of the group", async () => {
  const { response, calls } = await request("org_admin", {
    method: "POST",
    url: "/api/v1/plot-corrections",
    payload: { scope: "group", groupType: "supplier", groupKey: supplierId, category: "evidence", message: "Nachweise fehlen" },
  });
  assert.equal(response.statusCode, 201);
  const select = calls.find((call) => call.text.includes("SELECT id, revision FROM plots"));
  assert.ok(select);
  assert.ok(select.text.includes("supplier_id = $2"));
  assert.deepEqual(select.values, [organizationId, supplierId]);
  const insert = calls.find((call) => call.text.includes("INSERT INTO plot_correction_requests"));
  assert.deepEqual(insert?.values.slice(1, 5), ["group", "supplier", supplierId, "Kaffa Cooperative"]);
  const items = calls.find((call) => call.text.includes("INSERT INTO plot_correction_items"));
  assert.deepEqual(items?.values[2], [plotA, plotB]);
});

test("producer groups and organization-wide requests select the right plots", async () => {
  const producer = await request("reviewer", {
    method: "POST",
    url: "/api/v1/plot-corrections",
    payload: { scope: "group", groupType: "producer", groupKey: "Abebe", category: "area", message: "Fläche prüfen" },
  });
  assert.equal(producer.response.statusCode, 201);
  const producerSelect = producer.calls.find((call) => call.text.includes("SELECT id, revision FROM plots"));
  assert.ok(producerSelect?.text.includes("producer = $2"));

  const all = await request("reviewer", {
    method: "POST",
    url: "/api/v1/plot-corrections",
    payload: { scope: "all", category: "other", message: "Alle Parzellen neu aufnehmen" },
  });
  assert.equal(all.response.statusCode, 201);
  const allSelect = all.calls.find((call) => call.text.includes("SELECT id, revision FROM plots"));
  assert.deepEqual(allSelect?.values, [organizationId]);
});

test("correction requests are validated", async () => {
  for (const payload of [
    { scope: "plot", category: "geometry", message: "x" },
    { scope: "plot", plotId: plotA, category: "unknown", message: "x" },
    { scope: "plot", plotId: plotA, category: "geometry", message: "   " },
    { scope: "group", groupType: "supplier", groupKey: "not-a-uuid", category: "geometry", message: "x" },
    { scope: "everything", category: "geometry", message: "x" },
  ]) {
    const { response } = await request("org_admin", { method: "POST", url: "/api/v1/plot-corrections", payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }
});

test("requests without matching plots or suppliers are rejected", async () => {
  const none = await request("org_admin", {
    method: "POST", url: "/api/v1/plot-corrections",
    payload: { scope: "all", category: "other", message: "x" },
  }, []);
  assert.equal(none.response.statusCode, 400);
  assert.equal(none.response.json().error.code, "NO_PLOTS");
  const missingPlot = await request("org_admin", {
    method: "POST", url: "/api/v1/plot-corrections",
    payload: { scope: "plot", plotId: plotA, category: "other", message: "x" },
  }, []);
  assert.equal(missingPlot.response.statusCode, 404);
  const missingSupplier = await request("org_admin", {
    method: "POST", url: "/api/v1/plot-corrections",
    payload: { scope: "group", groupType: "supplier", groupKey: otherOrganizationId, category: "other", message: "x" },
  });
  assert.equal(missingSupplier.response.statusCode, 404);
});

test("read-only roles cannot create or close correction requests but can read them", async () => {
  for (const role of ["field_agent", "auditor"] as const) {
    const create = await request(role, {
      method: "POST", url: "/api/v1/plot-corrections", payload: { scope: "all", category: "other", message: "x" },
    });
    assert.equal(create.response.statusCode, 403, role);
    const close = await request(role, {
      method: "PATCH", url: `/api/v1/plot-corrections/${requestId}`, payload: { status: "resolved" },
    });
    assert.equal(close.response.statusCode, 403, role);
    const list = await request(role, { method: "GET", url: "/api/v1/plot-corrections?status=open" });
    assert.equal(list.response.statusCode, 200, role);
  }
});

test("correction requests list their plots and flag plots updated since the request", async () => {
  const { response, calls } = await request("field_agent", {
    method: "GET", url: `/api/v1/plot-corrections?status=open&plotId=${plotA}`,
  });
  assert.equal(response.statusCode, 200);
  const [item] = response.json().data;
  assert.equal(item.plotCount, 2);
  assert.equal(item.openPlotCount, 2);
  assert.equal(item.requestedBy.displayName, "Reviewer");
  assert.deepEqual(item.plots.map((plot: { plotUpdated: boolean }) => plot.plotUpdated), [true, false]);
  const select = calls.find((call) => call.text.includes("FROM plot_correction_requests r"));
  assert.deepEqual(select?.values, [organizationId, "open", plotA]);
  const invalid = await request("field_agent", { method: "GET", url: "/api/v1/plot-corrections?status=bogus" });
  assert.equal(invalid.response.statusCode, 400);
});

test("a request can be closed as a whole", async () => {
  const { response, calls } = await request("reviewer", {
    method: "PATCH", url: `/api/v1/plot-corrections/${requestId}`, payload: { status: "resolved", note: "Erledigt" },
  });
  assert.equal(response.statusCode, 200);
  const update = calls.find((call) => call.text.includes("UPDATE plot_correction_requests"));
  assert.deepEqual(update?.values, [organizationId, requestId, "resolved", userId, "Erledigt"]);
  assert.ok(calls.some((call) => call.text.includes("UPDATE plot_correction_items")));
  assert.ok(calls.some((call) => call.text.includes("INSERT INTO audit_logs")));
});

test("a concurrent whole-request close is reported as a conflict", async () => {
  const { response, calls } = await request("reviewer", {
    method: "PATCH", url: `/api/v1/plot-corrections/${requestId}`, payload: { status: "resolved" },
  }, undefined, true);
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, "CORRECTION_CLOSED");
  assert.ok(!calls.some((call) => call.text.includes("INSERT INTO audit_logs")));
});

test("a single plot of a request can be closed", async () => {
  const { response, calls } = await request("reviewer", {
    method: "PATCH", url: `/api/v1/plot-corrections/${requestId}/plots/${plotA}`, payload: { status: "resolved" },
  });
  assert.equal(response.statusCode, 200);
  const update = calls.find((call) => call.text.includes("UPDATE plot_correction_items"));
  assert.deepEqual(update?.values, [organizationId, requestId, plotA, "resolved"]);
  const unknown = await request("reviewer", {
    method: "PATCH", url: `/api/v1/plot-corrections/${requestId}/plots/${otherOrganizationId}`,
    payload: { status: "resolved" },
  });
  assert.equal(unknown.response.statusCode, 404);
});

test("a concurrent plot close is reported as a conflict", async () => {
  const { response, calls } = await request("reviewer", {
    method: "PATCH", url: `/api/v1/plot-corrections/${requestId}/plots/${plotA}`,
    payload: { status: "resolved" },
  }, undefined, true);
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, "CORRECTION_CLOSED");
  assert.ok(!calls.some((call) => call.text.includes("INSERT INTO audit_logs")));
});

test("correction requests stay inside the caller's organization", async () => {
  const crossTenant = await request("org_admin", {
    method: "GET", url: `/api/v1/plots?organizationId=${otherOrganizationId}`,
  });
  assert.equal(crossTenant.response.statusCode, 403);
  const missing = await request("system_admin", { method: "GET", url: "/api/v1/plot-corrections" });
  assert.equal(missing.response.statusCode, 400);
  const scoped = await request("system_admin", {
    method: "POST", url: `/api/v1/plot-corrections?organizationId=${otherOrganizationId}`,
    payload: { scope: "all", category: "other", message: "x" },
  });
  assert.equal(scoped.response.statusCode, 201);
  assert.equal(scoped.calls.find((call) => call.text.includes("INSERT INTO plot_correction_requests"))?.values[0],
    otherOrganizationId);
});
