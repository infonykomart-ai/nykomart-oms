"use client";

// 2026-09-15 — "dilogbox me hi open ho usi me aaye puri report, dure page
// par nahi lekar jaye" + "jese hi kisi vender ka payment ki entry ho jaye
// to dilogbox open ho jaye ki send to whatsaap email, print, save as pdf"
// — the bill statement SHEET, reused everywhere a bill number shows
// (Bill Payment rows, Documents' Purchase/Courier/Duty lists, the Party
// Ledger's invoice cells) and auto-opened right after a payment is
// recorded (autoOpen + onClose props). The fetch goes through
// /api/bill-statement/[billId], which re-runs the SAME access-checked
// loader (loadBillStatement) — a bill outside the caller's companies
// returns 403 and the sheet shows exactly that error instead of the
// statement. Inside: the full read-only document + the action bar (Print,
// WhatsApp + PDF, Telegram + PDF, Email + PDF, Save PDF, Copy). The PDF
// buttons share the REAL A4-portrait file (company logo) — see
// src/lib/bill-statement-pdf.tsx. window.print() prints ONLY the sheet's
// document (PrintArea's @media print CSS hides everything else; the sheet
// wrapper gets print:static so print-view.tsx's ancestor-clipping fix
// applies to this fixed-position sheet too).

import { useCallback, useEffect, useRef, useState } from "react";
import { BillStatementActions } from "./bill-statement-actions";
import { BillStatementDocument } from "./bill-statement-document";
import type { BillStatementData } from "@/lib/bill-statement";

export function BillStatementDialog({
  billId,
  label,
  autoOpen = false,
  onClose,
}: {
  billId: string;
  // The clickable trigger text — usually the invoice/document number.
  label?: string;
  // When true the sheet opens on mount WITHOUT any trigger button (the
  // post-payment auto-open case — the parent renders this only while
  // `statementForBill` is set and calls onClose to clear it).
  autoOpen?: boolean;
  // Called when the sheet closes — the parent clears its
  // auto-open state here. Required when autoOpen is set.
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BillStatementData | null>(null);

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
      const res = await fetch(`/api/bill-statement/${billId}`);
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Could not load this bill statement.");
      } else {
        setData(body.data);
      }
    } catch {
      setError("Could not load this bill statement.");
    } finally {
      setLoading(false);
    }
  }, [billId]);

  // Auto-open (post-payment share dialog): fetch directly on mount when
  // autoOpen is set — no trigger button; the parent renders this only
  // while `statementForBill` is set and clears it via onClose.
  const startedRef = useRef(false);
  useEffect(() => {
    if (autoOpen && !startedRef.current) {
      startedRef.current = true;
      void openSheet();
    }
  }, [autoOpen, openSheet]);

  // Esc closes the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Controlled variant: no trigger — the parent mounts this only while it
  // wants the sheet open.
  if (!autoOpen) {
    const trigger =
      label != null && label !== "" ? (
        <span className="underline decoration-amber-400 decoration-2 underline-offset-2 hover:text-amber-700">{label}</span>
      ) : (
        <span className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50">📄 View</span>
      );
    return (
      <button type="button" onClick={openSheet} className="text-left" title="Open read-only bill statement (print / WhatsApp / Telegram / email / PDF)">
        {trigger}
      </button>
    );
  }

  return <Sheet open={open} close={close} loading={loading} error={error} data={data} />;
}

// The sheet itself, shared by both the triggered and auto-open variants.
function Sheet({
  open,
  close,
  loading,
  error,
  data,
}: {
  open: boolean;
  close: () => void;
  loading: boolean;
  error: string | null;
  data: BillStatementData | null;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-2 md:p-6" onClick={close}>
      <div
        className="flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl print:max-w-none print:rounded-none print:shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sheet header — sticky action bar, close button hidden in print. */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 print:hidden">
          <div className="text-sm font-semibold text-slate-800">
            Bill Statement — {data?.invoiceRef ?? "…"}
            {data ? <span className="ml-2 text-xs font-normal text-slate-500">{data.party.name}</span> : null}
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
          {loading && <p className="text-xs text-slate-500">Loading statement…</p>}
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error} — this statement only opens for bills in companies you can access.
            </p>
          )}
          {data && <BillStatementActions data={data} />}
        </div>
        <div className="flex-1 overflow-y-auto print:overflow-visible">
          {data && <BillStatementDocument data={data} />}
        </div>
      </div>
    </div>
  );
}
