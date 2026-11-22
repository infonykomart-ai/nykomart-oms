// Country address formats (2026-11-22) — Phase 2 of the master upgrade.
//
// src/lib/geo/parse-country.ts already answers "which country is this address
// in?" for 64 countries (validated against 340 real production addresses).
// What it deliberately does NOT know is each country's own address SHAPE:
// whether the postcode comes before or after the city, what a valid postcode
// looks like, and whether a state/province/region is normally required. That
// shape is exactly what the address splitter needs in order to avoid the
// bug this phase fixes — a country whose street/postal/city order differs
// from the US pattern (Germany's "10115 Berlin", the UK's postcode-on-its-
// own-line, India's "Bengaluru, Karnataka 560001") was previously split with
// US assumptions and produced wrong or blank City/State.
//
// One table, one source of truth. Adding a country later means adding one
// entry here (plus, for a country parse-country.ts doesn't detect yet, one
// alias there) — no parser code changes. Countries intentionally absent from
// parse-country.ts's alias list are absent here too: the parser must not
// claim a country it cannot confidently detect.
//
// `postalFirst` = the standard written order puts the postcode BEFORE the
// city (most of continental Europe, Japan, Korea, China, Brazil, Mexico).
// `stateRequired` = an address in that country is incomplete without a
// state/province/region; US/CA/AU/IN/BR/MX only. Everywhere else the field
// is accepted-and-kept but never demanded, which is why those countries can
// reach "Parsed" without one.
//
// `states` maps the folded (accent-stripped, lowercase) official name and
// its abbreviation to the abbreviation to store. Used only to pull a state
// token off the end of a city line — never to invent one that isn't there.

export type CountryRule = {
  /** ISO 3166-1 alpha-2. */
  code: string;
  /** Canonical name exactly as src/lib/geo/parse-country.ts returns it. */
  name: string;
  /** Full-string test against an UPPERCASED, single-spaced postcode. */
  postal: RegExp | null;
  postalRequired: boolean;
  postalFirst: boolean;
  stateRequired: boolean;
  stateLabel: string;
  states: [name: string, code: string][] | null;
};

const US_STATE_LIST: [string, string][] = [
  ["Alabama", "AL"], ["Alaska", "AK"], ["Arizona", "AZ"], ["Arkansas", "AR"], ["California", "CA"],
  ["Colorado", "CO"], ["Connecticut", "CT"], ["Delaware", "DE"], ["Florida", "FL"], ["Georgia", "GA"],
  ["Hawaii", "HI"], ["Idaho", "ID"], ["Illinois", "IL"], ["Indiana", "IN"], ["Iowa", "IA"],
  ["Kansas", "KS"], ["Kentucky", "KY"], ["Louisiana", "LA"], ["Maine", "ME"], ["Maryland", "MD"],
  ["Massachusetts", "MA"], ["Michigan", "MI"], ["Minnesota", "MN"], ["Mississippi", "MS"], ["Missouri", "MO"],
  ["Montana", "MT"], ["Nebraska", "NE"], ["Nevada", "NV"], ["New Hampshire", "NH"], ["New Jersey", "NJ"],
  ["New Mexico", "NM"], ["New York", "NY"], ["North Carolina", "NC"], ["North Dakota", "ND"], ["Ohio", "OH"],
  ["Oklahoma", "OK"], ["Oregon", "OR"], ["Pennsylvania", "PA"], ["Rhode Island", "RI"], ["South Carolina", "SC"],
  ["South Dakota", "SD"], ["Tennessee", "TN"], ["Texas", "TX"], ["Utah", "UT"], ["Vermont", "VT"],
  ["Virginia", "VA"], ["Washington", "WA"], ["West Virginia", "WV"], ["Wisconsin", "WI"], ["Wyoming", "WY"],
  ["District of Columbia", "DC"], ["Puerto Rico", "PR"],
];

const CA_PROVINCE_LIST: [string, string][] = [
  ["Alberta", "AB"], ["British Columbia", "BC"], ["Manitoba", "MB"], ["New Brunswick", "NB"],
  ["Newfoundland and Labrador", "NL"], ["Northwest Territories", "NT"], ["Nova Scotia", "NS"],
  ["Nunavut", "NU"], ["Ontario", "ON"], ["Prince Edward Island", "PE"], ["Quebec", "QC"],
  ["Saskatchewan", "SK"], ["Yukon", "YT"],
];

