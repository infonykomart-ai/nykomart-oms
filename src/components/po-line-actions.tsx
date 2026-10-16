"use client";

// 2026-10-13 — "EDIT DELET MODIFY PER ENTRY OPETION NAHI HAI" — per-entry
// Edit/Delete for the Purchase Bill line items shown inside the bill
// statement A4 dialog (Bill Payment's invoice no. link). A multi-item /
// multi-PO Purchase Bill is several purchase_bills rows on one vendor
// invoice (see src/lib/bill-grouping.ts); the statement now lists every
// entry and this lets the user fix or remove a single one without leaving
// the dialog or hunting through the Documents tab.
//
// Delete reuses documents/actions.deletePurchaseBill (which already blocks
// when payments exist and cleans up the mirrored bill_pass_register row).
// Edit reuses the existing PurchaseBillEditForm (already handles unit
// conversion, GST, round-off, and the bill_pass_register sync-back), so
// behaviour is identical to editing from the Documents tab — no duplicated
// save logic here. After either action we fire a DOM event the dialog
// listens on to refetch the statement, keeping the sheet in sync.
import { useState } from "react";
import { deletePurchaseBill, type SimpleResult } from "@/app/dashboard/documents/actions";
import { PurchaseBillEditForm, type EditablePurchaseBill } from "@/app/dashboard/documents/purchase-bill-edit-form";
import { A4Dialog } from "@/components/a4-dialog";
import type { BillStatementPoLine } from "@/lib/bill-statement";

export function PoLineActions({
  line,
  vendorPartyId,
  vendorPartyName,
  vendorInvoiceNo,
  onChanged,
}: {
  line: BillStatementPoLine;
  /** The invoice's vendor (a purchase bill has exactly one) — pre-fills the edit form's party select. */
  vendorPartyId: string;
  vendorPartyName: string;
  /** Invoice-level vendor invoice no (edit form requires it). */
  vendorInvoiceNo: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function handleDelete() {
    if (!window.confirm(`Delete this entry (₹${line.amount.toFixed(2)}) from the invoice? This cannot be undone.`)) return;
    setPending(true);
    setErr(null);
    void deletePurchaseBill(line.purchaseBillId).then((r: SimpleResult) => {
      setPending(false);
      if (r.error) setErr(r.error);
      else onChanged();
    });
  }

  // Build the shape PurchaseBillEditForm expects. Falls back to values
  // carried on the line (vendor identity) so the form is pre-filled even
  // though the statement line is a flattened read-model.
  const bill: EditablePurchaseBill = {
    id: line.purchaseBillId,
    vendor_party_id: vendorPartyId,
    vendor_invoice_no: vendorInvoiceNo,
    vendor_invoice_date: null,
    qty: line.qty,
    sq_feet: line.size,
    qty_unit: line.unit,
    work_description: line.description,
    unit_rate: line.rate,
    gst_rate_pct: line.gstRatePct,
    gst_type: line.gstType,
    round_off_amt: 0,
  };

  return (
    <div className="flex items-center justify-end gap-1">
      {err && <span className="text-[10px] text-red-600">{err}</span>}
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={pending}
        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        ✏️ Edit
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
      >
        {pending ? "…" : "🗑 Delete"}
      </button>
      {editing && (
        <A4Dialog open onClose={() => setEditing(false)} title={`Edit entry — ${line.description ?? line.refNo ?? "item"}`} subtitle="Edit the fields and press Save.">
          {/* 2026-10-15 — PurchaseBillEditForm's party select needs the
              full PartyOption shape (it groups by invoice_type /
              party_type); the statement line only carries the vendor's id
              + name, so the grouping fields go through as null — the
              select still shows this one party. */}
          <PurchaseBillEditForm
            bill={bill}
            parties={[
              { id: vendorPartyId, name: vendorPartyName, invoice_type: null, party_type: null },
            ]}
            onDone={() => { setEditing(false); onChanged(); }}
          />
        </A4Dialog>
      )}
    </div>
  );
}
