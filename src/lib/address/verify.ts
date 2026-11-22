// Address verification providers (2026-11-22) — Phase 2.
//
// "Parsed" (rules.ts output) only means the text had every part this app can
// check by itself. "Verified" must mean something stronger: a real address
// service confirmed the address exists. Nothing in this repo may label an
// address Verified without such a response, which is why this file exists
// separately from parse.ts and why the rules provider below can never return
// "Verified".
//
// Two providers behind one interface:
//
//  • rules — always available, no network, no key. Wraps assessAddress(), so
//    a caller that always awaits a verifier doesn't need a branch.
//  • google-address-validation — Google's Address Validation API. Dormant
//    until GOOGLE_ADDRESS_VALIDATION_API_KEY is present in the environment;
//    no key means isConfigured() is false and the rules provider is used
//    instead. Toggle without a code change.
//
// Deliberately NOT wired into the save path yet: an order must never fail or
// slow down because a third-party API is down or rate-limited, and the
// current address status is only ever advisory. The order actions call
// assessAddress() directly (cheap, offline, deterministic). When the key is
// added, src/app/dashboard/orders/[id] and the entry forms can call
// verifyAddress() explicitly for the "Verify" action, storing the result in
// orders.address_status.
//
// The provider contract is intentionally small: status + corrections +
// message. A future provider (Lob, SmartyStreets, a national postal API)
// implements the same three members and nothing else changes.

import { assessAddress, type AddressFields, type AddressStatus } from "./parse";
import { countryRuleByCode } from "./countries";

export const GOOGLE_VALIDATION_ENV_VAR = "GOOGLE_ADDRESS_VALIDATION_API_KEY";

export type VerificationInput = {
  fields: AddressFields;
  /** The untouched text the employee pasted, when available. */
  raw: string;
};

export type VerificationOutcome = {
  status: AddressStatus;
  provider: "rules" | "google-address-validation";
  /** Fields the provider is confident enough to correct. Usually empty. */
  corrections: Partial<AddressFields>;
  /** Plain-language result for the employee. */
  message: string;
  checkedAt: string;
};

export type AddressVerifier = {
  id: VerificationOutcome["provider"];
  isConfigured(): boolean;
  verify(input: VerificationInput): Promise<VerificationOutcome>;
};

/** Offline, deterministic, no key. Never returns "Verified". */
export const rulesVerifier: AddressVerifier = {
  id: "rules",
  isConfigured: () => true,
  async verify({ fields }) {
    const assessment = assessAddress({
      country: fields.country,
      state: fields.state,
      city: fields.city,
      postalCode: fields.postalCode,
      street: fields.street,
    });
    return {
      status: assessment.status,
      provider: "rules",
      corrections: {},
      message:
        assessment.missing.length === 0
          ? "All required parts for this country are present."
          : `Missing: ${assessment.missing.join(", ")}.`,
      checkedAt: new Date().toISOString(),
    };
  },
};

type GoogleValidationResponse = {
  result?: {
    verdict?: {
      addressComplete?: boolean;
      hasUnconfirmedComponents?: boolean;
      hasInferredComponents?: boolean;
      validationGranularity?: string;
    };
    address?: {
      formattedAddress?: string;
      postalAddress?: {
        regionCode?: string;
        postalCode?: string;
        locality?: string;
        administrativeArea?: string;
        addressLines?: string[];
      };
    };
  };
  error?: { message?: string };
};

/**
 * Google Address Validation. Only used when the key is set. Any transport or
 * API error returns Needs Review with the reason — never a false "Verified".
 */
export const googleAddressVerifier: AddressVerifier = {
  id: "google-address-validation",
  isConfigured: () => Boolean(process.env[GOOGLE_VALIDATION_ENV_VAR]),
  async verify({ fields }) {
    const key = process.env[GOOGLE_VALIDATION_ENV_VAR];
    const fallback = await rulesVerifier.verify({ fields, raw: "" });
    if (!key) return { ...fallback, provider: "google-address-validation", message: "No Google API key configured." };

    const regionCode = fields.countryCode || countryRuleByCode(fields.countryCode)?.code || "";
    const addressLines = [fields.street, fields.address2, fields.apartment, fields.building]
      .map((v) => v.trim())
      .filter(Boolean);

    try {
      const response = await fetch(
        `https://addressvalidation.googleapis.com/v1:validateAddress?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address: {
              regionCode,
              addressLines,
              locality: fields.city || undefined,
              administrativeArea: fields.state || undefined,
              postalCode: fields.postalCode || undefined,
            },
          }),
        }
      );
      const body = (await response.json()) as GoogleValidationResponse;
      if (!response.ok) {
        return {
          ...fallback,
          provider: "google-address-validation",
          message: `Google Address Validation returned ${response.status}${body?.error?.message ? `: ${body.error.message}` : ""}.`,
        };
      }

      const verdict = body.result?.verdict;
      const postal = body.result?.address?.postalAddress;
      const corrections: Partial<AddressFields> = {};
      if (postal?.postalCode && postal.postalCode !== fields.postalCode) corrections.postalCode = postal.postalCode;
      if (postal?.locality && postal.locality !== fields.city) corrections.city = postal.locality;
      if (postal?.administrativeArea && postal.administrativeArea !== fields.state) {
        corrections.state = postal.administrativeArea;
      }

      const confirmed =
        verdict?.addressComplete === true &&
        verdict?.hasUnconfirmedComponents !== true &&
        verdict?.hasInferredComponents !== true;

      return {
        status: confirmed ? "Verified" : "Needs Review",
        provider: "google-address-validation",
        corrections,
        message: confirmed
          ? "Confirmed by Google Address Validation."
          : `Google could only partially confirm this address${verdict?.validationGranularity ? ` (${verdict.validationGranularity})` : ""}.`,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ...fallback,
        provider: "google-address-validation",
        message: `Google Address Validation could not be reached: ${error instanceof Error ? error.message : "unknown error"}.`,
      };
    }
  },
};

const PROVIDERS: AddressVerifier[] = [rulesVerifier, googleAddressVerifier];

/** The strongest configured provider: Google when a key exists, else rules. */
export function activeVerifier(): AddressVerifier {
  return PROVIDERS.find((provider) => provider.id !== "rules" && provider.isConfigured()) ?? rulesVerifier;
}

/** Verifies with the active provider. Never throws. */
export async function verifyAddress(input: VerificationInput): Promise<VerificationOutcome> {
  const verifier = activeVerifier();
  try {
    return await verifier.verify(input);
  } catch (error) {
    return {
      status: "Needs Review",
      provider: verifier.id,
      corrections: {},
      message: `Verification failed: ${error instanceof Error ? error.message : "unknown error"}.`,
      checkedAt: new Date().toISOString(),
    };
  }
}
