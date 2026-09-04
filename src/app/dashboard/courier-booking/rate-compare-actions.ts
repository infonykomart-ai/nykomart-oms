"use server";

// "Compare all couriers' rates before booking" (2026-09-03 follow-on round
// to §27's Courier Ops Dashboard) — user's own framing: "jab booking
// karenge to kya sabhi courier company ke rate dikhenge campair ke liye".
//
// TWO price sources per courier, shown side by side:
//  1. Rate Card estimate — this company's own manually-maintained
//     Courier Rate Card (courier_rate_cards), the SAME
//     estimateBookedAmountFromRateCard() booking already falls back to
//     when a courier's API returns no price. Instant, no network call,
//     works for every courier the Rate Card has a matching (courier,
//     zone, weight) slab for. Requires the employee to also supply a Zone
//     — this app's Rate Card is zone-based, not postcode-based, and has
//     no automatic postcode→zone mapping (matches the existing Freight
//     Cost Estimator's own design).
//  2. Live API quote — a real-time call to each courier's own dedicated
//     RATE/QUOTE endpoint (never the booking/shipment-creation endpoint —
//     see each *-rate.ts file), using whatever credentials Account Setup
//     (or env vars) has resolved for this company. Skipped entirely for a
//     courier with no credentials configured (courier_credentials via
//     getCourierCredentialStatus) rather than attempting a call that can
//     only fail. Every *-rate.ts file is UNVERIFIED against a real
//     account — built from public/secondary-source API docs, same honest-
//     limitation standard as this round's other new integrations (see
//     BRAIN.md §27/§28) — so a live-quote failure is surfaced as a normal
//     row state, never blocks the other 5 couriers' results.
//
// Deliberately a SEPARATE action from the booking actions in actions.ts —
// this never creates a shipment/AWB, only reads/estimates.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { estimateBookedAmountFromRateCard } from "@/lib/couriers/rate-card-fallback";
import { resolveCourierCredentials, getCourierCredentialStatus, type CourierKey } from "@/lib/couriers/credentials";
import { getFedexRateQuote } from "@/lib/couriers/fedex-rate";
import { getUpsRateQuote } from "@/lib/couriers/ups-rate";
import { getAramexRateQuote } from "@/lib/couriers/aramex-rate";
import { getDelhiveryRateQuote } from "@/lib/couriers/delhivery-rate";
import { getShiprocketRateQuote } from "@/lib/couriers/shiprocket-rate";
import { getDhlRateQuote } from "@/lib/couriers/dhl-rate";
import type { RateQuoteInput, RateQuoteResult } from "@/lib/couriers/rate-quote-types";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

// Matches the exact courier_rate_cards.courier_name strings already used
// by every create*Booking action in actions.ts's own rate-card fallback
// calls — kept here rather than re-derived, so a Rate Card slab saved
// against (say) "FedEx" is found by both booking's fallback AND this
// compare view without needing two different label conventions.
const RATE_CARD_LABEL: Record<CourierKey, string> = {
  fedex: "FedEx",
  ups: "UPS",
  aramex: "Aramex",
  delhivery: "Delhivery",
  shiprocket: "Shiprocket",
  dhl: "DHL",
};

const DISPLAY_LABEL: Record<CourierKey, string> = {
  fedex: "FedEx",
  ups: "UPS",
  aramex: "Aramex",
  delhivery: "Delhivery",
  shiprocket: "Shiprocket",
  dhl: "DHL Express",
};

const COURIER_KEYS: CourierKey[] = ["fedex", "ups", "aramex", "delhivery", "shiprocket", "dhl"];

export type CourierRateRow = {
  courier: CourierKey;
  label: string;
  rateCardEstimate: { amt: number; currency: string } | null;
  liveQuote: (RateQuoteResult & { attempted: true }) | { attempted: false };
};

export type CompareRatesState = {
  error: string | null;
  rows: CourierRateRow[] | null;
  originSummary: string | null;
};

const INITIAL: CompareRatesState = { error: null, rows: null, originSummary: null };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

async function getLiveQuote(courier: CourierKey, input: RateQuoteInput, creds: Record<string, string>): Promise<RateQuoteResult> {
  switch (courier) {
    case "fedex":
      return getFedexRateQuote(input, creds);
    case "ups":
      return getUpsRateQuote(input, creds);
    case "aramex":
      return getAramexRateQuote(input, {
        userName: creds.username,
        password: creds.password,
        accountNumber: creds.account_number,
        accountPin: creds.account_pin,
        accountEntity: creds.account_entity,
        accountCountryCode: creds.account_country_code,
      });
    case "delhivery":
      return getDelhiveryRateQuote(input, { api_token: creds.api_token });
    case "shiprocket":
      return getShiprocketRateQuote(input, creds);
    case "dhl":
      return getDhlRateQuote(input, creds);
  }
}

async function resolveShipperOrigin(supabase: ServiceClient, companyId: string) {
  const { data } = await supabase.from("courier_shipper_profiles").select("postcode, country_code, city").eq("company_id", companyId).maybeSingle();
  return data;
}

export async function compareCourierRates(_prev: CompareRatesState, formData: FormData): Promise<CompareRatesState> {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  const destPostalCode = str(formData, "dest_postcode");
  const destCountryCode = str(formData, "dest_country_code").toUpperCase();
  const weightKg = Number(str(formData, "weight_kg"));
  const zoneLabel = str(formData, "zone_label") || null;

  if (!destPostalCode || !destCountryCode) return { ...INITIAL, error: "Destination Postcode and Country Code are required." };
  if (!Number.isFinite(weightKg) || weightKg <= 0) return { ...INITIAL, error: "Weight must be greater than 0." };

  const shipper = await resolveShipperOrigin(supabase, employee.currentCompanyId);
  if (!shipper?.postcode || !shipper.country_code) {
    return { ...INITIAL, error: "No shipper profile set up for this company yet — fill in the Shipper Profile section below first." };
  }

  const input: RateQuoteInput = {
    originPostalCode: shipper.postcode,
    originCountryCode: shipper.country_code,
    destPostalCode,
    destCountryCode,
    weightKg,
  };

  const status = await getCourierCredentialStatus(supabase, employee.currentCompanyId);

  const rows = await Promise.all(
    COURIER_KEYS.map(async (courier): Promise<CourierRateRow> => {
      const [rateCardEstimate, liveQuote] = await Promise.all([
        zoneLabel ? estimateBookedAmountFromRateCard(supabase, employee.currentCompanyId, RATE_CARD_LABEL[courier], zoneLabel, weightKg) : Promise.resolve(null),
        status[courier]?.configured
          ? resolveCourierCredentials(supabase, employee.currentCompanyId, courier).then((creds) => getLiveQuote(courier, input, creds))
          : Promise.resolve(null),
      ]);

      return {
        courier,
        label: DISPLAY_LABEL[courier],
        rateCardEstimate: rateCardEstimate ? { amt: rateCardEstimate.amt, currency: rateCardEstimate.currency } : null,
        liveQuote: liveQuote ? { ...liveQuote, attempted: true } : { attempted: false },
      };
    })
  );

  return {
    error: null,
    rows,
    originSummary: `${shipper.city ? `${shipper.city}, ` : ""}${shipper.postcode} (${shipper.country_code})`,
  };
}
