import { requireCapability } from "@/lib/auth/require-capability";
import { BackupExportButton } from "./backup-export-button";
import { BuyerCountryBackfillButton } from "./buyer-country-backfill-button";

// Backup Export (2026-08-22) — admin-only. One button, one Excel
// workbook: every order across ALL companies joined with its
// invoice-relevant fields (the generated sales_invoices export invoice +
// the per-order dispatch_invoices "Dispatch & Invoice" record). See
// db/2026-08-22-backup-export-admin.sql and ./actions.ts for the full
// rationale on why this is its own capability rather than reusing
// "reports" or "invoicing".
export default async function BackupExportPage() {
  await requireCapability("data_export_admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">💾 Backup Export</h1>
        <p className="mt-1 text-sm text-slate-500">Admin/MD-only data tools.</p>
      </div>

      <div className="max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">Export All Orders + Invoices</h2>
        <p className="mb-4 text-sm text-slate-600">
          Download one Excel workbook with every order — across all companies — and its generated invoice fields
          (Invoice Generation + Dispatch &amp; Invoice), one row per order. This can take a moment for a large order
          history — the workbook is built after every order finishes loading, then downloads straight to your
          device. Nothing is emailed or stored anywhere else.
        </p>
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
        <p className="mb-4 text-sm text-slate-600">
          One-time fix for orders entered before country was auto-detected from the buyer&apos;s address — fills in{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">orders.buyer_country</code> for every existing
          order that doesn&apos;t have one yet, using the buyer&apos;s address text already on file. Safe to run
          again any time — it only ever touches orders that still need it.
        </p>
        <BuyerCountryBackfillButton />
      </div>
    </div>
  );
}
