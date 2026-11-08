import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import type { Pool, PoolClient, QueryResult } from "pg";
import { buildApp } from "../src/application.js";
import type { AppConfig } from "../src/config.js";
import { hashOpaqueToken } from "../src/security.js";
import { createPasswordResetService } from "../src/services/password-reset-service.js";

const userId = "c2314a55-b213-4dce-8754-f144cd93848a";
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
  RESEND_API_KEY: "test-resend-key",
  INVITATION_FROM_EMAIL: "no-reply@example.com",
  STORAGE_DIR: "storage",
  ADMIN_ORIGIN: "http://127.0.0.1:4300",
};

type TestUser = {
  id: string;
  email: string;
  active: boolean;
  deleted: boolean;
  organizationActive: boolean;
  passwordHash: string;
  tokenVersion: number;
};

type ResetToken = {
  id: string;
  userId: string;
  hash: string;
  consumed: boolean;
};

function fakePool(users: TestUser[]) {
  const resetTokens: ResetToken[] = [];
  let revokedRefreshTokens = 0;
  const client = {
    async query(text: string, values: unknown[] = []): Promise<QueryResult> {
      if (text.startsWith("SELECT u.id, u.email")) {
        const [email, organizationSlug] = values as [string, string | null];
        const matchingUsers = users.filter((user) =>
          user.email.toLowerCase() === email && user.active && !user.deleted && user.organizationActive);
        return {
          rows: organizationSlug ? matchingUsers.slice(0, 1) : matchingUsers.slice(0, 2),
          rowCount: matchingUsers.length,
        } as QueryResult;
      }
      if (text.startsWith("UPDATE password_reset_tokens") && text.includes("WHERE user_id = $1")) {
        for (const token of resetTokens) {
          if (token.userId === values[0]) token.consumed = true;
        }
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }
      if (text.startsWith("INSERT INTO password_reset_tokens")) {
        const [id, resetUserId, hash] = values as [string, string, string];
        resetTokens.push({ id, userId: resetUserId, hash, consumed: false });
        return { rows: [], rowCount: 1 } as unknown as QueryResult;
      }
      if (text.startsWith("UPDATE password_reset_tokens") && text.includes("WHERE token_hash = $1")) {
        const token = resetTokens.find((item) => item.hash === values[0] && !item.consumed);
        if (token) token.consumed = true;
        return { rows: [], rowCount: token ? 1 : 0 } as unknown as QueryResult;
      }
      if (text.startsWith("SELECT r.id")) {
        const token = resetTokens.find((item) => item.hash === values[0] && !item.consumed);
        const user = token && users.find((item) => item.id === token.userId);
        return {
          rows: user && user.active && !user.deleted && user.organizationActive
            ? [{ id: token!.id, user_id: user.id }]
            : [],
          rowCount: user && user.active && !user.deleted && user.organizationActive ? 1 : 0,
        } as QueryResult;
      }
      if (text.startsWith("UPDATE password_reset_tokens") && text.includes("WHERE id = $1")) {
        const token = resetTokens.find((item) => item.id === values[0] && !item.consumed);
        if (token) token.consumed = true;
        return { rows: [], rowCount: token ? 1 : 0 } as unknown as QueryResult;
      }
      if (text.startsWith("UPDATE users SET password_hash")) {
        const [passwordHash, resetUserId] = values as [string, string];
        const user = users.find((item) => item.id === resetUserId);
        if (user) {
          user.passwordHash = passwordHash;
          user.tokenVersion += 1;
        }
        return { rows: [], rowCount: user ? 1 : 0 } as unknown as QueryResult;
      }
      if (text.startsWith("UPDATE refresh_tokens SET revoked_at")) {
        revokedRefreshTokens += 1;
        return { rows: [], rowCount: 2 } as unknown as QueryResult;
      }
      return { rows: [], rowCount: 0 } as unknown as QueryResult;
    },
    release() {},
  } as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as Pool;
  return { pool, resetTokens, users, getRevokedRefreshTokens: () => revokedRefreshTokens };
}

function user(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: userId,
    email: "person@example.com",
    active: true,
    deleted: false,
    organizationActive: true,
    passwordHash: "old-password-hash",
    tokenVersion: 0,
    ...overrides,
  };
}

test("mail rejection diagnostics classify failures without logging secrets or provider bodies", async () => {
  const messages: string[] = [];
  const loggerApp = Fastify({ logger: { stream: { write(message: string) { messages.push(message); } } } });
  const originalFetch = globalThis.fetch;
  try {
    for (const [body, expected] of [
      ["The private.example.com domain is not verified. token=secret-reset", "sender_domain_unverified"],
      ["You can only send testing emails to your own email address (private@example.com)", "test_recipient_restricted"],
      ["API key is invalid: re_secret-key", "invalid_api_key"],
      ["Unexpected provider failure: secret-reset", "provider_rejected"],
    ]) {
      const fixture = fakePool([user()]);
      globalThis.fetch = async () => new Response(body, { status: 403 });
      const service = createPasswordResetService(fixture.pool, config, loggerApp.log);
      await assert.rejects(service.requestReset("person@example.com"), { code: "MAIL_UNAVAILABLE" });
      const diagnostic = JSON.parse(messages.at(-1)!);
      assert.equal(diagnostic.mailFailure, expected);
      assert.equal(diagnostic.providerStatus, 403);
      assert.equal(fixture.resetTokens[0]?.consumed, true);
    }
    const logged = messages.join("");
    assert.ok(!logged.includes("secret-reset"));
    assert.ok(!logged.includes("re_secret-key"));
    assert.ok(!logged.includes("private@example.com"));
    assert.ok(!logged.includes("private.example.com"));
    assert.ok(!logged.includes(config.RESEND_API_KEY!));
  } finally {
    globalThis.fetch = originalFetch;
    await loggerApp.close();
  }
});

