import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { withContext } from "../db.js";
import { writeAudit, type AuditContext } from "../audit.js";
import { AppError, conflict } from "../errors.js";
import { parsePolygon } from "../geo.js";
import type { AuthContext, GeoJsonPolygon } from "../types.js";
import type { PushOperation, GeofenceEvaluation, GeofenceViolationDetail } from "../domain/sync-contract.js";
import * as repository from "../repositories/sync-repository.js";

function requireOrganization(auth: AuthContext): string {
 if (!auth.organizationId) throw new AppError(403, "ORGANIZATION_REQUIRED", "An organization-scoped account is required.");
 return auth.organizationId;
}
function canonical(value: unknown): string {
 if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
 if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+":"+canonical(item)).join(",") + "}";
 return JSON.stringify(value) ?? "null";
}
export function operationHash(operation: PushOperation): string {
 return createHash("sha256").update(canonical(operation)).digest("hex");
}
export function createSyncService(pool: Pool) {
 return {
 async push(auth: AuthContext, audit: AuditContext, body: {deviceId: string; operations: PushOperation[]}) {
  const organizationId = requireOrganization(auth);
  if (!["org_admin", "field_agent"].includes(auth.role)) throw new AppError(403, "FORBIDDEN", "This role cannot push mobile changes.");
  const polygons = new Map<string, GeoJsonPolygon>();
  for (const operation of body.operations) {
   if (operation.entityId !== operation.payload.id) throw conflict("ENTITY_ID_MISMATCH", "Operation entityId must equal payload.id.");
   if (operation.entityType === "plot") polygons.set(operation.id, parsePolygon(operation.payload.polygon));
  }
  const result = await withContext(pool, auth, async client => {
   // Acquire before row locks and sequence assignment; held until commit.
   await repository.lockTenantSync(client, organizationId);
   const violations: GeofenceViolationDetail[] = [];
   const evaluations = new Map<string, GeofenceEvaluation>();
   const previous = new Map<string, NonNullable<Awaited<ReturnType<typeof repository.previousOperation>>>>();
   for (const operation of body.operations) {
    const stored = await repository.previousOperation(client, organizationId, operation.idempotencyKey);
    if (stored) {
     if (stored.operation_id !== operation.id || stored.request_hash !== operationHash(operation)) throw conflict("IDEMPOTENCY_KEY_REUSED", "The operation content does not match its idempotency key.");
     previous.set(operation.id, stored);
     continue;
    }
    if (operation.entityType === "plot") {
     const evaluation = await repository.checkGeofence(client, organizationId, operation, polygons.get(operation.id)!);
     evaluations.set(operation.id, evaluation);
     if (evaluation.violationId) violations.push({ violationId: evaluation.violationId, operationId: operation.id, entityId: operation.entityId });
    }
   }
   if (violations.length) {
    await writeAudit(client, audit, auth, "sync.blocked.geofence", "sync", body.deviceId, {violations});
    return { violations, accepted: [] as string[], conflicts: [] as Record<string, unknown>[], applied: [] as Record<string, unknown>[] };
   }
   const accepted: string[] = [], conflicts: Record<string, unknown>[] = [], applied: Record<string, unknown>[] = [];
   const ordered = [...body.operations].sort((a,b)=>a.entityType === b.entityType ? 0 : a.entityType === "supplier" ? -1 : 1);
   for (const operation of ordered) {
    let response = previous.get(operation.id)?.response;
    if (!response) {
     const outcome = operation.entityType === "supplier"
      ? await repository.applySupplier(client, organizationId, operation)
      : await repository.applyPlot(client, organizationId, operation, polygons.get(operation.id)!, evaluations.get(operation.id)!);
     response = outcome.conflict ? {accepted: false, remote: outcome.conflict} : {accepted: true, resource: outcome.payload};
     await repository.saveOperation(client, organizationId, operation, operationHash(operation), response);
    }
    if (response.accepted) {
     accepted.push(operation.id);
     if (response.resource) applied.push({operationId: operation.id, resource: response.resource});
    } else conflicts.push({ operationId: operation.id, entityType: operation.entityType, entityId: operation.entityId, remote: response.remote });
   }
   await writeAudit(client, audit, auth, "sync.push", "device", body.deviceId, {accepted: accepted.length, conflicts: conflicts.length});
   return { violations, accepted, conflicts, applied };
  });
  if (result.violations.length) throw conflict("GEOFENCE_REVIEW_REQUIRED", "The referenced plots require review.", {violations: result.violations});
  return {accepted: result.accepted, conflicts: result.conflicts, applied: result.applied};
 },
 async pull(auth: AuthContext, cursor: string, limit: number) {
  const org = requireOrganization(auth);
  const changes = await withContext(pool, auth, client=>repository.getChanges(client, org, cursor, limit + 1));
  const hasMore = changes.length > limit, page = changes.slice(0, limit);
  return { cursor: page.length ? String(page.at(-1)!.sequence_id) : cursor, hasMore, changes: page.map(change=>({entityType: change.entity_type, entity: change.payload})) };
 },
 async geofences(auth: AuthContext) {
  const org = requireOrganization(auth);
  return withContext(pool, auth, client=>repository.getGeofences(client, org));
 }
 };
}
