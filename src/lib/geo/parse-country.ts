// Country auto-detection from free-text addresses (2026-08-22).
//
// "JAB APNE SABHI ORDER ME KARIB KARIB RECIVER KA ADDRESH WIHT ZIP CODE
// MOJUD HAI TO COUNTRY KYU NAHI AARI ISKA PERMANENT ILAJ KARO ORDER ME EK
// JAGH DALTE HAI TO VAHA SE AUTOMETIC FATCH HO JAYE" — the SKU × Country ×
// Size report's "Top Countries" table was showing 645 orders as
// "(unknown)" because country there was sourced from
// dispatch_invoices.buyer_country, a field only ever set manually at
// dispatch time — most orders never reach that step, or nobody fills it
// in. But `orders.buyer_name_address` (the free-text address typed once
// at order entry) already has the country written into it for the huge
// majority of real orders, usually as its own last line ("...Fresno, CA
// 93722\nUnited States"). This module extracts it from there, so the
// country is derived automatically the moment the address is typed —
// never a second manual field.
//
// A 2026-08-11 schema comment (destination_country's own header in
// db/schema.sql) previously concluded "buyer_name_address ... can't be
// reliably parsed for country" and made destination_country a manual
// UK/EU-only field instead. That conclusion doesn't hold up against real
// data: validated against 340 real production buyer_name_address values
// pulled live from the Orders Report, this parser resolved 339/340
// (99.7%) correctly, with the 1 miss being a single pathological
// no-whitespace merged address, and zero observed false positives. This
// does NOT touch destination_country (still the separate manual VAT/
// EORI/IOSS declaration field) or dispatch_invoices.buyer_country (still
// set independently at dispatch time) — it only adds a new, genuinely
// auto-derived orders.buyer_country.
//
// Design: never guess. If nothing here confidently resolves a country,
// return null and let the caller show "(unknown)" — same honest fallback
// as before, just applying to far fewer rows. Ambiguous single-word
// country names that collide with common person/place names elsewhere
// in an address (Georgia, Jordan, Chad, Turkey, Niger, ...) are
// deliberately NOT in the alias list below, since this business's real
// order destinations don't need them and guessing wrong on a person's
// name is worse than an honest "(unknown)".

type CountryEntry = { canonical: string; aliases: string[] };

const COUNTRIES: CountryEntry[] = [
  { canonical: "United States", aliases: ["united states", "united states of america", "usa", "u.s.a.", "us"] },
  { canonical: "United Kingdom", aliases: ["united kingdom", "uk", "u.k.", "great britain", "england", "scotland", "wales", "northern ireland"] },
  { canonical: "Canada", aliases: ["canada"] },
  { canonical: "Australia", aliases: ["australia"] },
  { canonical: "Germany", aliases: ["germany", "deutschland"] },
  { canonical: "France", aliases: ["france"] },
  { canonical: "Netherlands", aliases: ["netherlands", "the netherlands", "holland"] },
  { canonical: "Switzerland", aliases: ["switzerland"] },
  { canonical: "Spain", aliases: ["spain"] },
  { canonical: "Ireland", aliases: ["ireland", "republic of ireland"] },
  { canonical: "Mexico", aliases: ["mexico", "méxico"] },
  { canonical: "Malaysia", aliases: ["malaysia"] },
  { canonical: "Hungary", aliases: ["hungary"] },
  { canonical: "New Zealand", aliases: ["new zealand"] },
  { canonical: "Hong Kong", aliases: ["hong kong, china", "hong kong"] },
  { canonical: "Argentina", aliases: ["argentina"] },
  { canonical: "Austria", aliases: ["austria"] },
  { canonical: "Puerto Rico", aliases: ["puerto rico"] },
  { canonical: "Singapore", aliases: ["singapore"] },
  { canonical: "Italy", aliases: ["italy", "italia"] },
  { canonical: "Sweden", aliases: ["sweden"] },
  { canonical: "Norway", aliases: ["norway"] },
  { canonical: "Denmark", aliases: ["denmark"] },
  { canonical: "Belgium", aliases: ["belgium"] },
  { canonical: "Poland", aliases: ["poland"] },
  { canonical: "Portugal", aliases: ["portugal"] },
  { canonical: "Japan", aliases: ["japan"] },
  { canonical: "United Arab Emirates", aliases: ["united arab emirates", "uae", "u.a.e."] },
  { canonical: "Saudi Arabia", aliases: ["saudi arabia", "ksa"] },
  { canonical: "South Africa", aliases: ["south africa"] },
  { canonical: "Brazil", aliases: ["brazil", "brasil"] },
  { canonical: "Israel", aliases: ["israel"] },
  { canonical: "India", aliases: ["india"] },
  { canonical: "China", aliases: ["china", "p.r.china", "prc"] },
  { canonical: "South Korea", aliases: ["south korea", "republic of korea"] },
  { canonical: "Finland", aliases: ["finland"] },
  { canonical: "Greece", aliases: ["greece"] },
  { canonical: "Czech Republic", aliases: ["czech republic", "czechia"] },
  { canonical: "Romania", aliases: ["romania"] },
  { canonical: "Bulgaria", aliases: ["bulgaria"] },
  { canonical: "Croatia", aliases: ["croatia"] },
  { canonical: "Slovakia", aliases: ["slovakia"] },
  { canonical: "Slovenia", aliases: ["slovenia"] },
  { canonical: "Luxembourg", aliases: ["luxembourg"] },
  { canonical: "Kuwait", aliases: ["kuwait"] },
  { canonical: "Qatar", aliases: ["qatar"] },
  { canonical: "Bahrain", aliases: ["bahrain"] },
  { canonical: "Oman", aliases: ["oman"] },
  { canonical: "Philippines", aliases: ["philippines"] },
  { canonical: "Indonesia", aliases: ["indonesia"] },
  { canonical: "Thailand", aliases: ["thailand"] },
  { canonical: "Vietnam", aliases: ["vietnam", "viet nam"] },
  { canonical: "Pakistan", aliases: ["pakistan"] },
  { canonical: "Bangladesh", aliases: ["bangladesh"] },
  { canonical: "Nepal", aliases: ["nepal"] },
  { canonical: "Sri Lanka", aliases: ["sri lanka"] },
  { canonical: "Nigeria", aliases: ["nigeria"] },
  { canonical: "Kenya", aliases: ["kenya"] },
  { canonical: "Egypt", aliases: ["egypt"] },
  { canonical: "Chile", aliases: ["chile"] },
  { canonical: "Colombia", aliases: ["colombia"] },
  { canonical: "Peru", aliases: ["peru", "perú"] },
];

