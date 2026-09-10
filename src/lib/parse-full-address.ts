// Full-address splitter (2026-09-10) — "ORDER SE FIRST LINE SECOND LINE SE
// ADDRESSH UTH KE NAHI AARA NA BUYER KA ADDRESSH AARA OR YE ERROR KYU AARA
// HAI" (FedEx "Recipient state and postal code mismatch").
//
// ROOT CAUSE this fixes: the order form's "Structured Address" section
// (order-form.tsx / order-edit-form.tsx) has always been 5-6 separate plain
// <input>s — Address Line 1/2/(3), City, State, Postal Code — with zero
// guidance and zero parsing. An employee who's used to pasting a buyer's
// FULL address (name + street + city + state + zip + country, usually
// copied as several lines from a marketplace order page) naturally pastes
// the whole thing into the first box, "Address Line 1", exactly like they
// always could with the old single free-text field. City/State/Postcode
// then sit blank — which is exactly what showed up in the FedEx booking
// screenshot (blank City/State/Postcode, and Address Line 1 holding
// "Megha Malik 4700 Hampden Lane Apt 0809 Bethesda, MD 20814 United
// States" all run together, because a browser pasting multi-line clipboard
// text into a single-line <input> collapses the line breaks). FedEx then
// rejects the booking with a confusing "state and postal code mismatch"
// instead of a clear "these are blank" error, because from its side it
// just received empty strings for both.
//
// THE FIX, in 3 layers (see callers of parseFullAddress for where each is
// wired in):
//  1. An onPaste handler on the Address Line 1 box (order-form.tsx /
//     order-edit-form.tsx) intercepts a multi-line paste BEFORE the browser
//     collapses it — reads the raw clipboard text (real line breaks still
//     intact) and auto-splits it into Address Line 1/2, City, State,
//     Postcode, and Destination Country, going forward.
//  2. A "Split Address" button next to Address Line 1 that re-runs this
//     same parser against whatever is ALREADY sitting in the box — for
//     already-broken orders (like the one in the bug report) without the
//     employee needing to retype anything, and for browsers/flows where
//     the paste event can't be intercepted (e.g. a mobile "Paste" menu).
//  3. A server-side fallback in courier-booking/actions.ts's
//     lookupOrderForCourierBooking (and shipglobal/actions.ts) — if an
//     order's City/State/Postcode are still blank but Address Line 1 looks
//     like it has a full address jammed into it, the Create Shipment
//     screen's defaults are parsed from that instead of coming up blank,
//     so an order entered before this fix existed self-heals the moment
//     it's booked, with zero manual re-entry required.
//
// Two very different input shapes are handled, by design:
//  - Real multi-line text (paste event with line breaks intact, or any
//    future free-text import) — the reliable case: the last non-junk line
//    is almost always the country, the line right before it is almost
//    always "City, State Postcode" in one clean piece, and everything
//    above that is the street address. Parsed line-by-line, no guessing
//    needed for the city/street boundary.
//  - Already-collapsed single-line text (what's sitting in the DB for an
//    order like the one in the bug report, or a paste our own onPaste
//    handler couldn't intercept) — inherently lossier: the city/street
//    boundary isn't marked by anything, so it's guessed by finding the
//    LAST "street-type" token (a house number, Apt/Suite/Unit, or a
//    street-suffix word like St/Ave/Rd) and treating whatever comes after
//    it as the city. State and Postcode are still extracted reliably even
//    in this shape (they sit at the very end, after the country is
//    stripped off) — those are exactly the two fields FedEx complained
//    about, so this alone fixes the reported error even when the
//    city/street split isn't perfect. Every field this produces stays in
//    an ordinary editable <input> — never silently trusted, always
//    reviewable before a booking is submitted, same "best-effort, never
//    silently wrong" approach as src/lib/postal-lookup.ts and
//    src/lib/geo/parse-country.ts already use elsewhere in this app.
import { parseCountryFromAddress, US_STATES } from "@/lib/geo/parse-country";

