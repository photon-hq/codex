import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";
import { getCountries, getCountryCallingCode } from "libphonenumber-js";

countries.registerLocale(en);

export interface Country {
  dial: string;
  flag: string;
  iso: string;
  name: string;
}

function flagFromIso(iso: string): string {
  if (!/^[A-Z]{2}$/.test(iso)) {
    return "";
  }
  const A = 0x1_f1_e6;
  return String.fromCodePoint(A + (iso.charCodeAt(0) - 65), A + (iso.charCodeAt(1) - 65));
}

// Filter to ISO-3166-1 alpha-2 codes that libphonenumber recognises and that
// i18n-iso-countries can name. This mirrors the country list react-aria /
// libphonenumber expose on codex's auth screen.
const RAW = (getCountries() as string[])
  .filter((iso) => /^[A-Z]{2}$/.test(iso))
  .map((iso) => {
    const name = countries.getName(iso, "en", { select: "official" }) ?? iso;
    let dial: string;
    try {
      dial = getCountryCallingCode(iso as Parameters<typeof getCountryCallingCode>[0]);
    } catch {
      dial = "";
    }
    return { iso, name, dial, flag: flagFromIso(iso) };
  })
  .filter((c) => c.dial !== "");

export const COUNTRIES: Country[] = RAW.sort((a, b) => a.name.localeCompare(b.name));

export const DEFAULT_COUNTRY: Country = findByIso("US") ?? COUNTRIES[0];

export function findByIso(iso: string): Country | undefined {
  return COUNTRIES.find((c) => c.iso === iso);
}

// Resolve a dial code to a canonical country. Several territories share a
// dial (e.g. +1 is US/CA/many), so we prefer the most populous registered
// entry — matching libphonenumber's primary mapping.
export function bestMatchByDial(dial: string): Country | undefined {
  const primary: Record<string, string> = {
    "1": "US",
    "7": "RU",
    "44": "GB",
    "61": "AU",
    "212": "MA",
    "262": "RE",
    "590": "GP",
    "596": "MQ",
    "594": "GF",
  };
  const iso = primary[dial];
  if (iso) {
    const hit = findByIso(iso);
    if (hit) {
      return hit;
    }
  }
  return COUNTRIES.find((c) => c.dial === dial);
}
