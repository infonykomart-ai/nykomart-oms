"use client";

import { useActionState } from "react";
import { DownloadTemplateButton } from "@/components/download-template-button";
import { bulkSaveParties, type BulkPartyState } from "../actions";
import { PARTY_COLUMNS } from "./columns";

const initialState: BulkPartyState = { error: null, results: null };

export function BulkPartyUploadForm() {
  const [state, formAction, pending] = useActionState(bulkSaveParties, initialState);

  const createdCount = state.results?.filter((r) => r.action === "created").length ?? 0;
  const updatedCount = state.results?.filter((r) => r.action === "updated").length ?? 0;
  const failCount = state.results ? state.results.length - createdCount - updatedCount : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <DownloadTemplateButton filenameBase="bulk-party-master" columns={PARTY_COLUMNS} />
        <p className="text-xs text-slate-400">
          Fields marked * are required. Uploading an existing Party Name updates that party instead of creating a
          duplicate.
        </p>
      </div>

      <form action={formAction} className="rounded-xl border border-slate-200 bg-white p-4">
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
            {pending ? "Uploading..." : "Upload & Save Parties"}
          </button>
        </div>
      </form>

      {state.results && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-3 text-sm font-semibold text-slate-700">
            {createdCount} created, {updatedCount} updated
            {failCount > 0 && <span className="text-red-600"> · {failCount} row{failCount === 1 ? "" : "s"} failed</span>}
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Row</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Party Name</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.results.map((r) => (
                  <tr key={r.row} className={r.error ? "bg-red-50" : ""}>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.row}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.name || "—"}</td>
                    <td className="px-3 py-2">
                      {r.error ? (
                        <span className="text-red-700">{r.error}</span>
                      ) : (
                        <span className="text-green-700">✓ {r.action}</span>
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
