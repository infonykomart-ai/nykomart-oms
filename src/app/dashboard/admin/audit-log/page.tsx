import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";

// Audit log viewer (2026-08-24) — see db/2026-08-24-audit-log.sql. Read-only,
// MD/Admin-only. Filterable by entity type and date range (same native GET
// <form> pattern as the report pages, e.g. reports/purchase-bills). Only
// shows what's actually been wired up so far (order Hold/Cancel, Purchase/
// Courier/Duty Bill delete, Office Expense delete, Order Shipment delete) —
// see the migration's header comment for how to extend coverage.
const inputClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500";

const ENTITY_TYPES = ["order", "purchase_bill", "freight_bill", "duty_tax_bill", "internal_expense", "order_shipment"];

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("audit_log_view");
  const supabase = await createClient();
  const sp = await searchParams;

  const entityType = typeof sp.entity === "string" ? sp.entity : "";
  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";

  let query = supabase
    .from("audit_log")
    .select("id, company_id, employee_name, action, entity_type, entity_id, entity_label, changes, created_at")
    .or(`company_id.in.(${employee.companyIds.join(",")}),company_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(300);

  if (entityType) query = query.eq("entity_type", entityType);
  if (fromDate) query = query.gte("created_at", fromDate);
  if (toDate) query = query.lte("created_at", `${toDate}T23:59:59`);

  const { data: rows } = await query;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">🕵️ Audit Log</h1>
        <p className="mt-1 text-sm text-slate-500">
          Who changed or deleted what, and when. Currently covers: order Hold/Cancel, Purchase/Courier/Duty Bill
          delete, Office Expense delete, Order Shipment delete — not every action in the app yet, more can be added
          the same way.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label htmlFor="entity" className="mb-1 block text-xs font-medium text-slate-600">
            Entity type
          </label>
          <select id="entity" name="entity" defaultValue={entityType} className={inputClass}>
            <option value="">All</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
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
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">When</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Who</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Action</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Entity</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(rows ?? []).map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">{new Date(r.created_at).toLocaleString("en-IN")}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.employee_name}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.action}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                  {r.entity_type}
                  {r.entity_label ? <span className="text-slate-400"> — {r.entity_label}</span> : null}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {r.changes ? <code className="whitespace-pre-wrap break-words">{JSON.stringify(r.changes)}</code> : "—"}
                </td>
              </tr>
            ))}
            {(!rows || rows.length === 0) && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                  No audit entries yet for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
