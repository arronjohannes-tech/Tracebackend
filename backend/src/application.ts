import { readFile } from "node:fs/promises";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "./config.js";
import { createAuthenticator, registerAuthRoutes } from "./auth.js";
import { AppError } from "./errors.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerOperationRoutes } from "./routes/operations.js";
import { registerSyncRoutes } from "./routes/sync.js";

export async function buildApp(config: AppConfig, pool: Pool): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 52_428_800,
    trustProxy: false,
    logger: {
      level: config.NODE_ENV === "test" ? "silent" : "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.query.token",
          "req.headers.x-upload-token",
          "body.password",
          "body.refreshToken",
          "body.eu.password",
          "body.eu.username",
          "body.eu.clientId",
        ],
        censor: "[REDACTED]",
      },
    },
  });

  app.decorateRequest("auth", null);
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => done(null, body));

  const allowedAdminOrigins = new Set(
    config.ADMIN_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean),
  );
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || allowedAdminOrigins.has(origin)) callback(null, true);
      else callback(new Error("Origin is not allowed."), false);
    },
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "Idempotency-Key",
      "X-Organization-Id",
      "X-Upload-Token",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });

  // Keep each asset URL literal so Node File Trace includes the root-level admin files
  // in the Vercel function bundle. After `npm run build`, the copy script mirrors
  // those assets at the matching compiled location for `npm start`.
  const adminAssets = new Map([
    ["/admin/", { file: new URL("../../admin/index.html", import.meta.url), contentType: "text/html; charset=utf-8" }],
    ["/admin/index.html", { file: new URL("../../admin/index.html", import.meta.url), contentType: "text/html; charset=utf-8" }],
    ["/admin/app.js", { file: new URL("../../admin/app.js", import.meta.url), contentType: "text/javascript; charset=utf-8" }],
    ["/admin/roles.js", { file: new URL("../../admin/roles.js", import.meta.url), contentType: "text/javascript; charset=utf-8" }],
    ["/admin/styles.css", { file: new URL("../../admin/styles.css", import.meta.url), contentType: "text/css; charset=utf-8" }],
  ]);
  for (const [route, asset] of adminAssets) {
    app.get(route, async (_request, reply) =>
      reply.type(asset.contentType).send(await readFile(asset.file)));
  }

  app.addHook("onSend", async (_request, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'",
      );
  });

  app.get("/", async (_request, reply) => reply.redirect("/admin/"));
  app.get("/admin", async (_request, reply) => reply.redirect("/admin/"));
  app.get("/health", async (_request, reply) => {
    await pool.query("SELECT 1");
    return reply.send({ data: { status: "ok" } });
  });

  const authenticate = createAuthenticator(pool, config);
  await registerAuthRoutes(app, pool, config, authenticate);
  await registerAdminRoutes(app, pool, config, authenticate);
  await registerSyncRoutes(app, pool, authenticate);
  await registerDocumentRoutes(app, pool, config, authenticate);
  await registerOperationRoutes(app, pool, config, authenticate);

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found." } }));
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
    }
    const httpError = error as { statusCode?: number };
    if (typeof httpError.statusCode === "number" && httpError.statusCode >= 400 && httpError.statusCode < 500) {
      return reply.code(httpError.statusCode!).send({ error: { code: httpError.statusCode === 429 ? "RATE_LIMITED" : "INVALID_REQUEST", message: httpError.statusCode === 429 ? "Too many requests. Try again later." : "Invalid HTTP request." } });
    }
    const pgCode = (error as { code?: string }).code;
    if (pgCode === "23505") {
      return reply.code(409).send({
        error: { code: "DUPLICATE", message: "A resource with these unique fields already exists." },
      });
    }
    if (pgCode === "23503") {
      return reply.code(409).send({
        error: { code: "REFERENCE_CONFLICT", message: "A referenced resource does not exist or is still in use." },
      });
    }
    if (pgCode === "23502" || pgCode === "23514" || pgCode === "22P02") {
      return reply.code(400).send({
        error: { code: "INVALID_DATA", message: "The supplied data violates a database constraint." },
      });
    }
    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." },
    });
  });
  return app;
}
