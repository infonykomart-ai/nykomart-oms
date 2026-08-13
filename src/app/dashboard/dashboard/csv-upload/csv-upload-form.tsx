"use client";

import { useActionState, useState } from "react";
import { DownloadTemplateButton } from "@/components/download-template-button";
import { bulkImportStatement, type BulkImportState } from "./actions";
import { STATEMENT_IMPORT_TABLES } from "@/lib/statement-import/tables";

const initialState: BulkImportState = { error: null, tableKey: null, imported: null, results: null };

export function CsvUploadForm({ companies }: { companies: { id: string; name: string }[] }) {
  const [tableKey, setTableKey] = useState(STATEMENT_IMPORT_TABLES[0].key);
  const [state, formAction, pending] = useActionState(bulkImportStatement, initialState);
  const config = STATEMENT_IMPORT_TABLES.find((t) => t.key === tableKey)!;
  const failCount = state.results?.filter((r) => r.error).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {STATEMENT_IMPORT_TABLES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTableKey(t.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              tableKey === t.key ? "bg-amber-500 text-white" : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-slate-400">{config.sourceNote}</p>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <DownloadTemplateButton
          filenameBase={`csv-upload-${config.key}`}
          columns={config.columns.map((c) => ({ label: c.header, example: "", required: !!c.required }))}
        />
        <p className="text-xs text-slate-400">Every row becomes a new record — re-uploading the same file twice logs it twice.</p>
      </div>

      <form action={formAction} className="rounded-xl border border-slate-200 bg-white p-4">
        <input type="hidden" name="table_key" value={tableKey} />
        {state.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}
        {state.imported !== null && state.tableKey === tableKey && (
          <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
            ✓ {state.imported} row(s) imported{failCount > 0 && <span className="text-red-700"> · {failCount} row(s) skipped</span>}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <select name="company_id" required defaultValue="" className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900">
            <option value="" disabled>Company *</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
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
            {pending ? "Uploading..." : `Upload & Save ${config.label}`}
          </button>
        </div>
      </form>

      {state.results && state.tableKey === tableKey && failCount > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-slate-700">Skipped rows</p>
          <div className="space-y-1 text-xs">
            {state.results
              .filter((r) => r.error)
              .map((r) => (
                <p key={r.row} className="text-red-700">Row {r.row}: {r.error}</p>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
