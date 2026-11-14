import { requireAnyCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import {
  CALCULATOR_CURRENCIES,
  getCurrentVerifiedRates,
  getPendingRates,
  getRateAudit,
  getRateHistory,
  getSyncOverview,
  lookupCustomsRate,
  type AuditRow,
  type CustomsHistoryRow,
  type SyncOverview,
} from "@/lib/customs/data";
import type { RateInForce } from "@/lib/customs/lookup";
import { isSupportedCurrency, supportedCurrencyCodes } from "@/lib/customs/currencies";
import { isValidIsoDate } from "@/lib/customs/lookup";
import { CustomsRatesDashboard } from "./customs-rates-dashboard";

// INDIAN CUSTOMS EXCHANGE RATES — the module dashboard.
//
// Reads only: every write is a Server Action gated on customs_rate_admin (see
// actions.ts). The page itself needs either capability (viewing or admin).
export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  currency?: string;
  date?: string;
  kind?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: string;
}>;

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<{ value: T; error: string | null }> {
  try {
    return { value: await fn(), error: null };
  } catch (e) {
    return { value: fallback, error: e instanceof Error ? e.message : String(e) };
  }
}

export default async function CustomsRatesPage({ searchParams }: { searchParams: SearchParams }) {
  const employee = await requireAnyCapability("customs_rate_view", "customs_rate_admin");
  const supabase = createServiceRoleClient();
  const params = await searchParams;
  const today = todayIST();

  const searchCurrency =
    params.currency && isSupportedCurrency(params.currency.toUpperCase())
      ? params.currency.toUpperCase()
      : "USD";
  const searchDate = params.date && isValidIsoDate(params.date) ? params.date : today;
  const searchKind = params.kind === "export" ? "export" : "import";

  const historyPage = Number(params.page ?? "1");
  const filters = {
    currency:
      params.currency && isSupportedCurrency(params.currency.toUpperCase())
        ? params.currency.toUpperCase()
        : undefined,
    from: params.from && isValidIsoDate(params.from) ? params.from : undefined,
    to: params.to && isValidIsoDate(params.to) ? params.to : undefined,
    status: params.status || undefined,
    page: Number.isFinite(historyPage) && historyPage > 0 ? historyPage : 1,
    pageSize: 25,
  };

  const [current, history, pending, sync, audit, lookup] = await Promise.all([
    safe(() => getCurrentVerifiedRates(supabase, today), [] as RateInForce[]),
    safe(() => getRateHistory(supabase, filters), {
      rows: [] as CustomsHistoryRow[],
      total: 0,
      page: 1,
      pageSize: 25,
    }),
    safe(() => getPendingRates(supabase), [] as CustomsHistoryRow[]),
    safe(
      () => getSyncOverview(supabase),
      { logs: [], lastSuccessAt: null, lastAttemptAt: null, lastStatus: null, sources: [] } as SyncOverview
    ),
    safe(() => getRateAudit(supabase), [] as AuditRow[]),
    safe(() => lookupCustomsRate(supabase, searchCurrency, searchDate), null as RateInForce | null),
  ]);

  const setupError =
    current.error ?? history.error ?? sync.error ?? null;

  const isAdmin = employee.capabilities.includes("customs_rate_admin");

  return (
    <CustomsRatesDashboard
      today={today}
      isAdmin={isAdmin}
      setupError={setupError}
      currentRates={current.value}
      history={history.value}
      pending={pending.value}
      sync={sync.value}
      audit={audit.value}
      lookup={{ currency: searchCurrency, date: searchDate, kind: searchKind, rate: lookup.value }}
      filters={{
        currency: params.currency ?? "",
        from: params.from ?? "",
        to: params.to ?? "",
        status: params.status ?? "",
      }}
      calculatorCurrencies={CALCULATOR_CURRENCIES}
      supportedCurrencies={supportedCurrencyCodes()}
    />
  );
}
