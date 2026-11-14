// Server-side reads for the customs rate dashboard and API.
//
// All access goes through the service-role client from pages/actions that have
// already checked a capability (customs_rate_view / customs_rate_admin), the
// same posture as every other admin screen in this app.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { findCustomsRateInForce, type RateInForce } from "./lookup";
import { PRIMARY_CURRENCY_CODES, SUPPORTED_CURRENCIES } from "./currencies";

type ServiceClient = SupabaseClient<Database>;

export type CustomsHistoryRow = {
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
  status: string;
  source: string;
  sourceUrl: string | null;
  sourceDocumentRef: string | null;
  confidence: number | null;
  validationNotes: string | null;
  fetchedAt: string;
  verifiedAt: string | null;
  verifiedByName: string | null;
};

const HISTORY_SELECT =
  "id, currency_code, currency_name, currency_unit, import_rate, export_rate, " +
  "effective_start_date, effective_end_date, notification_no, notification_date, " +
  "verification_status, source, source_url, source_document_ref, extraction_confidence, " +
  "validation_notes, fetched_at, verified_at, verified_by_name";

type HistoryDbRow = {
  id: string;
  currency_code: string;
  currency_name: string | null;
  currency_unit: number;
  import_rate: number | null;
  export_rate: number;
  effective_start_date: string;
  effective_end_date: string | null;
  notification_no: string | null;
  notification_date: string | null;
  verification_status: string;
  source: string;
  source_url: string | null;
  source_document_ref: string | null;
  extraction_confidence: number | null;
  validation_notes: string | null;
  fetched_at: string;
  verified_at: string | null;
  verified_by_name: string | null;
};

function mapHistory(row: HistoryDbRow): CustomsHistoryRow {
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
    status: row.verification_status,
    source: row.source,
    sourceUrl: row.source_url,
    sourceDocumentRef: row.source_document_ref,
    confidence: row.extraction_confidence == null ? null : Number(row.extraction_confidence),
    validationNotes: row.validation_notes,
    fetchedAt: row.fetched_at,
    verifiedAt: row.verified_at,
    verifiedByName: row.verified_by_name,
  };
}

/**
 * The verified rate in force today for every currency the module supports.
 * One query, newest first, keep the first row per currency — the row that has
 * not been superseded by a later effective date.
 */
export async function getCurrentVerifiedRates(
  supabase: ServiceClient,
  asOf: string
): Promise<RateInForce[]> {
  const { data, error } = await supabase
    .from("customs_exchange_rates")
    .select(HISTORY_SELECT)
    .eq("verification_status", "verified")
    .lte("effective_start_date", asOf)
    .order("effective_start_date", { ascending: false });

  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  const out: RateInForce[] = [];
  for (const raw of (data ?? []) as unknown as HistoryDbRow[]) {
    if (seen.has(raw.currency_code)) continue;
    seen.add(raw.currency_code);
    out.push({
      id: raw.id,
      currencyCode: raw.currency_code,
      currencyName: raw.currency_name,
      currencyUnit: Number(raw.currency_unit ?? 1),
      importRate: raw.import_rate == null ? null : Number(raw.import_rate),
      exportRate: Number(raw.export_rate),
      effectiveStartDate: raw.effective_start_date,
      effectiveEndDate: raw.effective_end_date,
      notificationNo: raw.notification_no,
      notificationDate: raw.notification_date,
      source: raw.source,
      sourceUrl: raw.source_url,
      sourceDocumentRef: raw.source_document_ref,
      verifiedAt: raw.verified_at,
    });
  }
  return out;
}

export function primaryCurrencies<T extends { currencyCode: string }>(rates: T[]): T[] {
  return PRIMARY_CURRENCY_CODES.map((code) => rates.find((r) => r.currencyCode === code)).filter(
    (r): r is T => Boolean(r)
  );
}

const RATE_STATUSES = [
  "pending",
  "verified",
  "rejected",
  "source_unavailable",
  "extraction_failed",
  "superseded",
] as const;
type RateStatus = (typeof RATE_STATUSES)[number];

function statusFilter(value: string | undefined): RateStatus | null {
  return value && (RATE_STATUSES as readonly string[]).includes(value) ? (value as RateStatus) : null;
}

