// GET /api/customs-rates?currency=USD&date=2026-11-14
//
// Returns the verified Indian Customs rate in force on the requested date,
// import and export separately, with its notification reference and
// verification metadata.
//
// SECURITY
//   * Session required (Supabase auth cookie) AND one of the customs
//     capabilities — same requireCapability guard every dashboard page uses.
//   * Service-role client used only after that check; the key never leaves
//     the server.
//   * Per-user rate limiting (best-effort, per instance — see
//     src/lib/customs/rate-limit.ts).
//   * No caching: rates change with each notification, and a stale copy must
//     never be served as current.
//
// HONESTY
//   If no VERIFIED rate covers the date, this returns 404. It never falls
//   back to an older notification, a market/RBI rate, or an unverified row.
import { NextRequest, NextResponse } from "next/server";
import { getAuthedEmployee, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isSupportedCurrency, supportedCurrencyCodes } from "@/lib/customs/currencies";
import { findCustomsRateInForce, isValidIsoDate } from "@/lib/customs/lookup";
import { createRateLimiter } from "@/lib/customs/rate-limit";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
const ALLOWED_CAPABILITIES = ["customs_rate_view", "customs_rate_admin"];

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      ...headers,
    },
  });
}

function isMissingTable(message: string): boolean {
  return /PGRST205|42P01|does not exist|schema cache/i.test(message);
}

export async function GET(req: NextRequest) {
  // ---- session ------------------------------------------------------------
  const sessionClient = await createClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) {
    return json({ error: "Authentication required." }, 401);
  }

  let employee;
  try {
    employee = await getAuthedEmployee();
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return json({ error: "Authentication required." }, 401);
    }
    // getAuthedEmployee() may redirect (MFA) — in a route handler that throws
    // a redirect signal; treat any non-auth failure as forbidden here.
    if (e instanceof ForbiddenError) {
      return json({ error: e.message }, 403);
    }
    return json({ error: "Could not verify your access." }, 403);
  }

  if (!ALLOWED_CAPABILITIES.some((c) => employee.capabilities.includes(c))) {
    return json({ error: "Your role does not have access to customs exchange rates." }, 403);
  }

  // ---- rate limit ---------------------------------------------------------
  const limited = limiter.check(employee.id);
  if (!limited.allowed) {
    return json(
      { error: "Too many requests. Try again shortly." },
      429,
      { "Retry-After": String(limited.retryAfterSeconds) }
    );
  }

  // ---- input validation ---------------------------------------------------
  const currency = (req.nextUrl.searchParams.get("currency") ?? "").trim().toUpperCase();
  const date = (req.nextUrl.searchParams.get("date") ?? "").trim();

  if (!currency) {
    return json(
      {
        error: "The currency parameter is required.",
        supportedCurrencies: supportedCurrencyCodes(),
      },
      400
    );
  }
  if (!/^[A-Z]{3}$/.test(currency) || !isSupportedCurrency(currency)) {
    return json(
      {
        error: `Currency "${currency}" is not supported.`,
        supportedCurrencies: supportedCurrencyCodes(),
      },
      400
    );
  }
  if (!date) {
    return json({ error: "The date parameter is required (YYYY-MM-DD)." }, 400);
  }
  if (!isValidIsoDate(date)) {
    return json({ error: `Date "${date}" is not a valid YYYY-MM-DD date.` }, 400);
  }

  // ---- lookup -------------------------------------------------------------
  try {
    const supabase = createServiceRoleClient();
    const rate = await findCustomsRateInForce(supabase, currency, date);

    if (!rate) {
      return json(
        {
          currency,
          requestedDate: date,
          error:
            "No verified Indian Customs exchange rate is on record for that currency and date. " +
            "Nothing unverified or from a different date has been substituted.",
        },
        404
      );
    }

    return json(
      {
        currency: rate.currencyCode,
        requestedDate: date,
        effectiveFrom: rate.effectiveStartDate,
        effectiveTo: rate.effectiveEndDate,
        importRate: rate.importRate,
        exportRate: rate.exportRate,
        currencyUnit: rate.currencyUnit,
        // The register stores which channel the row came through; the public
        // field names the authoritative source as the brief specifies.
        source: "ICEGATE / CBIC",
        sourceRecord: rate.source,
        sourceUrl: rate.sourceUrl,
        sourceDocumentReference: rate.sourceDocumentRef,
        notificationNumber: rate.notificationNo ?? "",
        notificationDate: rate.notificationDate,
        verificationStatus: "verified",
        verifiedAt: rate.verifiedAt,
      },
      200
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isMissingTable(message)) {
      return json(
        {
          error:
            "The customs exchange rate register is not installed yet. Run db/2026-11-14-customs-exchange-rate-module.sql.",
        },
        503
      );
    }
    return json({ error: "The customs rate lookup failed.", detail: message }, 500);
  }
}
