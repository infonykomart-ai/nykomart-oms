"use client";

// INDIAN CUSTOMS EXCHANGE RATES — module dashboard.
//
// Sections (per the module brief):
//   A. Current rates (USD/EUR/GBP/AED import + export, every other currency below)
//   B. Historical rate search
//   C. Automatic sync status
//   D. Historical records (filters, pagination, CSV export)
//   E. Admin controls (sync, uploads, pending review, audit log)
//   + the customs conversion calculator
//
// Read data arrives from the server page; every mutation goes through a
// Server Action that re-checks customs_rate_admin on the server.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import type { RateInForce } from "@/lib/customs/lookup";
import type { AuditRow, CustomsHistoryRow, SyncOverview } from "@/lib/customs/data";
import { PRIMARY_CURRENCY_CODES } from "@/lib/customs/currencies";
import { nextScheduledCheck } from "@/lib/customs/schedule";
import { CustomsCalculator } from "./calculator";
import {
  approveCustomsRate,
  rejectCustomsRate,
  syncCustomsRatesNow,
  uploadCustomsRateDocument,
  uploadCustomsRatesCsv,
  type CustomsFormState,
} from "./actions";

type Props = {
  today: string;
  isAdmin: boolean;
  setupError: string | null;
  currentRates: RateInForce[];
  history: { rows: CustomsHistoryRow[]; total: number; page: number; pageSize: number };
  pending: CustomsHistoryRow[];
  sync: SyncOverview;
  audit: AuditRow[];
  lookup: { currency: string; date: string; kind: string; rate: RateInForce | null };
  filters: { currency: string; from: string; to: string; status: string };
  calculatorCurrencies: { code: string; name: string; unit: number }[];
  supportedCurrencies: string[];
};

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-[11px] font-medium text-slate-600";
const card = "rounded-xl border border-slate-200 bg-white";

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

function fmtDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    verified: "bg-emerald-100 text-emerald-800",
    pending: "bg-amber-100 text-amber-800",
    rejected: "bg-red-100 text-red-700",
    superseded: "bg-slate-200 text-slate-600",
    extraction_failed: "bg-red-100 text-red-700",
    source_unavailable: "bg-amber-100 text-amber-800",
    success: "bg-emerald-100 text-emerald-800",
    partial: "bg-amber-100 text-amber-800",
    failed: "bg-red-100 text-red-700",
    running: "bg-slate-200 text-slate-600",
  };
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${map[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function buildQuery(base: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && String(v) !== "") params.set(k, String(v));
  }
  const q = params.toString();
  return q ? `?${q}` : "";
}

