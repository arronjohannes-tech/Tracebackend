import "@formatjs/intl-displaynames/polyfill.js";
import "@formatjs/intl-displaynames/locale-data/de.js";
import "@formatjs/intl-displaynames/locale-data/en.js";
import "@formatjs/intl-displaynames/locale-data/am.js";
import "@formatjs/intl-displaynames/locale-data/ti.js";
import "@formatjs/intl-displaynames/locale-data/om.js";
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export type PhoneCountry = { code: CountryCode; name: string; callingCode: string; flag: string };

export function phoneCountries(language: string): PhoneCountry[] {
  const names = new Intl.DisplayNames([language, "en"], { type: "region" });
  return getCountries().map((code) => ({
    code,
    name: names.of(code) ?? code,
    callingCode: `+${getCountryCallingCode(code)}`,
    flag: [...code].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join(""),
  })).sort((a, b) => a.name.localeCompare(b.name, language));
}

export function searchPhoneCountries(countries: PhoneCountry[], search: string): PhoneCountry[] {
  const query = search.trim().toLocaleLowerCase();
  return countries.filter(({ code, name, callingCode }) =>
    `${code} ${name} ${callingCode}`.toLocaleLowerCase().includes(query));
}

export function normalizePhone(phoneNumber: string, phoneCountry: CountryCode): string | null {
  const input = phoneNumber.trim();
  if (!input || !/^\+?[\d\s().-]+$/.test(input)) return null;
  const phone = parsePhoneNumberFromString(input, { defaultCountry: phoneCountry, extract: false });
  if (!phone?.isValid() || phone.ext || phone.country !== phoneCountry) return null;
  return phone.number;
}

export type ActivationLink = { token: string | null };

/** Null means an untrusted URL; a trusted route without a usable token is an invalid link. */
export function parseActivationLink(value: string): ActivationLink | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port) return null;
    let params: URLSearchParams;
    if (url.protocol === "https:" && url.hostname === "tracehub-ten.vercel.app" &&
        url.pathname === "/mobile-activate.html" && !url.search) {
      params = new URLSearchParams(url.hash.slice(1));
    } else if (url.protocol === "tracehub:" && url.hostname === "activate" &&
               !url.pathname && !url.hash) {
      params = url.searchParams;
    } else {
      return null;
    }
    const tokens = params.getAll("token");
    const token = tokens[0];
    return {
      token: tokens.length === 1 && token && token.length >= 32 && token.length <= 256 &&
        /^[A-Za-z0-9._~-]+$/.test(token) ? token : null,
    };
  } catch {
    return null;
  }
}
