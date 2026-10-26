// 2026-10-21 — "Schema / Migration Status" card.
//
// Shown on /dashboard to Admin/MD only (permissions_admin). It is the answer
// to "admin ko dikhta nahi ki kaunsi migration abhi bhi pending hai" — every
// optional column in this app is read with a tolerant fallback, so a missing
// migration degrades a number silently (old figure, missing stamp, empty
// picker) instead of throwing. This card is the one place that says it out
// loud, BEFORE someone wonders why a total looks wrong.
//
// Server component: the probes live in src/lib/db/schema-status.ts and never
// read data — just "does this column/table exist".
import Link from "next/link";
import type { SchemaStatus } from "@/lib/db/schema-status";

export function SchemaHealthCard({ status }: { status: SchemaStatus }) {
  const appliedCount = status.results.length - status.pending.length - status.unverified.length;

  // Nothing pending: stay out of the way with one slim green line. This is
  // the normal state, so it must not take up dashboard space.
  if (status.pending.length === 0) {
    return (
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-2.5">
        <p className="text-xs text-emerald-800">
          🗄️ <span className="font-semibold">Database schema up to date</span> — {appliedCount} tracked migration
          {appliedCount === 1 ? "" : "s"} applied
          {status.unverified.length > 0 && (
            <span className="text-emerald-700/70"> · {status.unverified.length} couldn&apos;t be checked</span>
          )}
          .
        </p>
        <Link href="/dashboard?schema=recheck" className="text-[11px] font-medium text-emerald-700 underline hover:text-emerald-900">
          Recheck
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-amber-900">
            🧩 Schema / Migration Status
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              {status.pending.length} pending
            </span>
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-amber-900/90">
            This SQL file{status.pending.length === 1 ? " has" : "s have"} not been run on the live database yet. That is
            why the features below show old / incomplete data — the code is not wrong, the column just does not exist. Run
            the file in Supabase → SQL Editor, then press &quot;Recheck&quot;.
          </p>
        </div>
        <Link
          href="/dashboard?schema=recheck"
          className="shrink-0 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
        >
          ↻ Recheck
        </Link>
      </div>

      <ul className="mt-3 space-y-2">
        {status.pending.map((p) => (
          <li key={p.file} className="rounded-lg border border-amber-200 bg-white px-3 py-2">
            <p className="text-xs font-semibold text-slate-800">{p.title}</p>
            <code className="mt-0.5 block break-all rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
              db/{p.file}
            </code>
            <ul className="mt-1 list-disc pl-4 text-[11px] text-slate-600">
              {p.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            {p.error && <p className="mt-1 text-[10px] text-amber-700">DB said: {p.error}</p>}
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[10px] text-amber-800/80">
        Checked {new Date(status.checkedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
        {status.unverified.length > 0 && ` · ${status.unverified.length} check(s) could not run (network/permission)`} ·
        This card only checks column/table existence, never reads your data.
      </p>
    </div>
  );
}