const AU_STATE_LIST: [string, string][] = [
  ["New South Wales", "NSW"], ["Victoria", "VIC"], ["Queensland", "QLD"], ["Western Australia", "WA"],
  ["South Australia", "SA"], ["Tasmania", "TAS"], ["Australian Capital Territory", "ACT"],
  ["Northern Territory", "NT"],
];

const IN_STATE_LIST: [string, string][] = [
  ["Andhra Pradesh", "AP"], ["Arunachal Pradesh", "AR"], ["Assam", "AS"], ["Bihar", "BR"],
  ["Chhattisgarh", "CG"], ["Goa", "GA"], ["Gujarat", "GJ"], ["Haryana", "HR"], ["Himachal Pradesh", "HP"],
  ["Jharkhand", "JH"], ["Karnataka", "KA"], ["Kerala", "KL"], ["Madhya Pradesh", "MP"],
  ["Maharashtra", "MH"], ["Manipur", "MN"], ["Meghalaya", "ML"], ["Mizoram", "MZ"], ["Nagaland", "NL"],
  ["Odisha", "OR"], ["Orissa", "OR"], ["Punjab", "PB"], ["Rajasthan", "RJ"], ["Sikkim", "SK"],
  ["Tamil Nadu", "TN"], ["Telangana", "TS"], ["Tripura", "TR"], ["Uttar Pradesh", "UP"],
  ["Uttarakhand", "UK"], ["West Bengal", "WB"], ["Delhi", "DL"], ["New Delhi", "DL"],
  ["Chandigarh", "CH"], ["Jammu and Kashmir", "JK"], ["Ladakh", "LA"], ["Puducherry", "PY"],
];

const BR_STATE_LIST: [string, string][] = [
  ["Acre", "AC"], ["Alagoas", "AL"], ["Amapa", "AP"], ["Amazonas", "AM"], ["Bahia", "BA"],
  ["Ceara", "CE"], ["Distrito Federal", "DF"], ["Espirito Santo", "ES"], ["Goias", "GO"],
  ["Maranhao", "MA"], ["Mato Grosso", "MT"], ["Mato Grosso do Sul", "MS"], ["Minas Gerais", "MG"],
  ["Para", "PA"], ["Paraiba", "PB"], ["Parana", "PR"], ["Pernambuco", "PE"], ["Piaui", "PI"],
  ["Rio de Janeiro", "RJ"], ["Rio Grande do Norte", "RN"], ["Rio Grande do Sul", "RS"], ["Rondonia", "RO"],
  ["Roraima", "RR"], ["Santa Catarina", "SC"], ["Sao Paulo", "SP"], ["Sergipe", "SE"], ["Tocantins", "TO"],
];

const MX_STATE_LIST: [string, string][] = [
  ["Aguascalientes", "AGU"], ["Baja California", "BC"], ["Baja California Sur", "BCS"], ["Campeche", "CAM"],
  ["Chiapas", "CHP"], ["Chihuahua", "CHH"], ["Ciudad de Mexico", "CDMX"], ["Coahuila", "COA"],
  ["Colima", "COL"], ["Durango", "DUR"], ["Guanajuato", "GUA"], ["Guerrero", "GRO"], ["Hidalgo", "HID"],
  ["Jalisco", "JAL"], ["Michoacan", "MIC"], ["Morelos", "MOR"], ["Nayarit", "NAY"], ["Nuevo Leon", "NL"],
  ["Oaxaca", "OAX"], ["Puebla", "PUE"], ["Queretaro", "QUE"], ["Quintana Roo", "ROO"],
  ["San Luis Potosi", "SLP"], ["Sinaloa", "SIN"], ["Sonora", "SON"], ["Tabasco", "TAB"],
  ["Tamaulipas", "TAM"], ["Tlaxcala", "TLA"], ["Veracruz", "VER"], ["Yucatan", "YUC"], ["Zacatecas", "ZAC"],
];

