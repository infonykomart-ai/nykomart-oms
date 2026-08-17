"use client";

import { useState, useTransition, type ReactNode } from "react";
import { CreditNoteForm } from "./credit-note-form";
import { DebitNoteForm } from "./debit-note-form";
import { WashingEntryForm } from "./washing-entry-form";
import { InternalInvoiceForm } from "./internal-invoice-form";
import { PurchaseBillForm } from "./purchase-bill-form";
import { FreightBillSection, type FreightBillRow } from "./freight-bill-section";
import { DutyBillSection, type DutyBillRow } from "./duty-bill-section";
import { CourierBillPdfSection } from "./courier-bill-pdf-section";
import { CreditNoteEditForm, type EditableCreditNote } from "./credit-note-edit-form";
import { DebitNoteEditForm, type EditableDebitNote } from "./debit-note-edit-form";
import { WashingEntryEditForm, type EditableWashingEntry } from "./washing-entry-edit-form";
import { InternalInvoiceEditForm, type EditableInternalInvoice } from "./internal-invoice-edit-form";
import { PurchaseBillEditForm, type EditablePurchaseBill } from "./purchase-bill-edit-form";
import { PurchaseBillMultiForm } from "./purchase-bill-multi-form";
import { CsbFilingForm } from "./csb-filing-form";
import { CsbFilingEditForm, type EditableCsbFiling } from "./csb-filing-edit-form";
import { ShipmentHandoverChalanForm } from "./shipment-handover-chalan-form";
import Link from "next/link";
import {
  deleteCreditNote,
  deleteDebitNote,
  deleteWashingEntry,
  deleteInternalInvoice,
  deletePurchaseBill,
  deleteCsbFiling,
  deleteShipmentHandoverChalan,
  type SimpleResult,
} from "./actions";
import type { PartyOption } from "./party-options";
import { PrintArea, PrintButton } from "@/components/print-view";

type Company = { id: string; name: string };
type Party = PartyOption;
type Store = { id: string; name: string; company_id: string };
type Currency = { code: string; name: string };
type ShipmentChalanRow = {
  id: string;
  chalan_no: string | null;
  chalan_date: string;
  remark: string | null;
  courierName: string;
  lines: string[];
};

type Recent = {
  creditNotes: (EditableCreditNote & { companyName: string })[];
  debitNotes: (EditableDebitNote & { companyName: string })[];
  washingEntries: (EditableWashingEntry & { companyName: string; amount: number })[];
  internalInvoices: (EditableInternalInvoice & { fromCompanyName: string; toCompanyName: string; total_amount: number })[];
  purchaseBills: (EditablePurchaseBill & { vendorName: string; total_amount: number; g_total_plus_gst: number | null })[];
  freightBills: FreightBillRow[];
  dutyBills: DutyBillRow[];
  csbFilings: EditableCsbFiling[];
};

