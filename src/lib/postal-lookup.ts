// Client-side postal-code auto-fill (2026-09-08) — see
// db/2026-09-08-order-address-fields-and-vendor-assignments.sql for the
// structured buyer_address1/2/3/city/state/postal_code columns this feeds.
//
// Goal: when an employee types a postal/zip code into the new structured
// address section (order-form.tsx / order-edit-form.tsx), try to save them
// re-typing City and State by hand — but never block or error if it can't.
// Two free, no-auth, CORS-enabled public services cover this, called
// straight from the browser (no API key, no server round-trip needed):
//
//   - India Post's PIN-code API (https://api.postalpincode.in) — used for
//     any 6-digit PIN when the Destination Country field is blank or reads
//     as some form of "India" (the overwhelming common case for this
//     business's domestic orders, where the country field is often just
//     left empty at first).
//   - Zippopotam.us (https://api.zippopotam.us) — used for the small set of
//     countries this business commonly ships to internationally (US, UK,
//     Canada, Australia, and the major EU/Gulf/APAC destinations — see
//     COUNTRY_CODE_ALIASES below), resolved from whatever free text was
//     typed into Destination Country via a simple alias match.
//
// Both lookups are wrapped in try/catch and resolve to `null` on ANY
// failure (network error, unexpected shape, unknown country, no match) —
// autofill is purely additive. City/State always stay ordinary editable
// text inputs (never readOnly/disabled) so the employee can always
// overwrite whatever came back — "phir bhi kuch change karna ho to usi
// time kar sake". Callers (see the onBlur handlers in the order forms)
// additionally only apply the result when City/State are still empty, so
// this never silently clobbers something already typed.

export type PostalLookupResult = { city: string; state: string; country?: string };

const INDIA_PIN_RE = /^\d{6}$/;

