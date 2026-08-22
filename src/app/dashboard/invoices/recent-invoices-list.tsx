"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteInvoice } from "./actions";

type Invoice = {
  id: string;
  invoice_no: string;
  master_invoice_no: string;
  invoice_date: string;
  buyer_name_address: string;
  companyLabel: string;
  storeLabel: string;
  csb_type: string;
  courier_company: string;
};

// "galat invoice ban gaya... uska bhi delete chahiye" — same Delete action
// as the invoice detail page, surfaced right here too so a wrong/duplicate
// invoice can be removed without opening it first.
export function RecentInvoicesList({ invoices }: { invoices: Invoice[] }) {
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  function handleDelete(id: string, invoiceNo: string) {
    if (!window.confirm(`Delete invoice "${invoiceNo}"? Its orders will become available to invoice again. This cannot be undone.`)) return;
    setDeleteError((prev) => ({ ...prev, [id]: "" }));
    startTransition(async () => {
      const result = await deleteInvoice(id);
      if (result.error) setDeleteError((prev) => ({ ...prev, [id]: result.error! }));
      else setRemovedIds((prev) => new Set(prev).add(id));
    });
  }

  const visible = invoices.filter((inv) => !removedIds.has(inv.id));

  if (visible.length === 0) {
    return <p className="text-sm text-slate-400">No invoices have been created yet.</p>;
  }

  return (
    <div className="space-y-2">
      {visible.map((inv) => (
        <div key={inv.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm transition hover:border-amber-300">
          <Link href={`/dashboard/invoices/${inv.id}`} className="block">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-900">{inv.invoice_no}</span>
              <span className="text-xs text-slate-400">{inv.invoice_date}</span>
            </div>
            <p className="mt-1 truncate text-slate-500">{inv.buyer_name_address}</p>
            <p className="mt-1 text-xs text-slate-400">
              {inv.companyLabel} · {inv.storeLabel} · {inv.csb_type} · {inv.courier_company}
            </p>
            <p className="mt-1 text-xs text-slate-400">Master No.: {inv.master_invoice_no}</p>
          </Link>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
            <p className="text-xs text-red-600">{deleteError[inv.id]}</p>
            <div className="flex shrink-0 gap-2">
              {/* 2026-08-22 — "View"/"Download" made explicit and labelled:
                  the whole row already links to the invoice detail page
                  (which has the real editable form + the Print/Save-as-PDF
                  button), but that was only discoverable by clicking the
                  row itself. These two buttons point to the exact same
                  page — "Download" doesn't trigger print here, it just gets
                  the user to the page whose own PrintButton (see
                  invoice-view.tsx) is the actual download mechanism. */}
              <Link
                href={`/dashboard/invoices/${inv.id}`}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                View
              </Link>
              <Link
                href={`/dashboard/invoices/${inv.id}`}
                className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
              >
                Download
              </Link>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleDelete(inv.id, inv.invoice_no)}
                className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
