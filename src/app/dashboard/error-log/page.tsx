import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { ErrorRowActions } from "./error-row-actions";

// Error Tab (2026-09-08) — see db/2026-09-08-error-log.sql. Read-only list
// + inline Resolve/Reopen, Admin/MD only (error_log_view). Mirrors
// audit-log/page.tsx closely (native GET <form> filter, same table shell)
// — deliberately its own screen rather than folded into Audit Log, since
// this has a resolved/pending lifecycle Audit Log doesn't.
//
// Unifies 3 sources, all written via src/lib/error-log/log-entry-error.ts:
//   - validation:   a form submission was rejected (order entry, courier
//                    booking) before it could save.
//   - courier_api:  a real courier booking API call failed — a sibling to
//                    courier_shipments' own attempt log, kept here too so
//                    it shows up in one place alongside the other 2.
//   - manual:       an employee explicitly flagged something wrong (see
//                    the "🚩 Flag as Error" button on the order detail page).
const inputClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500";

const SOURCES = [
  { value: "validation", label: "Validation" },
  { value: "courier_api", label: "Courier/API" },
  { value: "manual", label: "Manual flag" },
];

export default async function ErrorLogPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("error_log_view");
  const supabase = await createClient();
  const sp = await searchParams;

  const status = typeof sp.status === "string" ? sp.status : "pending";
  const source = typeof sp.source === "string" ? sp.source : "";
  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";

  let query = supabase
    .from("entry_errors")
    .select(
      "id, company_id, source, status, reason, reference_type, reference_id, reference_label, raised_by_name, created_at, resolved_at, resolved_by_name, resolution_notes"
    )
    .or(`company_id.in.(${employee.companyIds.join(",")}),company_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(300);

  if (status) query = query.eq("status", status);
  if (source) query = query.eq("source", source);
  if (fromDate) query = query.gte("created_at", fromDate);
  if (toDate) query = query.lte("created_at", `${toDate}T23:59:59`);

  const { data: rows } = await query;

  const pendingCount = (rows ?? []).filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">⚠️ Error Tab</h1>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label htmlFor="status" className="mb-1 block text-xs font-medium text-slate-600">
            Status
          </label>
          <select id="status" name="status" defaultValue={status} className={inputClass}>
            <option value="pending">Pending</option>
            <option value="resolved">Resolved</option>
            <option value="">All</option>
          </select>
        </div>
        <div>
          <label htmlFor="source" className="mb-1 block text-xs font-medium text-slate-600">
            Source
          </label>
          <select id="source" name="source" defaultValue={source} className={inputClass}>
            <option value="">All</option>
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="from" className="mb-1 block text-xs font-medium text-slate-600">
            From
          </label>
          <input id="from" type="date" name="from" defaultValue={fromDate} className={inputClass} />
        </div>
        <div>
          <label htmlFor="to" className="mb-1 block text-xs font-medium text-slate-600">
            To
          </label>
          <input id="to" type="date" name="to" defaultValue={toDate} className={inputClass} />
        </div>
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
          Filter
        </button>
        {status === "pending" && (
          <span className="ml-auto rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            {pendingCount} pending
          </span>
        )}
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">When</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Who</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Source</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Reference</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Reason</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Status</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-600">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(rows ?? []).map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">{new Date(r.created_at).toLocaleString("en-IN")}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.raised_by_name}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                  {SOURCES.find((s) => s.value === r.source)?.label ?? r.source}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                  {r.reference_type === "order" && r.reference_id ? (
                    <Link href={`/dashboard/orders/${r.reference_id}`} className="text-amber-600 underline">
                      {r.reference_label ?? "View order"}
                    </Link>
                  ) : r.reference_label ? (
                    r.reference_label
                  ) : (
                    "—"
                  )}
                </td>
                <td className="max-w-md px-3 py-2 text-xs text-slate-600">
                  <p className="whitespace-pre-wrap break-words">{r.reason}</p>
                  {r.status === "resolved" && r.resolution_notes && (
                    <p className="mt-1 text-slate-400">
                      Resolved by {r.resolved_by_name}
                      {r.resolved_at ? ` · ${new Date(r.resolved_at).toLocaleString("en-IN")}` : ""}: {r.resolution_notes}
                    </p>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span
                    className={
                      r.status === "resolved"
                        ? "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700"
                        : "rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800"
                    }
                  >
                    {r.status === "resolved" ? "Resolved" : "Pending"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <ErrorRowActions id={r.id} status={r.status} />
                </td>
              </tr>
            ))}
            {(!rows || rows.length === 0) && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                  No entries for this filter — nothing wrong logged yet 🎉
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
