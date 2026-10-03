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
const shipmentId = "37b69e74-9033-44eb-a833-cb0f8bb3fe94";
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

const row = (overrides: Record<string, unknown> = {}) => ({
  id: shipmentId,
  reference: "IMP-2026-0142",
  product: "Washed Arabica",
  hs_code: "0901",
  quantity_kg: "18500.000",
  origin_country: "ET",
  origin_region: "Jimma",
  supplier_id: null,
  supplier_name: null,
  destination: "Hamburg",
  status: "planned",
  expected_arrival: "2026-12-18",
  notes: "",
  created_at: new Date("2026-10-01T10:00:00.000Z"),
  updated_at: new Date("2026-10-01T10:00:00.000Z"),
  ...overrides,
});

function fakePool(role: Role, calls: Array<{ text: string; values: unknown[] }>): Pool {
  const client = {
    async query(text: string, values: unknown[] = []): Promise<QueryResult> {
      calls.push({ text, values });
      if (text.includes("FROM users WHERE id")) {
        return {
          rows: [{
            active: true, organization_active: true, token_version: 0,
            organization_id: role === "system_admin" ? null : organizationId, role,
          }],
          rowCount: 1,
        } as QueryResult;
      }
      if (text.includes("INSERT INTO shipments")) return { rows: [{ id: shipmentId }], rowCount: 1 } as QueryResult;
      if (text.includes("UPDATE shipments")) return { rows: [{ id: shipmentId }], rowCount: 1 } as QueryResult;
      if (text.includes("DELETE FROM shipments")) return { rows: [{ id: shipmentId }], rowCount: 1 } as QueryResult;
      if (text.includes("FROM shipments s")) {
        const wantsUpdate = calls.some((call) => call.text.includes("UPDATE shipments"));
        return {
          rows: [row(wantsUpdate ? { status: "arrived", quantity_kg: "20000.000" } : {})],
          rowCount: 1,
        } as QueryResult;
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult;
    },
    release() { },
  } as unknown as PoolClient;
  return { connect: async () => client } as unknown as Pool;
}

async function request(
  role: Role,
  options: { method: "GET" | "POST" | "PATCH" | "DELETE"; url: string; payload?: unknown },
) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const app = await buildApp(config, fakePool(role, calls));
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

test("shipments can be listed with typed fields", async () => {
  const { response } = await request("field_agent", { method: "GET", url: "/api/v1/shipments" });
  assert.equal(response.statusCode, 200);
  const [shipment] = response.json().data;
  assert.equal(shipment.reference, "IMP-2026-0142");
  assert.equal(shipment.quantityKg, 18500);
  assert.equal(shipment.expectedArrival, "2026-12-18");
  assert.equal(shipment.createdAt, "2026-10-01T10:00:00.000Z");
});

test("shipments are created with validated, tenant-scoped data", async () => {
  const { response, calls } = await request("org_admin", {
    method: "POST",
    url: "/api/v1/shipments",
    payload: { reference: " IMP-2026-0142 ", quantityKg: 18500, destination: "Hamburg", expectedArrival: "2026-12-18" },
  });
  assert.equal(response.statusCode, 201);
  const insert = calls.find((call) => call.text.includes("INSERT INTO shipments"));
  assert.ok(insert);
  assert.equal(insert.values[0], organizationId);
  assert.equal(insert.values[1], "IMP-2026-0142");
  assert.ok(calls.some((call) => call.text.includes("INSERT INTO audit_logs")));
});

test("shipment validation rejects bad quantities and dates", async () => {
  for (const payload of [
    { reference: "X", quantityKg: 0 },
    { reference: "", quantityKg: 5 },
    { reference: "X", quantityKg: 5, expectedArrival: "2026-02-31" },
    { reference: "X", quantityKg: 5, status: "lost" },
  ]) {
    const { response } = await request("org_admin", { method: "POST", url: "/api/v1/shipments", payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
    assert.equal(response.json().error.code, "VALIDATION_ERROR");
  }
});

test("shipments can be updated partially and merge existing values", async () => {
  const { response, calls } = await request("reviewer", {
    method: "PATCH",
    url: `/api/v1/shipments/${shipmentId}`,
    payload: { status: "arrived", quantityKg: 20000 },
  });
  assert.equal(response.statusCode, 200);
  const update = calls.find((call) => call.text.includes("UPDATE shipments"));
  assert.ok(update);
  assert.equal(update.values[2], "IMP-2026-0142");
  assert.equal(update.values[10], "arrived");
  const empty = await request("reviewer", { method: "PATCH", url: `/api/v1/shipments/${shipmentId}`, payload: {} });
  assert.equal(empty.response.statusCode, 400);
});

test("only administrators may delete shipments", async () => {
  const denied = await request("reviewer", { method: "DELETE", url: `/api/v1/shipments/${shipmentId}` });
  assert.equal(denied.response.statusCode, 403);
  const allowed = await request("org_admin", { method: "DELETE", url: `/api/v1/shipments/${shipmentId}` });
  assert.equal(allowed.response.statusCode, 200);
  assert.deepEqual(allowed.response.json().data, { deleted: true, id: shipmentId });
});

test("read-only roles cannot create shipments", async () => {
  for (const role of ["field_agent", "auditor"] as const) {
    const { response } = await request(role, {
      method: "POST", url: "/api/v1/shipments", payload: { reference: "X", quantityKg: 5 },
    });
    assert.equal(response.statusCode, 403, role);
  }
});

test("system administrators must name the organization and cannot cross tenants as members", async () => {
  const missing = await request("system_admin", { method: "GET", url: "/api/v1/shipments" });
  assert.equal(missing.response.statusCode, 400);
  const scoped = await request("system_admin", {
    method: "GET", url: `/api/v1/shipments?organizationId=${otherOrganizationId}`,
  });
  assert.equal(scoped.response.statusCode, 200);
  const crossTenant = await request("org_admin", {
    method: "GET", url: `/api/v1/shipments?organizationId=${otherOrganizationId}`,
  });
  assert.equal(crossTenant.response.statusCode, 403);
});