export type ParsedAddress = {
  address1: string;
  address2: string;
  city: string;
  state: string;
  postalCode: string;
  /** Canonical country name (e.g. "United States"), or "" if unresolved. */
  country: string;
};

const EMPTY: ParsedAddress = { address1: "", address2: "", city: "", state: "", postalCode: "", country: "" };

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Same phone-number / tax-ID junk-line filter as parse-country.ts's own
// isJunkLine — duplicated rather than imported since that one isn't
// exported and is tightly scoped to that file's own line-scanning loop;
// this is the one other place in the app that needed the identical check.
function isJunkLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^[+()\d][\d\s()+-]{4,}$/.test(t)) return true;
  if (/^(buyer\s+)?(national\s*id|tax\s*id|gst(in)?|vat(\s*no)?|pan)\b/i.test(t)) return true;
  return false;
}

/**
 * Matches State+Postcode (optionally with a City in front, separated by a
 * comma or just whitespace) at the very END of `text`. Tried in order:
 * US, India, Canada, Australia, UK, then a generic last-resort. Returns the
 * text BEFORE the match (`rest` — the city, when this was given an already
 * isolated city/state/zip line, or city+street combined, when given a
 * larger chunk of text) plus the extracted state/postcode. Returns null
 * when nothing recognizable is found at the tail at all.
 */
