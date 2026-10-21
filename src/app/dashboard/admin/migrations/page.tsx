import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { probeMigrations, migrationApplied, summarizeMigrations, type ProbeState } from "@/lib/migrations/probes";

// 2026-10-21 — "kar diya run" / the reason it exists at all: every dated
// db/2026-*.sql file has to be run ONCE by hand, and the app is deliberately
// built to keep working (with the OLD behaviour) when one hasn't been. That
// tolerance made a pending migration invisible — the live screen just kept
// showing the pre-fix figures and there was no way to tell the fix apart from
// a broken fix. This page reads (read-only) whether each file's object is
// present in the database and prints the exact file to run for anything
// still pending.
//
// Admin-only (MD / Admin both hold employee_admin — see schema.sql's role
// seed), read-only, and it never mutates anything: every check is a
// limit(1) select or an RPC call PostgREST can answer with "does not exist".
export default async function MigrationsPage() {
  const employee = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();
  const probes = await probeMigrations(supabase, employee.currentCompanyId);
  const { pending, unknown, total } = summarizeMigrations(probes);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">🧩 Database / Migration Status</h1>
        <p className="mt-1 text-sm text-slate-500">
          Which one-time SQL files are already applied to this database. The app keeps working either way (features
          simply stay on the old behaviour), so this page is how you can tell a pending file from a broken one.
        </p>
      </div>

      {pending === 0 && unknown === 0 && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          ✓ All {total} migrations are applied — this database matches <code className="rounded bg-emerald-100 px-1">db/schema.sql</code>.
        </div>
      )}
      {pending > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">⚠ {pending} migration{pending === 1 ? "" : "s"} not applied yet.</p>
          <p className="mt-1">
            Run each pending file below in the Supabase SQL Editor — one at a time, in the order shown. Every file is
            idempotent (safe to run twice), and the newest one ends with a PostgREST schema-cache reload so the app
            picks the change up immediately.
          </p>
        </div>
      )}
      {unknown > 0 && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          {unknown} file{unknown === 1 ? "" : "s"} could not be checked (the API answered with something other than
          “not found”). Nothing is wrong with the app — run the file anyway if it is new, it is idempotent.
        </div>
      )}

      <div className="space-y-3">
        {probes.map((probe) => {
          const applied = migrationApplied(probe);
          const missingChecks = probe.checks.filter((c) => c.state === "missing");
          return (
            <div key={probe.file} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    {applied ? (
                      <span className="mr-1.5 text-emerald-600">✓</span>
                    ) : (
                      <span className="mr-1.5 text-amber-600">⏳</span>
                    )}
                    {probe.label}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">{probe.impact}</p>
                </div>
                <StatusBadge state={applied ? "applied" : missingChecks.length ? "missing" : "unknown"} />
              </div>

              <ul className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-[11px]">
                {probe.checks.map((check) => (
                  <li key={check.name} className="flex items-center gap-2 text-slate-600">
                    <CheckDot state={check.state} />
                    {check.name}
                    {check.state === "missing" && <span className="text-amber-700">— not found in this database</span>}
                  </li>
                ))}
              </ul>

              {!applied && missingChecks.length > 0 && (
                <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  Run <code className="rounded bg-amber-100 px-1">{probe.file}</code> in the Supabase SQL Editor.
                </div>
              )}
              {applied && (
                <p className="mt-2 text-[11px] text-slate-400">
                  Applied — <code className="rounded bg-slate-100 px-1">{probe.file}</code> has already been run.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ state }: { state: ProbeState }) {
  if (state === "applied") {
    return <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Applied</span>;
  }
  if (state === "missing") {
    return <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Not applied</span>;
  }
  return <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Unknown</span>;
}

function CheckDot({ state }: { state: ProbeState }) {
  if (state === "applied") return <span className="text-emerald-600">●</span>;
  if (state === "missing") return <span className="text-amber-600">○</span>;
  return <span className="text-slate-400">●</span>;
}
