import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import type { AppConfig } from "../src/config.js";
import { AppError } from "../src/errors.js";
import type { ObjectStore } from "../src/infrastructure/object-store.js";
import { createDocumentService } from "../src/services/document-service.js";
import type { AuthContext } from "../src/types.js";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const plot = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const auth: AuthContext = { userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", organizationId: org, role: "field_agent", tokenVersion: 1 };
const config = { JWT_SECRET: "test-secret", PUBLIC_BASE_URL: "https://example.test" } as AppConfig;
const store: ObjectStore = {
  async put() {}, async get() { return Buffer.alloc(0); },
  async size() { return 0; }, async presignGet() { return null; },
};

function fixture(plotExists: boolean, existing?: { plot_id: string | null }) {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const client = {
    async query(text: string, values: unknown[] = []) {
      queries.push({ text, values });
      if (text.includes("FROM plots")) return { rows: plotExists ? [{ id: plot }] : [] };
      if (text.includes("FROM documents") && text.includes("idempotency_key") && existing) {
        return { rows: [{ ...existing, file_name: "plot.pdf", mime_type: "application/pdf", byte_size: 12 }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } } as unknown as Pool;
  return { service: createDocumentService(pool, config, store), queries };
}

test("document upload rejects a plot outside the organization before insertion", async () => {
  const { service, queries } = fixture(false);
  await assert.rejects(
    service.initiate(auth, { ip: "127.0.0.1", headers: {} }, { fileName: "plot.pdf", mimeType: "application/pdf", size: 12, plotId: plot }, "upload-key"),
    (error: unknown) => error instanceof AppError && error.statusCode === 404,
  );
  assert.equal(queries.some(({ text }) => text.includes("INSERT INTO documents")), false);
  assert.deepEqual(queries.find(({ text }) => text.includes("FROM plots"))?.values, [org, plot]);
});

test("reusing an upload key for a different plot is rejected", async () => {
  const { service, queries } = fixture(true, { plot_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" });
  await assert.rejects(
    service.initiate(auth, { ip: "127.0.0.1", headers: {} }, { fileName: "plot.pdf", mimeType: "application/pdf", size: 12, plotId: plot }, "upload-key"),
    (error: unknown) => error instanceof AppError && error.code === "IDEMPOTENCY_KEY_REUSED",
  );
  assert.equal(queries.some(({ text }) => text.includes("INSERT INTO documents") || text.includes("UPDATE documents")), false);
});

test("document listing only returns completed documents for the selected tenant and plot", async () => {
  const { service, queries } = fixture(true);
  assert.deepEqual(await service.listForPlot(auth, plot), []);
  const listing = queries.find(({ text }) => text.includes("FROM documents"));
  assert.deepEqual(listing?.values, [org, plot]);
  assert.match(listing?.text ?? "", /status='completed'/);
});
