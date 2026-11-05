import test from "node:test";
import assert from "node:assert/strict";
import { canRequestSatellite, satelliteOutcome } from "../src/satellite.mjs";

test("satellite start permissions match the operational API", () => {
  for (const role of ["org_admin", "reviewer", "field_agent"]) assert.equal(canRequestSatellite(role), true);
  for (const role of ["system_admin", "auditor", undefined, "unknown"]) assert.equal(canRequestSatellite(role), false);
});

test("mock completion must never appear as satellite evidence", () => {
  assert.equal(satelliteOutcome({ status: "completed", phase: "mock_screened" }, "a"), "mock");
});

test("satellite result status is specific to the plot, not just the operation", () => {
  const operation = { status: "completed", results: [{ plotId: "a" }] };
  assert.equal(satelliteOutcome(operation, "a"), "completed");
  assert.equal(satelliteOutcome(operation, "b"), "noResult");
  assert.equal(satelliteOutcome({ status: "completed" }, "a"), "noResult");
});

test("unconfigured, running and failed requests retain explicit outcomes", () => {
  assert.equal(satelliteOutcome({ status: "not_configured" }, "a"), "notConfigured");
  assert.equal(satelliteOutcome({ status: "queued" }, "a"), "running");
  assert.equal(satelliteOutcome({ status: "processing" }, "a"), "running");
  assert.equal(satelliteOutcome({ status: "failed" }, "a"), "failed");
});
