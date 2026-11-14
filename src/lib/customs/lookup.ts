// As-of-date selection for customs rates — the rule the API and the
// calculator both rely on.
//
// A rate is in force from its effective_start_date until the day before the
// next notification's effective date (effective_end_date stays NULL while it
// is open-ended). A date is therefore served by the LATEST VERIFIED row whose
// range contains it.
//
// Deliberately strict: a pending, rejected, superseded or unverified row is
// never returned. If no verified row covers the date, the caller must say so
// rather than silently falling back to an older or newer rate.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type RateInForce = {
  id: string;
  currencyCode: string;
  currencyName: string | null;
  currencyUnit: number;
  importRate: number | null;
  exportRate: number;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  notificationNo: string | null;
  notificationDate: string | null;
  source: string;
  sourceUrl: string | null;
  sourceDocumentRef: string | null;
  verifiedAt: string | null;
};

/** Minimal candidate shape, so this stays unit-testable without a database. */
export type DateRangeRow = {
  id: string;
  currencyCode: string;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  verificationStatus: string;
  verifiedAt?: string | null;
};

/**
 * Picks the verified row in force on `date` (ISO YYYY-MM-DD). Rows are
 * expected to belong to one currency; ties on the same start date are broken
 * by the most recently verified row.
 */
export function selectRateInForce<T extends DateRangeRow>(rows: T[], date: string): T | null {
  const candidates = rows.filter(
    (r) =>
      r.verificationStatus === "verified" &&
      r.effectiveStartDate <= date &&
      (r.effectiveEndDate === null || r.effectiveEndDate >= date)
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.effectiveStartDate !== b.effectiveStartDate) {
      return a.effectiveStartDate < b.effectiveStartDate ? 1 : -1;
    }
    return String(b.verifiedAt ?? "").localeCompare(String(a.verifiedAt ?? ""));
  });
  return candidates[0];
}

type ServiceClient = SupabaseClient<Database>;

/**
 * The verified customs rate in force for a currency on a date, read through
 * the SQL function get_customs_exchange_rate_as_of() so the date-range rule
 * lives in one place. Returns null when nothing verified covers the date.
 */
export async function findCustomsRateInForce(
  supabase: ServiceClient,
  currencyCode: string,
  date: string
): Promise<RateInForce | null> {
  const { data, error } = await supabase.rpc("get_customs_exchange_rate_as_of", {
    p_currency_code: currencyCode.toUpperCase(),
    p_as_of: date,
  });
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;

  return {
    id: row.id,
    currencyCode: row.currency_code,
    currencyName: row.currency_name,
    currencyUnit: Number(row.currency_unit ?? 1),
    importRate: row.import_rate == null ? null : Number(row.import_rate),
    exportRate: Number(row.export_rate),
    effectiveStartDate: row.effective_start_date,
    effectiveEndDate: row.effective_end_date,
    notificationNo: row.notification_no,
    notificationDate: row.notification_date,
    source: row.source,
    sourceUrl: row.source_url,
    sourceDocumentRef: row.source_document_ref,
    verifiedAt: row.verified_at,
  };
}

/** True when the string is a real calendar date in ISO YYYY-MM-DD form. */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d
  );
}