const TABS = [
  { key: "credit-note", label: "Credit Note" },
  { key: "debit-note", label: "Debit Note" },
  { key: "washing-entry", label: "Washing Entry" },
  { key: "internal-invoice", label: "Internal Invoice" },
  { key: "purchase-bill", label: "Purchase Bill" },
  { key: "courier-bill", label: "Courier Bill" },
  { key: "duty-tax-bill", label: "Duty & Tax Bill" },
  { key: "courier-bill-pdf", label: "Courier Bill (PDF Upload)" },
  { key: "csb-filing", label: "CSB Filing" },
  { key: "shipment-chalan", label: "Shipment Chalan" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// 2026-08-07: "edit modify deleat sabhi section me rahega" — same edit/
// delete pattern as the Orders hub, applied to each of the 4 Document Entry
// types. Doc numbers (cn_no/debit_note_no/chalan_no/invoice_no) are never
// editable; delete is blocked server-side (see actions.ts) when another
// table still references the row, with a plain-English reason surfaced
// right here instead of a raw DB error.
export function DocumentEntryTabs({
  companies,
  parties,
  stores,
  currencies,
  recent,
  shipmentChalans,
}: {
  companies: Company[];
  parties: Party[];
  stores: Store[];
  currencies: Currency[];
  recent: Recent;
  shipmentChalans: ShipmentChalanRow[];
}) {
  const [tab, setTab] = useState<TabKey>("credit-note");
  // 2026-08-12 (round 10): "JIS JIS PO RF RG NO KO SELECT KARE UNKE LIYE
  // JO PARTY INVOICE DALE VO SABHI ME UPDATE HO JAYE" — Purchase Bill now
  // has 2 modes: the original single-order form, and a new multi-order
  // picker for one vendor invoice covering several POs at once.
  const [pbMode, setPbMode] = useState<"single" | "multi">("single");

  const tabBar = (
    <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => setTab(t.key)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            tab === t.key ? "bg-amber-500 text-white" : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  // Courier Bill / Duty & Tax Bill are a different shape from the other 5
  // types — one bill header covers MANY AWBs/orders (see
  // freight-bill-section.tsx), so their create-form + list live together in
  // one full-width section instead of the usual "form on the left, recent
  // list on the right" split.
  if (tab === "courier-bill" || tab === "duty-tax-bill" || tab === "courier-bill-pdf") {
    return (
      <div>
        {tabBar}
        {tab === "courier-bill" && <FreightBillSection bills={recent.freightBills} companies={companies} parties={parties} />}
        {tab === "duty-tax-bill" && <DutyBillSection bills={recent.dutyBills} companies={companies} parties={parties} />}
        {tab === "courier-bill-pdf" && <CourierBillPdfSection />}
      </div>
    );
  }

  // Shipment Handover Chalan is the same "one header covers many orders"
  // shape as Courier Bill / Duty & Tax Bill above, so it gets the same
  // full-width form+list layout instead of the usual 2-column split.
  if (tab === "shipment-chalan") {
    return (
      <div>
        {tabBar}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <ShipmentHandoverChalanForm parties={parties} />
          </div>
          <ShipmentChalanList rows={shipmentChalans} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        {tabBar}

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          {tab === "credit-note" && <CreditNoteForm companies={companies} stores={stores} />}
          {tab === "debit-note" && <DebitNoteForm companies={companies} parties={parties} />}
          {tab === "washing-entry" && <WashingEntryForm companies={companies} parties={parties} stores={stores} />}
          {tab === "internal-invoice" && <InternalInvoiceForm companies={companies} />}
          {tab === "purchase-bill" && (
            <div>
              <div className="mb-3 flex gap-2 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setPbMode("single")}
                  className={`rounded-full px-3 py-1 ${pbMode === "single" ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  Single Order
                </button>
                <button
                  type="button"
                  onClick={() => setPbMode("multi")}
                  className={`rounded-full px-3 py-1 ${pbMode === "multi" ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  Multiple Orders, One Invoice
                </button>
              </div>
              {pbMode === "single" ? <PurchaseBillForm parties={parties} /> : <PurchaseBillMultiForm parties={parties} />}
            </div>
          )}
          {tab === "csb-filing" && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  Customs CSB-V filing confirmation — enter one row per filed shipping bill (matches the courier&apos;s
                  filing PDF).
                </p>
                <Link href="/dashboard/documents/bulk-upload" className="shrink-0 text-xs font-medium text-amber-600 hover:underline">
                  📤 Bulk upload xlsx →
                </Link>
              </div>
              <CsbFilingForm currencies={currencies} />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {/* 2026-08-12 (round 10): "JITNI FILE BAN RAHI HAI SABKI PDF FILE
            UNKE SAME DOWNLOAD KARNE KA OPTION HONA CHAHIYE" — Credit Note /
            Debit Note / Washing Entry / Internal Invoice / Purchase Bill
            don't have individual detail pages (only this list), so "PDF
            download" here means the same window.print() pattern applied
            to the whole recent-documents list, same as Orders' and Ad
            Spend's own list-print buttons. Courier Bill / Duty & Tax Bill
            get their own dedicated printable report page instead (see
            freight-bill-section.tsx / duty-bill-section.tsx's "Report /
            PDF" link) since those need the invoice+AWB-table layout, not
            a flat list. */}
        <div className="flex justify-end print:hidden">
          <PrintButton label="🖨 Print / Download this list" />
        </div>
        <PrintArea id="doc-lists-print-area">
        <DocList
          title="Recent Credit Notes"
          rows={recent.creditNotes.map((r) => ({
            id: r.id,
            no: r.cn_no ?? "—",
            date: r.credit_note_date,
            sub: `${r.companyName} · ${r.buyer_name ?? ""}`,
            amount: `₹${r.refund_amount}`,
            record: r,
          }))}
          onDelete={deleteCreditNote}
          renderEdit={(r, onDone) => (
            <CreditNoteEditForm note={r} stores={stores.filter((s) => s.company_id === r.company_id)} onDone={onDone} />
          )}
        />
        <DocList
          title="Recent Debit Notes"
          rows={recent.debitNotes.map((r) => ({
            id: r.id,
            no: r.debit_note_no ?? "—",
            date: r.debit_note_date,
            sub: `${r.companyName} · ${r.particulars ?? ""}`,
            amount: `₹${r.debit_amount}`,
            record: r,
          }))}
          onDelete={deleteDebitNote}
          renderEdit={(r, onDone) => <DebitNoteEditForm note={r} parties={parties} onDone={onDone} />}
        />
        <DocList
          title="Recent Washing Entries"
          rows={recent.washingEntries.map((r) => ({
            id: r.id,
            no: r.chalan_no ?? "—",
            date: r.chalan_date,
            sub: r.companyName,
            amount: `₹${r.amount}`,
            record: r,
          }))}
          onDelete={deleteWashingEntry}
          renderEdit={(r, onDone) => (
            <WashingEntryEditForm entry={r} parties={parties} stores={stores.filter((s) => s.company_id === r.company_id)} onDone={onDone} />
          )}
        />
        <DocList
          title="Recent Internal Invoices"
          rows={recent.internalInvoices.map((r) => ({
            id: r.id,
            no: r.invoice_no ?? "—",
            date: r.invoice_date,
            sub: `${r.fromCompanyName} → ${r.toCompanyName}`,
            amount: `₹${r.total_amount}`,
            record: r,
          }))}
          onDelete={deleteInternalInvoice}
          renderEdit={(r, onDone) => <InternalInvoiceEditForm invoice={r} onDone={onDone} />}
        />
        <DocList
          title="Recent Purchase Bills"
          rows={recent.purchaseBills.map((r) => ({
            id: r.id,
            no: r.vendor_invoice_no ?? "—",
            date: r.vendor_invoice_date ?? "—",
            sub: r.vendorName,
            amount:
              r.gst_rate_pct != null && r.g_total_plus_gst != null
                ? `₹${r.total_amount} + GST (${r.gst_type === "IGST" ? "IGST" : "CGST+SGST"} ${r.gst_rate_pct * 2}%) = ₹${r.g_total_plus_gst}`
                : `₹${r.total_amount}`,
            record: r,
          }))}
          onDelete={deletePurchaseBill}
          renderEdit={(r, onDone) => <PurchaseBillEditForm bill={r} parties={parties} onDone={onDone} />}
        />
        <DocList
          title="Recent CSB Filings"
          rows={recent.csbFilings.map((r) => ({
            id: r.id,
            no: r.csb_number,
            date: r.filing_date ?? "—",
            sub: `HAWB ${r.hawb_number ?? "—"} · Inv ${r.invoice_no ?? "—"}`,
            amount: r.fob_value_inr != null ? `₹${r.fob_value_inr}` : "—",
            record: r,
          }))}
          onDelete={deleteCsbFiling}
          renderEdit={(r, onDone) => <CsbFilingEditForm filing={r} currencies={currencies} onDone={onDone} />}
        />
        </PrintArea>
      </div>
    </div>
  );
}

function ShipmentChalanList({ rows }: { rows: ShipmentChalanRow[] }) {
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  function handleDelete(id: string, label: string) {
    if (!window.confirm(`Delete Chalan "${label}"? This cannot be undone.`)) return;
    setDeleteError((prev) => ({ ...prev, [id]: "" }));
    startTransition(async () => {
      const result = await deleteShipmentHandoverChalan(id);
      if (result.error) setDeleteError((prev) => ({ ...prev, [id]: result.error! }));
    });
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent Shipment Handover Chalans</h2>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-slate-900">{r.chalan_no ?? "—"} <span className="font-normal text-slate-400">· {r.courierName}</span></div>
                <div className="text-slate-400">{r.lines.length} shipment(s): {r.lines.join(", ") || "—"}</div>
              </div>
              <div className="text-right text-slate-400">{r.chalan_date}</div>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
              <p className="text-red-600">{deleteError[r.id]}</p>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleDelete(r.id, r.chalan_no ?? r.id)}
                className="rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs text-slate-400">None created yet.</p>}
      </div>
    </div>
  );
}

function DocList<T extends { id: string }>({
  title,
  rows,
  renderEdit,
  onDelete,
}: {
  title: string;
  rows: { id: string; no: string; date: string; sub: string; amount: string; record: T }[];
  renderEdit: (record: T, onDone: () => void) => ReactNode;
  onDelete: (id: string) => Promise<SimpleResult>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  function handleDelete(id: string, label: string) {
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
    setDeleteError((prev) => ({ ...prev, [id]: "" }));
    startTransition(async () => {
      const result = await onDelete(id);
      if (result.error) setDeleteError((prev) => ({ ...prev, [id]: result.error! }));
    });
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">{title}</h2>
      <div className="space-y-1.5">
        {rows.map((r) =>
          editingId === r.id ? (
            <div key={r.id}>{renderEdit(r.record, () => setEditingId(null))}</div>
          ) : (
            <div key={r.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-900">{r.no}</div>
                  <div className="text-slate-400">{r.sub}</div>
                </div>
                <div className="text-right">
                  <div className="text-slate-700">{r.amount}</div>
                  <div className="text-slate-400">{r.date}</div>
                </div>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
                <p className="text-red-600">{deleteError[r.id]}</p>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditingId(r.id)}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleDelete(r.id, r.no)}
                    className="rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )
        )}
        {rows.length === 0 && <p className="text-xs text-slate-400">None created yet.</p>}
      </div>
    </div>
  );
}