// Small alias dictionary -> ISO-3166 alpha-2, matched case-insensitively as
// a substring against whatever free text is in Destination Country. Not
// meant to be exhaustive — just the countries this business's own courier
// setup (FedEx/UPS/Aramex/DHL/Delhivery/Shiprocket/Shipglobal) commonly
// ships to, per the migration note. Longest alias first so e.g. "united
// arab emirates" is tried before a shorter, coincidentally-contained one.
//
// 2026-09-12 — expanded from ~27 countries to FedEx's full official country
// list (the reference table the user pasted this round). The original 27
// covered this business's day-to-day destinations; this fills in every
// other FedEx-served country so a first-time shipment to somewhere new
// never has to hit the "unrecognized country" form error the hard way.
// Multi-name FedEx entries (e.g. "Italy, Vatican City, San Marino" -> IT)
// are split into one alias per name. Existing 27 entries kept exactly as
// they were (already proven working) — everything below is additive.
const COUNTRY_CODE_ALIASES: { alias: string; code: string }[] = [
  { alias: "united states of america", code: "US" },
  { alias: "united states", code: "US" },
  { alias: "usa", code: "US" },
  { alias: "u.s.a.", code: "US" },
  { alias: "united kingdom", code: "GB" },
  { alias: "great britain", code: "GB" },
  { alias: "britain", code: "GB" },
  { alias: "uk", code: "GB" },
  { alias: "canada", code: "CA" },
  { alias: "australia", code: "AU" },
  { alias: "germany", code: "DE" },
  { alias: "france", code: "FR" },
  { alias: "italy", code: "IT" },
  { alias: "spain", code: "ES" },
  { alias: "netherlands", code: "NL" },
  { alias: "united arab emirates", code: "AE" },
  { alias: "uae", code: "AE" },
  { alias: "saudi arabia", code: "SA" },
  { alias: "singapore", code: "SG" },
  { alias: "new zealand", code: "NZ" },
  { alias: "ireland", code: "IE" },
  { alias: "sweden", code: "SE" },
  { alias: "switzerland", code: "CH" },
  { alias: "belgium", code: "BE" },
  { alias: "japan", code: "JP" },
  { alias: "south korea", code: "KR" },
  { alias: "south georgia and south sandwich islands", code: "GS" },
  { alias: "british indian ocean territory", code: "IO" },
  { alias: "svalbard and jan mayen island", code: "SJ" },
  { alias: "french southern territories", code: "TF" },
  { alias: "u.s. minor outlying islands", code: "UM" },
  { alias: "heard and mcdonald islands", code: "HM" },
  { alias: "wallis and futuna islands", code: "WF" },
  { alias: "central african republic", code: "CF" },
  { alias: "northern mariana islands", code: "MP" },
  { alias: "turks and caicos islands", code: "TC" },
  { alias: "democratic republic of", code: "CD" },
  { alias: "british virgin islands", code: "VG" },
  { alias: "caribbean netherlands", code: "BQ" },
  { alias: "jost van dyke islands", code: "VG" },
  { alias: "sao tome and principe", code: "ST" },
  { alias: "great tobago islands", code: "VG" },
  { alias: "great thatch island", code: "VG" },
  { alias: "st. kitts and nevis", code: "KN" },
  { alias: "u.s. virgin islands", code: "VI" },
  { alias: "trinidad and tobago", code: "TT" },
  { alias: "bosnia-herzegovina", code: "BA" },
  { alias: "dominican republic", code: "DO" },
  { alias: "equatorial guinea", code: "GQ" },
  { alias: "christmas island", code: "CX" },
  { alias: "northern ireland", code: "GB" },
  { alias: "falkland islands", code: "FK" },
  { alias: "marshall islands", code: "MH" },
  { alias: "papua new guinea", code: "PG" },
  { alias: "st. croix island", code: "VI" },
  { alias: "french polynesia", code: "PF" },
  { alias: "channel islands", code: "GB" },
  { alias: "slovak republic", code: "SK" },
  { alias: "solomon islands", code: "SB" },
  { alias: "st. christopher", code: "KN" },
  { alias: "american samoa", code: "AS" },
  { alias: "czech republic", code: "CZ" },
  { alias: "faeroe islands", code: "FO" },
  { alias: "cayman islands", code: "KY" },
  { alias: "tortola island", code: "VG" },
  { alias: "st. barthelemy", code: "GP" },
  { alias: "norfolk island", code: "NF" },
  { alias: "canary islands", code: "ES" },
  { alias: "western sahara", code: "EH" },
  { alias: "st. eustatius", code: "BQ" },
  { alias: "bouvet island", code: "BV" },
  { alias: "cocos islands", code: "CC" },
  { alias: "french guiana", code: "GF" },
  { alias: "norman island", code: "VG" },
  { alias: "guinea bissau", code: "GW" },
  { alias: "liechtenstein", code: "LI" },
  { alias: "new caledonia", code: "NC" },
  { alias: "burkina faso", code: "BF" },
  { alias: "cook islands", code: "CK" },
  { alias: "grand cayman", code: "KY" },
  { alias: "vatican city", code: "IT" },
  { alias: "sierra leone", code: "SL" },
  { alias: "south africa", code: "ZA" },
  { alias: "union island", code: "VC" },
  { alias: "turkmenistan", code: "TM" },
  { alias: "afghanistan", code: "AF" },
  { alias: "el salvador", code: "SV" },
  { alias: "ivory coast", code: "CI" },
  { alias: "north korea", code: "KP" },
  { alias: "philippines", code: "PH" },
  { alias: "puerto rico", code: "PR" },
  { alias: "st. maarten", code: "SX" },
  { alias: "st. vincent", code: "VC" },
  { alias: "antarctica", code: "AQ" },
  { alias: "azerbaijan", code: "AZ" },
  { alias: "bangladesh", code: "BD" },
  { alias: "cape verde", code: "CV" },
  { alias: "costa rica", code: "CR" },
  { alias: "east timor", code: "TL" },
  { alias: "san marino", code: "IT" },
  { alias: "kazakhstan", code: "KZ" },
  { alias: "kyrgyzstan", code: "KG" },
  { alias: "luxembourg", code: "LU" },
  { alias: "madagascar", code: "MG" },
  { alias: "martinique", code: "MQ" },
  { alias: "mauritania", code: "MR" },
  { alias: "micronesia", code: "FM" },
  { alias: "montenegro", code: "ME" },
  { alias: "montserrat", code: "MS" },
  { alias: "mozambique", code: "MZ" },
  { alias: "seychelles", code: "SC" },
  { alias: "st. thomas", code: "VI" },
  { alias: "st. helena", code: "SH" },
  { alias: "st. martin", code: "MF" },
  { alias: "st. pierre", code: "PM" },
  { alias: "tajikistan", code: "TJ" },
  { alias: "uzbekistan", code: "UZ" },
  { alias: "argentina", code: "AR" },
  { alias: "gibraltar", code: "GI" },
  { alias: "greenland", code: "GL" },
  { alias: "guatemala", code: "GT" },
  { alias: "hong kong", code: "HK" },
  { alias: "indonesia", code: "ID" },
  { alias: "lithuania", code: "LT" },
  { alias: "macedonia", code: "MK" },
  { alias: "mauritius", code: "MU" },
  { alias: "nicaragua", code: "NI" },
  { alias: "palestine", code: "PS" },
  { alias: "sri lanka", code: "LK" },
  { alias: "st. lucia", code: "LC" },
  { alias: "venezuela", code: "VE" },
  { alias: "anguilla", code: "AI" },
  { alias: "barbados", code: "BB" },
  { alias: "botswana", code: "BW" },
  { alias: "bulgaria", code: "BG" },
  { alias: "cambodia", code: "KH" },
  { alias: "cameroon", code: "CM" },
  { alias: "colombia", code: "CO" },
  { alias: "djibouti", code: "DJ" },
  { alias: "dominica", code: "DM" },
  { alias: "scotland", code: "GB" },
  { alias: "eswatini", code: "SZ" },
  { alias: "ethiopia", code: "ET" },
  { alias: "honduras", code: "HN" },
  { alias: "kiribati", code: "KI" },
  { alias: "malaysia", code: "MY" },
  { alias: "maldives", code: "MV" },
  { alias: "mongolia", code: "MN" },
  { alias: "pakistan", code: "PK" },
  { alias: "paraguay", code: "PY" },
  { alias: "pitcairn", code: "PN" },
  { alias: "portugal", code: "PT" },
  { alias: "slovenia", code: "SI" },
  { alias: "st. john", code: "VI" },
  { alias: "suriname", code: "SR" },
  { alias: "tanzania", code: "TZ" },
  { alias: "thailand", code: "TH" },
  { alias: "zimbabwe", code: "ZW" },
  { alias: "albania", code: "AL" },
  { alias: "algeria", code: "DZ" },
  { alias: "andorra", code: "AD" },
  { alias: "antigua", code: "AG" },
  { alias: "barbuda", code: "AG" },
  { alias: "armenia", code: "AM" },
  { alias: "austria", code: "AT" },
  { alias: "bahamas", code: "BS" },
  { alias: "bahrain", code: "BH" },
  { alias: "belarus", code: "BY" },
  { alias: "bermuda", code: "BM" },
  { alias: "bolivia", code: "BO" },
  { alias: "bonaire", code: "BQ" },
  { alias: "burundi", code: "BI" },
  { alias: "comoros", code: "KM" },
  { alias: "croatia", code: "HR" },
  { alias: "curacao", code: "CW" },
  { alias: "denmark", code: "DK" },
  { alias: "ecuador", code: "EC" },
  { alias: "england", code: "GB" },
  { alias: "eritrea", code: "ER" },
  { alias: "estonia", code: "EE" },
  { alias: "finland", code: "FI" },
  { alias: "georgia", code: "GE" },
  { alias: "grenada", code: "GD" },
  { alias: "hungary", code: "HU" },
  { alias: "iceland", code: "IS" },
  { alias: "jamaica", code: "JM" },
  { alias: "lebanon", code: "LB" },
  { alias: "lesotho", code: "LS" },
  { alias: "liberia", code: "LR" },
  { alias: "mayotte", code: "YT" },
  { alias: "moldova", code: "MD" },
  { alias: "morocco", code: "MA" },
  { alias: "myanmar", code: "MM" },
  { alias: "namibia", code: "NA" },
  { alias: "holland", code: "NL" },
  { alias: "nigeria", code: "NG" },
  { alias: "reunion", code: "RE" },
  { alias: "romania", code: "RO" },
  { alias: "senegal", code: "SN" },
  { alias: "somalia", code: "SO" },
  { alias: "tokelau", code: "TK" },
  { alias: "tunisia", code: "TN" },
  { alias: "ukraine", code: "UA" },
  { alias: "uruguay", code: "UY" },
  { alias: "vanuatu", code: "VU" },
  { alias: "vietnam", code: "VN" },
  { alias: "angola", code: "AO" },
  { alias: "belize", code: "BZ" },
  { alias: "bhutan", code: "BT" },
  { alias: "brazil", code: "BR" },
  { alias: "brunei", code: "BN" },
  { alias: "cyprus", code: "CY" },
  { alias: "gambia", code: "GM" },
  { alias: "greece", code: "GR" },
  { alias: "guinea", code: "GN" },
  { alias: "guyana", code: "GY" },
  { alias: "israel", code: "IL" },
  { alias: "jordan", code: "JO" },
  { alias: "kuwait", code: "KW" },
  { alias: "latvia", code: "LV" },
  { alias: "malawi", code: "MW" },
  { alias: "mexico", code: "MX" },
  { alias: "monaco", code: "MC" },
  { alias: "saipan", code: "MP" },
  { alias: "tinian", code: "MP" },
  { alias: "norway", code: "NO" },
  { alias: "panama", code: "PA" },
  { alias: "poland", code: "PL" },
  { alias: "russia", code: "RU" },
  { alias: "rwanda", code: "RW" },
  { alias: "serbia", code: "RS" },
  { alias: "tahiti", code: "PF" },
  { alias: "taiwan", code: "TW" },
  { alias: "turkey", code: "TR" },
  { alias: "tuvalu", code: "TV" },
  { alias: "uganda", code: "UG" },
  { alias: "zambia", code: "ZM" },
  { alias: "aruba", code: "AW" },
  { alias: "benin", code: "BJ" },
  { alias: "chile", code: "CL" },
  { alias: "china", code: "CN" },
  { alias: "congo", code: "CG" },
  { alias: "egypt", code: "EG" },
  { alias: "wales", code: "GB" },
  { alias: "gabon", code: "GA" },
  { alias: "ghana", code: "GH" },
  { alias: "haiti", code: "HT" },
  { alias: "india", code: "IN" },
  { alias: "kenya", code: "KE" },
  { alias: "libya", code: "LY" },
  { alias: "macau", code: "MO" },
  { alias: "malta", code: "MT" },
  { alias: "burma", code: "MM" },
  { alias: "nauru", code: "NR" },
  { alias: "nepal", code: "NP" },
  { alias: "niger", code: "NE" },
  { alias: "palau", code: "PW" },
  { alias: "qatar", code: "QA" },
  { alias: "samoa", code: "WS" },
  { alias: "sudan", code: "SD" },
  { alias: "syria", code: "SY" },
  { alias: "tonga", code: "TO" },
  { alias: "yemen", code: "YE" },
  { alias: "saba", code: "BQ" },
  { alias: "chad", code: "TD" },
  { alias: "cuba", code: "CU" },
  { alias: "fiji", code: "FJ" },
  { alias: "guam", code: "GU" },
  { alias: "iran", code: "IR" },
  { alias: "iraq", code: "IQ" },
  { alias: "laos", code: "LA" },
  { alias: "mali", code: "ML" },
  { alias: "niue", code: "NU" },
  { alias: "rota", code: "MP" },
  { alias: "oman", code: "OM" },
  { alias: "peru", code: "PE" },
  { alias: "togo", code: "TG" },
].sort((a, b) => b.alias.length - a.alias.length);

