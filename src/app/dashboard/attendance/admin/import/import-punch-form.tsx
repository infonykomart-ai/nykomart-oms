"use client";

// 2026-10-01 — client half of the punch-report import (TeamOffice daily
// IN/OUT export or any sheet with Empcode/Date/IN/OUT columns). File OR
// pasted rows, an optional fallback date for reports that carry the date
// in the title instead of a column, then the parsed summary + per-row
// issues render right here — the server action reports every skipped row
// with its line number, so nothing is dropped silently.
import { useActionState } from "react";
import { importPunchReport, type ImportState } from "./actions";

const initialState: ImportState = { error: null, summary: null, issues: [] };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

export function ImportPunchForm({ today }: { today: string }) {
  const [state, formAction, pending] = useActionState(importPunchReport, initialState);

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}
      {state.summary && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          ✓ {state.summary.total} row(s) read — <strong>{state.summary.imported}</strong> imported,{" "}
          <strong>{state.summary.updated}</strong> updated, <strong>{state.summary.skipped}</strong> skipped.
        </div>
      )}
      {state.issues.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="mb-1 text-xs font-semibold text-amber-800">Skipped / needs attention:</p>
          <ul className="space-y-0.5 text-xs text-amber-900">
            {state.issues.map((msg, i) => (
              <li key={i}>• {msg}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Upload report (.csv / .xlsx / .txt)
          </label>
          <input type="file" name="file" accept=".csv,.tsv,.txt,.xlsx,.xls" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Fallback date (if the file has no Date column — YYYY-MM-DD)
          </label>
          <input type="date" name="fallback_date" defaultValue={today} className={inputClass} />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          …or paste rows here (CSV / tab-separated — with or without a header row)
        </label>
        <textarea
          name="pasted"
          rows={6}
          placeholder={"Empcode,Name,Date,INTime,OUTTime\n0002,GAJANAND BHANKARIWAL,01/10/2026,09:29,14:39\n0003,SAHIL,01/10/2026,09:10,"}
          className={`${inputClass} font-mono text-xs`}
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
      >
        {pending ? "Importing…" : "⬆️ Import Punches"}
      </button>
    </form>
  );
}
