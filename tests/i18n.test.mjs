import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  SUPPORTED_LANGUAGES,
  translate,
  translations,
} from "../src/i18n.mjs";

test("all supported languages contain the same translation keys", () => {
  const reference = Object.keys(translations.de).sort();

  for (const language of SUPPORTED_LANGUAGES) {
    assert.deepEqual(Object.keys(translations[language]).sort(), reference);
  }
});

test("translation lookup resolves German, English, and Amharic", () => {
  assert.equal(translate("de", "nav.overview"), "Überblick");
  assert.equal(translate("en", "nav.overview"), "Overview");
  assert.equal(translate("am", "nav.overview"), "አጠቃላይ እይታ");
});

const keyPattern =
  /data-(?:i18n|i18n-aria-label|i18n-content|title-key|toast-key)="([^"]+)"/g;

for (const page of ["index-demo.html", "index-prod.html"]) {
  test(`all translation keys referenced by ${page} exist`, async () => {
    const html = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
    const referencedKeys = [...html.matchAll(keyPattern)].map((match) => match[1]);

    assert.ok(referencedKeys.length > 0);

    for (const language of SUPPORTED_LANGUAGES) {
      const missingKeys = referencedKeys.filter(
        (key) => !Object.hasOwn(translations[language], key),
      );
      assert.deepEqual(missingKeys, [], `${language} is missing UI translation keys`);
    }
  });
}

test("all translation keys used by the production script exist", async () => {
  const script = await readFile(new URL("../app-prod.js", import.meta.url), "utf8");
  const keys = [...script.matchAll(/\bt\(\s*"([\w.]+)"/g)].map((match) => match[1]);
  const dynamic = [
    ...["system_admin", "org_admin", "reviewer", "field_agent", "auditor"].map((role) => `prod.role.${role}`),
    ...["planned", "in_transit", "arrived", "cancelled"].map((status) => `prod.status.${status}`),
    ...["pending", "inside", "outside", "review_required", "approved", "rejected"].map((status) => `prod.status.${status}`),
    ...["queued", "processing", "completed", "failed", "not_configured", "initiated", "uploaded"].map((status) => `prod.status.${status}`),
    ...["satellite", "evidence_pack", "dds"].map((kind) => `prod.kind.${kind}`),
    ...["geofence", "dds"].map((type) => `prod.review.${type}`),
    ...["pending", "inside", "outside", "review_required", "approved"].map((status) => `prod.val.geofence.${status}`),
    ...["open", "resolved"].map((status) => `prod.status.${status}`),
    ...["plot", "group", "all"].map((scope) => `prod.corr.scope.${scope}`),
    ...["supplier", "producer"].map((type) => `prod.corr.group.${type}`),
    ...["geometry", "area", "geofence", "duplicate", "evidence", "other"].map((category) => `prod.corr.category.${category}`),
    ...["ok", "fail", "pending"].map((tone) => `prod.pv.legend.${tone}`),
  ];

  assert.ok(keys.length > 40);
  for (const language of SUPPORTED_LANGUAGES) {
    const missing = [...keys, ...dynamic].filter((key) => !Object.hasOwn(translations[language], key));
    assert.deepEqual(missing, [], `${language} is missing production UI keys`);
  }
});

test("placeholders are identical in every language", () => {
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(translations.de)) {
    for (const language of SUPPORTED_LANGUAGES) {
      assert.deepEqual(placeholders(translations[language][key]), placeholders(translations.de[key]), `${language}:${key}`);
    }
  }
});