const ISO2_RE = /^[a-z]{2}$/i;

// 2026-09-08 (follow-up): exported — also used server-side in
// courier-booking/actions.ts to normalize the "Recipient Country Code"
// field before it's sent to a courier's Ship API. Root cause of a real
// FedEx 400 ("Recipient state and postal code mismatch"): that field
// defaults from orders.destination_country, which is free text (e.g.
// "United States" — see the placeholder on the Order form's Destination
// Country input, "USA / United Kingdom / Germany / ..."), NOT a 2-letter
// ISO code. The field carries a `maxLength={2}` HTML attribute, but
// maxLength only restricts interactive typing/pasting — it does nothing to
// a value set programmatically via `defaultValue`, so an employee who
// didn't overwrite it could submit "United States" (or similar) straight
// through as the courier API's countryCode. FedEx's own validator, given
// an unrecognized country code, produces exactly the confusing
// state/postal "mismatch" error rather than a clear "invalid country"
// one — this function is now also the server-side safety net that catches
// that before the request ever reaches FedEx (or UPS/Aramex/DHL, which
// share the same form field and the same bug).
export function countryCodeFor(countryFreeText: string): string | null {
  const cleaned = countryFreeText.trim();
  if (!cleaned) return null;
  // Alias dictionary FIRST, then a bare-ISO2-code fallback — deliberately
  // in that order. Some common everyday abbreviations that people actually
  // type (e.g. "UK") are exactly 2 letters but are NOT valid ISO-3166
  // alpha-2 codes themselves (the real code is "GB") — checking aliases
  // first means "UK" still correctly resolves via the alias table below
  // instead of being taken literally and sent to zippopotam.us/UK/... as
  // an invalid code. The bare-code fallback exists for callers that
  // already hold a real code (e.g. courier-booking's "Country Code *
  // (2-letter)" field, which the courier's own API also expects as a real
  // ISO code) rather than a free-text country name.
  const lower = cleaned.toLowerCase();
  for (const { alias, code } of COUNTRY_CODE_ALIASES) {
    if (lower.includes(alias)) return code;
  }
  if (ISO2_RE.test(cleaned)) return cleaned.toUpperCase();
  return null;
}

