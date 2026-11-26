import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient, QueryResult } from "pg";
import { AppError } from "../src/errors.js";
import type { PushOperation } from "../src/domain/sync-contract.js";
import { applyPlot, plotJson } from "../src/repositories/sync-repository.js";
import { pushSchema } from "../src/domain/sync-contract.js";

const organizationId = "b23815e3-8701-41bc-b0a4-168f07521dd5";
const supplierId = "c2314a55-b213-4dce-8754-f144cd93848a";
const shipmentId = "37b69e74-9033-44eb-a833-cb0f8bb3fe94";

function linkedPlotOperation(): Extract<PushOperation, { entityType: "plot" }> {
  const now = "2026-09-14T20:00:00.000Z";
  return {
    id: "0cf63e4f-f37b-4505-9d28-eb06cfa8c72a",
    idempotencyKey: "plot-shipment-link",
    entityId: "1db48d88-b22f-42db-8d9d-20bcb14c0f27",
    entityType: "plot",
    action: "upsert",
    baseVersion: 0,
    createdAt: now,
    payload: {
      id: "1db48d88-b22f-42db-8d9d-20bcb14c0f27",
      supplierId,
      shipmentId,
      producer: "Producer",
      farmName: "Farm",
      areaHa: "1",
      polygon: { type: "Polygon", coordinates: [[[8, 50], [9, 50], [9, 51], [8, 50]]] },
      capturedAt: now,
      updatedAt: now,
    },
  };
}

test("plot sync rejects a shipment when its supplier does not match the plot supplier", async () => {
  let insertedPlot = false;
  const client = {
    async query(text: string): Promise<QueryResult> {
      if (text.includes("FROM plots")) return { rows: [], rowCount: 0 } as unknown as QueryResult;
      if (text.includes("FROM shipments")) {
        return { rows: [{ supplier_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }], rowCount: 1 } as unknown as QueryResult;
      }
      if (text.includes("INSERT INTO plots")) insertedPlot = true;
      return { rows: [], rowCount: 0 } as unknown as QueryResult;
    },
  } as unknown as PoolClient;

  await assert.rejects(
    applyPlot(
      client,
      organizationId,
      linkedPlotOperation(),
      linkedPlotOperation().payload.polygon as { type: "Polygon"; coordinates: number[][][] },
      { geofenceStatus: "pending", localGeofenceResult: "pending" },
    ),
    (error) => error instanceof AppError && error.code === "SHIPMENT_SUPPLIER_MISMATCH",
  );
  assert.equal(insertedPlot, false);
});

test("plot sync serialization includes an associated shipment id", () => {
  const serialized = plotJson({
    id: "1db48d88-b22f-42db-8d9d-20bcb14c0f27",
    revision: 1,
    supplier_id: supplierId,
    shipment_id: shipmentId,
    producer: "Producer",
    farm_name: "Farm",
    area_ha: "1",
    polygon: { type: "Polygon", coordinates: [] },
    geofence_status: "pending",
    local_geofence_result: "pending",
    captured_at: new Date("2026-09-14T20:00:00.000Z"),
    source_updated_at: new Date("2026-09-14T20:00:00.000Z"),
  });

  assert.equal(serialized.shipmentId, shipmentId);
});

test("plot region is validated and returned in sync responses", () => {
  const operation = linkedPlotOperation();
  operation.payload.region = "Oromia";
  assert.equal(pushSchema.parse({ deviceId: "device", operations: [operation] }).operations[0]?.payload.region, "Oromia");
  assert.equal(pushSchema.safeParse({ deviceId: "device", operations: [
    { ...operation, payload: { ...operation.payload, region: "x".repeat(201) } },
  ] }).success, false);
  const result = plotJson({ region: "Oromia", area_ha: "1", revision: 1 });
  assert.equal(result.region, "Oromia");
});