function extractTrailingStateZip(text: string): { rest: string; state: string; postalCode: string } | null {
  const t = text.trim();
  if (!t) return null;

  // US: "..., CA 92256" / "... CA 92256-2101"
  let m = t.match(/^(.*?),?\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
  if (m && US_STATES.has(m[2].toUpperCase())) {
    return { rest: m[1].trim(), state: m[2].toUpperCase(), postalCode: m[3] };
  }

  // India: "..., Maharashtra 400001" / "..., Maharashtra - 400001"
  m = t.match(/^(.*?),\s*([A-Za-z .]{3,30}?)\s*[-–]?\s*(\d{6})\s*$/);
  if (m) {
    return { rest: m[1].trim(), state: m[2].trim(), postalCode: m[3] };
  }

  // Canada: "..., ON M5V 2T6"
  m = t.match(/^(.*?),?\s+([A-Za-z]{2})\s+([A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d)\s*$/i);
  if (m) {
    return { rest: m[1].trim(), state: m[2].toUpperCase(), postalCode: m[3].toUpperCase() };
  }

  // Australia: "..., NSW 2074"
  m = t.match(/^(.*?),?\s+(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s+(\d{4})\s*$/i);
  if (m) {
    return { rest: m[1].trim(), state: m[2].toUpperCase(), postalCode: m[3] };
  }

  // UK: "..., SW1A 1AA"
  m = t.match(/^(.*?),\s*([A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2})\s*$/i);
  if (m) {
    return { rest: m[1].trim(), state: "", postalCode: m[2].toUpperCase() };
  }

  // Generic last resort: split on the final comma, treat the trailing
  // alphanumeric token in what's left after it as the postcode and
  // whatever's before that token (on that side of the comma) as the
  // state/region. Deliberately conservative — only fires when there IS a
  // comma to anchor on, so it doesn't misfire on a plain street address
  // with no city/state/zip at all.
  const idx = t.lastIndexOf(",");
  if (idx !== -1) {
    const rest = t.slice(0, idx).trim();
    const tail = t.slice(idx + 1).trim();
    const m2 = tail.match(/^(.*?)\s*([\w-]{3,10})$/);
    if (rest && m2 && m2[2]) {
      return { rest, state: m2[1].trim(), postalCode: m2[2].trim() };
    }
  }

  return null;
}

// Street-type marker used only for the lossy single-line fallback, to
// guess where the street address ends and the city begins — a house
// number, an Apt/Suite/Unit marker, or a common street-suffix word. Takes
// everything AFTER the LAST such marker as the city.
const STREET_MARKER_RE =
  /\b(\d+[a-z]?|apt|apartment|suite|ste|unit|#\S*|floor|fl|bldg|building|st|street|ave|avenue|rd|road|ln|lane|dr|drive|blvd|boulevard|ct|court|pl|place|way|ter|terrace|cir|circle|pkwy|parkway|hwy|highway)\b\.?/gi;

function splitStreetFromCity(text: string): { street: string; city: string } {
  let lastEnd = -1;
  const re = new RegExp(STREET_MARKER_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd === -1 || lastEnd >= text.length) {
    return { street: text.trim(), city: "" };
  }
  return { street: text.slice(0, lastEnd).trim(), city: text.slice(lastEnd).trim() };
}

/**
 * Best-effort full-address splitter. Accepts either real multi-line text
 * (preferred — pass the raw clipboard string from a paste event before the
 * browser has a chance to collapse it) or an already-single-line string
 * (e.g. re-parsing an order's existing Address Line 1). Never throws;
 * returns whatever it could confidently resolve and leaves the rest blank
 * — every result field is meant to land in an ordinary editable <input>,
 * never auto-submitted without a look.
 */
export function parseFullAddress(raw: string | null | undefined): ParsedAddress {
  if (!raw || !raw.trim()) return { ...EMPTY };

  const hasRealLines = /\r?\n/.test(raw);
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !isJunkLine(l));
  if (lines.length === 0) return { ...EMPTY };

  const result: ParsedAddress = { ...EMPTY };
  result.country = parseCountryFromAddress(lines.join("\n")) ?? "";

  // Drop a line that IS just the country by itself.
  let working = result.country
    ? lines.filter((l) => l.toLowerCase().replace(/[.,]+$/, "").trim() !== result.country.toLowerCase())
    : lines.slice();
  if (working.length === 0) return result;

  // Strip a country name stuck onto the tail of the last remaining line —
  // this is what happens when a paste collapsed what used to be 2 separate
  // lines ("...MD 20814" / "United States") into one.
  if (result.country) {
    const re = new RegExp(`\\s*\\b${escapeRe(result.country)}\\b\\s*$`, "i");
    working[working.length - 1] = working[working.length - 1].replace(re, "").trim();
    working = working.filter(Boolean);
  }
  if (working.length === 0) return result;

  if (hasRealLines) {
    // Real line breaks available — scan backward for the line that IS the
    // City/State/Postcode line; everything above it is the street address.
    let cszIndex = -1;
    for (let i = working.length - 1; i >= 0; i--) {
      const csz = extractTrailingStateZip(working[i]);
      if (csz) {
        result.city = csz.rest;
        result.state = csz.state;
        result.postalCode = csz.postalCode;
        cszIndex = i;
        break;
      }
    }
    const addressLines = cszIndex === -1 ? working : working.slice(0, cszIndex);
    result.address1 = addressLines[0] ?? "";
    result.address2 = addressLines.slice(1).join(", ");
  } else {
    // No real line breaks — already-collapsed text. State/Postcode are
    // still reliably extractable from the tail; City/street is a
    // best-effort guess (see splitStreetFromCity above).
    const flat = working.join(" ");
    const csz = extractTrailingStateZip(flat);
    if (csz) {
      result.state = csz.state;
      result.postalCode = csz.postalCode;
      const { street, city } = splitStreetFromCity(csz.rest);
      result.address1 = street;
      result.city = city;
    } else {
      result.address1 = flat;
    }
  }

  return result;
}

/**
 * True when `text` looks like it's carrying more than just a plain street
 * address — i.e. it has real line breaks, or its tail matches a
 * City/State/Postcode or trailing-country pattern. Used to decide whether
 * an onPaste should be intercepted for auto-splitting at all (a normal
 * single "123 Main St" paste should behave exactly as a plain text input
 * always has — this only kicks in for a paste that looks like a FULL
 * address).
 */
export function looksLikeFullAddress(text: string): boolean {
  if (!text || !text.trim()) return false;
  if (/\r?\n/.test(text)) return true;
  if (parseCountryFromAddress(text)) return true;
  return extractTrailingStateZip(text.trim()) !== null;
}
