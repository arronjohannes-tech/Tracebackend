import type { Pool, PoolClient } from "pg";
import { writeAudit, type AuditContext } from "../audit.js";
import type { AppConfig } from "../config.js";
import { withContext } from "../db.js";
import { AppError, badRequest } from "../errors.js";
import { parsePolygon } from "../geo.js";
import {
  createProcessClient,
  buildProcessRequest,
  extensionFor,
  ProcessApiError,
  type ProcessClient,
  type ProcessCredentials,
} from "../copernicus/process-client.js";
import {
  defaultProcessSettings,
  processSettingsSchema,
  type ProcessConfigUpdate,
  type ProcessSettings,
} from "../copernicus/process-settings.js";
import * as repository from "../repositories/copernicus-repository.js";
import { decryptSecret, encryptSecret } from "../security.js";
import type { AuthContext } from "../types.js";

export type ProcessRuntime = { settings: ProcessSettings; credentials: ProcessCredentials };
export type PlotInput = { id: string; polygon: unknown };
export type AnalysisResult = {
  plotId: string;
  storagePath: string;
  contentType: string;
  bytes: number;
  from: string;
  to: string;
};
export type AnalysisOutcome = {
  results: AnalysisResult[];
  failures: Array<{ plotId: string; message: string }>;
  skippedPlotIds: string[];
};

// A small area near Ljubljana, used only to verify credentials and settings.
const PROBE_POLYGON = {
  type: "Polygon" as const,
  coordinates: [[[14.45, 46.04], [14.5, 46.04], [14.5, 46.07], [14.45, 46.07], [14.45, 46.04]]],
};

function readSettings(raw: unknown): { settings: ProcessSettings; valid: boolean } {
  const parsed = processSettingsSchema.safeParse(raw ?? {});
  return parsed.success
    ? { settings: parsed.data, valid: true }
    : { settings: defaultProcessSettings(), valid: false };
}

export function adminConfigJson(
  row: repository.CopernicusConfigRow | null,
  satelliteEnabled: boolean,
) {
  const { settings, valid } = readSettings(row?.settings);
  const hasClientId = Boolean(row?.client_id_ciphertext);
  const hasClientSecret = Boolean(row?.client_secret_ciphertext);
  const configured = hasClientId && hasClientSecret;
  return {
    enabled: row?.enabled ?? false,
    hasClientId,
    hasClientSecret,
    configured,
    settings,
    settingsValid: valid,
    satelliteEnabled,
    // The analysis only runs when the existing satellite switch and this integration are both on.
    active: Boolean(row?.enabled) && configured && satelliteEnabled && valid,
    updatedAt: row?.updated_at?.toISOString() ?? null,
  };
}

