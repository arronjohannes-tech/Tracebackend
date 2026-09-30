import path from "node:path";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4300),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: booleanString,
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default("sctracker"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(180).default(30),
  CONFIG_ENCRYPTION_KEY: z.string().transform((value, context) => {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length !== 32) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key.",
      });
      return z.NEVER;
    }
    return decoded;
  }),
  PUBLIC_BASE_URL: z.string().url().default("http://127.0.0.1:4300"),
  STORAGE_DIR: z.string().default("./storage"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().default("eu-central-1").optional(),
  S3_ENDPOINT: z.string().url().optional(),
  AWS_ENDPOINT_URL_S3: z.string().url().optional(),
  ADMIN_ORIGIN: z.string().default("http://127.0.0.1:4300"),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
});

export type AppConfig = Omit<z.infer<typeof schema>, "STORAGE_DIR"> & {
  STORAGE_DIR: string;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.parse({
    ...environment,
    STORAGE_DIR:
      environment.STORAGE_DIR ??
      (environment.VERCEL === "1" ? "/tmp/sctracker-storage" : undefined),
  });
  if (parsed.NODE_ENV === "production" && parsed.STORAGE_DRIVER !== "s3") throw new Error("Production requires durable S3 object storage.");
  if (parsed.STORAGE_DRIVER === "s3" && !parsed.S3_BUCKET) throw new Error("S3_BUCKET is required.");
  if (parsed.NODE_ENV === "production" && !parsed.PUBLIC_BASE_URL.startsWith("https://")) throw new Error("Production PUBLIC_BASE_URL must use HTTPS.");
  if (parsed.NODE_ENV === "production" && parsed.S3_ENDPOINT && !parsed.S3_ENDPOINT.startsWith("https://")) throw new Error("Production object storage must use HTTPS.");
  return {
    ...parsed,
    S3_ENDPOINT: parsed.S3_ENDPOINT ?? parsed.AWS_ENDPOINT_URL_S3,
    PUBLIC_BASE_URL: parsed.PUBLIC_BASE_URL.replace(/\/+$/, ""),
    STORAGE_DIR: path.resolve(process.cwd(), parsed.STORAGE_DIR),
  };
}
