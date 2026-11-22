// Public entry point for the address engine (Phase 2, 2026-11-22).
//
// Import from "@/lib/address" rather than the individual files: the split
// between countries/parse/verify is an implementation detail, and the UI only
// ever needs these names.

export {
  COUNTRY_RULES,
  countryRuleByCode,
  countryRuleByName,
  normalisePostal,
  postalMatches,
  type CountryRule,
} from "./countries";

export {
  PARSER_VERSION,
  assessAddress,
  extractState,
  parseAddress,
  type AddressAssessment,
  type AddressConfidence,
  type AddressFields,
  type AddressStatus,
  type ParsedAddressResult,
} from "./parse";

export {
  GOOGLE_VALIDATION_ENV_VAR,
  activeVerifier,
  googleAddressVerifier,
  rulesVerifier,
  verifyAddress,
  type AddressVerifier,
  type VerificationInput,
  type VerificationOutcome,
} from "./verify";
