import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { normalizePhone, parseActivationLink, phoneCountries, searchPhoneCountries } from "./onboarding";

test("registration country choices work without native Intl.DisplayNames", () => {
  const moduleUrl = new URL("./onboarding.ts", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--import", "tsx", "-e", `
    const assert = require("node:assert/strict");
    delete Intl.DisplayNames;
    const { phoneCountries } = require(require("node:url").fileURLToPath(${JSON.stringify(moduleUrl)}));
    for (const language of ["de", "en", "am", "ti"]) {
      const countries = phoneCountries(language);
      assert.ok(countries.length > 200);
      assert.ok(countries.every(country => country.name && country.flag && country.callingCode));
      assert.ok(countries.some(country => country.code === "DE"));
    }
    assert.equal(phoneCountries("de").find(country => country.code === "DE").name, "Deutschland");
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("phone normalization uses full international metadata and the selected country", () => {
  assert.equal(normalizePhone("01512 3456789", "DE"), "+4915123456789");
  assert.equal(normalizePhone("+49 (1512) 345-6789", "DE"), "+4915123456789");
  assert.equal(normalizePhone("020 7946 0018", "GB"), "+442079460018");
  assert.equal(normalizePhone("0911 123456", "ET"), "+251911123456");
  assert.equal(normalizePhone("+1 202 555 0123", "US"), "+12025550123");
  for (const invalid of ["", "123", "+49123", "call +4915123456789", "+4915123456789 ext 1", "015123456789abc"]) {
    assert.equal(normalizePhone(invalid, "DE"), null);
  }
  assert.equal(normalizePhone("+442079460018", "DE"), null);
  assert.equal(normalizePhone("+12025550123", "CA"), null);
  assert.equal(normalizePhone("+999123456789", "DE"), null);
});

test("country choices include flags, localized names and searchable calling codes", () => {
  const countries = phoneCountries("en");
  assert.ok(countries.length > 200);
  assert.deepEqual(countries.find(({ code }) => code === "DE"), {
    code: "DE", flag: "🇩🇪", name: "Germany", callingCode: "+49",
  });
  assert.equal(phoneCountries("de").find(({ code }) => code === "DE")?.name, "Deutschland");
  assert.ok(phoneCountries("am").find(({ code }) => code === "ET")?.name);
  assert.equal(searchPhoneCountries(countries, "  geRMAny ")[0]?.code, "DE");
  assert.equal(searchPhoneCountries(countries, "+49")[0]?.code, "DE");
  assert.ok(searchPhoneCountries(countries, "ET").some(({ code }) => code === "ET"));
  assert.deepEqual(searchPhoneCountries(countries, "not-a-country"), []);
});

test("activation links accept only the HTTPS fragment and exact native fallback route", () => {
  const token = "test-token_123.abc~".repeat(2);
  assert.deepEqual(parseActivationLink(`https://tracehub-ten.vercel.app/mobile-activate.html#token=${token}`), { token });
  assert.deepEqual(parseActivationLink(`tracehub://activate?token=${token}`), { token });
  assert.deepEqual(parseActivationLink(`tracehub://activate?token=${token.replaceAll("-", "%2D")}`), { token });
});

test("activation helpers reject untrusted origins, routes and token locations", () => {
  for (const url of [
    "not a URL",
    "http://tracehub-ten.vercel.app/mobile-activate.html#token=secret",
    "https://tracehub-ten.vercel.app.evil.test/mobile-activate.html#token=secret",
    "https://evil.test/mobile-activate.html#token=secret",
    "https://user:pass@tracehub-ten.vercel.app/mobile-activate.html#token=secret",
    "https://tracehub-ten.vercel.app:8443/mobile-activate.html#token=secret",
    "https://tracehub-ten.vercel.app/other.html#token=secret",
    "https://tracehub-ten.vercel.app/mobile-activate.html/extra#token=secret",
    "https://tracehub-ten.vercel.app/mobile-activate.html?token=secret",
    "tracehub://other?token=secret",
    "tracehub://activate/other?token=secret",
    "tracehub://activate/#token=secret",
    "tracehub://activate#token=secret",
    "other://activate?token=secret",
  ]) assert.equal(parseActivationLink(url), null);
});

test("trusted activation routes expose unusable tokens only as an invalid state", () => {
  for (const token of ["", "a&token=b", "a%20b", "%0Asecret", "%ZZ", "a".repeat(31), "a".repeat(257)]) {
    assert.deepEqual(
      parseActivationLink(`https://tracehub-ten.vercel.app/mobile-activate.html#token=${token}`),
      { token: null },
    );
    assert.deepEqual(parseActivationLink(`tracehub://activate?token=${token}`), { token: null });
  }
  assert.deepEqual(parseActivationLink("https://tracehub-ten.vercel.app/mobile-activate.html"), { token: null });
});
