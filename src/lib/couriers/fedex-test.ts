// FedEx connection TEST — proves the pair (API key + account number) a
// company has saved actually works TOGETHER, before anyone burns a booking
// on it. Built 2026-09-17 after a real production 400: "Account number not
// found. Please provide a valid account number." — the account number
// belonged to a DIFFERENT FedEx organization than the API key it was sent
// with (each FedEx developer org's key can only book against accounts
// linked to THAT org; with 3 companies sharing one deployment there was no
// way to see the mismatch until a real booking failed).
//
// HOW: one quote-only call to the Rate API (POST /rate/v1/rates/quotes) —
// the cheapest real call that authenticates the key AND names an account
// number FedEx will validate. It NEVER creates a shipment/AWB — same
// guarantee the Rate Compare feature already relies on (see
// rate-quote-types.ts's header). Request body is the canonical minimal
// shape (two valid addresses, 1kg package) — deliberately NO
// expressFreightShipment/shipDatestamp/serviceType blocks, because extra
// blocks trigger unrelated validation errors that would mask the
// account/key result this test exists to produce.
//
// The result names WHICH API key was used — the company's own (saved in
// Account Setup) or the shared deployment env var (FEDEX_API_CLIENT_ID) —
// because "your account number is fine but it's paired with someone
// else's key" is the exact confusion this feature exists to surface.
import { getFedexAccessToken, FEDEX_API_BASE } from "@/lib/couriers/fedex-auth";

export type FedexTestResult =
  | { ok: true; accountMasked: string; keySource: "company" | "shared-env" }
  | { ok: false; accountMasked: string | null; error: string };

export function describeFedexKeySource(credentials?: { client_id?: string; client_secret?: string }): "company" | "shared-env" | "none" {
  if (credentials?.client_id && credentials?.client_secret) return "company";
  if (process.env.FEDEX_API_CLIENT_ID && process.env.FEDEX_API_CLIENT_SECRET) return "shared-env";
  return "none";
}

function maskAccount(accountNumber: string): string {
  return accountNumber.length > 4 ? `${"*".repeat(accountNumber.length - 4)}${accountNumber.slice(-4)}` : accountNumber;
}

export const KEY_SOURCE_LABEL: Record<"company" | "shared-env", string> = {
  company: "THIS company's own API key (saved in Account Setup)",
  "shared-env": "the SHARED deployment API key (FEDEX_API_CLIENT_ID env var — no per-company key saved in Account Setup)",
};

export async function testFedexConnection(credentials: {
  client_id?: string;
  client_secret?: string;
  account_number?: string;
}): Promise<FedexTestResult> {
  const keySource = describeFedexKeySource(credentials);
  if (keySource === "none") {
    return { ok: false, accountMasked: null, error: "No FedEx API key at all (neither Account Setup nor the deployment env vars) — save Client ID + Secret first." };
  }

  // Same digit-normalization the real booking path applies (see
  // fedex-ship.ts) so the test tests exactly what a booking would send.
  const accountNumber = (credentials.account_number ?? "").replace(/\D/g, "");
  if (!accountNumber) {
    return { ok: false, accountMasked: null, error: "FedEx Account Number is not saved for this company — fill it in and Save first." };
  }
  const accountMasked = maskAccount(accountNumber);

  let accessToken: string;
  try {
    accessToken = await getFedexAccessToken({ clientId: credentials.client_id, clientSecret: credentials.client_secret });
  } catch (err) {
    return {
      ok: false,
      accountMasked,
      error: `FedEx rejected the API key itself (OAuth failed): ${err instanceof Error ? err.message : "unknown error"} — key source: ${KEY_SOURCE_LABEL[keySource]}.`,
    };
  }

  const body = {
    accountNumber: { value: accountNumber },
    rateRequestControlParameters: { returnTransitTimes: false },
    requestedShipment: {
      shipper: { address: { postalCode: "302001", countryCode: "IN" } },
      recipient: { address: { postalCode: "10001", countryCode: "US" } },
      pickupType: "USE_SCHEDULED_PICKUP",
      rateRequestType: ["ACCOUNT"],
      requestedPackageLineItems: [{ weight: { units: "KG", value: 1 } }],
    },
  };

  try {
    const res = await fetch(`${FEDEX_API_BASE}/rate/v1/rates/quotes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "X-locale": "en_US" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    let parsed: {
      output?: { rateReplyDetails?: Array<{ ratedShipmentDetails?: Array<{ rateType?: string; totalNetCharge?: number; currency?: string }> }> };
      errors?: Array<{ message?: string }>;
      alerts?: Array<{ message?: string }>;
    } | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // fall through — non-JSON is treated as an error below
    }

    // THE FALSE POSITIVE THIS CHECK EXISTS FOR (the exact live bug this
    // round — Test connection said ✓ but the very next real booking 400'd
    // with "Account number not found"): FedEx's Rate API answers HTTP 200
    // with output.rateReplyDetails EVEN WHEN the account number is
    // rejected — it just silently prices the quote on published LIST
    // rates instead of the account's negotiated rates. A bare res.ok
    // therefore proves nothing about the account. The honest signal is
    // rateType === "ACCOUNT" in the response: FedEx only produces that
    // when it actually priced against THIS account number — which is the
    // thing a booking needs. (Same response-shape parsing as
    // fedex-rate.ts, including totalNetCharge being a plain number.)
    const allRateDetails = (parsed?.output?.rateReplyDetails ?? []).flatMap((d) => d.ratedShipmentDetails ?? []);
    const accountPriced = allRateDetails.find((r) => r.rateType === "ACCOUNT" && r.totalNetCharge != null);

    if (res.ok && accountPriced) {
      return { ok: true, accountMasked, keySource };
    }

    if (res.ok && !accountPriced) {
      const warn = parsed?.alerts?.map((a) => a.message).filter(Boolean).join("; ");
      return {
        ok: false,
        accountMasked,
        error:
          `FedEx answered the rate request but priced it on LIST rates, not THIS account (${accountMasked}) — meaning the account number is NOT linked to this API key's organization, exactly why a real booking would fail with "Account number not found".` +
          (warn ? ` FedEx said: ${warn}` : "") +
          ` Fix the number, or save this company's own Client ID + Secret (whose org the account IS linked to) and Save.`,
      };
    }

    const msg = parsed?.errors?.map((e) => e.message).filter(Boolean).join("; ") || `HTTP ${res.status}`;
    const mismatch = /account number/i.test(msg);
    return {
      ok: false,
      accountMasked,
      error:
        `FedEx rejected this key + account pair: ${msg} — sent account ${accountMasked} against ${FEDEX_API_BASE} using ${KEY_SOURCE_LABEL[keySource]}.` +
        (mismatch
          ? " That error means the account number does NOT belong to this API key's organization: either the number is wrong, or this company needs its OWN Client ID + Secret (whose org the account IS linked to) saved in Account Setup instead of riding on the shared key."
          : ""),
    };
  } catch (err) {
    return { ok: false, accountMasked, error: `Could not reach FedEx (${FEDEX_API_BASE}): ${err instanceof Error ? err.message : "unknown error"}` };
  }
}
