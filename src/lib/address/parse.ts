// Worldwide address parser (2026-11-22) — Phase 2 of the master upgrade.
//
// Replaces the US-shaped assumptions in src/lib/parse-full-address.ts with a
// country-aware splitter, and adds the piece that file never had: a status
// the employee can see. Background (the bug that started all of this): an
// employee pastes a buyer's full address into Address Line 1, City/State/
// Postcode end up blank, and a real FedEx booking then fails with
// "Recipient state and postal code mismatch".
//
// Three rules this parser is built around, because getting them wrong is how
// address parsers lose people's trust:
//
//  1. NEVER GUESS A FIELD SILENTLY. City and state are only filled when the
//     text actually determines them (a comma or a line break marks the
//     boundary, or the country's own written order makes it unambiguous —
//     Germany's "10115 Berlin" is postal-then-city by definition). When a
//     boundary really has to be inferred from a single run-together line,
//     the result is marked "Needs Review" with a note saying so. A blank
//     field plus a visible flag is honest; a plausible-looking wrong city is
//     not.
//  2. THE ORIGINAL TEXT SURVIVES. `raw` is carried through untouched and the
//     order form stores it in orders.buyer_address_raw, so nothing an
//     employee pasted is ever lost by a bad split — they can always see and
//     re-paste what they originally had.
//  3. THREE STATES ONLY: "Parsed" (rules resolved every required field for
//     that country), "Verified" (a real address-validation provider
//     confirmed it — see verify.ts; never set by this file), "Needs Review"
//     (something required is missing or had to be guessed).
//
// Country detection itself is NOT duplicated here: it reuses
// src/lib/geo/parse-country.ts, which was validated against 340 real
// production addresses. This file only decides what each country's address
// looks like (countries.ts) and how to take one apart.
//
// Every output field is meant to land in an ordinary editable input. Nothing
// here writes to the database; src/app/dashboard/orders/{new/actions.ts,
// actions.ts} recomputes the status server-side before saving, so a tampered
// form can never claim "Verified".

import { parseCountryFromAddress, countryNameForLine, isCountryOnlyText } from "../geo/parse-country";
import {
  COUNTRY_RULES,
  countryRuleByName,
  normalisePostal,
  postalMatches,
  stateLookup,
  fold,
  type CountryRule,
} from "./countries";

export const PARSER_VERSION = "rules-v1";

export type AddressStatus = "Parsed" | "Verified" | "Needs Review";
export type AddressConfidence = "high" | "medium" | "low";

export type AddressFields = {
  /** Buyer/person name, when it was clearly the first line of the paste. */
  name: string;
  company: string;
  /** Address line 1 — street and number. */
  street: string;
  /** Address line 2 — a second street line, nothing that was guessed. */
  address2: string;
  apartment: string;
  building: string;
  district: string;
  landmark: string;
  city: string;
  state: string;
  postalCode: string;
  /** Canonical country name ("" when not confidently detected). */
  country: string;
  /** ISO alpha-2 ("" when unknown). */
  countryCode: string;
};

export type ParsedAddressResult = {
  fields: AddressFields;
  status: AddressStatus;
  confidence: AddressConfidence;
  /** Names of the fields that keep this from being "Parsed". */
  missing: string[];
  /** Plain-language notes for the employee (why it needs a look). */
  notes: string[];
  raw: string;
  parser: string;
};

export type AddressAssessment = {
  status: AddressStatus;
  confidence: AddressConfidence;
  missing: string[];
};

const STREET_KEYWORDS = /^(apt|apartment|unit|suite|ste|flat|floor|fl|bldg|building|rm|room|plot|house|h\.no|no\.?|door)\b/i;

function emptyFields(): AddressFields {
  return {
    name: "",
    company: "",
    street: "",
    address2: "",
    apartment: "",
    building: "",
    district: "",
    landmark: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
    countryCode: "",
  };
}

function trimPunctuation(value: string): string {
  return value.replace(/^[\s,;:-]+|[\s,;:-]+$/g, "").trim();
}

function isJunkLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  // Phone numbers only — a bare postcode like Japan's "160-0023" is seven
  // digits and one dash, and must NOT be mistaken for a phone number.
  if (/^\+[\d\s()+-]{6,}$/.test(t)) return true;
  if (/\(\d{2,4}\)/.test(t) && /^[\d\s()+-]+$/.test(t)) return true;
  if (/^[\d\s()+-]+$/.test(t)) {
    const digits = t.replace(/\D/g, "").length;
    if (digits >= 10 || (digits >= 7 && /\s/.test(t))) return true;
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return true;
  if (/^(buyer\s+)?(national\s*id|tax\s*id|gst(in)?|vat(\s*no)?|pan)\b/i.test(t)) return true;
  return false;
}

function looksLikeCompany(line: string): boolean {
  return /\b(ltd|limited|llc|l\.l\.c|inc|corp|corporation|gmbh|co|pvt|pte|bv|nv|srl|sarl|plc|llp|company|enterprises?|trading)\b\.?$/i.test(
    trimPunctuation(line)
  );
}

function looksLikePersonName(line: string): boolean {
  const t = trimPunctuation(line);
  if (!t) return false;
  if (STREET_KEYWORDS.test(t)) return false;
  if (/\d/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 4) return false;
  return words.every((w) => /^[A-Za-z][A-Za-z.'’-]*$/.test(w));
}

function looksLikeCityText(line: string): boolean {
  const t = trimPunctuation(line);
  if (!t) return false;
  if (/\d/.test(t)) return false;
  if (looksLikeCompany(t)) return false;
  return t.split(/\s+/).length <= 5;
}

/**
 * Pulls a state/province token off the END of `text` using the country's own
 * list (abbreviation or full name). Returns the abbreviation plus whatever
 * preceded it, and never matches mid-word or against a name that only looks
 * similar.
 */
export function extractState(rule: CountryRule | undefined, text: string): { state: string; rest: string } {
  const cleaned = trimPunctuation(text);
  if (!rule?.states || !cleaned) return { state: "", rest: cleaned };
  const folded = fold(cleaned);
  for (const [key, code] of stateLookup(rule)) {
    if (folded === key) return { state: code, rest: "" };
    if (folded.endsWith(` ${key}`)) {
      const rest = trimPunctuation(cleaned.slice(0, cleaned.length - key.length));
      return { state: code, rest };
    }
  }
  return { state: "", rest: cleaned };
}

/** Splits "… Apt 4"/"… #4B" off a street line without touching the street number. */
function splitApartment(line: string): { street: string; apartment: string } {
  const m = trimPunctuation(line).match(/^(.*?)[,\s]+((?:#\S+.*|apt\b.*|apartment\b.*|unit\b.*|suite\b.*|ste\b.*|flat\b.*|floor\b.*|fl\b.*|bldg\b.*|building\b.*|rm\b.*|room\b.*))$/i);
  if (!m || !m[1].trim()) return { street: trimPunctuation(line), apartment: "" };
  return { street: trimPunctuation(m[1]), apartment: trimPunctuation(m[2]) };
}

/**
 * Last-resort street/city boundary for text with no comma, no line break and
 * no usable country order — everything after the LAST street marker (a house
 * number, Apt/Unit, or a street suffix) is taken as the city. Callers must
 * mark the result "Needs Review": this is the one place a boundary is guessed.
 */
function splitStreetFromCity(text: string): { street: string; city: string } {
  const re =
    /\b(\d+[a-z]?|apt|apartment|suite|ste|unit|#\S*|floor|fl|bldg|building|st|street|ave|avenue|rd|road|ln|lane|dr|drive|blvd|boulevard|ct|court|pl|place|way|ter|terrace|cir|circle|pkwy|parkway|hwy|highway)\b\.?/gi;
  let lastEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) lastEnd = m.index + m[0].length;
  if (lastEnd === -1 || lastEnd >= text.length) return { street: trimPunctuation(text), city: "" };
  return { street: trimPunctuation(text.slice(0, lastEnd)), city: trimPunctuation(text.slice(lastEnd)) };
}

type PostalLine = {
  postal: string;
  state: string;
  city: string;
  /** Text on the same line before the city/state/postcode segment. */
  streetPrefix: string;
  /** Any text after that segment (rare; kept so nothing is silently lost). */
  trailing: string;
};

/**
 * Finds a postcode on ONE line and takes everything else on that line apart
 * around it, in the country's own written order. Comma segments are tried
 * from the end so a street line's house number can't be mistaken for a
 * postcode. Returns null when the line has no postcode valid for `rule`.
 */
function parsePostalLine(
  line: string,
  rule: CountryRule | undefined
): { info: PostalLine; rule: CountryRule } | null {
  const segments = line
    .split(",")
    .map((s) => trimPunctuation(s))
    .filter(Boolean)
    // Exact match only: "Ciudad de Mexico" must survive as a city.
    .filter((s) => !isCountryOnlyText(s));

  const rules = rule ? [rule] : COUNTRY_RULES;

  for (const candidateRule of rules) {
    if (!candidateRule.postal) continue;
    for (let s = segments.length - 1; s >= 0; s--) {
      const tokens = segments[s].split(/\s+/).filter(Boolean);
      for (const size of [2, 1]) {
        for (let i = tokens.length - size; i >= 0; i--) {
          const postal = normalisePostal(tokens.slice(i, i + size).join(" "));
          if (!postalMatches(candidateRule, postal)) continue;

          const before = trimPunctuation(tokens.slice(0, i).join(" "));
          const after = trimPunctuation(tokens.slice(i + size).join(" "));
          // "10115 Berlin" (postal first) vs "Bethesda, MD 20814" (postal last).
          const remainder = candidateRule.postalFirst ? after || before : before || after;

          const { state, rest } = extractState(candidateRule, remainder);
          let city = trimPunctuation(rest);
          let citySegment = -1;
          if (!city && s > 0 && looksLikeCityText(segments[s - 1])) {
            city = trimPunctuation(segments[s - 1]);
            citySegment = s - 1;
          }

          return {
            rule: candidateRule,
            info: {
              postal,
              state,
              city,
              streetPrefix: segments.slice(0, citySegment === -1 ? s : citySegment).join(", "),
              trailing: segments.slice(s + 1).join(", "),
            },
          };
        }
      }
    }
  }
  return null;
}

/**
 * The parts of an address that make it usable for a courier label, checked
 * against that country's rules. Used by the order actions (server-side, so
 * the stored status can never be spoofed by the browser) and by the order
 * form's live badge.
 */
export function assessAddress(input: {
  country: string | null | undefined;
  state: string | null | undefined;
  city: string | null | undefined;
  postalCode: string | null | undefined;
  street: string | null | undefined;
}): AddressAssessment {
  const country = (input.country ?? "").trim();
  const state = (input.state ?? "").trim();
  const city = (input.city ?? "").trim();
  const postal = (input.postalCode ?? "").trim();
  const street = (input.street ?? "").trim();

  const rule = countryRuleByName(country);
  const missing: string[] = [];

  if (!country) missing.push("country");
  else if (!rule) missing.push("a recognised country");
  if (!street) missing.push("street address");
  if (!city) missing.push("city");
  if (rule?.stateRequired && !state) missing.push(rule.stateLabel.toLowerCase());
  if (rule?.postalRequired && !postal) missing.push("postal code");
  if (postal && rule?.postal && !postalMatches(rule, postal)) missing.push(`a valid ${rule.code} postal code`);

  const status: AddressStatus = missing.length === 0 ? "Parsed" : "Needs Review";
  const confidence: AddressConfidence = missing.length === 0 ? "high" : missing.length <= 2 ? "medium" : "low";
  return { status, confidence, missing };
}

/**
 * Splits any pasted address — real multi-line clipboard text, a single line,
 * or one with commas only — into structured fields. Never throws; returns
 * empty strings for whatever the text doesn't determine.
 */
export function parseAddress(raw: string | null | undefined): ParsedAddressResult {
  const rawText = typeof raw === "string" ? raw : "";
  const base = { raw: rawText, parser: PARSER_VERSION };

  if (!rawText.trim()) {
    return {
      ...base,
      fields: emptyFields(),
      status: "Needs Review",
      confidence: "low",
      missing: ["address"],
      notes: ["No address text to split."],
    };
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !isJunkLine(l));

  const country = parseCountryFromAddress(rawText) ?? "";
  const rule = countryRuleByName(country);

  const fields = emptyFields();
  fields.country = country;
  fields.countryCode = rule?.code ?? "";

  if (lines.length === 0) {
    return {
      ...base,
      fields,
      status: "Needs Review",
      confidence: "low",
      missing: ["address"],
      notes: ["The pasted text contained only a phone number, email or tax ID."],
    };
  }

  // Drop lines that ARE a country name (and nothing else), then strip a
  // country name stuck to the tail of the last line by a paste that lost its
  // line breaks. Exact-match only for the whole line: "L-1111 Luxembourg"
  // and "Ciudad de Mexico" are address lines that merely end in a name.
  let working = lines.filter((l) => !isCountryOnlyText(l));
  if (working.length === 0) working = lines.slice();
  if (country && working.length > 0) {
    const stripped = stripTrailingCountry(working[working.length - 1], country);
    if (stripped) working[working.length - 1] = stripped;
    else working.pop();
  }
  if (working.length === 0) {
    return {
      ...base,
      fields,
      status: "Needs Review",
      confidence: "low",
      missing: ["address"],
      notes: ["Only a country was found in the pasted text."],
    };
  }

  const notes: string[] = [];
  const consumed = new Set<number>();
  let guessed = false;

  // 1. The line carrying the postcode (scanned bottom-up — it is almost
  //    always one of the last three lines).
  let postalIdx = -1;
  let postalInfo: PostalLine | null = null;
  for (let i = working.length - 1; i >= 0 && i >= working.length - 4; i--) {
    const parsed = parsePostalLine(working[i], rule);
    if (parsed) {
      postalIdx = i;
      postalInfo = parsed.info;
      break;
    }
  }

  if (postalInfo) {
    consumed.add(postalIdx);
    fields.postalCode = postalInfo.postal;
    fields.state = postalInfo.state;
    fields.city = postalInfo.city;

    // Postcode on its own line ("…\nLondon\nSW1A 2AA") — the line above it is
    // the city, or the state when it is one.
    if (!fields.city && postalIdx > 0) {
      const prev = working[postalIdx - 1];
      const st = extractState(rule, prev);
      if (st.state && !st.rest) {
        fields.state = fields.state || st.state;
        consumed.add(postalIdx - 1);
        if (postalIdx > 1 && looksLikeCityText(working[postalIdx - 2])) {
          fields.city = working[postalIdx - 2];
          consumed.add(postalIdx - 2);
        }
      } else if (looksLikeCityText(prev)) {
        fields.city = trimPunctuation(prev);
        consumed.add(postalIdx - 1);
      }
    }
  } else {
    // No postcode anywhere. Countries without one (Hong Kong, UAE, Qatar)
    // can still be complete; the last line may be the city.
    const lastIdx = working.length - 1;
    const last = working[lastIdx];
    const st = extractState(rule, last);
    if (st.state && !st.rest) {
      fields.state = st.state;
      consumed.add(lastIdx);
      if (lastIdx > 0 && looksLikeCityText(working[lastIdx - 1])) {
        fields.city = working[lastIdx - 1];
        consumed.add(lastIdx - 1);
      }
    } else if ((!rule || !rule.postalRequired || working.length > 1) && looksLikeCityText(last)) {
      fields.city = trimPunctuation(last);
      consumed.add(lastIdx);
    }
    if (rule?.postalRequired) notes.push(`No ${rule.stateLabel === "State" ? "" : ""}postal code was found in the pasted text.`);
  }

  // 2. Street lines: everything left, plus any street text on the postcode
  //    line itself (a paste that collapsed several lines into one).
  let inlineStreet = postalInfo?.streetPrefix ?? "";
  if (fields.city && /\d/.test(fields.city)) {
    // The "city" still contains a house/street number, so the boundary was
    // not actually marked — infer it, and flag it.
    const guess = splitStreetFromCity(fields.city);
    fields.city = guess.city;
    inlineStreet = [inlineStreet, guess.street].filter(Boolean).join(", ");
    guessed = true;
    notes.push("Street and city were separated from a single run-together line — please check.");
  }

  const streetChunks: string[] = [];
  for (const chunk of inlineStreet.split(",")) {
    const t = trimPunctuation(chunk);
    if (t) streetChunks.push(t);
  }
  for (let i = 0; i < working.length; i++) {
    if (consumed.has(i)) continue;
    const t = trimPunctuation(working[i]);
    if (t) streetChunks.push(t);
  }

  // 3. A leading plain name (or company) is not part of the street.
  if (streetChunks.length > 0) {
    const first = streetChunks[0];
    const inlineName = !STREET_KEYWORDS.test(first)
      ? first.match(/^([A-Za-z][A-Za-z.'’-]*(?:\s+[A-Za-z][A-Za-z.'’-]*){0,3})\s+(\d.*)$/)
      : null;
    if (inlineName && !looksLikeCompany(inlineName[1])) {
      fields.name = inlineName[1].trim();
      streetChunks[0] = trimPunctuation(inlineName[2]);
    } else if (streetChunks.length > 1 && looksLikeCompany(first)) {
      fields.company = first;
      streetChunks.shift();
    } else if (streetChunks.length > 1 && looksLikePersonName(first)) {
      fields.name = first;
      streetChunks.shift();
    }
  }

  const [firstStreet, ...restLines] = streetChunks;
  if (firstStreet) {
    // The apartment/suite stays INSIDE the street line on purpose: courier
    // APIs (and the previous parser) expect "4700 Hampden Lane Apt 0809" in
    // address line 1, and dropping it here would silently shorten a label.
    fields.street = trimPunctuation(firstStreet);
    fields.apartment = splitApartment(firstStreet).apartment;
  }
  for (const line of restLines) {
    if (STREET_KEYWORDS.test(line) || line.startsWith("#")) {
      fields.apartment = [fields.apartment, line].filter(Boolean).join(", ");
      fields.address2 = [fields.address2, line].filter(Boolean).join(", ");
    } else if (/(landmark|near|opposite|opp\.?|beside|behind)\b/i.test(line)) {
      fields.landmark = line;
    } else if (!fields.address2) {
      fields.address2 = line;
    } else if (!fields.district) {
      fields.district = line;
    } else {
      fields.address2 = `${fields.address2}, ${line}`;
    }
  }

  // 4. Status. `Parsed` only when every required part is present.
  const assessment = assessAddress({
    country: fields.country,
    state: fields.state,
    city: fields.city,
    postalCode: fields.postalCode,
    street: fields.street,
  });

  if (assessment.missing.length > 0) {
    notes.push(`Missing: ${assessment.missing.join(", ")}.`);
  }
  if (guessed) notes.push("Fields below are editable — correct anything that looks wrong.");

  return {
    ...base,
    fields,
    status: guessed ? "Needs Review" : assessment.status,
    confidence: guessed ? "low" : assessment.confidence,
    missing: assessment.missing,
    notes,
  };
}

/** Removes a trailing country name/alias from a line, e.g. "…20814 United States". */
function stripTrailingCountry(line: string, country: string): string {
  const tokens = line.split(/\s+/).filter(Boolean);
  // Smallest tail first: a 5-token window on "…Bethesda MD 20814 United
  // States" also suffix-matches the country and would swallow the address.
  for (let size = 1; size <= Math.min(5, tokens.length); size++) {
    const tail = tokens.slice(tokens.length - size).join(" ");
    if (countryNameForLine(tail) === country) {
      const remainder = trimPunctuation(tokens.slice(0, tokens.length - size).join(" "));
      if (!remainder) return "";
      const remainderTokens = remainder.split(/\s+/);
      const lastRemaining = remainderTokens[remainderTokens.length - 1];
      // If only the postcode would be left ("018956 Singapore", "L-1111
      // Luxembourg"), the country name is also the city — keep the line and
      // let the postal split read it. Only a plain city ("Paris, France")
      // or a real street line is worth stripping down to.
      if (remainderTokens.length >= 2 || !/\d/.test(lastRemaining)) return remainder;
      return trimPunctuation(line);
    }
  }
  return trimPunctuation(line);
}
