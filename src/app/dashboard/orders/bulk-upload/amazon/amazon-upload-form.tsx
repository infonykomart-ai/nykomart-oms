"use client";

import { useActionState } from "react";
import { importAmazonOrders, type AmazonImportState } from "./actions";

const initialState: AmazonImportState = {
  error: null,
  mode: null,
  shape: null,
  issues: [],
  preview: null,
  results: null,
};

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

export function AmazonUploadForm({
  stores,
  categories,
  currencies,
}: {
  stores: { id: string; name: string; company: string }[];
  categories: { id: string; name: string }[];
  currencies: { code: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(importAmazonOrders, initialState);

  const validCount = state.preview?.filter((r) => !r.error).length ?? 0;
  const problemCount = (state.preview?.length ?? 0) - validCount;
  const createdOk = state.results?.filter((r) => r.refNo && !r.error).length ?? 0;

  return (
    <div className="space-y-4">
      <form action={formAction} className="rounded-xl border border-slate-200 bg-white p-4">
        {state.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="file">Amazon order file (.xlsx / .csv)</label>
            <input
              id="file"
              type="file"
              name="file"
              accept=".csv,.xlsx,.xls,.txt,.tsv"
              required
              className="w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="store_id">Amazon store *</label>
            <select id="store_id" name="store_id" required className={inputClass} defaultValue={stores.length === 1 ? stores[0].id : ""}>
              <option value="">Select…</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name} — {s.company}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="item_category_id">Item Category *</label>
            <select id="item_category_id" name="item_category_id" required className={inputClass}>
              <option value="">Select…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="fallback_currency">
              Currency (jab sheet me na ho)
            </label>
            <select id="fallback_currency" name="fallback_currency" className={inputClass} defaultValue="USD">
              {currencies.length > 0
                ? currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)
                : ["USD", "INR", "EUR", "GBP"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            name="mode"
            value="preview"
            disabled={pending}
            className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {pending ? "Reading…" : "👁 Preview rows"}
          </button>
          {state.preview && (
            <button
              type="submit"
              name="mode"
              value="create"
              disabled={pending || validCount === 0}
              className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {pending ? "Creating…" : `✓ Create ${validCount} order${validCount === 1 ? "" : "s"}`}
            </button>
          )}
          {state.shape && (
            <span className="text-xs text-slate-400">
              format: {state.shape === "amazon-report" ? "Amazon report (header row)" : state.shape === "ledger-blocks" ? "Order-No book layout" : "unknown"}
            </span>
          )}
        </div>
      </form>

      {state.issues.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="mb-1 text-xs font-semibold text-amber-800">Reading notes</p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800">
            {state.issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {state.preview && state.preview.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-3 text-sm font-semibold text-slate-700">
            {validCount} order{validCount === 1 ? "" : "s"} ready
            {problemCount > 0 && <span className="text-red-600"> · {problemCount} row{problemCount === 1 ? "" : "s"} need fixing</span>}
            {state.mode === "create" && <span className="text-green-700"> · {createdOk} created</span>}
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {["Line", "Order No", "Date", "Buyer", "Item / ASIN", "Size", "Qty", "Amount", "Status", "Result"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.preview.map((row) => {
                  const created = state.results?.find((r) => r.line === row.line);
                  return (
                    <tr key={`${row.line}-${row.orderNo}`} className={row.error ? "bg-red-50" : created?.error ? "bg-amber-50" : ""}>
                      <td className="px-3 py-2 text-slate-500">{row.line}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">{row.orderNo || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">{row.orderDate ?? "—"}</td>
                      <td className="max-w-[16rem] truncate px-3 py-2 text-slate-600" title={row.buyer}>{row.buyer || "—"}</td>
                      <td className="max-w-[14rem] px-3 py-2 text-xs text-slate-600">
                        <span className="block truncate" title={row.productName}>{row.productName || "—"}</span>
                        {row.asin ? <span className="font-mono text-[11px] text-slate-400">{row.asin}</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">{row.size || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{row.qty ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {row.amount != null ? `${row.amount.toFixed(2)} ${row.currency ?? ""}` : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{row.status || "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {row.error ? (
                          <span className="text-red-700">{row.error}</span>
                        ) : created ? (
                          created.error ? (
                            <span className="text-amber-700">{created.error}</span>
                          ) : (
                            <span className="text-green-700">✓ {created.refNo}</span>
                          )
                        ) : (
                          <span className="text-slate-400">ready</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {state.preview.some((r) => r.remark) && (
            <p className="mt-2 text-xs text-slate-400">
              Notes/Refund lines from the sheet are carried into each order&apos;s Remark — orders &amp; refunds are not booked
              twice from the same sheet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
