import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { queryOne, withContext } from "../db.js";
import { badRequest } from "../errors.js";
import { decryptSecret, encryptSecret } from "../security.js";
import { writeAudit, type AuditContext } from "../audit.js";
import type { AuthContext } from "../types.js";

export const googleMapsConfigSchema = z.object({
  enabled: z.boolean(),
  apiKey: z.string().trim().min(20).max(256).regex(/^[A-Za-z0-9_-]+$/).nullable().optional(),
});

type ConfigRow = { enabled: boolean; api_key_ciphertext: string | null };
const status = (row: ConfigRow | null) => ({
  enabled: row?.enabled ?? false, hasApiKey: Boolean(row?.api_key_ciphertext),
});

export function createGoogleMapsService(pool: Pool, config: AppConfig) {
  const read = (auth: AuthContext, organizationId: string) => withContext(pool, auth, (client) =>
    queryOne<ConfigRow>(client,
      "SELECT enabled,api_key_ciphertext FROM organization_google_maps_config WHERE organization_id=$1",
      [organizationId]));
  return {
    async adminConfig(auth: AuthContext, organizationId: string) {
      return status(await read(auth, organizationId));
    },
    async browserConfig(auth: AuthContext, organizationId: string) {
      const row = await read(auth, organizationId);
      return {
        enabled: row?.enabled ?? false,
        apiKey: row?.enabled && row.api_key_ciphertext
          ? decryptSecret(config.CONFIG_ENCRYPTION_KEY, row.api_key_ciphertext) : null,
      };
    },
    async save(auth: AuthContext, organizationId: string, body: z.output<typeof googleMapsConfigSchema>, audit: AuditContext) {
      return withContext(pool, auth, async (client) => {
        await client.query(
          "INSERT INTO organization_google_maps_config(organization_id) VALUES($1) ON CONFLICT DO NOTHING",
          [organizationId]);
        const row = await queryOne<ConfigRow>(client,
          "SELECT enabled,api_key_ciphertext FROM organization_google_maps_config WHERE organization_id=$1 FOR UPDATE",
          [organizationId]);
        const ciphertext = body.apiKey === undefined ? row?.api_key_ciphertext ?? null
          : body.apiKey === null ? null : encryptSecret(config.CONFIG_ENCRYPTION_KEY, body.apiKey);
        if (body.enabled && !ciphertext) {
          throw badRequest("GOOGLE_MAPS_KEY_REQUIRED", "Save a Google Maps browser API key before enabling Google Maps.");
        }
        await client.query(
          "UPDATE organization_google_maps_config SET enabled=$2,api_key_ciphertext=$3 WHERE organization_id=$1",
          [organizationId, body.enabled, ciphertext]);
        await writeAudit(client, audit, auth, "google_maps_config.update", "organization", organizationId, {
          organizationId, enabled: body.enabled, apiKeyChanged: body.apiKey !== undefined,
        });
        return { enabled: body.enabled, hasApiKey: Boolean(ciphertext) };
      });
    },
  };
}