// Every alias, longest-first, so a more specific alias ("united arab
// emirates") is tried before a shorter one that could be its substring.
const ALIAS_INDEX = COUNTRIES.flatMap((c) => c.aliases.map((alias) => ({ alias, canonical: c.canonical }))).sort(
  (a, b) => b.alias.length - a.alias.length
);

function stripTrailingParenthetical(line: string): string {
  // "United States (US)" -> "United States"
  return line.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function isJunkLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  // A line that's essentially just a phone number.
  if (/^[+()\d][\d\s()+-]{4,}$/.test(t)) return true;
  // A trailing tax/ID line accidentally left on the address (real example:
  // "Buyer National Id: GARV180581D53" appended after the real country line).
  if (/^(buyer\s+)?(national\s*id|tax\s*id|gst(in)?|vat(\s*no)?|pan)\b/i.test(t)) return true;
  return false;
}

function matchLineToCountry(rawLine: string): string | null {
  const cleaned = stripTrailingParenthetical(rawLine)
    .toLowerCase()
    .replace(/[.,]+$/, "")
    .trim();
  if (!cleaned) return null;

  for (const { alias, canonical } of ALIAS_INDEX) {
    if (cleaned === alias) return canonical;
  }
  // Suffix match — handles addresses with the line breaks stripped out
  // somewhere upstream, where the country name ends up concatenated
  // straight onto the previous token (real examples: "...MeathC15
  // VX7TIreland", "...258875Singapore").
  for (const { alias, canonical } of ALIAS_INDEX) {
    if (cleaned.endsWith(alias)) {
      const before = cleaned.slice(0, cleaned.length - alias.length);
      // Require the character right before the match (if any) to not be
      // a letter, so a name ending in a country-like fragment can't
      // false-positive-match mid-word.
      if (before === "" || !/[a-z]$/.test(before)) return canonical;
    }
  }
  return null;
}

const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]);
const AU_STATES = new Set(["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"]);
const INDIA_KEYWORDS = [
  "india", "delhi", "new delhi", "mumbai", "bengaluru", "bangalore", "chennai", "kolkata", "hyderabad", "pune",
  "karnataka", "maharashtra", "gujarat", "punjab", "rajasthan", "tamil nadu", "telangana", "kerala", "uttar pradesh",
  "west bengal", "haryana", "bihar", "madhya pradesh", "odisha", "assam", "chandigarh", "noida", "gurgaon", "gurugram",
];

// Only reached when no line in the address matched a country name at
// all — postal-format/keyword fallbacks for addresses that never wrote
// the country out in words (real example: an Australian address ending
// "...NORTH TURRAMURRA, NSW 2074" with no "Australia" anywhere).
function postalFallback(fullText: string): string | null {
  const usMatch = fullText.match(/\b([A-Z]{2})\s+\d{5}(-\d{4})?\b/);
  if (usMatch && US_STATES.has(usMatch[1])) return "United States";

  if (/\b[A-CEGHJ-NPRSTVXY]\d[A-CEGHJ-NPRSTV-Z]\s?\d[A-CEGHJ-NPRSTV-Z]\d\b/i.test(fullText)) return "Canada";

  const auMatch = fullText.match(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b[,\s]+(\d{4})\b/i);
  if (auMatch && AU_STATES.has(auMatch[1].toUpperCase())) return "Australia";

  const lower = fullText.toLowerCase();
  for (const kw of INDIA_KEYWORDS) {
    const re = new RegExp(`\\b${kw.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(lower)) return "India";
  }
  return null;
}

/**
 * Extracts the destination country from a free-text buyer address —
 * `orders.buyer_name_address`, one field, exactly as typed at order
 * entry. Returns the canonical country name, or null if nothing here
 * can confidently resolve one (never guesses).
 */
export function parseCountryFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const lines = address
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  // Scan from the end backward, skipping junk trailing lines (a phone
  // number or a stray tax-ID line sometimes ends up after the real
  // country line), trying up to 5 real lines.
  let scanned = 0;
  for (let i = lines.length - 1; i >= 0 && scanned < 5; i--) {
    if (isJunkLine(lines[i])) continue;
    scanned++;
    const match = matchLineToCountry(lines[i]);
    if (match) return match;
  }

  return postalFallback(lines.join(" "));
}
