"use client";

// 2026-09-11 (Payroll Phase 3) — "Documents" panel toggled from
// EmployeeRowActions, same inline pattern as the existing Edit Details /
// Store Access panels. Upload goes through uploadEmployeeDocument
// (service-role, writes to the PRIVATE employee-documents bucket); every
// download/view goes through the gated /api/employee-document/[id] proxy
// route, never a direct Storage URL.
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { uploadEmployeeDocument, deleteEmployeeDocument, type DocumentActionState } from "./actions";

const initialState: DocumentActionState = { error: null, success: false };
const inputClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

export type EmployeeDocumentRow = {
  id: string;
  doc_type: string;
  file_name: string;
  file_size: number | null;
  notes: string | null;
  uploaded_at: string;
};

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EmployeeDocumentsPanel({
  employeeId,
  documents,
  onDone,
}: {
  employeeId: string;
  documents: EmployeeDocumentRow[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(uploadEmployeeDocument, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [deletePending, startDeleteTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">📁 Documents</p>
        <button type="button" onClick={onDone} className="text-xs text-slate-500 hover:underline">
          Close
        </button>
      </div>

      <ul className="space-y-1.5">
        {documents.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
            <div className="min-w-0">
              <a
                href={`/api/employee-document/${d.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-blue-600 underline"
              >
                {d.doc_type}
              </a>
              <div className="truncate text-slate-400">
                {d.file_name} {formatBytes(d.file_size) && `· ${formatBytes(d.file_size)}`} · {d.uploaded_at.slice(0, 10)}
              </div>
              {d.notes && <div className="mt-0.5 text-slate-500">{d.notes}</div>}
            </div>
            <button
              type="button"
              disabled={deletePending}
              onClick={() => {
                setDeletingId(d.id);
                startDeleteTransition(async () => {
                  await deleteEmployeeDocument(d.id);
                });
              }}
              className="shrink-0 text-red-600 hover:underline disabled:opacity-50"
            >
              {deletePending && deletingId === d.id ? "Removing..." : "Remove"}
            </button>
          </li>
        ))}
        {documents.length === 0 && <li className="py-2 text-center text-xs text-slate-400">No documents uploaded yet.</li>}
      </ul>

      <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3">
        <input type="hidden" name="employee_id" value={employeeId} />
        {state.error && <p className="w-full rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
        {state.success && state.message && <p className="w-full rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">{state.message}</p>}
        <div>
          <label className="mb-1 block text-xs text-slate-500">Document Type *</label>
          <input name="doc_type" required placeholder="e.g. Aadhaar Card" className={`${inputClass} w-40`} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">File *</label>
          <input type="file" name="file" required className={inputClass} />
        </div>
        <div className="min-w-[8rem] flex-1">
          <label className="mb-1 block text-xs text-slate-500">Notes</label>
          <input name="notes" placeholder="optional" className={`${inputClass} w-full`} />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {pending ? "Uploading..." : "Upload"}
        </button>
      </form>
      <p className="text-[11px] text-slate-400">
        Stored privately — only visible to Employees admins, never a public link. Max 15MB per file.
      </p>
    </div>
  );
}
