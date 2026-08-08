"use client";

import { useActionState, useRef } from "react";
import { bulkCreateOrders, type BulkOrderState } from "../new/actions";
import { DownloadTemplateButton } from "@/components/download-template-button";
import type { BulkOrderColumn } from "./columns";

const initialState: BulkOrderState = { error: null, results: null };

export function BulkOrderUploadForm({ columns }: { columns: BulkOrderColumn[] }) {
  const [state, formAction, pending] = useActionState(bulkCreateOrders, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  const okCount = state.results?.filter((r) => !r.error).length ?? 0;
  const failCount = state.results ? state.results.length - okCount : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <DownloadTemplateButton filenameBase="bulk-order-upload" columns={columns} />
        <p className="text-xs text-slate-400">
          Fields marked * are required. Multiple rows with the same Buyer Name &amp; Address / Contact No on the same
          Order Date automatically batch under one PO/RF/RG number.
        </p>
      </div>

      <form
        ref={formRef}
        action={(formData) => {
          formAction(formData);
        }}
        className="rounded-xl border border-slate-200 bg-white p-4"
      >
        {state.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            name="file"
            accept=".csv,.xlsx,.xls"
            required
            className="text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            {pending ? "Uploading..." : "Upload & Create Orders"}
          </button>
        </div>
      </form>

      {state.results && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-3 text-sm font-semibold text-slate-700">
            {okCount} order{okCount === 1 ? "" : "s"} created
            {failCount > 0 && <span className="text-red-600"> · {failCount} row{failCount === 1 ? "" : "s"} failed</span>}
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Row</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.results.map((r) => (
                  <tr key={r.row} className={r.error ? "bg-red-50" : ""}>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.row}</td>
                    <td className="px-3 py-2">
                      {r.error ? (
                        <span className="text-red-700">{r.error}</span>
                      ) : (
                        <span className="text-green-700">✓ {r.refNo}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