export type HistoryFilters = {
  currency?: string;
  from?: string;
  to?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

export async function getRateHistory(
  supabase: ServiceClient,
  filters: HistoryFilters
): Promise<{ rows: CustomsHistoryRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = filters.pageSize ?? 25;
  const page = Math.max(1, filters.page ?? 1);
  const fromIndex = (page - 1) * pageSize;

  let query = supabase
    .from("customs_exchange_rates")
    .select(HISTORY_SELECT, { count: "exact" })
    .order("effective_start_date", { ascending: false })
    .order("currency_code");

  if (filters.currency) query = query.eq("currency_code", filters.currency);
  const status = statusFilter(filters.status);
  if (status) query = query.eq("verification_status", status);
  if (filters.from) query = query.gte("effective_start_date", filters.from);
  if (filters.to) query = query.lte("effective_start_date", filters.to);

  const { data, count, error } = await query.range(fromIndex, fromIndex + pageSize - 1);
  if (error) throw new Error(error.message);

  return {
    rows: ((data ?? []) as unknown as HistoryDbRow[]).map(mapHistory),
    total: count ?? 0,
    page,
    pageSize,
  };
}

/** Every row for the CSV export (no pagination), capped for safety. */
export async function getRateHistoryForExport(
  supabase: ServiceClient,
  filters: HistoryFilters
): Promise<CustomsHistoryRow[]> {
  let query = supabase
    .from("customs_exchange_rates")
    .select(HISTORY_SELECT)
    .order("effective_start_date", { ascending: false })
    .order("currency_code")
    .limit(5000);

  if (filters.currency) query = query.eq("currency_code", filters.currency);
  const status = statusFilter(filters.status);
  if (status) query = query.eq("verification_status", status);
  if (filters.from) query = query.gte("effective_start_date", filters.from);
  if (filters.to) query = query.lte("effective_start_date", filters.to);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as HistoryDbRow[]).map(mapHistory);
}

export async function getPendingRates(supabase: ServiceClient): Promise<CustomsHistoryRow[]> {
  const { data, error } = await supabase
    .from("customs_exchange_rates")
    .select(HISTORY_SELECT)
    .in("verification_status", ["pending", "extraction_failed"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as HistoryDbRow[]).map(mapHistory);
}

export type SyncLogRow = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  triggerSource: string;
  status: string;
  provider: string | null;
  rowsExtracted: number;
  rowsVerified: number;
  rowsPending: number;
  message: string | null;
  actorName: string | null;
};

export type SourceState = {
  provider: string;
  label: string;
  url: string;
  reachable: boolean;
  machineReadable: boolean;
  message: string;
};

export type SyncOverview = {
  logs: SyncLogRow[];
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastStatus: string | null;
  sources: SourceState[];
};

export async function getSyncOverview(supabase: ServiceClient, limit = 10): Promise<SyncOverview> {
  const { data, error } = await supabase
    .from("customs_rate_sync_log")
    .select("id, started_at, finished_at, trigger_source, status, provider, rows_extracted, rows_verified, rows_pending, message, details, actor_name")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const logs: SyncLogRow[] = (data ?? []).map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    triggerSource: r.trigger_source,
    status: r.status,
    provider: r.provider,
    rowsExtracted: r.rows_extracted,
    rowsVerified: r.rows_verified,
    rowsPending: r.rows_pending,
    message: r.message,
    actorName: r.actor_name,
  }));

  const successes = (data ?? []).filter((r) => r.status === "success" || r.status === "partial");
  const lastSuccessAt = successes.length > 0 ? successes[0].started_at : null;

  const details = (data ?? [])[0]?.details as { checks?: SourceState[] } | null;
  return {
    logs,
    lastSuccessAt,
    lastAttemptAt: data?.[0]?.started_at ?? null,
    lastStatus: data?.[0]?.status ?? null,
    sources: Array.isArray(details?.checks) ? details!.checks! : [],
  };
}

export type AuditRow = {
  id: string;
  rateId: string | null;
  action: string;
  actorName: string | null;
  changes: unknown;
  createdAt: string;
};

export async function getRateAudit(supabase: ServiceClient, limit = 30): Promise<AuditRow[]> {
  const { data, error } = await supabase
    .from("customs_exchange_rate_audit")
    .select("id, rate_id, action, actor_name, changes, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    rateId: r.rate_id,
    action: r.action,
    actorName: r.actor_name,
    changes: r.changes,
    createdAt: r.created_at,
  }));
}

/** Historical search used by the dashboard form and the calculator. */
export async function lookupCustomsRate(
  supabase: ServiceClient,
  currency: string,
  date: string
): Promise<RateInForce | null> {
  return findCustomsRateInForce(supabase, currency, date);
}

export const CALCULATOR_CURRENCIES = SUPPORTED_CURRENCIES.map((c) => ({
  code: c.code,
  name: c.name,
  unit: c.unit,
}));
