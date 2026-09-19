"use client";

// 2026-09-19 — the generic "A4 dialog box" for the 4 Doc Statement types
// (Credit Note / CSB Filing / Refund / Order Refund). Mirrors
// bill-statement-dialog.tsx's Sheet shell exactly (fixed overlay, max-w-4xl,
// Esc to close, sticky header/actions, scrollable document) — ONE Sheet
// implementation parameterized by `type` instead of 4 separate dialogs, per
// "bs duplicate nahi ho stracture dekh lena". Fetches through
// /api/doc-statement/[type]/[id], which re-runs the SAME access-checked
// loader server-side (loadDocStatement) — a document outside the caller's
// access returns 403/404 and the sheet shows exactly that error.
import { useCallback, useEffect, useRef, useState } from "react";
import { DocStatementActions } from "./doc-statement-actions";
import { DocStatementDocument } from "./doc-statement-document";
import type { DocStatementData, DocType } from "@/lib/doc-statement";

const KIND_LABEL: Record<DocType, string> = {
  credit_note: "Credit Note",
  csb_filing: "CSB Filing",
  refund: "Refund",
  order_refund: "Order Refund",
};

export function DocStatementDialog({
  type,
  id,
  label,
  autoOpen = false,
  onClose,
}: {
  type: DocType;
  id: string;
  // The clickable trigger text — usually the document's own number.
  label?: string | null;
  // Post-action auto-open, same convention as BillStatementDialog: the
  // parent renders this only while its own "just saved" state is set and
  // clears it via onClose.
  autoOpen?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DocStatementData | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  const openSheet = useCallback(async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/doc-statement/${type}/${id}`);
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Could not load this document.");
      } else {
        setData(body.data);
      }
    } catch {
      setError("Could not load this document.");
    } finally {
      setLoading(false);
    }
  }, [type, id]);

  const startedRef = useRef(false);
  useEffect(() => {
    if (autoOpen && !startedRef.current) {
      startedRef.current = true;
      void openSheet();
    }
  }, [autoOpen, openSheet]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!autoOpen) {
    const trigger =
      label != null && label !== "" ? (
        <span className="underline decoration-amber-400 decoration-2 underline-offset-2 hover:text-amber-700">{label}</span>
      ) : (
        <span className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50">📄 View</span>
      );
    return (
      <button
        type="button"
        onClick={openSheet}
        className="text-left"
        title={`Open read-only ${KIND_LABEL[type]} statement (print / WhatsApp / Telegram / email / PDF)`}
      >
        {trigger}
      </button>
    );
  }

  return <Sheet type={type} open={open} close={close} loading={loading} error={error} data={data} />;
}

function Sheet({
  type,
  open,
  close,
  loading,
  error,
  data,
}: {
  type: DocType;
  open: boolean;
  close: () => void;
  loading: boolean;
  error: string | null;
  data: DocStatementData | null;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-2 md:p-6" onClick={close}>
      <div
        className="flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl print:max-w-none print:rounded-none print:shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 print:hidden">
          <div className="text-sm font-semibold text-slate-800">
            {KIND_LABEL[type]} — {data?.invoiceRef ?? "…"}
            {data?.party?.name ? <span className="ml-2 text-xs font-normal text-slate-500">{data.party.name}</span> : null}
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            ✕ Close
          </button>
        </div>
        <div className="shrink-0 space-y-2 px-4 py-2 print:hidden">
          {loading && <p className="text-xs text-slate-500">Loading…</p>}
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error} — this statement only opens for documents in companies you can access.
            </p>
          )}
          {data && <DocStatementActions data={data} />}
        </div>
        <div className="flex-1 overflow-y-auto print:overflow-visible">
          {data && <DocStatementDocument data={data} />}
        </div>
      </div>
    </div>
  );
}
