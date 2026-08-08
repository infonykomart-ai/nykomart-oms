"use client";

import { downloadCSVTemplate, type TemplateColumn } from "@/lib/export/export-table";

// 2026-08-08 (pending item 7) — reusable across every bulk-upload form
// (Bulk Order Entry, Bulk Tracking Update, ...): pass the same column
// list the server-side parser expects and this generates a matching
// ready-to-fill CSV, so uploads don't fail from a guessed/wrong header.
export function DownloadTemplateButton({
  filenameBase,
  columns,
}: {
  filenameBase: string;
  columns: TemplateColumn[];
}) {
  return (
    <button
      type="button"
      onClick={() => downloadCSVTemplate(filenameBase, columns)}
      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
    >
      ⬇️ Download CSV Template
    </button>
  );
}
