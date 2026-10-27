import { requireCapability } from "@/lib/auth/require-capability";
import { listBackupRuns, type BackupRunList } from "@/lib/backup/run";
import { R2_ENV_VARS } from "@/lib/backup/r2";
import { BackupExportButton } from "./backup-export-button";
import { BuyerCountryBackfillButton } from "./buyer-country-backfill-button";
import { CloudBackupButton } from "./cloud-backup-panel";

// Backup Export (2026-08-22) — admin-only. One button, one Excel
// workbook: every order across ALL companies joined with its
// invoice-relevant fields (the generated sales_invoices export invoice +
// the per-order dispatch_invoices "Dispatch & Invoice" record). See
// db/2026-08-22-backup-export-admin.sql and ./actions.ts for the full
// rationale on why this is its own capability rather than reusing
// "reports" or "invoicing".
//
// 2026-10-23 — Cloud Backup added above it: the weekly full snapshot stored
// in Cloudflare R2 (every table as Excel + a readable PDF), plus the list of
// stored runs to download. The Excel export below remains the quick,
// on-demand "orders + invoices" workbook; it does not touch R2.

// The stored-run list is read from R2 on every visit (the list calls use
// `cache: "no-store"`), so a just-finished backup shows up immediately — no
// page-level caching opt-out needed.

function describeRunTime(runId: string): string {
  // runId is "YYYY-MM-DD_HHMMSS" in UTC (see run.ts's runIdFor()).
  const match = /^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(runId);
  if (!match) return runId;
  const date = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
  if (Number.isNaN(date.getTime())) return runId;
  return `${date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })} IST`;
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileLabel(name: string): string {
  if (name.endsWith(".xlsx")) return "⬇️ Excel (all data)";
  if (name.endsWith(".pdf")) return "⬇️ PDF report";
  if (name.endsWith(".json")) return "⬇️ Manifest";
  return `⬇️ ${name}`;
}

function StoredRuns({ state }: { state: BackupRunList }) {
  if (!state.configured) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">Storage not configured yet</p>
        <p className="mt-1">
          Add these keys in Settings → Environment (Cloudflare R2 → bucket → &quot;Manage R2 API Tokens&quot; creates the
          first three):
        </p>
        <ul className="mt-2 list-inside list-disc font-mono text-xs">
          {R2_ENV_VARS.map((name) => (
            <li key={name}>
              {name}
              {state.missing.includes(name) ? " (missing)" : ""}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs">
          Optional: <span className="font-mono">R2_PREFIX</span> (defaults to{" "}
          <span className="font-mono">backups</span>).
        </p>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-medium">Could not read the backup bucket</p>
        <p className="mt-1 break-words text-xs">{state.error}</p>
      </div>
    );
  }

  if (state.runs.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        No backups stored yet. Run one now, or let the weekly schedule take the first one.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2 pr-4">Backup (IST)</th>
            <th className="py-2 pr-4">Files</th>
          </tr>
        </thead>
        <tbody>
          {state.runs.map((run) => (
            <tr key={run.runId} className="border-b border-slate-100 align-top last:border-0">
              <td className="whitespace-nowrap py-3 pr-4 font-medium text-slate-800">{describeRunTime(run.runId)}</td>
              <td className="py-3">
                <div className="flex flex-wrap gap-2">
                  {run.files.map((file) => (
                    <a
                      key={file.key}
                      href={`/api/admin/backups/download?key=${encodeURIComponent(file.key)}`}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                      title={file.key}
                    >
                      {fileLabel(file.name)}
                      <span className="text-slate-400">{fileSize(file.size)}</span>
                    </a>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function BackupExportPage() {
  await requireCapability("data_export_admin");
  const runs = await listBackupRuns();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">💾 Backup Export</h1>
      </div>

      <div className="max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">☁️ Cloud Backup — weekly full snapshot</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Every Sunday, 02:00 IST</span>
        </div>
        <CloudBackupButton disabled={!runs.configured} />
        <div className="mt-4">
          <StoredRuns state={runs} />
        </div>
      </div>

      <div className="max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">Export All Orders + Invoices</h2>
        <BackupExportButton />
      </div>

      {/* 2026-08-22 — one-time (safely re-runnable) migration for the
          orders that predate orders.buyer_country — see
          db/2026-08-22-orders-buyer-country.sql and actions.ts's
          backfillBuyerCountry() for the full rationale. New/edited
          orders get this automatically from now on; this button is only
          for the pre-existing backlog. */}
      <div className="max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">🌍 Backfill Buyer Country</h2>
        <BuyerCountryBackfillButton />
      </div>
    </div>
  );
}
