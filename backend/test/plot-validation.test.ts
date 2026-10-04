import assert from "node:assert/strict";
import test from "node:test";
import { isAreaPlausible, validatePlot, type PlotValidationInput } from "../src/domain/plot-validation.js";

const input = (overrides: Partial<PlotValidationInput> = {}): PlotValidationInput => ({
  geofenceStatus: "inside",
  areaHa: 2.7,
  computedAreaHa: 2.68,
  valid: true,
  simple: true,
  duplicateCount: 0,
  eoStatus: null,
  eoPhase: null,
  ...overrides,
});

test("a clean plot passes every check except the pending satellite analysis", () => {
  const result = validatePlot(input());
  assert.equal(result.geofence.state, "ok");
  assert.equal(result.area.state, "ok");
  assert.equal(result.selfIntersection.state, "ok");
  assert.equal(result.duplicate.state, "ok");
  assert.equal(result.eo.state, "pending");
});

test("geofence results map to ok, fail or pending", () => {
  const state = (geofenceStatus: string) => validatePlot(input({ geofenceStatus })).geofence.state;
  assert.equal(state("inside"), "ok");
  assert.equal(state("approved"), "ok");
  assert.equal(state("outside"), "fail");
  assert.equal(state("review_required"), "fail");
  assert.equal(state("pending"), "pending");
});

test("area plausibility compares the recorded value with the polygon and enforces bounds", () => {
  assert.equal(isAreaPlausible(2.7, 2.68), true);
  assert.equal(isAreaPlausible(0.12, 0.1), true);
  assert.equal(isAreaPlausible(4, 2.68), false);
  assert.equal(isAreaPlausible(0.001, 0.001), false);
  assert.equal(isAreaPlausible(900, 900), false);
  assert.equal(isAreaPlausible(Number.NaN, 1), false);
});

test("invalid geometry and duplicates are reported", () => {
  assert.equal(validatePlot(input({ valid: false })).selfIntersection.state, "fail");
  assert.equal(validatePlot(input({ simple: false })).selfIntersection.state, "fail");
  const duplicate = validatePlot(input({ duplicateCount: 2 })).duplicate;
  assert.deepEqual(duplicate, { state: "fail", count: 2 });
});

test("only a real completed analysis counts as earth-observation evidence", () => {
  const state = (eoStatus: string | null, eoPhase: string | null = null) =>
    validatePlot(input({ eoStatus, eoPhase })).eo.state;
  assert.equal(state("completed", "analysed"), "ok");
  assert.equal(state("completed", "mock_screened"), "pending");
  assert.equal(state("failed", "failed"), "fail");
  assert.equal(state("processing"), "pending");
  assert.equal(state(null), "pending");
});
