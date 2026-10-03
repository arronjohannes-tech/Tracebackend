import test from "node:test";
import assert from "node:assert/strict";

import { editionPage } from "../src/edition.mjs";
import { format } from "../src/i18n-prod.mjs";

test("edition pages carry the demo and prod suffix", () => {
  assert.equal(editionPage("demo"), "index-demo.html");
  assert.equal(editionPage("prod"), "index-prod.html");
  assert.equal(editionPage(undefined), "index-prod.html");
});

test("format fills placeholders and keeps unknown ones visible", () => {
  assert.equal(format("{n} von {m}", { n: 1, m: 2 }), "1 von 2");
  assert.equal(format("Sendung {ref}", {}), "Sendung {ref}");
});