// UK/EU/APAC/MEA/LatAm. `postal: null` means the country has no postal-code
// system at all (Hong Kong, UAE, Qatar) — a blank postcode there is not a
// defect, so those can still reach "Parsed".
export const COUNTRY_RULES: CountryRule[] = [
  { code: "US", name: "United States", postal: /^\d{5}(-\d{4})?$/, postalRequired: true, postalFirst: false, stateRequired: true, stateLabel: "State", states: US_STATE_LIST },
  { code: "PR", name: "Puerto Rico", postal: /^\d{5}(-\d{4})?$/, postalRequired: true, postalFirst: false, stateRequired: false, stateLabel: "State", states: US_STATE_LIST },
  { code: "CA", name: "Canada", postal: /^[A-Z]\d[A-Z][ -]?\d[A-Z]\d$/, postalRequired: true, postalFirst: false, stateRequired: true, stateLabel: "Province", states: CA_PROVINCE_LIST },
  { code: "AU", name: "Australia", postal: /^\d{4}$/, postalRequired: true, postalFirst: false, stateRequired: true, stateLabel: "State", states: AU_STATE_LIST },
  { code: "NZ", name: "New Zealand", postal: /^\d{4}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Region", states: null },
  { code: "GB", name: "United Kingdom", postal: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/, postalRequired: true, postalFirst: false, stateRequired: false, stateLabel: "County", states: null },
  { code: "IE", name: "Ireland", postal: /^[A-Z]\d{2}\s?[A-Z0-9]{4}$/, postalRequired: false, postalFirst: false, stateRequired: false, stateLabel: "County", states: null },
  { code: "DE", name: "Germany", postal: /^\d{5}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "State", states: null },
  { code: "FR", name: "France", postal: /^\d{5}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Region", states: null },
  { code: "NL", name: "Netherlands", postal: /^\d{4}\s?[A-Z]{2}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Province", states: null },
  { code: "BE", name: "Belgium", postal: /^\d{4}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Province", states: null },
  { code: "LU", name: "Luxembourg", postal: /^L-?\d{4}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Canton", states: null },
  { code: "CH", name: "Switzerland", postal: /^\d{4}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Canton", states: null },
  { code: "AT", name: "Austria", postal: /^\d{4}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "State", states: null },
  { code: "IT", name: "Italy", postal: /^\d{5}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Province", states: null },
  { code: "ES", name: "Spain", postal: /^\d{5}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Province", states: null },
  { code: "PT", name: "Portugal", postal: /^\d{4}-\d{3}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "District", states: null },
  { code: "SE", name: "Sweden", postal: /^\d{3}\s?\d{2}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "County", states: null },
  { code: "NO", name: "Norway", postal: /^\d{4}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "County", states: null },
  { code: "DK", name: "Denmark", postal: /^\d{4}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Region", states: null },
  { code: "FI", name: "Finland", postal: /^\d{5}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Region", states: null },
  { code: "PL", name: "Poland", postal: /^\d{2}-\d{3}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Voivodeship", states: null },
  { code: "CZ", name: "Czech Republic", postal: /^\d{3}\s?\d{2}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Region", states: null },
  { code: "SK", name: "Slovakia", postal: /^\d{3}\s?\d{2}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Region", states: null },
  { code: "HU", name: "Hungary", postal: /^\d{4}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "County", states: null },
  { code: "RO", name: "Romania", postal: /^\d{6}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "County", states: null },
  { code: "BG", name: "Bulgaria", postal: /^\d{4}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Province", states: null },
  { code: "HR", name: "Croatia", postal: /^\d{5}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "County", states: null },
  { code: "SI", name: "Slovenia", postal: /^\d{4}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Region", states: null },
  { code: "GR", name: "Greece", postal: /^\d{3}\s?\d{2}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Region", states: null },
  { code: "IN", name: "India", postal: /^\d{6}$/, postalRequired: true, postalFirst: false, stateRequired: true, stateLabel: "State", states: IN_STATE_LIST },
  { code: "PK", name: "Pakistan", postal: /^\d{5}$/, postalRequired: true, postalFirst: false, stateRequired: false, stateLabel: "Province", states: null },
  { code: "BD", name: "Bangladesh", postal: /^\d{4}$/, postalRequired: true, postalFirst: false, stateRequired: false, stateLabel: "Division", states: null },
  { code: "LK", name: "Sri Lanka", postal: /^\d{5}$/, postalRequired: true, postalFirst: false, stateRequired: false, stateLabel: "Province", states: null },
  { code: "NP", name: "Nepal", postal: /^\d{5}$/, postalRequired: true, postalFirst: false, stateRequired: false, stateLabel: "Province", states: null },
  { code: "CN", name: "China", postal: /^\d{6}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Province", states: null },
  { code: "JP", name: "Japan", postal: /^\d{3}-?\d{4}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Prefecture", states: null },
  { code: "KR", name: "South Korea", postal: /^\d{5}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Province", states: null },
  { code: "SG", name: "Singapore", postal: /^\d{6}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Region", states: null },
  { code: "MY", name: "Malaysia", postal: /^\d{5}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "State", states: null },
  { code: "TH", name: "Thailand", postal: /^\d{5}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Province", states: null },
  { code: "ID", name: "Indonesia", postal: /^\d{5}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Province", states: null },
  { code: "VN", name: "Vietnam", postal: /^\d{6}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Province", states: null },
  { code: "PH", name: "Philippines", postal: /^\d{4}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Province", states: null },
  { code: "HK", name: "Hong Kong", postal: null, postalRequired: false, postalFirst: false, stateRequired: false, stateLabel: "District", states: null },
  { code: "AE", name: "United Arab Emirates", postal: null, postalRequired: false, postalFirst: false, stateRequired: false, stateLabel: "Emirate", states: null },
  { code: "QA", name: "Qatar", postal: null, postalRequired: false, postalFirst: false, stateRequired: false, stateLabel: "Municipality", states: null },
  { code: "SA", name: "Saudi Arabia", postal: /^\d{5}$/, postalRequired: true, postalFirst: false, stateRequired: false, stateLabel: "Province", states: null },
  { code: "KW", name: "Kuwait", postal: /^\d{5}$/, postalRequired: true, postalFirst: false, stateRequired: false, stateLabel: "Governorate", states: null },
  { code: "BH", name: "Bahrain", postal: /^\d{3,4}$/, postalRequired: true, postalFirst: false, stateRequired: false, stateLabel: "Governorate", states: null },
  { code: "OM", name: "Oman", postal: /^\d{3}$/, postalRequired: true, postalFirst: false, stateRequired: false, stateLabel: "Governorate", states: null },
  { code: "IL", name: "Israel", postal: /^\d{5,7}$/, postalRequired: true, postalFirst: false, stateRequired: false, stateLabel: "District", states: null },
  { code: "ZA", name: "South Africa", postal: /^\d{4}$/, postalRequired: true, postalFirst: false, stateRequired: false, stateLabel: "Province", states: null },
  { code: "NG", name: "Nigeria", postal: /^\d{6}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "State", states: null },
  { code: "KE", name: "Kenya", postal: /^\d{5}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "County", states: null },
  { code: "EG", name: "Egypt", postal: /^\d{5}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Governorate", states: null },
  { code: "BR", name: "Brazil", postal: /^\d{5}-?\d{3}$/, postalRequired: true, postalFirst: true, stateRequired: true, stateLabel: "State", states: BR_STATE_LIST },
  { code: "MX", name: "Mexico", postal: /^\d{5}$/, postalRequired: true, postalFirst: true, stateRequired: true, stateLabel: "State", states: MX_STATE_LIST },
  { code: "AR", name: "Argentina", postal: /^[A-Z]?\d{4}[A-Z]{0,3}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Province", states: null },
  { code: "CL", name: "Chile", postal: /^\d{7}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Region", states: null },
  { code: "CO", name: "Colombia", postal: /^\d{6}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Department", states: null },
  { code: "PE", name: "Peru", postal: /^\d{5}$/, postalRequired: true, postalFirst: true, stateRequired: false, stateLabel: "Region", states: null },
];

const BY_NAME = new Map(COUNTRY_RULES.map((rule) => [rule.name.toLowerCase(), rule]));
const BY_CODE = new Map(COUNTRY_RULES.map((rule) => [rule.code, rule]));

/** Accent/case-insensitive fold used for state-name matching. */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The rules for a canonical country name from src/lib/geo/parse-country.ts. */
export function countryRuleByName(name: string | null | undefined): CountryRule | undefined {
  if (!name) return undefined;
  return BY_NAME.get(name.toLowerCase());
}

export function countryRuleByCode(code: string | null | undefined): CountryRule | undefined {
  if (!code) return undefined;
  return BY_CODE.get(code.toUpperCase());
}

/** UPPERCASE + single-spaced form every `postal` regex above is written against. */
export function normalisePostal(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

export function postalMatches(rule: CountryRule | undefined, postal: string): boolean {
  if (!rule?.postal) return false;
  return rule.postal.test(normalisePostal(postal));
}

const STATE_INDEX = new Map<string, Map<string, string>>();

/**
 * Folded token -> stored abbreviation for a country's state/province list,
 * longest key first so "New South Wales" wins over a bare "Wales"-like tail
 * and "West Bengal" over "Bengal"-like fragments. Built once, lazily.
 */
export function stateLookup(rule: CountryRule): [key: string, code: string][] {
  const cached = STATE_INDEX.get(rule.code);
  if (cached) return [...cached.entries()];
  const built = new Map<string, string>();
  for (const [name, code] of rule.states ?? []) {
    built.set(fold(name), code);
    built.set(fold(code), code);
  }
  STATE_INDEX.set(rule.code, built);
  return [...built.entries()].sort((a, b) => b[0].length - a[0].length);
}
