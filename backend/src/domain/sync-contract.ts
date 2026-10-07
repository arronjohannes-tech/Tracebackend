import { z } from "zod";
const supplierPayload = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  region: z.string().max(200),
  producerCount: z.number().int().min(0),
  plotCount: z.number().int().min(0),
  updatedAt: z.string().datetime(),
}).passthrough();
const plotPayload = z.object({
  id: z.string().uuid(),
  supplierId: z.string().uuid().optional(),
  documentId: z.string().uuid().optional(),
  producer: z.string().trim().min(1).max(200),
  farmName: z.string().trim().min(1).max(200),
  areaHa: z.string().refine((value) => Number.isFinite(Number(value)) && Number(value) > 0),
  polygon: z.unknown(),
  trackPoints: z.array(z.object({
    position: z.tuple([
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
    ]),
    accuracyM: z.number().nonnegative().nullable(),
    capturedAt: z.string().datetime(),
  })).max(10000).optional(),
  capturedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).passthrough();
const operationBase = z.object({
  id: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(200),
  entityId: z.string().uuid(),
  action: z.literal("upsert"),
  baseVersion: z.number().int().min(0).default(0),
  createdAt: z.string().datetime(),
});
export const pushSchema = z.object({
  deviceId: z.string().min(1).max(200),
  operations: z.array(z.discriminatedUnion("entityType", [
    operationBase.extend({ entityType: z.literal("supplier"), payload: supplierPayload }),
    operationBase.extend({ entityType: z.literal("plot"), payload: plotPayload }),
  ])).max(500).refine(operations => new Set(operations.map(op => op.id)).size === operations.length, "Duplicate operation ids are not allowed."),
});
export type PushOperation = z.infer<typeof pushSchema>["operations"][number];
export type GeofenceEvaluation = {
  geofenceStatus: "pending" | "inside" | "review_required" | "approved";
  localGeofenceResult: "pending" | "inside" | "outside";
};
export type GeofenceCheckResult = GeofenceEvaluation & { violationId: string | null };
export type GeofenceViolationDetail = {
  violationId: string;
  operationId: string;
  entityId: string;
};

export function classifyGeofenceResult(check: {
  geofencesExist: boolean;
  covered: boolean;
  approved: boolean;
}): GeofenceEvaluation {
  if (!check.geofencesExist) {
    return { geofenceStatus: "pending", localGeofenceResult: "pending" };
  }
  if (check.covered) {
    return { geofenceStatus: "inside", localGeofenceResult: "inside" };
  }
  if (check.approved) {
    return { geofenceStatus: "approved", localGeofenceResult: "outside" };
  }
  return { geofenceStatus: "review_required", localGeofenceResult: "outside" };
}
