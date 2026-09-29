import test from "node:test";
import assert from "node:assert/strict";
import { assertCanValidate, ddsPlotIds } from "../src/domain/dds.js";
test("validation cannot reopen an uncertain or in-flight DDS submission", () => {
 for (const phase of ["submitting", "reconciliation_required"]) assert.throws(() => assertCanValidate(phase), { code: "DDS_RECONCILIATION_REQUIRED" });
 for (const phase of ["draft", "validated", "submitted"]) assert.doesNotThrow(() => assertCanValidate(phase));
});
test("legacy DDS without explicit plot scope fails closed", () => {
 assert.throws(() => ddsPlotIds({}), { code: "DDS_SCOPE_REQUIRED" });
});