async function lookupIndiaPin(postalCode: string): Promise<PostalLookupResult | null> {
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${encodeURIComponent(postalCode)}`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0] as { Status?: string; PostOffice?: { District?: string; State?: string }[] };
    if (first?.Status !== "Success" || !Array.isArray(first.PostOffice) || first.PostOffice.length === 0) return null;
    const po = first.PostOffice[0];
    if (!po?.District || !po?.State) return null;
    return { city: po.District, state: po.State, country: "India" };
  } catch {
    return null;
  }
}

async function lookupZippopotam(code: string, postalCode: string): Promise<PostalLookupResult | null> {
  try {
    const res = await fetch(`https://api.zippopotam.us/${code}/${encodeURIComponent(postalCode)}`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const obj = data as { places?: { "place name"?: string; state?: string }[]; "country abbreviation"?: string };
    if (!Array.isArray(obj?.places) || obj.places.length === 0) return null;
    const place = obj.places[0];
    const city = place?.["place name"];
    const state = place?.state;
    if (!city || !state) return null;
    return { city, state, country: obj["country abbreviation"] };
  } catch {
    return null;
  }
}

/**
 * Best-effort City/State lookup from a postal/zip code, for the "Structured
 * Address" section's onBlur autofill. Always resolves — never throws — and
 * returns null whenever nothing can be confidently resolved (unrecognized
 * country, malformed postcode, the service being unreachable, etc.); the
 * caller then just leaves City/State for manual entry, same as before this
 * existed.
 */
