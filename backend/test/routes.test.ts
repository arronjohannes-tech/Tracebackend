import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Fastify from "fastify";
import type { Pool } from "pg";
import { buildApp } from "../src/application.js";
import type { AppConfig } from "../src/config.js";
import { AppError } from "../src/errors.js";
import { registerSupplierInvitationRoutes } from "../src/routes/supplier-invitations.js";

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

test("mobile and admin routes reject unauthenticated access with the standard envelope", async () => {
  const pool = { query: async () => ({ rows: [{ "?column?": 1 }] }) } as unknown as Pool;
  const app = await buildApp(config, pool);
  try {
    for (const request of [
      { method: "POST", url: "/api/v1/sync/push", payload: { deviceId: "d", operations: [] } },
      { method: "GET", url: "/api/v1/sync/pull" },
      { method: "POST", url: "/api/v1/documents/uploads", payload: {} },
      { method: "POST", url: "/api/v1/satellite/analyses", payload: {} },
      { method: "POST", url: "/api/v1/evidence-packs", payload: {} },
      { method: "POST", url: "/api/v1/dds/drafts", payload: {} },
      { method: "GET", url: "/api/v1/geofences" },
      { method: "GET", url: "/api/v1/admin/organizations" },
      { method: "GET", url: "/api/v1/admin/users" },
      { method: "POST", url: "/api/v1/admin/users", payload: {} },
      { method: "PATCH", url: "/api/v1/admin/users/550e8400-e29b-41d4-a716-446655440000", payload: {} },
    ] as const) {
      const response = await app.inject(request);
      assert.equal(response.statusCode, 401, `${request.method} ${request.url}`);
      assert.equal(response.json().error.code, "UNAUTHORIZED");
    }
  } finally {
    await app.close();
  }
});

test("unknown routes use the documented error envelope", async () => {
  const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  const app = await buildApp(config, pool);
  try {
    const response = await app.inject({ method: "GET", url: "/does-not-exist" });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), {
      error: { code: "NOT_FOUND", message: "Route not found." },
    });
  } finally {
    await app.close();
  }
});

test("admin SPA is served with restrictive browser headers", async () => {
  const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  const app = await buildApp(config, pool);
  try {
    const response = await app.inject({ method: "GET", url: "/admin/" });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /(SCTracker|Tracebackend) Administration/);
    assert.match(response.headers["content-security-policy"] ?? "", /default-src 'self'/);
    assert.equal(response.headers["x-frame-options"], "DENY");
    const roles = await app.inject({ method: "GET", url: "/admin/roles.js" });
    assert.equal(roles.statusCode, 200);
    assert.match(roles.body, /allowedTabsForRole/);
  } finally {
    await app.close();
  }
});

test("supplier invitation migration stores tenant-scoped, one-use invitations", async () => {
  const sql = await readFile(new URL("../migrations/005_supplier_invitations.sql", import.meta.url), "utf8");
  assert.match(sql, /token_hash text NOT NULL UNIQUE/);
  assert.match(sql, /accepted_at timestamptz/);
  assert.match(sql, /ALTER TABLE supplier_invitations FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS contact_email/);
});

