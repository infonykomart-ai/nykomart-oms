"use client";

/**
 * 2026-09-29 — FedEx-style upgrade of the Employees page, same visual
 * language as the redesigned My Profile (see
 * src/app/dashboard/profile/my-profile-form.tsx):
 *
 *   • A card-style identity header for the whole ROSTER (big count, photo
 *     strip, active/inactive split) instead of a bare "Employees" <h1>.
 *   • The same --oms-* token theming (this page sits inside the same
 *     ThemedShell as everything else).
 *   • Data-download controls live here because the user asked for them
 *     "sabhi employe ka data ek sath download" — Export Excel (every
 *     column incl. statutory/bank, like the Backup Export workbook) and a
 *     printable Directory PDF (contact-book fields only).
 *
 * This is a client component only so the download buttons can be buttons;
 * every number/photo in the header arrives server-computed via props.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { downloadXLSX, type ExportColumn } from "@/lib/export/export-table";
import { getAllEmployeesExportRows, getTeamDirectoryPdf } from "./export-actions";

// Reused verbatim by the header's ⬇ Excel button — kept in this file so
// export-actions.ts stays server-only and column labels live beside the
// UI that names them.
export const EMPLOYEE_EXPORT_COLUMNS: ExportColumn<EmployeeExportRow>[] = [
  { key: "name", label: "Name", value: (r) => r.name },
  { key: "email", label: "Email (Login)", value: (r) => r.email },
  { key: "employeeCode", label: "Employee Code", value: (r) => r.employeeCode },
  { key: "designation", label: "Designation", value: (r) => r.designation },
  { key: "roleName", label: "Role", value: (r) => r.roleName },
  { key: "companyName", label: "Company", value: (r) => r.companyName },
  { key: "active", label: "Status", value: (r) => (r.active ? "Active" : "Inactive") },
  { key: "dateOfJoining", label: "Date of Joining", value: (r) => r.dateOfJoining },
  { key: "whatsappNo", label: "WhatsApp No.", value: (r) => r.whatsappNo },
  { key: "gender", label: "Gender", value: (r) => r.gender },
  { key: "maritalStatus", label: "Marital Status", value: (r) => r.maritalStatus },
  { key: "dob", label: "Date of Birth", value: (r) => r.dob },
  { key: "anniversaryDate", label: "Anniversary", value: (r) => r.anniversaryDate },
  { key: "family1", label: "Family Contact 1", value: (r) => r.family1 },
  { key: "family2", label: "Family Contact 2", value: (r) => r.family2 },
  { key: "panNumber", label: "PAN Number", value: (r) => r.panNumber },
  { key: "uanNumber", label: "UAN (PF)", value: (r) => r.uanNumber },
  { key: "pfNumber", label: "PF Account No.", value: (r) => r.pfNumber },
  { key: "esiNumber", label: "ESI Number", value: (r) => r.esiNumber },
  { key: "bankAccountHolderName", label: "Bank A/c Holder", value: (r) => r.bankAccountHolderName },
  { key: "bankAccountNo", label: "Bank Account No.", value: (r) => r.bankAccountNo },
  { key: "bankIfsc", label: "IFSC Code", value: (r) => r.bankIfsc },
  { key: "bankName", label: "Bank Name", value: (r) => r.bankName },
];

export type EmployeeExportRow = {
  name: string;
  email: string | null;
  employeeCode: string | null;
  designation: string | null;
  roleName: string;
  companyName: string;
  active: boolean;
  dateOfJoining: string | null;
  whatsappNo: string | null;
  gender: string | null;
  maritalStatus: string | null;
  dob: string | null;
  anniversaryDate: string | null;
  family1: string;
  family2: string;
  panNumber: string | null;
  uanNumber: string | null;
  pfNumber: string | null;
  esiNumber: string | null;
  bankAccountHolderName: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  bankName: string | null;
};

export function EmployeesHeader({
  total,
  activeCount,
  inactiveCount,
  photoUrls,
}: {
  total: number;
  activeCount: number;
  inactiveCount: number;
  photoUrls: (string | null)[];
}) {
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  function exportExcel() {
    setNotice(null);
    startTransition(async () => {
      try {
        const rows = await getAllEmployeesExportRows();
        const stamp = new Date().toISOString().slice(0, 10);
        await downloadXLSX(`all-employees-${stamp}`, "All Employees", EMPLOYEE_EXPORT_COLUMNS, rows);
        setNotice(`Downloaded ${rows.length} employee${rows.length === 1 ? "" : "s"}.`);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Export failed — please try again.");
      }
    });
  }

  /** Directory PDF arrives base64 through the authenticated action
      channel (no new public URL surface), then downloads as a blob. */
  function downloadDirectoryPdf() {
    setNotice(null);
    startTransition(async () => {
      try {
        const res = await getTeamDirectoryPdf();
        if (!res.ok || !res.base64 || !res.filename) {
          throw new Error(res.error ?? "Could not generate the PDF.");
        }
        const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = res.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setNotice("Directory PDF downloaded.");
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Could not generate the PDF — please try again.");
      }
    });
  }

  return (
    <div className="oms-card overflow-hidden rounded-2xl border shadow-sm">
      <div className="h-16 bg-[var(--oms-sidebar-bg)] md:h-20" />
      <div className="px-5 pb-5 md:px-6 md:pb-6">
        <div className="-mt-8 flex flex-wrap items-end justify-between gap-4 md:-mt-10">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-[var(--oms-text)] md:text-2xl">Employee Roster</h1>
            <p className="mt-0.5 text-sm text-[var(--oms-text-muted)]">
              {total} employee{total === 1 ? "" : "s"} · {activeCount} active
              {inactiveCount > 0 ? ` · ${inactiveCount} inactive` : ""}
            </p>
            {/* Photo strip — first few avatars as a quick visual roll-call. */}
            {photoUrls.length > 0 && (
              <div className="mt-2.5 flex items-center gap-1.5">
                {photoUrls.slice(0, 8).map((url, i) =>
                  url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- remote Storage URL, not a static asset
                    <img
                      key={i}
                      src={url}
                      alt=""
                      className="h-8 w-8 rounded-full border-2 border-[var(--oms-surface)] object-cover shadow-sm"
                    />
                  ) : (
                    <span
                      key={i}
                      className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--oms-surface)] bg-[var(--oms-accent)]/20 text-[10px] font-bold text-[var(--oms-text)] shadow-sm"
                    >
                      #{i + 1}
                    </span>
                  )
                )}
                {total > 8 && (
                  <span className="ml-1 rounded-full bg-[var(--oms-canvas)] px-2 py-0.5 text-[10px] font-semibold text-[var(--oms-text-muted)]">
                    +{total - 8} more
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ── Sabhi employee ka data ek sath download (user request) ── */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={exportExcel}
              disabled={isPending}
              className="rounded-lg border border-[var(--oms-surface-border)] px-3 py-2 text-xs font-medium text-[var(--oms-text)] transition hover:bg-[var(--oms-canvas)] disabled:opacity-60"
              title="Download every employee's full record (incl. statutory & bank) as an Excel workbook"
            >
              {isPending ? "Preparing workbook…" : "⬇ Export All (Excel)"}
            </button>
            <button
              type="button"
              onClick={downloadDirectoryPdf}
              disabled={isPending}
              className="rounded-lg border border-[var(--oms-surface-border)] px-3 py-2 text-xs font-medium text-[var(--oms-text)] transition hover:bg-[var(--oms-canvas)] disabled:opacity-60"
              title="Download a printable PDF directory of the whole team (contact fields only)"
            >
              📄 Directory PDF
            </button>
          </div>
        </div>

        {notice && <p className="mt-3 text-xs text-[var(--oms-text-muted)]">{notice}</p>}

        {/* Quick links — previously sat alone in a bare flex row. */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--oms-surface-border)] pt-4">
          <Link
            href="/dashboard/admin/employees/onboarding"
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
          >
            🧭 Onboarding
          </Link>
          <Link
            href="/dashboard/admin/employees/org-chart"
            className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-100"
          >
            🌳 Org Chart
          </Link>
          <Link
            href="/dashboard/admin/employees/settlements"
            className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            🧾 Full &amp; Final Settlement
          </Link>
          <Link
            href="/dashboard/team"
            className="rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-canvas)] px-3 py-1.5 text-xs font-medium text-[var(--oms-text)] hover:opacity-80"
          >
            📇 Team Directory (view-only)
          </Link>
        </div>
      </div>
    </div>
  );
}