test("forgot-password gives the same neutral response for existing and unknown accounts", async () => {
  const fixture = fakePool([user()]);
  const app = await buildApp(config, fixture.pool);
  const originalFetch = globalThis.fetch;
  let delivered = 0;
  globalThis.fetch = async () => {
    delivered += 1;
    return new Response(null, { status: 200 });
  };
  try {
    const known = await app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: "PERSON@example.com" },
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: "missing@example.com" },
    });

    assert.equal(known.statusCode, 202);
    assert.equal(unknown.statusCode, 202);
    assert.deepEqual(known.json(), unknown.json());
    assert.equal(delivered, 1);
    assert.equal(fixture.resetTokens.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("forgot-password requires configured, working email delivery and removes undelivered tokens", async () => {
  const unconfigured = await buildApp({
    ...config,
    RESEND_API_KEY: undefined,
  }, fakePool([]).pool);
  const configuredFixture = fakePool([user()]);
  const configured = await buildApp(config, configuredFixture.pool);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("provider unavailable");
  };
  try {
    const missingConfiguration = await unconfigured.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: "missing@example.com" },
    });
    const deliveryFailure = await configured.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: "person@example.com" },
    });
    assert.equal(missingConfiguration.statusCode, 503);
    assert.equal(deliveryFailure.statusCode, 503);
    assert.deepEqual(missingConfiguration.json(), deliveryFailure.json());
    assert.equal(configuredFixture.resetTokens[0]?.consumed, true);
  } finally {
    globalThis.fetch = originalFetch;
    await unconfigured.close();
    await configured.close();
  }
});

test("reset-password stores only a token hash and atomically consumes it, updates the password, and revokes sessions", async () => {
  const fixture = fakePool([user()]);
  const app = await buildApp(config, fixture.pool);
  const originalFetch = globalThis.fetch;
  let sentEmail: { text: string } | undefined;
  globalThis.fetch = async (_input, init) => {
    sentEmail = JSON.parse(String(init?.body)) as { text: string };
    return new Response(null, { status: 200 });
  };
  try {
    const request = await app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: "person@example.com" },
    });
    assert.equal(request.statusCode, 202);
    const token = /index-prod\.html#reset-password\?token=([A-Za-z0-9_-]+)/.exec(sentEmail!.text)?.[1];
    assert.ok(token);
    assert.notEqual(fixture.resetTokens[0]!.hash, token);
    assert.equal(fixture.resetTokens[0]!.hash, hashOpaqueToken(token));

    const reset = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reset-password",
      payload: { token, password: "a-new-password-123" },
    });
    assert.equal(reset.statusCode, 200);
    assert.deepEqual(reset.json().data, { reset: true });
    assert.match(fixture.resetTokens[0]!.hash, /^[a-f0-9]{64}$/);
    assert.equal(fixture.resetTokens[0]!.consumed, true);
    assert.match(fixture.users[0]!.passwordHash, /^\$argon2id\$/);
    assert.equal(fixture.resetTokens.length, 1);
    assert.equal(fixture.getRevokedRefreshTokens(), 1);

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reset-password",
      payload: { token, password: "a-different-password-456" },
    });
    assert.equal(replay.statusCode, 400);
    assert.equal(replay.json().error.code, "INVALID_RESET_TOKEN");
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("inactive accounts cannot receive or use reset tokens", async () => {
  const inactive = user({
    id: userId,
    email: "inactive@example.com",
    active: false,
  });
  const deleted = user({
    id: "dd14e016-4f66-4b13-b657-a2a9fa9fb0bb",
    email: "deleted@example.com",
    deleted: true,
  });
  const fixture = fakePool([inactive, deleted]);
  const deletedToken = randomBytes(32).toString("base64url");
  fixture.resetTokens.push({
    id: "67f24d58-28ef-44cb-ae62-f5db31bd91ef",
    userId: deleted.id,
    hash: hashOpaqueToken(deletedToken),
    consumed: false,
  });
  const app = await buildApp(config, fixture.pool);
  const originalFetch = globalThis.fetch;
  let deliveredEmails = 0;
  globalThis.fetch = async () => {
    deliveredEmails += 1;
    return new Response(null, { status: 200 });
  };
  try {
    const request = await app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: inactive.email },
    });
    assert.equal(request.statusCode, 202);
    const deletedRequest = await app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: deleted.email },
    });
    assert.equal(deletedRequest.statusCode, 202);
    assert.deepEqual(request.json(), deletedRequest.json());
    assert.equal(deliveredEmails, 0);

    const reset = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reset-password",
      payload: { token: deletedToken, password: "a-new-password-123" },
    });
    assert.equal(reset.statusCode, 400);
    assert.equal(reset.json().error.code, "INVALID_RESET_TOKEN");
    assert.equal(inactive.passwordHash, "old-password-hash");
    assert.equal(deleted.passwordHash, "old-password-hash");
    assert.equal(fixture.resetTokens[0]!.consumed, false);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});
