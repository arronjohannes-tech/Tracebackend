import { conflict } from "../errors.js";
export function assertCanValidate(phase: string | null): void {
 if (phase === "submitting" || phase === "reconciliation_required") {
  throw conflict("DDS_RECONCILIATION_REQUIRED", "A pending or uncertain submission must be reconciled before validation.");
 }
 if (!["draft", "validated", "submitted"].includes(phase ?? "")) {
  throw conflict("DDS_INVALID_STATE", "This DDS state cannot be validated.");
 }
}
export function ddsPlotIds(metadata: Record<string, unknown>): string[] {
 const ids = metadata.plotIds;
 if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) {
  throw conflict("DDS_SCOPE_REQUIRED", "Explicit plot references are required for this DDS draft.");
 }
 return [...new Set(ids as string[])];
}