export async function lookupPostalCode(
  postalCode: string,
  countryFreeText: string
): Promise<PostalLookupResult | null> {
  const pin = postalCode.trim();
  if (!pin) return null;

  const country = countryFreeText.trim();
  // Matches a blank country, any free-text form of "India", and the bare
  // ISO code "IN" (2026-09-08 follow-up — some callers pass a 2-letter
  // code, see countryCodeFor below).
  const isIndia = country === "" || /india/i.test(country) || /^in$/i.test(country);

  if (isIndia && INDIA_PIN_RE.test(pin)) {
    return lookupIndiaPin(pin);
  }

  const code = countryCodeFor(country);
  if (!code) return null;

  return lookupZippopotam(code, pin);
}

// 2026-09-12 — same shape bug as countryCodeFor above ("Recipient state and
// postal code mismatch"), but for STATE instead of country: FedEx's own
// documentation (the full reference tables the user pasted this round —
// U.S. State Codes, Indian State Codes, Canadian Province Codes, Mexican
// State Codes) confirms these 4 countries specifically need a strict
// 2-letter/short code for stateOrProvinceCode, not a free-text name — while
// orders.buyer_state is free text end to end (typed by whoever entered the
// order, or pulled from a marketplace export), e.g. "California" or "Uttar
// Pradesh" rather than "CA"/"UP". Scoped to exactly these 4 countries (the 4
// tables FedEx's own docs actually gave) — every other country's state
// field keeps working exactly as it does today (passed through as-is),
// since FedEx doesn't enforce a closed code list for most destinations and
// this app has no evidence any other country needs it.
//
// Unlike countryCodeFor (which returns null on no match, forcing a visible
// form error), an unresolved state here falls back to the ORIGINAL trimmed
// text rather than blanking it out — state doesn't have a small closed
// alias set the way country does, so a typo or an abbreviation not in the
// table below still has a chance of already being correct; blanking a
// required-by-FedEx field out entirely would turn a possibly-fine value
// into a guaranteed new error.
const US_STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", "washington state": "WA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};

