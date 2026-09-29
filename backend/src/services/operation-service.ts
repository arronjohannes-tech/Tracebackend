import { createObjectStore } from "../infrastructure/object-store.js";
import { geometryHash, parsePolygon } from "../geo.js";
import * as repository from "../repositories/operation-repository.js";
import { assertCanValidate, ddsPlotIds } from "../domain/dds.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { writeAudit, type AuditContext } from "../audit.js";
import type { AppConfig } from "../config.js";
import { queryOne, withContext } from "../db.js";
import { AppError, conflict, notFound } from "../errors.js";
import type { AuthContext } from "../types.js";
import { EuSubmissionError, submitDds, type EuAdapterConfig } from "../soap.js";

export type OperationKind = "satellite" | "evidence_pack" | "dds";
export type OperationRow = {
  id: string;
  organization_id: string;
  kind: OperationKind;
  subject_id: string;
  status: string;
  phase: string | null;
  download_url: string | null;
  message: string | null;
  metadata: Record<string, unknown>;
  external_reference: string | null;
  updated_at: Date;
};
export type DdsActionName = "validate" | "submit";
export type StoredDdsActionResponse =
  | { ok: true; statusCode: number; data: ReturnType<typeof operationJson> }
  | {
      ok: false;
      statusCode: number;
      error: { code: string; message: string; details?: unknown };
    };
type DdsActionRow = {
  id: string;
  operation_id: string;
  action: DdsActionName;
  idempotency_key: string;
  status: "processing" | "completed" | "failed" | "uncertain";
  response: StoredDdsActionResponse | null;
};

export const createSchema = z.object({ subjectId: z.string().trim().min(1).max(200), plotIds: z.array(z.string().uuid()).min(1).max(500).optional() });

export function operationJson(row: OperationRow) {
  return {
    id: row.id,
    kind: row.kind,
    subjectId: row.subject_id,
    status: row.status,
    ...(row.download_url ? { downloadUrl: row.download_url } : {}),
    ...(row.message ? { message: row.message } : {}),
    ...(row.external_reference ? { externalReference: row.external_reference } : {}),
    phase: row.phase,
    updatedAt: row.updated_at.toISOString(),
  };
}

export function assertDdsActionBinding(
  action: Pick<DdsActionRow, "operation_id" | "action">,
  operationId: string,
  actionName: DdsActionName,
): void {
  if (action.operation_id !== operationId || action.action !== actionName) {
    throw conflict(
      "IDEMPOTENCY_KEY_REUSED",
      "The idempotency key was already used for another DDS operation or action.",
    );
  }
}

