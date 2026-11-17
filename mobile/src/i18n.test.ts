import assert from "node:assert/strict";
import test from "node:test";
import { isLanguage, languages, translations } from "./i18n";

function translationKeys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, entry]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === "object" && entry !== null) return translationKeys(entry, path);
    assert.equal(typeof entry, "string", path);
    assert.ok(entry.trim(), path);
    return [path];
  }).sort();
}

test("Oromo is selectable and has a complete non-empty mobile translation", () => {
  assert.ok(isLanguage("om"));
  const keys = translationKeys(translations.de);
  for (const language of languages) {
    assert.deepEqual(translationKeys(translations[language]), keys, language);
  }
  assert.notEqual(translations.om.auth.selectOrganization, translations.en.auth.selectOrganization);
  assert.notEqual(translations.om.plots.startWalk, translations.en.plots.startWalk);
});