export function CustomsRatesDashboard(props: Props) {
  const { currentRates, sync, pending, isAdmin, setupError } = props;
  const primary = PRIMARY_CURRENCY_CODES.map((code) => currentRates.find((r) => r.currencyCode === code));
  const others = currentRates.filter((r) => !(PRIMARY_CURRENCY_CODES as readonly string[]).includes(r.currencyCode));
  const failedSync = sync.logs.find((l) => l.status === "failed");
  const sourceUnavailable = sync.lastStatus === "source_unavailable";

  return (
    <div className="space-y-6">
      {/* ---------- header ---------- */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">🛃 INDIAN CUSTOMS EXCHANGE RATES</h1>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          Official customs conversion rates for valuation under the Customs Act — Import and Export rates kept
          separately, effective-dated, sourced from ICEGATE / CBIC notifications. Only <strong>verified</strong>{" "}
          rates are used in customs calculations. Rates are not bank, RBI reference, or payment-provider rates.
        </p>
      </div>

      {setupError && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <p className="font-semibold">The customs rate register is not ready.</p>
          <p className="mt-1">
            Run <code className="rounded bg-amber-100 px-1">db/2026-11-14-customs-exchange-rate-module.sql</code> in
            the Supabase SQL editor, then reload. ({setupError})
          </p>
        </div>
      )}

      {pending.length > 0 && isAdmin && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <strong>{pending.length}</strong> extracted rate row{pending.length === 1 ? "" : "s"} await approval — see
          “Admin controls” below. They are not used in any calculation until verified.
        </div>
      )}

      {/* ---------- A. current rates ---------- */}
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Current Customs Rates</h2>
            <p className="text-[11px] text-slate-500">Verified rates in force today ({fmtDate(props.today)}).</p>
          </div>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
            Source: ICEGATE / CBIC
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
          {PRIMARY_CURRENCY_CODES.map((code, i) => {
            const rate = primary[i];
            return (
              <div key={code} className={`rounded-lg border p-3 ${rate ? "border-slate-200" : "border-dashed border-slate-300 bg-slate-50"}`}>
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-semibold text-slate-800">{code}</p>
                  {rate && statusBadge("verified")}
                </div>
                {rate ? (
                  <>
                    <dl className="mt-2 space-y-1 text-xs">
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-500">Import ₹</dt>
                        <dd className="font-semibold text-slate-900">{rate.importRate == null ? "not published" : rate.importRate}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-500">Export ₹</dt>
                        <dd className="font-semibold text-slate-900">{rate.exportRate}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-500">Unit</dt>
                        <dd className="text-slate-700">per {rate.currencyUnit}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-500">Effective from</dt>
                        <dd className="text-slate-700">{fmtDate(rate.effectiveStartDate)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-500">Notification</dt>
                        <dd className="max-w-[9rem] truncate text-slate-700" title={rate.notificationNo ?? ""}>
                          {rate.notificationNo ?? "—"}
                        </dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <p className="mt-2 text-[11px] text-slate-500">
                    No verified rate on record for today. Upload the official notification below — nothing has
                    been guessed.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {others.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-3">
            <details>
              <summary className="cursor-pointer text-xs font-medium text-slate-600">
                Other currencies verified today ({others.length})
              </summary>
              <div className="mt-2 max-h-64 overflow-auto">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="px-2 py-1">Currency</th>
                      <th className="px-2 py-1 text-right">Unit</th>
                      <th className="px-2 py-1 text-right">Import ₹</th>
                      <th className="px-2 py-1 text-right">Export ₹</th>
                      <th className="px-2 py-1">Effective</th>
                      <th className="px-2 py-1">Notification</th>
                    </tr>
                  </thead>
                  <tbody>
                    {others.map((r) => (
                      <tr key={r.currencyCode} className="border-t border-slate-100">
                        <td className="px-2 py-1 font-medium text-slate-700">{r.currencyCode}</td>
                        <td className="px-2 py-1 text-right text-slate-500">{r.currencyUnit}</td>
                        <td className="px-2 py-1 text-right">{r.importRate ?? "—"}</td>
                        <td className="px-2 py-1 text-right">{r.exportRate}</td>
                        <td className="px-2 py-1">{fmtDate(r.effectiveStartDate)}</td>
                        <td className="px-2 py-1">{r.notificationNo ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}
      </section>

      {/* ---------- calculator ---------- */}
      <CustomsCalculator currencies={props.calculatorCurrencies} today={props.today} />

      {/* ---------- B. historical search ---------- */}
      <section className={card}>
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Historical Rate Search</h2>
          <p className="text-[11px] text-slate-500">
            The verified rate in force on a specific customs date. A date with no verified rate returns nothing —
            an older or newer rate is never substituted.
          </p>
        </div>
        <form method="get" className="grid grid-cols-1 items-end gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={labelClass} htmlFor="q-currency">Currency</label>
            <select id="q-currency" name="currency" defaultValue={props.lookup.currency} className={inputClass}>
              {props.supportedCurrencies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="q-date">Customs date</label>
            <input id="q-date" name="date" type="date" defaultValue={props.lookup.date} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="q-kind">Rate</label>
            <select id="q-kind" name="kind" defaultValue={props.lookup.kind} className={inputClass}>
              <option value="import">Import</option>
              <option value="export">Export</option>
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-600"
          >
            Search
          </button>
        </form>

        <div className="border-t border-slate-100 px-5 py-4">
          {props.lookup.rate ? (
            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Rate applied</p>
                <p className="mt-0.5 text-lg font-semibold text-slate-900">
                  ₹{props.lookup.kind === "export" ? props.lookup.rate.exportRate : props.lookup.rate.importRate ?? "—"}
                </p>
                <p className="text-[11px] text-slate-500">
                  per {props.lookup.rate.currencyUnit} {props.lookup.rate.currencyCode} · {props.lookup.kind}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Effective period</p>
                <p className="mt-1 font-medium text-slate-800">
                  {fmtDate(props.lookup.rate.effectiveStartDate)} →{" "}
                  {props.lookup.rate.effectiveEndDate ? fmtDate(props.lookup.rate.effectiveEndDate) : "next notification"}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">Requested {fmtDate(props.lookup.date)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Notification</p>
                <p className="mt-1 font-medium text-slate-800">{props.lookup.rate.notificationNo ?? "—"}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Published {fmtDate(props.lookup.rate.notificationDate)}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Source verification</p>
                <p className="mt-1">{statusBadge("verified")}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  ICEGATE / CBIC · {props.lookup.rate.sourceDocumentRef ?? props.lookup.rate.source}
                </p>
              </div>
            </div>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              No verified rate on record for {props.lookup.currency} on {fmtDate(props.lookup.date)}.
            </p>
          )}
        </div>
      </section>

      {/* ---------- C. sync status ---------- */}
      <section className={card}>
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Automatic Sync Status</h2>
          <p className="text-[11px] text-slate-500">
            ICEGATE publishes rates on the 1st and 3rd Thursday (effective the next day) at 18:00 IST. This app
            checks on a schedule and, importantly, never fills the register from a non-official rate source.
          </p>
        </div>

        {(sourceUnavailable || failedSync) && (
          <div className="mx-5 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            <p className="font-semibold">Sync needs attention.</p>
            <p className="mt-0.5">
              {sourceUnavailable
                ? "The last check found no machine-readable official source. Upload the official notification (PDF) or its CSV in Admin controls."
                : failedSync?.message ?? "The last synchronization failed."}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Last successful sync</p>
            <p className="mt-0.5 text-xs font-medium text-slate-800">{fmtDateTime(sync.lastSuccessAt)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Last attempted sync</p>
            <p className="mt-0.5 text-xs font-medium text-slate-800">
              {fmtDateTime(sync.lastAttemptAt)} {sync.lastStatus && <span className="ml-1">{statusBadge(sync.lastStatus)}</span>}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Next scheduled check</p>
            <p className="mt-0.5 text-xs font-medium text-slate-800">{fmtDateTime(nextScheduledCheck())}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">Source availability</p>
            {sync.sources.length === 0 ? (
              <p className="mt-0.5 text-xs text-slate-500">Not checked yet</p>
            ) : (
              <ul className="mt-0.5 space-y-0.5 text-[11px]">
                {sync.sources.map((s) => (
                  <li key={s.provider} className="flex items-start gap-1">
                    <span className={s.reachable ? "text-emerald-600" : "text-red-600"}>●</span>
                    <span className="text-slate-700">
                      {s.label}: {s.reachable ? (s.machineReadable ? "data available" : "no data feed") : "unreachable"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="border-t border-slate-100 px-5 py-3">
          <details>
            <summary className="cursor-pointer text-xs font-medium text-slate-600">Recent sync attempts</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-[11px]">
                <thead className="text-left text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-2 py-1">When</th>
                    <th className="px-2 py-1">Trigger</th>
                    <th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1">Provider</th>
                    <th className="px-2 py-1 text-right">Verified</th>
                    <th className="px-2 py-1 text-right">Pending</th>
                    <th className="px-2 py-1">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {sync.logs.length === 0 && (
                    <tr><td colSpan={7} className="px-2 py-3 text-slate-400">No sync attempts recorded yet.</td></tr>
                  )}
                  {sync.logs.map((l) => (
                    <tr key={l.id} className="border-t border-slate-100 align-top">
                      <td className="whitespace-nowrap px-2 py-1">{fmtDateTime(l.startedAt)}</td>
                      <td className="px-2 py-1">{l.triggerSource}</td>
                      <td className="px-2 py-1">{statusBadge(l.status)}</td>
                      <td className="px-2 py-1">{l.provider ?? "—"}</td>
                      <td className="px-2 py-1 text-right">{l.rowsVerified}</td>
                      <td className="px-2 py-1 text-right">{l.rowsPending}</td>
                      <td className="max-w-[26rem] px-2 py-1 text-slate-600">{l.message ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </section>

      {/* ---------- D. historical records ---------- */}
      <HistorySection history={props.history} filters={props.filters} currencies={props.supportedCurrencies} />

      {/* ---------- E. admin controls ---------- */}
      {isAdmin && <AdminSection pending={pending} audit={props.audit} />}
    </div>
  );
}

function HistorySection({
  history,
  filters,
  currencies,
}: {
  history: Props["history"];
  filters: Props["filters"];
  currencies: string[];
}) {
  const totalPages = Math.max(1, Math.ceil(history.total / history.pageSize));
  const exportHref = `/api/customs-rates/history${buildQuery({
    currency: filters.currency,
    from: filters.from,
    to: filters.to,
    status: filters.status,
  })}`;

  return (
    <section className={card}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Historical Records</h2>
          <p className="text-[11px] text-slate-500">
            Every stored row, including pending and superseded ones, with its notification and source document
            reference. {history.total} row{history.total === 1 ? "" : "s"}.
          </p>
        </div>
        <Link
          href={exportHref}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          ⬇ Export CSV
        </Link>
      </div>

      <form method="get" className="grid grid-cols-1 items-end gap-3 px-5 py-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className={labelClass} htmlFor="h-currency">Currency</label>
          <select id="h-currency" name="currency" defaultValue={filters.currency} className={inputClass}>
            <option value="">All</option>
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="h-from">Effective from</label>
          <input id="h-from" name="from" type="date" defaultValue={filters.from} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="h-to">Effective to</label>
          <input id="h-to" name="to" type="date" defaultValue={filters.to} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="h-status">Status</label>
          <select id="h-status" name="status" defaultValue={filters.status} className={inputClass}>
            <option value="">All</option>
            <option value="verified">Verified</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
            <option value="superseded">Superseded</option>
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700">
          Filter
        </button>
      </form>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Currency</th>
              <th className="px-3 py-2 text-right">Import ₹</th>
              <th className="px-3 py-2 text-right">Export ₹</th>
              <th className="px-3 py-2 text-right">Unit</th>
              <th className="px-3 py-2">Effective</th>
              <th className="px-3 py-2">Notification</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Source document</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {history.rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">No rate records match these filters.</td></tr>
            )}
            {history.rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-800">{r.currencyCode}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right">{r.importRate ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold">{r.exportRate}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-500">{r.currencyUnit}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">
                  {fmtDate(r.effectiveStartDate)}
                  {r.effectiveEndDate ? ` → ${fmtDate(r.effectiveEndDate)}` : ""}
                </td>
                <td className="px-3 py-1.5 text-slate-600">
                  {r.notificationNo ?? "—"}
                  {r.notificationDate ? <span className="block text-[10px] text-slate-400">{fmtDate(r.notificationDate)}</span> : null}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">{statusBadge(r.status)}</td>
                <td className="max-w-[14rem] px-3 py-1.5 text-slate-500">
                  {r.sourceDocumentRef ? (
                    r.sourceUrl ? (
                      <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted">
                        {r.sourceDocumentRef}
                      </a>
                    ) : (
                      r.sourceDocumentRef
                    )
                  ) : (
                    r.source
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs">
        <p className="text-slate-500">
          Page {history.page} of {totalPages}
        </p>
        <div className="flex gap-2">
          {history.page > 1 && (
            <Link
              href={`/dashboard/customs-rates${buildQuery({ currency: filters.currency, from: filters.from, to: filters.to, status: filters.status, page: history.page - 1 })}`}
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
            >
              ← Previous
            </Link>
          )}
          {history.page < totalPages && (
            <Link
              href={`/dashboard/customs-rates${buildQuery({ currency: filters.currency, from: filters.from, to: filters.to, status: filters.status, page: history.page + 1 })}`}
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
            >
              Next →
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

const emptyFormState: CustomsFormState = { error: null, success: false, message: null };

function AdminSection({ pending, audit }: { pending: CustomsHistoryRow[]; audit: AuditRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [syncNotice, setSyncNotice] = useState<{ error: string | null; message: string | null } | null>(null);

  const [csvState, csvAction, csvPending] = useActionState(uploadCustomsRatesCsv, emptyFormState);
  const [docState, docAction, docPending] = useActionState(uploadCustomsRateDocument, emptyFormState);

  useEffect(() => {
    if (csvState.success || docState.success) router.refresh();
  }, [csvState.success, docState.success, router]);

  function handleSync() {
    setSyncNotice(null);
    startTransition(async () => {
      const result = await syncCustomsRatesNow();
      setSyncNotice(result);
      router.refresh();
    });
  }

  return (
    <section className={card}>
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Admin Controls</h2>
        <p className="text-[11px] text-slate-500">
          Synchronize, upload an official notification, and approve or reject what was extracted. Admin/MD only —
          every action is re-checked on the server and written to the audit log.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-3">
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-700">1. Manual synchronization</h3>
          <p className="text-[11px] text-slate-500">
            Checks ICEGATE and CBIC now. If no machine-readable feed exists, nothing is written and the reason is
            recorded — an administrator then uploads the notification.
          </p>
          <button
            type="button"
            onClick={handleSync}
            disabled={isPending}
            className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {isPending ? "Checking official sources…" : "↻ Sync now"}
          </button>
          {syncNotice?.error && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">{syncNotice.error}</p>
          )}
          {syncNotice?.message && !syncNotice.error && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-800">{syncNotice.message}</p>
          )}
        </div>

        <form action={csvAction} className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-700">2. Official CSV upload</h3>
          <p className="text-[11px] text-slate-500">
            Columns: Currency (or Currency Code), Import Rate, Export Rate, Effective Start Date, Currency Unit,
            Notification No. Uploaded rows stay <strong>pending</strong> until approved.
          </p>
          <input type="file" name="file" accept=".csv,text/csv" required className="block w-full text-[11px] text-slate-600" />
          <div>
            <label className={labelClass} htmlFor="csv-date">Fallback effective date (if the file omits it)</label>
            <input id="csv-date" name="effective_start_date" type="date" className={inputClass} />
          </div>
          {csvState.error && <p className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{csvState.error}</p>}
          {csvState.success && <p className="rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800">{csvState.message}</p>}
          <button
            type="submit"
            disabled={csvPending}
            className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {csvPending ? "Reading…" : "Upload CSV"}
          </button>
        </form>

        <form action={docAction} className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-700">3. Official notification upload</h3>
          <p className="text-[11px] text-slate-500">
            PDF (or a .txt copy of the table) of the CBIC/ICEGATE notification. Extraction is best-effort and
            always lands as pending for review.
          </p>
          <input type="file" name="file" accept=".pdf,.txt,application/pdf,text/plain" required className="block w-full text-[11px] text-slate-600" />
          <div>
            <label className={labelClass} htmlFor="doc-date">Fallback effective date</label>
            <input id="doc-date" name="effective_start_date" type="date" className={inputClass} />
          </div>
          {docState.error && <p className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{docState.error}</p>}
          {docState.success && <p className="rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800">{docState.message}</p>}
          <button
            type="submit"
            disabled={docPending}
            className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {docPending ? "Extracting…" : "Upload document"}
          </button>
        </form>
      </div>

      <div className="border-t border-slate-100 px-5 py-4">
        <h3 className="text-xs font-semibold text-slate-700">4. Review pending rates ({pending.length})</h3>
        {pending.length === 0 ? (
          <p className="mt-1 text-[11px] text-slate-500">Nothing awaiting approval.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {pending.map((r) => (
              <PendingRow key={r.id} row={r} onDone={() => router.refresh()} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 px-5 py-4">
        <h3 className="text-xs font-semibold text-slate-700">5. Audit log</h3>
        {audit.length === 0 ? (
          <p className="mt-1 text-[11px] text-slate-500">No entries yet.</p>
        ) : (
          <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-[11px]">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-2 border-b border-slate-100 pb-1">
                <span className="text-slate-400">{fmtDateTime(a.createdAt)}</span>
                <span className="font-semibold text-slate-700">{a.action}</span>
                <span className="text-slate-600">{a.actorName ?? "system"}</span>
                {a.rateId && <span className="truncate font-mono text-[10px] text-slate-400">{a.rateId.slice(0, 8)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PendingRow({ row, onDone }: { row: CustomsHistoryRow; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setError(null);
    const result = await approveCustomsRate(row.id);
    setBusy(false);
    if (result.error) setError(result.error);
    else onDone();
  }

  async function reject() {
    setBusy(true);
    setError(null);
    const result = await rejectCustomsRate(row.id, reason);
    setBusy(false);
    if (result.error) setError(result.error);
    else onDone();
  }

  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className="font-semibold text-slate-800">{row.currencyCode}</span>
          <span>Import ₹{row.importRate ?? "—"}</span>
          <span>Export ₹{row.exportRate}</span>
          <span className="text-slate-500">per {row.currencyUnit}</span>
          <span className="text-slate-500">w.e.f. {fmtDate(row.effectiveStartDate)}</span>
          <span className="text-slate-500">Notif. {row.notificationNo ?? "missing"}</span>
          {row.confidence != null && <span className="text-slate-400">confidence {row.confidence}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={approve}
            className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Approve
          </button>
        </div>
      </div>
      {row.validationNotes && <p className="mt-1 text-[10px] text-amber-700">{row.validationNotes}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for rejection (required to reject)"
          className="min-w-[14rem] flex-1 rounded border border-slate-300 px-2 py-1 text-[11px] outline-none focus:border-red-400"
        />
        <button
          type="button"
          disabled={busy || !reason.trim()}
          onClick={reject}
          className="rounded border border-red-300 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40"
        >
          Reject
        </button>
      </div>
      {error && <p className="mt-1 text-[10px] text-red-600">{error}</p>}
    </div>
  );
}