function storedError(error: AppError): StoredDdsActionResponse {
  return {
    ok: false,
    statusCode: error.statusCode,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}

export function replayDdsAction(
  action: Pick<DdsActionRow, "status" | "response">,
): StoredDdsActionResponse {
  if (action.response) return action.response;
  if (action.status === "processing") {
    return storedError(conflict(
      "DDS_ACTION_PROCESSING",
      "This DDS action is already processing and will not be submitted again.",
    ));
  }
  return storedError(conflict(
    "DDS_RECONCILIATION_REQUIRED",
    "The previous DDS result is uncertain and requires administrator reconciliation.",
  ));
}

async function lockDdsActionKey(
  client: PoolClient,
  organizationId: string,
  idempotencyKey: string,
): Promise<void> {
  await repository.selectRecords(client, [`${organizationId}:${idempotencyKey}`]);
}

async function findDdsAction(
  client: PoolClient,
  organizationId: string,
  idempotencyKey: string,
): Promise<DdsActionRow | null> {
  return repository.selectDdsActions<DdsActionRow>(client, [organizationId, idempotencyKey]);
}

async function createDdsAction(
  client: PoolClient,
  organizationId: string,
  operationId: string,
  action: DdsActionName,
  idempotencyKey: string,
  userId: string,
): Promise<DdsActionRow> {
  return (await repository.insertDdsActions<DdsActionRow>(client, [organizationId, operationId, action, idempotencyKey, userId]))!;
}

async function completeDdsAction(
  client: PoolClient,
  actionId: string,
  status: "completed" | "failed" | "uncertain",
  response: StoredDdsActionResponse,
  errorCode: string | null = null,
): Promise<void> {
  await repository.updateDdsActions(client, [actionId, status, JSON.stringify(response), errorCode]);
}

async function assertNoPendingGeofence(client: PoolClient, organizationId: string, metadata: Record<string, unknown>): Promise<void> {
 const plotIds = ddsPlotIds(metadata);
 const plots = await repository.scopedPlotGeofences(client, organizationId, plotIds);
 if (plots.length !== plotIds.length) throw conflict("DDS_PLOT_NOT_FOUND", "All referenced plots must exist in this organization.");
 const pending = plots.filter(plot=>!plot.geofences_exist || (!plot.covered && !plot.approved_hashes.includes(geometryHash(parsePolygon(plot.polygon)))));
 if (pending.length) throw conflict("GEOFENCE_REVIEW_REQUIRED", "The referenced plots require geofence review.", {plotIds:pending.map(plot=>plot.id)});
}

async function loadOperation(
  client: PoolClient,
  organizationId: string,
  kind: OperationKind,
  id: string,
  forUpdate = false,
): Promise<OperationRow> {
  const row = await repository.selectOperationalRequests<OperationRow>(client, [id, organizationId, kind], forUpdate ? "FOR UPDATE" : "");
  if (!row) throw notFound("Operation");
  return row;
}


export type CreateOperationInput = z.infer<typeof createSchema>;
export function createOperationService(pool: Pool, config: AppConfig) {
 const store = createObjectStore(config);
  async function createOperation(auth: AuthContext, request: AuditContext, kind: OperationKind, body: CreateOperationInput, idempotencyKey: string): Promise<{ operation: OperationRow; created: boolean }> {
    if (!auth.organizationId) throw new AppError(403, "ORGANIZATION_REQUIRED", "Organization user required.");
    if (!["org_admin", "reviewer", "field_agent"].includes(auth.role)) {
      throw new AppError(403, "FORBIDDEN", "This role cannot create operational requests.");
    }
    return withContext(pool, auth, async (client) => {
      await repository.lockOperationKey(client, auth.organizationId!, kind, idempotencyKey);
      const existing = await repository.selectOperationalRequests2<OperationRow>(client, [auth.organizationId, kind, idempotencyKey]);
      if (existing) {
        if (existing.subject_id !== body.subjectId || (kind === "dds" && JSON.stringify(existing.metadata.plotIds) !== JSON.stringify(body.plotIds))) {
          throw conflict(
            "IDEMPOTENCY_KEY_REUSED",
            "The idempotency key was already used for another subject.",
          );
        }
        return { operation: existing, created: false };
      }
      if (kind === "dds") await assertNoPendingGeofence(client, auth.organizationId!, { plotIds: body.plotIds });
      const apiConfig = await repository.selectOrganizationApiConfig<{
        satellite_enabled: boolean;
        evidence_pack_enabled: boolean;
      }>(client, [auth.organizationId]);
      const enabled = kind === "satellite"
        ? Boolean(apiConfig?.satellite_enabled)
        : kind === "evidence_pack"
          ? (apiConfig?.evidence_pack_enabled ?? true)
          : true;
      const row = await repository.insertOperationalRequests<OperationRow>(client, [
          auth.organizationId,
          kind,
          body.subjectId,
          enabled ? "queued" : "not_configured",
          kind === "dds" ? "draft" : null,
          enabled ? null : `${kind} integration is disabled for this organization.`,
          idempotencyKey,
          auth.userId,
          JSON.stringify({ plotIds: body.plotIds ?? [] }),
        ]);
      if (kind === "dds") {
        await repository.insertReviewRequests(client, [auth.organizationId, row!.id, auth.userId]);
      }
      await writeAudit(client, request, auth, `${kind}.create`, kind, row!.id, {
        subjectId: body.subjectId,
      });
      return { operation: row!, created: true };
    });
  }

async function validate(auth: AuthContext, request: AuditContext, id: string, idempotencyKey: string): Promise<StoredDdsActionResponse> {
    if (!auth.organizationId) throw new AppError(403, "ORGANIZATION_REQUIRED", "Organization user required.");
    if (!["org_admin", "reviewer", "field_agent"].includes(auth.role)) {
      throw new AppError(403, "FORBIDDEN", "This role cannot validate DDS drafts.");
    }
    const response = await withContext(pool, auth, async (client) => {
      await lockDdsActionKey(client, auth.organizationId!, idempotencyKey);
      const previous = await findDdsAction(client, auth.organizationId!, idempotencyKey);
      if (previous) {
        assertDdsActionBinding(previous, id, "validate");
        return replayDdsAction(previous);
      }
      const current = await loadOperation(client, auth.organizationId!, "dds", id, true);
      const action = await createDdsAction(
        client,
        auth.organizationId!,
        id,
        "validate",
        idempotencyKey,
        auth.userId,
      );
      try {
        assertCanValidate(current.phase);
        await assertNoPendingGeofence(client, auth.organizationId!, current.metadata);
        const result = current.phase === "submitted"
          ? current
          : (await repository.updateOperationalRequests<OperationRow>(client, [id]))!;
        const success: StoredDdsActionResponse = {
          ok: true,
          statusCode: 200,
          data: operationJson(result),
        };
        await completeDdsAction(client, action.id, "completed", success);
        await writeAudit(client, request, auth, "dds.validate", "dds", id, {
          idempotencyKey,
        });
        return success;
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        const failure = storedError(error);
        await completeDdsAction(client, action.id, "failed", failure, error.code);
        return failure;
      }
    });
    return response;
}
async function submit(auth: AuthContext, request: AuditContext, id: string, idempotencyKey: string): Promise<StoredDdsActionResponse> {
    if (!auth.organizationId) throw new AppError(403, "ORGANIZATION_REQUIRED", "Organization user required.");
    if (auth.role !== "org_admin") {
      throw new AppError(403, "FORBIDDEN", "Only an organization administrator may submit DDS drafts.");
    }
    const prepared = await withContext(pool, auth, async (client) => {
      await lockDdsActionKey(client, auth.organizationId!, idempotencyKey);
      const previous = await findDdsAction(client, auth.organizationId!, idempotencyKey);
      if (previous) {
        assertDdsActionBinding(previous, id, "submit");
        return { response: replayDdsAction(previous) } as const;
      }
      const operation = await loadOperation(client, auth.organizationId!, "dds", id, true);
      const action = await createDdsAction(
        client,
        auth.organizationId!,
        id,
        "submit",
        idempotencyKey,
        auth.userId,
      );
      try {
        await assertNoPendingGeofence(client, auth.organizationId!, operation.metadata);
        if (operation.phase === "submitted") {
          const success: StoredDdsActionResponse = {
            ok: true,
            statusCode: 200,
            data: operationJson(operation),
          };
          await completeDdsAction(client, action.id, "completed", success);
          return { response: success } as const;
        }
        if (operation.phase === "submitting" || operation.phase === "reconciliation_required") {
          throw conflict(
            "DDS_RECONCILIATION_REQUIRED",
            "A previous submission has no definitive result and must be reconciled by an administrator.",
          );
        }
        if (operation.phase !== "validated") {
          throw conflict("DDS_NOT_VALIDATED", "The DDS draft must be validated before submission.");
        }
        const review = await repository.selectReviewRequests<{ status: string }>(client, [auth.organizationId, id]);
        if (review?.status !== "approved") {
          throw conflict("REVIEW_REQUIRED", "The DDS draft requires administrator or reviewer approval.");
        }
        const adapter = await repository.selectOrganizationApiConfig2<{
          eu_mode: "mock" | "live";
          eu_endpoint: string | null;
          eu_timeout_ms: number;
          eu_username_ciphertext: string | null;
          eu_password_ciphertext: string | null;
          eu_client_id_ciphertext: string | null;
        }>(client, [auth.organizationId]);
        if (!adapter) throw conflict("EU_NOT_CONFIGURED", "EU adapter configuration is missing.");
        await repository.updateOperationalRequests2(client, [id]);
        return {
          actionId: action.id,
          operation,
          adapter: {
            mode: adapter.eu_mode,
            endpoint: adapter.eu_endpoint,
            timeoutMs: adapter.eu_timeout_ms,
            usernameCiphertext: adapter.eu_username_ciphertext,
            passwordCiphertext: adapter.eu_password_ciphertext,
            clientIdCiphertext: adapter.eu_client_id_ciphertext,
          } satisfies EuAdapterConfig,
        } as const;
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        const failure = storedError(error);
        await completeDdsAction(client, action.id, "failed", failure, error.code);
        return { response: failure } as const;
      }
    });
    if ("response" in prepared) return prepared.response;

    try {
      const submission = await submitDds(config, prepared.adapter, {
        id: prepared.operation.id,
        organizationId: auth.organizationId,
        subjectId: prepared.operation.subject_id,
      });
      const response = await withContext(pool, auth, async (client) => {
        const action = await repository.selectDdsActions2<DdsActionRow>(client, [prepared.actionId]);
        if (!action) throw notFound("DDS action");
        if (action.status !== "processing") return replayDdsAction(action);
        const row = await repository.updateOperationalRequests3<OperationRow>(client, [
            id,
            submission.reference,
            submission.mock ? "Submitted in safe mock mode." : "Submitted to EU EUDR V3.",
          ]);
        const success: StoredDdsActionResponse = {
          ok: true,
          statusCode: 200,
          data: operationJson(row!),
        };
        await completeDdsAction(client, action.id, "completed", success);
        await writeAudit(client, request, auth, "dds.submit", "dds", id, {
          mock: submission.mock,
          reference: submission.reference,
          idempotencyKey,
        });
        return success;
      });
      return response;
    } catch (error) {
      const uncertain = !(error instanceof EuSubmissionError) || error.outcome === "uncertain";
      const appError = uncertain
        ? conflict(
          "DDS_RECONCILIATION_REQUIRED",
          "The EU submission result is uncertain and requires administrator reconciliation.",
        )
        : new AppError(
          502,
          "EU_SUBMISSION_FAILED",
          "The EU service definitively rejected the submission.",
        );
      const response = await withContext(pool, auth, async (client) => {
        const action = await repository.selectDdsActions3<DdsActionRow>(client, [prepared.actionId]);
        if (!action) throw notFound("DDS action");
        if (action.status !== "processing") return replayDdsAction(action);
        const failure = storedError(appError);
        await client.query(
          uncertain
            ? `UPDATE operational_requests
                  SET status = 'failed', phase = 'reconciliation_required',
                      message = 'Submission outcome is uncertain; administrator reconciliation is required.'
                WHERE id = $1`
            : `UPDATE operational_requests
                  SET status = 'completed', phase = 'validated',
                      message = 'EU submission failed definitively and may be retried with a new idempotency key.'
                WHERE id = $1`,
          [id],
        );
        await completeDdsAction(
          client,
          action.id,
          uncertain ? "uncertain" : "failed",
          failure,
          appError.code,
        );
        await writeAudit(
          client,
          request,
          auth,
          uncertain ? "dds.submit.uncertain" : "dds.submit.failed",
          "dds",
          id,
          { idempotencyKey },
        );
        return failure;
      });

      return response;
    }
}

 async function create(auth: AuthContext, audit: AuditContext, kind: OperationKind, body: CreateOperationInput, key: string) {
  const result = await createOperation(auth, audit, kind, body, key);
  let operation=result.operation;
  if (kind !== "dds" && operation.status === "queued") {
   operation=await withContext(pool,auth,async client=>{
    const current=await loadOperation(client,auth.organizationId!,kind,operation.id,true);
    if(current.status!=="queued") return current;
    if(kind==="satellite") return (await repository.finishAuxiliary<OperationRow>(client,current.id,"mock_screened","Mock screening only; no satellite provider was called.",null,{provider:"safe-mock",mock:true}))!;
    const storagePath="evidence/"+auth.organizationId+"/"+current.id+".json";
    const bytes=Buffer.from(JSON.stringify({schemaVersion:1,organizationId:auth.organizationId,subjectId:current.subject_id,notice:"Review summary only; no verified evidence attachments are included."},null,2));
    await store.put(storagePath,bytes);
    return (await repository.finishAuxiliary<OperationRow>(client,current.id,"generated","Review summary generated.",config.PUBLIC_BASE_URL+"/api/v1/operations/"+current.id+"/download",{storagePath}))!;
   });
  }
  return {data: operationJson(operation), statusCode: result.created ? 201 : 200};
 }
 async function get(auth: AuthContext, kind: OperationKind, id: string) {
  if (!auth.organizationId) throw new AppError(403, "ORGANIZATION_REQUIRED", "Organization user required.");
  return withContext(pool, auth, async client => operationJson(await loadOperation(client, auth.organizationId!, kind, id)));
 }
 async function download(auth: AuthContext,id:string) {
  if(!auth.organizationId) throw new AppError(403,"ORGANIZATION_REQUIRED","Organization user required.");
  const operation=await withContext(pool,auth,client=>loadOperation(client,auth.organizationId!,"evidence_pack",id));
  if(operation.status!=="completed" || typeof operation.metadata.storagePath!=="string") throw notFound("Evidence pack");
  return store.get(operation.metadata.storagePath);
 }
 return {create, get, validate, submit, download};
}