export function createCopernicusService(
  pool: Pool,
  appConfig: AppConfig,
  client: ProcessClient = createProcessClient(),
) {
  const decrypt = (value: string) => decryptSecret(appConfig.CONFIG_ENCRYPTION_KEY, value);

  function credentialsOf(row: repository.CopernicusConfigRow | null): ProcessCredentials | null {
    if (!row?.client_id_ciphertext || !row.client_secret_ciphertext) return null;
    return {
      clientId: decrypt(row.client_id_ciphertext),
      clientSecret: decrypt(row.client_secret_ciphertext),
    };
  }

  return {
    async get(auth: AuthContext, organizationId: string) {
      return withContext(pool, auth, async (db) => {
        const row = await repository.selectConfig(db, organizationId);
        const api = await repository.selectSatelliteEnabled(db, organizationId);
        return adminConfigJson(row, Boolean(api?.satellite_enabled));
      });
    },

    async update(
      auth: AuthContext,
      request: AuditContext,
      organizationId: string,
      body: ProcessConfigUpdate,
    ) {
      const encrypt = (value: string | null | undefined) =>
        value === undefined ? undefined : value === null || value === ""
          ? null
          : encryptSecret(appConfig.CONFIG_ENCRYPTION_KEY, value);
      const clientId = encrypt(body.clientId);
      const clientSecret = encrypt(body.clientSecret);
      return withContext(pool, auth, async (db) => {
        const current = await repository.selectConfig(db, organizationId);
        const hasId = clientId === undefined ? Boolean(current?.client_id_ciphertext) : clientId !== null;
        const hasSecret = clientSecret === undefined
          ? Boolean(current?.client_secret_ciphertext)
          : clientSecret !== null;
        if (body.enabled && (!hasId || !hasSecret)) {
          throw badRequest(
            "CREDENTIALS_REQUIRED",
            "Client ID and client secret are required before the integration can be enabled.",
          );
        }
        const row = await repository.upsertConfig(db, {
          organizationId,
          enabled: body.enabled,
          clientId,
          clientSecret,
          settings: body.settings,
        });
        await writeAudit(db, request, auth, "copernicus_process.update", "organization", organizationId, {
          organizationId,
          enabled: body.enabled,
          dataset: body.settings.dataset,
          preset: body.settings.preset,
          secretsChanged: { clientId: clientId !== undefined, clientSecret: clientSecret !== undefined },
        });
        const api = await repository.selectSatelliteEnabled(db, organizationId);
        return adminConfigJson(row, Boolean(api?.satellite_enabled));
      });
    },

    async test(auth: AuthContext, request: AuditContext, organizationId: string) {
      const row = await withContext(pool, auth, (db) => repository.selectConfig(db, organizationId));
      const { settings, valid } = readSettings(row?.settings);
      let credentials: ProcessCredentials | null;
      try {
        credentials = credentialsOf(row);
      } catch {
        return { ok: false, stage: "config" as const, message: "The stored credentials cannot be decrypted.", durationMs: 0 };
      }
      if (!credentials || !valid) {
        return {
          ok: false,
          stage: "config" as const,
          message: !valid ? "The stored settings are invalid. Save the settings again." : "Client ID and client secret are not stored.",
          durationMs: 0,
        };
      }
      const started = Date.now();
      let outcome:
        | { ok: true; stage: null; message: string; contentType: string; bytes: number }
        | { ok: false; stage: "token" | "process"; message: string };
      try {
        await client.getToken(settings, credentials, true);
        const result = await client.process(
          settings,
          credentials,
          buildProcessRequest(settings, PROBE_POLYGON, new Date(), 64),
        );
        outcome = {
          ok: true,
          stage: null,
          message: "Authentication and Process API request succeeded.",
          contentType: result.contentType,
          bytes: result.bytes.length,
        };
      } catch (error) {
        outcome = error instanceof ProcessApiError
          ? { ok: false, stage: error.stage, message: error.message }
          : { ok: false, stage: "process", message: "The connection test failed unexpectedly." };
      }
      const durationMs = Date.now() - started;
      await withContext(pool, auth, (db) =>
        writeAudit(db, request, auth, "copernicus_process.test", "organization", organizationId, {
          organizationId,
          ok: outcome.ok,
          stage: outcome.stage,
        }));
      return { ...outcome, durationMs };
    },

    // Returns null when the organization is not (fully) set up; the caller then keeps the legacy behaviour.
    async loadRuntime(db: PoolClient, organizationId: string): Promise<ProcessRuntime | null> {
      const row = await repository.selectConfig(db, organizationId);
      const api = await repository.selectSatelliteEnabled(db, organizationId);
      if (!row?.enabled || !api?.satellite_enabled) return null;
      const { settings, valid } = readSettings(row.settings);
      if (!valid) return null;
      let credentials: ProcessCredentials | null;
      try {
        credentials = credentialsOf(row);
      } catch {
        return null;
      }
      return credentials ? { settings, credentials } : null;
    },

    async analyse(
      runtime: ProcessRuntime,
      plots: PlotInput[],
      persist: (plotId: string, bytes: Buffer, extension: string) => Promise<string>,
      now: Date = new Date(),
    ): Promise<AnalysisOutcome> {
      const { settings, credentials } = runtime;
      const selected = plots.slice(0, settings.maxPlotsPerRun);
      const outcome: AnalysisOutcome = {
        results: [],
        failures: [],
        skippedPlotIds: plots.slice(settings.maxPlotsPerRun).map((plot) => plot.id),
      };
      for (const plot of selected) {
        try {
          const body = buildProcessRequest(settings, parsePolygon(plot.polygon), now);
          const result = await client.process(settings, credentials, body);
          const storagePath = await persist(plot.id, result.bytes, extensionFor(settings.output.format));
          outcome.results.push({
            plotId: plot.id,
            storagePath,
            contentType: result.contentType,
            bytes: result.bytes.length,
            from: body.input.data[0]!.dataFilter.timeRange.from,
            to: body.input.data[0]!.dataFilter.timeRange.to,
          });
        } catch (error) {
          outcome.failures.push({
            plotId: plot.id,
            message: error instanceof ProcessApiError || error instanceof AppError
              ? error.message
              : "The plot could not be analysed.",
          });
        }
      }
      return outcome;
    },
  };
}

export type CopernicusService = ReturnType<typeof createCopernicusService>;