const INDIA_STATE_CODES: Record<string, string> = {
  "andaman & nicobar (u.t)": "AN", "andaman and nicobar": "AN", "andhra pradesh": "AP",
  "arunachal pradesh": "AR", assam: "AS", bihar: "BR", chattisgarh: "CG",
  chhattisgarh: "CG", "chandigarh (u.t.)": "CH", chandigarh: "CH",
  "daman & diu (u.t.)": "DD", "daman and diu": "DD", "delhi (u.t.)": "DL", delhi: "DL",
  "dadra and nagar haveli (u.t.)": "DN", "dadra and nagar haveli": "DN", goa: "GA",
  gujarat: "GJ", haryana: "HR", "himachal pradesh": "HP", "jammu & kashmir": "JK",
  "jammu and kashmir": "JK", jharkhand: "JH", karnataka: "KA", kerala: "KL",
  "lakshadweep (u.t)": "LD", lakshadweep: "LD", "madhya pradesh": "MP",
  maharashtra: "MH", manipur: "MN", meghalaya: "ML", mizoram: "MZ", nagaland: "NL",
  orissa: "OR", odisha: "OR", punjab: "PB", "puducherry (u.t.)": "PY", puducherry: "PY",
  pondicherry: "PY", rajasthan: "RJ", sikkim: "SK", "tamil nadu": "TN", tripura: "TR",
  uttaranchal: "UA", uttarakhand: "UA", "uttar pradesh": "UP", "west bengal": "WB",
};

const CANADA_PROVINCE_CODES: Record<string, string> = {
  alberta: "AB", "british columbia": "BC", manitoba: "MB", "new brunswick": "NB",
  newfoundland: "NL", "newfoundland and labrador": "NL", "northwest territories": "NT",
  "nova scotia": "NS", nunavut: "NU", ontario: "ON", "prince edward island": "PE",
  quebec: "QC", saskatchewan: "SK", yukon: "YT",
};

const MEXICO_STATE_CODES: Record<string, string> = {
  aguascalientes: "AG", "baja california": "BC", "baja california sur": "BS",
  campeche: "CM", chiapas: "CS", chihuahua: "CH", "ciudad de méxico": "DF",
  "ciudad de mexico": "DF", "mexico city": "DF", coahuila: "CO", colima: "CL",
  durango: "DG", "estado de méxico": "EM", "estado de mexico": "EM",
  guanajuato: "GT", guerrero: "GR", hidalgo: "HG", jalisco: "JA",
  "michoacán": "MI", michoacan: "MI", morelos: "MO", nayarit: "NA",
  "nuevo león": "NL", "nuevo leon": "NL", oaxaca: "OA", puebla: "PU",
  "querétaro": "QE", queretaro: "QE", "quintana roo": "QR",
  "san luis potosí": "SL", "san luis potosi": "SL", sinaloa: "SI", sonora: "SO",
  tabasco: "TB", tamaulipas: "TM", tlaxcala: "TL", veracruz: "VE",
  "yucatán": "YU", yucatan: "YU", zacatecas: "ZA",
};

const STATE_TABLES_BY_COUNTRY: Record<string, Record<string, string>> = {
  US: US_STATE_CODES,
  IN: INDIA_STATE_CODES,
  CA: CANADA_PROVINCE_CODES,
  MX: MEXICO_STATE_CODES,
};

export function stateCodeFor(stateFreeText: string, countryCode: string): string {
  const cleaned = (stateFreeText ?? "").trim();
  if (!cleaned) return cleaned;
  const table = STATE_TABLES_BY_COUNTRY[countryCode.trim().toUpperCase()];
  if (!table) return cleaned; // no strict table for this country — unchanged, same as today
  const lower = cleaned.toLowerCase();
  if (table[lower]) return table[lower];
  if (ISO2_RE.test(cleaned) && Object.values(table).includes(cleaned.toUpperCase())) return cleaned.toUpperCase();
  return cleaned; // couldn't resolve — pass through as typed rather than block/blank a required field
}
