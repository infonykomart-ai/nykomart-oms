import { requireCapability } from "@/lib/auth/require-capability";
import { BackupExportButton } from "./backup-export-button";

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
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">💾 Backup Export</h1>
        <p className="mt-1 text-sm text-slate-500">
          Download one Excel workbook with every order — across all companies — and its generated invoice fields
          (Invoice Generation + Dispatch &amp; Invoice), one row per order. Admin/MD only.
        </p>
      </div>

      <div className="max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="mb-4 text-sm text-slate-600">
          This can take a moment for a large order history — the workbook is built after every order finishes
          loading, then downloads straight to your device. Nothing is emailed or stored anywhere else.
        </p>
        <BackupExportButton />
      </div>
    </div>
  );
}