test("supplier registration consumes its invite and returns a login session", async () => {
  const orgId = randomUUID();
  const inviterId = randomUUID();
  const invitationId = randomUUID();
  const supplierId = randomUUID();
  const userId = randomUUID();
  let invitationHash = "";
  let consumed = false;
  let expired = false;
  let delivered = true;
  let providerUnavailable = false;
  let deletedInvitations = 0;
  let passwordHash = "";
  let sentEmail = "";
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      if (text.includes("SELECT name FROM organizations")) return { rows: [{ name: "Tracehub" }] };
      if (text.includes("SELECT 1 FROM users")) return { rows: [] };
      if (text.includes("INSERT INTO supplier_invitations")) {
        invitationHash = String(values[3]);
        return { rows: [{ id: invitationId, expires_at: new Date(Date.now() + 86_400_000) }] };
      }
      if (text.includes("FROM supplier_invitations i")) {
        return {
          rows: values[0] === invitationHash ? [{
            id: invitationId, organization_id: orgId, organization_name: "Tracehub",
            organization_slug: "tracehub", legal_name: "Coffee Union", email: "coffee@example.com",
            expires_at: new Date(Date.now() + (expired ? -1000 : 86_400_000)), accepted_at: consumed ? new Date() : null,
          }] : []
        };
      }
      if (text.includes("INSERT INTO suppliers")) return {
        rows: [{
          id: supplierId, name: values[1], region: values[7], producer_count: 0, plot_count: 0,
          revision: 1, source_updated_at: new Date(),
        }]
      };
      if (text.includes("INSERT INTO users")) {
        passwordHash = String(values[3]);
        return { rows: [{ id: userId }] };
      }
      if (text.includes("UPDATE supplier_invitations")) consumed = true;
      if (text.includes("DELETE FROM supplier_invitations")) deletedInvitations += 1;
      if (text.includes("FROM users u")) return {
        rows: [{
          id: userId, organization_id: orgId, organization_name: "Tracehub",
          email: "coffee@example.com", display_name: "Coffee Contact", password_hash: passwordHash,
          role: "field_agent", active: true, token_version: 0,
        }]
      };
      return { rows: [] };
    },
    release: () => { },
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const app = Fastify();
  app.decorateRequest("auth", null);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code } });
    return reply.code(500).send({ error: { code: "UNEXPECTED" } });
  });
  await registerSupplierInvitationRoutes(app, pool, {
    ...config, RESEND_API_KEY: "test-key", INVITATION_FROM_EMAIL: "invites@example.com",
  }, async (request) => {
    request.auth = { userId: inviterId, organizationId: orgId, role: "org_admin", tokenVersion: 0 };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    if (providerUnavailable) throw new Error("Connection lost");
    sentEmail = String(JSON.parse(String(options?.body)).text);
    return new Response("{}", { status: delivered ? 200 : 503 });
  };
  try {
    const invitation = await app.inject({
      method: "POST", url: "/api/v1/supplier-invitations", payload: {
        legalName: "Coffee Union", email: "coffee@example.com",
      }
    });
    assert.equal(invitation.statusCode, 201);
    const token = sentEmail.match(/register\.html#token=([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(token);
    assert.equal(invitation.body.includes(token), false);
    expired = true;
    const expiredLink = await app.inject({ method: "POST", url: "/api/v1/supplier-invitations/resolve", payload: { token } });
    assert.equal(expiredLink.statusCode, 410);
    expired = false;
    const resolved = await app.inject({ method: "POST", url: "/api/v1/supplier-invitations/resolve", payload: { token } });
    assert.equal(resolved.json().data.email, "coffee@example.com");
    const registration = await app.inject({
      method: "POST", url: "/api/v1/supplier-invitations/register", payload: {
        token, legalName: "Coffee Union", registrationNumber: "REG-123", countryCode: "ET", region: "Sidama",
        streetAddress: "Main St 2", city: "Hawassa", contactName: "Coffee Contact",
        contactPhone: "+251 111 222", password: "secure-password-123",
      }
    });
    assert.equal(registration.statusCode, 201, registration.body);
    assert.ok(registration.json().data.accessToken);
    assert.equal(registration.json().data.selectedOrganizationId, orgId);
    const replay = await app.inject({ method: "POST", url: "/api/v1/supplier-invitations/resolve", payload: { token } });
    assert.equal(replay.statusCode, 410);
    delivered = false;
    const failedEmail = await app.inject({
      method: "POST", url: "/api/v1/supplier-invitations", payload: {
        legalName: "Second Union", email: "second@example.com",
      }
    });
    assert.equal(failedEmail.statusCode, 502);
    assert.equal(deletedInvitations, 1);
    providerUnavailable = true;
    const uncertainEmail = await app.inject({
      method: "POST", url: "/api/v1/supplier-invitations", payload: {
        legalName: "Third Union", email: "third@example.com",
      }
    });
    assert.equal(uncertainEmail.json().error.code, "MAIL_DELIVERY_UNCERTAIN");
    assert.equal(deletedInvitations, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});
