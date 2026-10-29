"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
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
import { PurchaseBillMultiItemsForm } from "./purchase-bill-multi-items-form";
import { CsbFilingForm } from "./csb-filing-form";
import { CsbFilingEditForm, type EditableCsbFiling } from "./csb-filing-edit-form";
import { ShipmentHandoverChalanForm } from "./shipment-handover-chalan-form";
import { JournalVoucherForm } from "./journal-voucher-form";
import { JournalVoucherEditForm, type EditableJournalVoucher } from "./journal-voucher-edit-form";
import { ReceivedChalanForm } from "./received-chalan-form";
import Link from "next/link";
import {
  deleteCreditNote,
  deleteDebitNote,
  deleteWashingEntry,
  deleteInternalInvoice,
  deletePurchaseBill,
  deleteCsbFiling,
  deleteShipmentHandoverChalan,
  deleteJournalVoucher,
  deleteReceivedChalan,
  getPurchaseBillHistory,
  type PurchaseBillHistoryEntry,
  type SimpleResult,
  type RelatedNote,
} from "./actions";
import type { PartyOption } from "./party-options";
import { PrintArea, PrintButton } from "@/components/print-view";
// 2026-10-20 repair — restored: the 2026-10-20 upload of this file was built
// from a checkout that predated PrintDialog (src/components/print-dialog.tsx),
// so importing/using it silently disappeared from the repo. See CHANGES.txt.
import { PrintDialog } from "@/components/print-dialog";
import {
  DocEntryA4,
  creditNoteDoc,
  debitNoteDoc,
  washingEntryDoc,
  internalInvoiceDoc,
  purchaseBillInvoiceDoc,
  csbFilingDoc,
} from "./doc-entry-a4";
import { RelatedNotesBadge } from "./related-notes-badge";
import { BillStatementDialog } from "@/components/bill-statement-dialog";
import { A4Dialog } from "@/components/a4-dialog";
import { DocStatementDialog } from "@/components/doc-statement-dialog";
import type { DocType } from "@/lib/doc-statement";
import type { PurchaseBillInvoiceGroup } from "@/lib/bill-grouping";
import { formatAuditStamp, purchaseBillAmountLabel, purchaseHasGst } from "@/lib/purchase-bill-money";
import { PurchaseFinanceBox } from "./finance-post-box";

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

// 2026-10-20 — one Purchase Bill ITEM row, as the grouped invoice list
// receives it: the editable fields plus its own computed money, its audit
// timestamps and its Finance link.
type PurchaseBillItem = EditablePurchaseBill & {
  company_id: string | null;
  vendorName: string;
  created_at: string;
  updated_at: string;
  // 2026-10-21 — "kisne entry ki": denormalised name of the entering
  // employee (db/2026-10-21-purchase-bill-entered-by.sql). null on bills
  // entered before that round — shown as "not tracked", never guessed.
  entered_by_name: string | null;
  total_amount: number;
  g_total_plus_gst: number | null;
  related_notes: RelatedNote[];
  finance_bpr_id: string | null;
};

// 2026-10-20 — "ek invoice me agar 10 entry hai to vaha par single entry
// aaye": ONE card per vendor invoice, expandable to the item rows that make
// it up (grouping built in page.tsx via lib/bill-grouping.ts's
// groupPurchaseBillInvoices — storage stays one row per item).
type PurchaseBillInvoiceRow = PurchaseBillInvoiceGroup<PurchaseBillItem> & {
  vendorName: string;
  // 2026-10-28 — used by the per-invoice "Debit Note" shortcut: a second bill
  // on the same PO can be adjusted with a debit note raised against THIS
  // invoice, so the note form needs the bill's company, party and Finance row.
  companyId: string | null;
  vendorPartyId: string;
  /** Who entered the invoice (first stamped item) — null on legacy bills. */
  enteredByName: string | null;
  taxableTotal: number;
  grandTotal: number;
  finance_bpr_id: string | null;
  /** 2026-10-29 — the company that actually holds this invoice in the Finance ledger. */
  financeCompanyId: string | null;
  notes: RelatedNote[];
};

type Recent = {
  creditNotes: (EditableCreditNote & { companyName: string })[];
  debitNotes: (EditableDebitNote & { companyName: string })[];
  washingEntries: (EditableWashingEntry & { companyName: string; amount: number })[];
  internalInvoices: (EditableInternalInvoice & { fromCompanyName: string; toCompanyName: string; total_amount: number })[];
  // company_id added 2026-10-16 — the new A4 View sheet shows which
  // company the bill belongs to (page.tsx already spreads it through from
  // the select, it just wasn't in this intersection type). Typed `string |
  // null` because that's how database.ts types the column — the sheet
  // falls back to a plain "PURCHASE BILL" header with no company line
  // rather than assuming the column can't be null.
  purchaseBillInvoices: PurchaseBillInvoiceRow[];
  // 2026-10-20 — "kab entry ki gyi date & time ke sath agar update hui ho
  // baad me to vo bhi show hona chahiye admin ko": entry/updated stamps are
  // rendered only when page.tsx says the viewer holds permissions_admin.
  canSeeAudit: boolean;
  freightBills: FreightBillRow[];
  dutyBills: DutyBillRow[];
  csbFilings: EditableCsbFiling[];
  journalVouchers: (EditableJournalVoucher & { vendorName: string })[];
  receivedChalans: ReceivedChalanRow[];
};

// 2026-08-29 (evening, follow-up round) — create+delete only, no edit form
// (matches Material OUT Chalan's own established shape, see stock module).
type ReceivedChalanRow = {
  id: string;
  chalan_no: string | null;
  chalan_date: string;
  source: string | null;
  remark: string | null;
  partyName: string;
  orderRefNo: string | null;
  items: { description: string; qty: number; qty_unit: string }[];
};

const TABS = [
  { key: "credit-note", label: "Credit Note" },
  { key: "debit-note", label: "Debit Note" },
  { key: "washing-entry", label: "Washing Entry" },
  { key: "internal-invoice", label: "Internal Invoice" },
  { key: "purchase-bill", label: "Purchase Bill" },
  // 2026-10-24b — "COTTON KI DHURRI KE PO KE ORDER KA PRINTING KA BILL AATA
  // HAI ... USKA TO KOI SECTION HI NAHI HAI": printing job work had a register
  // but no entry screen. Same shape as a Purchase Bill (PO link, qty × rate,
  // GST, round off), saved with bill_kind = 'printing' and posted to the
  // ledger's Printing bucket.
  { key: "printing-bill", label: "Printing Bill" },
  { key: "courier-bill", label: "Courier Bill" },
  { key: "duty-tax-bill", label: "Duty & Tax Bill" },
  { key: "courier-bill-pdf", label: "Courier Bill (PDF Upload)" },
  { key: "csb-filing", label: "CSB Filing" },
  { key: "shipment-chalan", label: "Shipment Chalan" },
  { key: "journal-voucher", label: "Journal Voucher" },
  { key: "received-chalan", label: "Received Chalan" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// 2026-08-22 — one {vendor, from, to} bundle per filtered list (Purchase
// Bill / Courier (Freight) Bill / Duty & Tax Bill), threaded down from
// page.tsx's searchParams so each filter form's <input>/<select> can show
// its current value (`defaultValue`) after a GET-form submit round-trips
// through the server.
type BillFilter = { vendor: string; from: string; to: string };
type BillFilters = { purchaseBill: BillFilter; freightBill: BillFilter; dutyBill: BillFilter };

function isTabKey(v: string): v is TabKey {
  return TABS.some((t) => t.key === v);
}

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
  initialTab,
  billFilters,
  washingEntriesTotal,
  debitNoteDefaults,
}: {
  companies: Company[];
  parties: Party[];
  stores: Store[];
  currencies: Currency[];
  recent: Recent;
  shipmentChalans: ShipmentChalanRow[];
  // 2026-08-22: this tab switcher is client-only useState, not URL-driven —
  // `initialTab` (read from ?tab= by page.tsx) is what lets the Purchase
  // Bill / Courier Bill / Duty & Tax Bill filter forms below submit a plain
  // GET (full navigation) and land back on the same tab instead of
  // resetting to Credit Note.
  initialTab: string;
  billFilters: BillFilters;
  /**
   * 2026-10-28 — prefill for the Debit Note tab when it is opened from a
   * Purchase Bill's "Debit Note" shortcut (?dn_party=…&dn_bill=…). Same
   * GET-params pattern the bill filters already use.
   */
  debitNoteDefaults?: {
    companyId?: string;
    partyId?: string;
    billId?: string;
    invoiceNo?: string;
  };
  // 2026-09-17 (evening) — full-history {count, amount} for Washing
  // Entries (the "Recent" list below is capped to 8/most recent) — see
  // page.tsx's own comment on why this needed a separate unlimited query.
  washingEntriesTotal?: { count: number; amount: number };
}) {
  const [tab, setTab] = useState<TabKey>(isTabKey(initialTab) ? initialTab : "credit-note");
  // 2026-08-12 (round 10): "JIS JIS PO RF RG NO KO SELECT KARE UNKE LIYE
  // JO PARTY INVOICE DALE VO SABHI ME UPDATE HO JAYE" — Purchase Bill now
  // has 2 modes: the original single-order form, and a new multi-order
  // picker for one vendor invoice covering several POs at once.
  const [pbMode, setPbMode] = useState<"single" | "multi" | "multi-items">("single");

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
        {tab === "courier-bill" && (
          <FreightBillSection bills={recent.freightBills} companies={companies} parties={parties} filter={billFilters.freightBill} />
        )}
        {tab === "duty-tax-bill" && (
          <DutyBillSection bills={recent.dutyBills} companies={companies} parties={parties} filter={billFilters.dutyBill} />
        )}
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
          {tab === "credit-note" && <CreditNoteForm companies={companies} stores={stores} parties={parties} />}
          {tab === "debit-note" && (
            <DebitNoteForm companies={companies} parties={parties} defaults={debitNoteDefaults} />
          )}
          {tab === "washing-entry" && <WashingEntryForm companies={companies} parties={parties} stores={stores} />}
          {tab === "internal-invoice" && <InternalInvoiceForm companies={companies} />}
          {tab === "printing-bill" && (
            <div>
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Printing job-work bill against a PO (cotton dhurri / rug printing etc.). Saves as a <strong>Printing</strong> bill — it
                appears in the Printing register and posts to the Finance ledger&apos;s Printing bucket, not the Purchase one.
              </p>
              <PurchaseBillForm parties={parties} billKind="printing" />
            </div>
          )}
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
                <button
                  type="button"
                  onClick={() => setPbMode("multi-items")}
                  className={`rounded-full px-3 py-1 ${pbMode === "multi-items" ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  Multiple Items, One Invoice
                </button>
              </div>
              {pbMode === "single" && <PurchaseBillForm parties={parties} />}
              {pbMode === "multi" && <PurchaseBillMultiForm parties={parties} />}
              {pbMode === "multi-items" && <PurchaseBillMultiItemsForm parties={parties} />}
            </div>
          )}
          {tab === "csb-filing" && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  Customs CSB-V filing confirmation — enter one row per filed shipping bill (matches the courier&apos;s
                  filing PDF).
                </p>
                <div className="flex shrink-0 items-center gap-3">
                  {/* 2026-10-28 — filing-date range + column picker + order
                      details wali poori report (Reports hub me bhi hai). */}
                  <Link href="/dashboard/reports/csb-filings" className="text-xs font-medium text-slate-600 hover:underline">
                    📊 Report
                  </Link>
                  <Link href="/dashboard/documents/bulk-upload" className="text-xs font-medium text-amber-600 hover:underline">
                    📤 Bulk upload xlsx →
                  </Link>
                </div>
              </div>
              <CsbFilingForm currencies={currencies} />
            </div>
          )}
          {tab === "journal-voucher" && (
            <div>
              <p className="mb-3 text-xs text-slate-400">
                Most Journal Vouchers auto-generate the moment a Purchase/Courier/Duty Bill is sent to the Finance ledger — this
                form is for a manual one, optionally linked to an existing bill.
              </p>
              <JournalVoucherForm companies={companies} parties={parties} />
            </div>
          )}
          {tab === "received-chalan" && (
            <div>
              <p className="mb-3 text-xs text-slate-400">
                Proof of goods received from the party — every Purchase Bill auto-generates one of these too. Use
                this form for job-work returns (printing/washing coming back) that have no Purchase Bill of their own.
                Order/PO is optional here — a Delivery Chalan (Stock → Material OUT Chalan tab) needs one, this doesn&apos;t.
              </p>
              <ReceivedChalanForm companies={companies} parties={parties} />
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
            a flat list.

            2026-08-29 fix — "jab print debit note ka lena hai to baki or
            kyu aaari hai, print camand puri window par kaam kar rahi": this
            button and PrintArea used to wrap ALL SIX "Recent ..." lists
            together (Credit Note, Debit Note, Washing Entry, Internal
            Invoice, Purchase Bill, CSB Filing all in one shared
            #doc-lists-print-area) — so printing from e.g. the Debit Note
            tab printed every OTHER list too, not just Debit Notes. Each
            list below is now wrapped in its own `tab === "..." ? "" :
            "print:hidden"` div, so only the list matching the currently
            selected tab actually prints — on-screen all six still show
            together as before (that combined overview is unchanged), only
            the print/PDF output is now scoped to the active tab. The
            button label reflects which list will print. (For a SINGLE
            document instead of a whole list, use the per-row "🖨 Print"
            link added 2026-08-29 — see DocList's printHref comment below —
            which goes to that one document's own dedicated report page.) */}
        {/* 2026-10-29g — "debit note or credit note kaha se print hote hai
            mujhe to kahi dikh hi nahi raha". The register pages (which print
            the whole list AND carry a per-note 🖨 Sheet) were only reachable by
            an unrelated small link on Bill Payment. This row puts the register
            link right next to the note lists, so the list-print and the
            single-note print are both one click away. */}
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <p className="text-xs text-slate-500">
            {tab === "credit-note" && (
              <>
                Full list + per-note print:{" "}
                <Link href="/dashboard/credit-notes-register" className="font-medium text-teal-700 underline hover:text-teal-800">
                  🧾 Credit Note Register →
                </Link>
              </>
            )}
            {tab === "debit-note" && (
              <>
                Full list + per-note print:{" "}
                <Link href="/dashboard/debit-notes-register" className="font-medium text-rose-700 underline hover:text-rose-800">
                  📉 Debit Note Register →
                </Link>
              </>
            )}
          </p>
          <PrintButton label={`🖨 Print / Download "${TABS.find((t) => t.key === tab)?.label ?? tab}" list`} />
        </div>
        <PrintArea id="doc-lists-print-area">
        <div className={tab === "credit-note" ? undefined : "print:hidden"}>
        <DocList
          title="Recent Credit Notes"
          rows={recent.creditNotes.map((r) => ({
            id: r.id,
            no: r.cn_no ?? "—",
            date: r.credit_note_date,
            sub: `${r.companyName} · ${r.buyer_name ?? ""}`,
            amount: `₹${r.refund_amount}`,
            record: r,
            docStatement: { type: "credit_note", id: r.id },
            statementLabel: "🧾 Statement",
            // 2026-10-29g — the A4 dialog sheet renders from the row alone
            // (no PO / item lines). This opens the FULL letterhead sheet —
            // PO No., items, qty / rate / GST and the invoices the note
            // adjusts — in the A4 print dialog.
            printHref: `/dashboard/documents/credit-notes/${r.id}/report`,
          }))}
          onDelete={deleteCreditNote}
          // 2026-10-16 — View + Print both open in the A4 dialog on THIS
          // page (printHref's /report navigation removed — see DocList's
          // renderView comment).
          renderView={(r) => <DocEntryA4 spec={creditNoteDoc(r)} />}
          renderEdit={(r, onDone) => (
            <CreditNoteEditForm note={r} stores={stores.filter((s) => s.company_id === r.company_id)} onDone={onDone} />
          )}
        />
        </div>
        <div className={tab === "debit-note" ? undefined : "print:hidden"}>
        <DocList
          title="Recent Debit Notes"
          rows={recent.debitNotes.map((r) => ({
            id: r.id,
            no: r.debit_note_no ?? "—",
            date: r.debit_note_date,
            sub: `${r.companyName} · ${r.particulars ?? ""}`,
            amount: `₹${r.debit_amount}`,
            record: r,
            // Same reason as Credit Notes above — full sheet with PO / items.
            printHref: `/dashboard/documents/debit-notes/${r.id}/report`,
          }))}
          onDelete={deleteDebitNote}
          renderView={(r) => <DocEntryA4 spec={debitNoteDoc(r, parties.find((p) => p.id === r.party_id)?.name ?? "—")} />}
          renderEdit={(r, onDone) => <DebitNoteEditForm note={r} parties={parties} onDone={onDone} />}
        />
        </div>
        <div className={tab === "washing-entry" ? undefined : "print:hidden"}>
        <DocList
          title="Recent Washing Entries"
          total={
            washingEntriesTotal
              ? `Total: ${washingEntriesTotal.count} washing entr${washingEntriesTotal.count === 1 ? "y" : "ies"} · ₹${washingEntriesTotal.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (all-time, matches the CRM P&L "Washing Chalans" line — not just the ${recent.washingEntries.length} shown below)`
              : undefined
          }
          rows={recent.washingEntries.map((r) => ({
            id: r.id,
            no: r.chalan_no ?? "—",
            date: r.chalan_date,
            sub: r.companyName,
            amount: `₹${r.amount}`,
            record: r,
          }))}
          onDelete={deleteWashingEntry}
          renderView={(r) => (
            <DocEntryA4
              spec={washingEntryDoc(r, {
                partyName: parties.find((p) => p.id === r.party_id)?.name ?? "—",
                storeName: stores.find((s) => s.id === r.store_id)?.name ?? "—",
              })}
            />
          )}
          renderEdit={(r, onDone) => (
            <WashingEntryEditForm entry={r} parties={parties} stores={stores.filter((s) => s.company_id === r.company_id)} onDone={onDone} />
          )}
        />
        </div>
        <div className={tab === "internal-invoice" ? undefined : "print:hidden"}>
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
          renderView={(r) => <DocEntryA4 spec={internalInvoiceDoc(r)} />}
          renderEdit={(r, onDone) => <InternalInvoiceEditForm invoice={r} onDone={onDone} />}
        />
        </div>
        <div className={tab === "purchase-bill" ? undefined : "print:hidden"}>
        <PurchaseBillFilterForm parties={parties} filter={billFilters.purchaseBill} />
        {/* 2026-10-20 — replaces the old one-card-per-ROW DocList (see
            PurchaseBillInvoiceList's own comment). */}
        <PurchaseBillInvoiceList
          invoices={recent.purchaseBillInvoices}
          parties={parties}
          companies={companies}
          canSeeAudit={recent.canSeeAudit}
        />
        </div>
        <div className={tab === "csb-filing" ? undefined : "print:hidden"}>
        <DocList
          title="Recent CSB Filings"
          rows={recent.csbFilings.map((r) => ({
            id: r.id,
            no: r.csb_number,
            date: r.filing_date ?? "—",
            sub: `HAWB ${r.hawb_number ?? "—"} · Inv ${r.invoice_no ?? "—"}`,
            amount: r.fob_value_inr != null ? `₹${r.fob_value_inr}` : "—",
            record: r,
            docStatement: { type: "csb_filing", id: r.id },
            statementLabel: "🧾 Statement",
          }))}
          onDelete={deleteCsbFiling}
          renderView={(r) => <DocEntryA4 spec={csbFilingDoc(r)} />}
          renderEdit={(r, onDone) => <CsbFilingEditForm filing={r} currencies={currencies} onDone={onDone} />}
        />
        </div>
        <div className={tab === "journal-voucher" ? undefined : "print:hidden"}>
        <DocList
          title="Recent Journal Vouchers"
          rows={recent.journalVouchers.map((r) => ({
            id: r.id,
            no: r.jv_no ?? "—",
            date: r.jv_date,
            sub: `${r.vendorName}${r.vendor_invoice_no ? ` · ${r.vendor_invoice_no}` : ""}`,
            amount: `₹${r.debit_amount}`,
            record: r,
            printHref: `/dashboard/documents/journal-vouchers/${r.id}/report`,
          }))}
          onDelete={deleteJournalVoucher}
          renderEdit={(r, onDone) => <JournalVoucherEditForm jv={r} parties={parties} onDone={onDone} />}
        />
        </div>
        <div className={tab === "received-chalan" ? undefined : "print:hidden"}>
        <DocList
          title="Recent Received Chalans"
          rows={recent.receivedChalans.map((r) => ({
            id: r.id,
            no: r.chalan_no ?? "—",
            date: r.chalan_date,
            sub:
              `${r.partyName}${r.orderRefNo ? ` · ${r.orderRefNo}` : ""}` +
              (r.source === "purchase_bill" ? " · auto" : "") +
              (r.items.length ? ` — ${r.items.map((it) => `${it.description} (${it.qty} ${it.qty_unit})`).join("; ")}` : ""),
            amount: "",
            record: r,
            printHref: `/dashboard/documents/received-chalans/${r.id}/report`,
          }))}
          onDelete={deleteReceivedChalan}
        />
        </div>
        </PrintArea>
      </div>
    </div>
  );
}

// 2026-08-22 — GET-form + searchParams filter for the Recent Purchase Bills
// list (date range + vendor party), same pattern as Orders. `tab` is a
// hidden field so submitting lands back on the Purchase Bill tab (see the
// `initialTab` comment above) instead of resetting to Credit Note.
function PurchaseBillFilterForm({ parties, filter }: { parties: Party[]; filter: BillFilter }) {
  return (
    <form method="get" action="/dashboard/documents" className="mb-2 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 print:hidden">
      <input type="hidden" name="tab" value="purchase-bill" />
      <div>
        <label className="mb-0.5 block text-[11px] font-medium text-slate-500" htmlFor="pbVendor">Vendor</label>
        <select id="pbVendor" name="pbVendor" defaultValue={filter.vendor} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-amber-500">
          <option value="">All</option>
          {parties.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-0.5 block text-[11px] font-medium text-slate-500" htmlFor="pbFrom">From</label>
        <input id="pbFrom" name="pbFrom" type="date" defaultValue={filter.from} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-amber-500" />
      </div>
      <div>
        <label className="mb-0.5 block text-[11px] font-medium text-slate-500" htmlFor="pbTo">To</label>
        <input id="pbTo" name="pbTo" type="date" defaultValue={filter.to} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-amber-500" />
      </div>
      <button type="submit" className="rounded-lg bg-slate-800 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700">
        Filter
      </button>
      <a href="/dashboard/documents?tab=purchase-bill" className="text-[11px] text-slate-400 underline">Clear</a>
    </form>
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
              <div className="flex shrink-0 gap-1.5">
                {/* 2026-10-20 repair — restored (see the PrintDialog import note). */}
                <PrintDialog
                  href={`/dashboard/documents/shipment-chalans/${r.id}/report`}
                  title={`Shipment Chalan — ${r.chalan_no ?? r.id}`}
                />
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
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs text-slate-400">None created yet.</p>}
      </div>
    </div>
  );
}

// =============================================================================
// 2026-10-20 — "agar document entry section me kisi bhi parkar ke invoice ki
// entry karte hai to alag alag entry kyu hoti hai, ek invoice me agar 10 entry
// hai to vaha par single entry aaye or usi se link me dikh jaye ki kon kon si
// entry hai or sabhi entry edit ki ja sake delet ki ja sake or modify ki ja
// sake. kab entry ki gyi date & time ke sath agar update hui ho baad me to vo
// bhi show hona chahiye admin ko."
//
// One card per VENDOR INVOICE instead of one per purchase_bills row (a
// multi-item invoice is stored as one row per item — its own qty/rate/GST — so
// a 6-item bill used to read as six unrelated entries). "▸ Items" expands the
// card into those rows, each with its own Edit / Delete, so every entry stays
// individually editable/modifiable/deletable while the invoice itself stays
// one line. Entry and last-updated timestamps are shown per invoice AND per
// item for Admins only (canSeeAudit).
// =============================================================================
function PurchaseBillInvoiceList({
  invoices,
  parties,
  companies,
  canSeeAudit,
}: {
  invoices: PurchaseBillInvoiceRow[];
  parties: Party[];
  companies: Company[];
  canSeeAudit: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [viewingKey, setViewingKey] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  // 2026-10-21 — which invoice's edit-history chain is open (Admin only).
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const viewing = invoices.find((i) => i.key === viewingKey) ?? null;
  const editingItem = invoices.flatMap((i) => i.items).find((it) => it.id === editingItemId) ?? null;
  const history = invoices.find((i) => i.key === historyKey) ?? null;

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setError(key: string, message: string) {
    setDeleteError((prev) => ({ ...prev, [key]: message }));
  }

  function handleDeleteItem(invoiceKey: string, item: PurchaseBillItem) {
    const label = item.work_description?.trim() || "this entry";
    if (!window.confirm(`Delete "${label}"? It is removed from this invoice and from Bill Payment / Party Ledger too.`)) return;
    setError(invoiceKey, "");
    startTransition(async () => {
      const result = await deletePurchaseBill(item.id);
      if (result.error) setError(invoiceKey, result.error);
    });
  }

  // Deleting the whole invoice = deleting each of its rows in turn (the same
  // server action the per-item Delete uses, so the "payments already recorded"
  // guard still protects a paid row and the rest are left untouched).
  function handleDeleteInvoice(invoice: PurchaseBillInvoiceRow) {
    if (
      !window.confirm(
        `Delete invoice "${invoice.vendor_invoice_no}"${invoice.isGroup ? ` with all ${invoice.items.length} items` : ""}? This cannot be undone.`
      )
    )
      return;
    setError(invoice.key, "");
    startTransition(async () => {
      for (const item of invoice.items) {
        const result = await deletePurchaseBill(item.id);
        if (result.error) {
          setError(invoice.key, `${item.work_description?.trim() || "Item"}: ${result.error}`);
          return;
        }
      }
    });
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Recent Purchase Bills</h2>
        <p className="text-[11px] text-slate-400">
          One entry per vendor invoice — open &quot;▸ Items&quot; to view, edit, modify or delete each entry on it.
        </p>
      </div>

      <div className="space-y-1.5">
        {invoices.map((inv) => {
          const isOpen = expanded.has(inv.key);
          return (
            <div key={inv.key} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 font-medium text-slate-900">
                    <span className="truncate">{inv.vendor_invoice_no}</span>
                    {inv.isGroup && (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                        {inv.items.length} items · 1 invoice
                      </span>
                    )}
                    {inv.notes.length > 0 && <RelatedNotesBadge notes={inv.notes} />}
                  </div>
                  <div className="text-slate-400">
                    {inv.vendorName}
                    {inv.isGroup
                      ? ` · ${inv.items.length} entries on one invoice`
                      : inv.items[0]?.work_description?.trim()
                        ? ` · ${inv.items[0].work_description.trim()}`
                        : ""}
                  </div>
                  {canSeeAudit && (
                    <div className="mt-0.5 text-[10px] text-slate-500">
                      {/* 2026-10-21 — "kisne entry ki": the name next to the
                          stamp it belongs to. Legacy bills say so instead of
                          leaving a bare gap the Admin would read as a bug. */}
                      👤 {inv.enteredByName ?? "entered by not tracked (older entry)"}
                      <span className="mx-1 text-slate-300">|</span>
                      🗓 Entered {formatAuditStamp(inv.createdAt)}
                      <span className="mx-1 text-slate-300">|</span>
                      {inv.updatedAt ? `✏️ Last updated ${formatAuditStamp(inv.updatedAt)}` : "not edited since entry"}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-medium text-slate-800">₹{inv.grandTotal.toFixed(2)}</div>
                  <div className="text-slate-400">{inv.vendor_invoice_date ?? "—"}</div>
                </div>
              </div>

              {/* 2026-10-29 — the Finance gate: nothing reaches Bill Payment /
                  Party Ledger until this invoice is sent from here, and its
                  company can be changed afterwards without deleting it. */}
              <PurchaseFinanceBox
                billIds={inv.items.map((i) => i.id)}
                companies={companies}
                defaultCompanyId={inv.companyId}
                total={inv.grandTotal}
                sent={
                  inv.finance_bpr_id
                    ? { billPassRegisterId: inv.finance_bpr_id, companyId: inv.financeCompanyId ?? inv.companyId ?? "" }
                    : null
                }
              />

              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
                <p className="text-red-600">{deleteError[inv.key]}</p>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {inv.isGroup && (
                    <button
                      type="button"
                      onClick={() => toggle(inv.key)}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
                    >
                      {isOpen ? "▾ Hide items" : "▸ Items"}
                    </button>
                  )}
                  {canSeeAudit && (
                    <button
                      type="button"
                      onClick={() => setHistoryKey(inv.key)}
                      title="Full chain — who changed what, and when"
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
                    >
                      🕘 History
                    </button>
                  )}
                  {/* 2026-10-28 — "baad me dubara usi po order ka bill aajata
                      hai to jo latest bill chadha hai usme us order ke against
                      debit note issue ka option ho": the second bill is saved
                      normally; this shortcut opens the Debit Note form for THIS
                      invoice, pre-linked, so the difference can be debited and
                      adjusted without retyping party/invoice. */}
                  <a
                    href={`/dashboard/documents?tab=debit-note&dn_company=${inv.companyId ?? ""}&dn_party=${inv.vendorPartyId}&dn_bill=${inv.finance_bpr_id ?? ""}&dn_invoice=${encodeURIComponent(inv.vendor_invoice_no)}`}
                    title="Raise a Debit Note against this invoice (e.g. the duplicate/extra bill on the same PO)"
                    className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-700 hover:bg-amber-100"
                  >
                    🧾 Debit Note
                  </a>
                  <button
                    type="button"
                    onClick={() => setViewingKey(inv.key)}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
                  >
                    👁 View
                  </button>
                  {inv.finance_bpr_id && <BillStatementDialog billId={inv.finance_bpr_id} label="🧾 Statement" />}
                  {inv.isGroup ? (
                    <button
                      type="button"
                      onClick={() => toggle(inv.key)}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
                    >
                      ✏️ Edit entries
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingItemId(inv.items[0].id)}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleDeleteInvoice(inv)}
                    className="rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                  >
                    Delete{inv.isGroup ? " invoice" : ""}
                  </button>
                </div>
              </div>

              {isOpen && inv.isGroup && (
                <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-100 bg-slate-50/60">
                  {inv.items.map((it, idx) => {
                    const edited =
                      new Date(it.updated_at).getTime() - new Date(it.created_at).getTime() >= 1000;
                    const size =
                      (it.qty_unit ?? "FT") === "PCS"
                        ? `${it.qty} pcs`
                        : `${it.qty} × ${Number(it.sq_feet)} ${it.qty_unit ?? "FT"}`;
                    return (
                      <li key={it.id} className="flex items-start justify-between gap-2 px-2 py-1.5">
                        <div className="min-w-0">
                          <div className="font-medium text-slate-800">
                            {idx + 1}. {it.work_description?.trim() || "(no description)"}
                          </div>
                          <div className="text-slate-500">
                            {size} @ ₹{Number(it.unit_rate).toFixed(2)} = {purchaseBillAmountLabel(it)}
                            {!purchaseHasGst(it.gst_rate_pct) && (
                              <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] text-slate-600">No GST</span>
                            )}
                          </div>
                          {canSeeAudit && (
                            <div className="text-[10px] text-slate-400">
                              Entered {formatAuditStamp(it.created_at)}
                              {it.entered_by_name ? ` by ${it.entered_by_name}` : " (by not tracked)"}
                              <span className="mx-1">|</span>
                              {edited ? `Updated ${formatAuditStamp(it.updated_at)}` : "never edited"}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingItemId(it.id)}
                            className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleDeleteItem(inv.key, it)}
                            className="rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
        {invoices.length === 0 && <p className="text-xs text-slate-400">None created yet.</p>}
      </div>

      {viewing && (
        <A4Dialog
          open
          onClose={() => setViewingKey(null)}
          title={`View — ${viewing.vendor_invoice_no}`}
          subtitle="A4 preview of the whole invoice — Print / Save PDF prints this document only."
          fitContent
          footer={
            <div className="flex items-center justify-end gap-2">
              <PrintButton label="🖨 Print / Save PDF" />
              <button
                type="button"
                onClick={() => setViewingKey(null)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          }
        >
          <DocEntryA4
            spec={purchaseBillInvoiceDoc(viewing, companies.find((c) => c.id === viewing.company_id)?.name ?? "")}
          />
        </A4Dialog>
      )}

      {editingItem && (
        <A4Dialog
          open
          onClose={() => setEditingItemId(null)}
          title={`Edit — ${editingItem.vendor_invoice_no}`}
          subtitle="A4-size dialog — edit this entry and press Save."
        >
          <PurchaseBillEditForm bill={editingItem} parties={parties} onDone={() => setEditingItemId(null)} />
        </A4Dialog>
      )}

      {history && (
        <A4Dialog
          open
          onClose={() => setHistoryKey(null)}
          title={`History — ${history.vendor_invoice_no}`}
          subtitle="Who entered it, when it was edited, and what changed — newest first."
          footer={
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setHistoryKey(null)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          }
        >
          <PurchaseBillHistoryPanel billIds={history.items.map((i) => i.id)} />
        </A4Dialog>
      )}
    </div>
  );
}

// =============================================================================
// 2026-10-21 — edit-history chain for one vendor invoice.
//
// Reads audit_log (getPurchaseBillHistory — Admin-only, same capability that
// already gates these stamps) for EVERY row of the invoice, so an item added
// later and an item edited twice all land in one timeline. A migration-less
// database (no audit_log) shows the action's own "run this SQL" message
// rather than an empty list, which would look like "nobody ever changed this".
// =============================================================================
function PurchaseBillHistoryPanel({ billIds }: { billIds: string[] }) {
  // Keyed on the joined ids so the effect re-runs only when the invoice
  // actually changes (a fresh array identity every render would re-fetch in a
  // loop).
  const idsKey = billIds.join(",");
  // One state object tagged with the key it belongs to, instead of separate
  // loading/error/entries states: "loaded for the CURRENT invoice" is then a
  // plain derived value (loaded?.key === idsKey), which avoids a synchronous
  // setState inside the effect just to flip a loading flag back on.
  const [loaded, setLoaded] = useState<{ key: string; error: string | null; entries: PurchaseBillHistoryEntry[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPurchaseBillHistory(idsKey.split(",").filter(Boolean))
      .then((res) => {
        if (!cancelled) setLoaded({ key: idsKey, error: res.error, entries: res.entries });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoaded({
            key: idsKey,
            error: err instanceof Error ? err.message : "Could not load history.",
            entries: [],
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  const forThisInvoice = loaded?.key === idsKey ? loaded : null;
  if (!forThisInvoice) return <p className="text-sm text-slate-500">Loading history…</p>;
  const { error, entries } = forThisInvoice;
  if (error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (entries.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No history entries yet. That means this bill was entered before the history code went live, or nothing is being
        written to audit_log yet (see the Schema Status card).
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {entries.map((e) => {
        const isCreate = e.action.endsWith(".created");
        const isDelete = e.action.endsWith(".deleted");
        const changes = e.changes ?? {};
        return (
          <li key={e.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-1">
              <p className="text-xs font-semibold text-slate-800">
                {isCreate ? "➕ Entry ki" : isDelete ? "🗑 Delete ki" : "✏️ Edit ki"} — {e.employee_name}
              </p>
              <p className="text-[11px] text-slate-400">{formatAuditStamp(e.created_at)}</p>
            </div>
            {Object.keys(changes).length > 0 && (
              <ul className="mt-1 space-y-0.5 text-[11px] text-slate-600">
                {Object.entries(changes).map(([key, raw]) => {
                  const v = (raw ?? {}) as { label?: string; from?: unknown; to?: unknown };
                  return (
                    <li key={key}>
                      <span className="font-medium text-slate-700">{v.label ?? key}</span>:{" "}
                      <span className="text-slate-400">{formatHistoryValue(v.from)}</span> →{" "}
                      <span className="text-slate-800">{formatHistoryValue(v.to)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** History values arrive as whatever was logged — null, number or string. */
function formatHistoryValue(v: unknown): string {
  if (v == null || v === "") return "—";
  return String(v);
}

function DocList<T extends { id: string }>({
  title,
  total,
  rows,
  renderEdit,
  renderView,
  onDelete,
}: {
  title: string;
  // 2026-09-17 (evening) — optional pre-formatted total line (e.g. "Total:
  // 42 washing entries · ₹1,23,456.78"), rendered under the heading. Only
  // Washing Entries passes this today (see document-entry-tabs.tsx's own
  // washing-entry DocList call for why) — every other list here is still
  // just the capped "recent 8", unchanged.
  total?: string;
  // 2026-08-27 (later same day) — optional `notes`: when a caller passes
  // real linked Credit/Debit Note records (see actions.ts's
  // listRelatedNotesForBills), show the same RelatedNotesBadge preview
  // used on Bill Payment / Courier Bill / Duty & Tax Bill.
  //
  // 2026-08-29 — optional `printHref`: when set, a "Print" link appears
  // next to Edit/Delete, pointing at that doc's own single-document report
  // page (e.g. credit-notes/[id]/report) — see that page's header comment
  // for why Credit Note/Debit Note/Internal Invoice needed this (previously
  // only the whole flat list could be printed, never one document).
  // 2026-09-15 — optional `statementBillId`: when set, a "📄 View" button
  // appears next to Print/Edit/Delete, opening the row's READ-ONLY bill
  // statement sheet (access-checked via /api/bill-statement — a bill in a
  // company you can't access shows an error instead of the document).
  // Wired for Purchase/Courier/Duty bills via their bill_pass_register
  // link ids passed from page.tsx.
  // 2026-09-19 — optional `docStatement`: the same idea as statementBillId
  // above, but for the 4 standalone document tables (Credit Note / CSB
  // Filing / Refund / Order Refund) that don't route through
  // bill_pass_register at all — see src/lib/doc-statement.ts. Kept as its
  // own field rather than overloading statementBillId since the access
  // check and API route genuinely differ per table (see that file's header
  // comment), even though the on-screen button looks identical.
  //
  // 2026-10-16 — `statementLabel`: with the new per-row "👁 View" A4
  // preview (renderView below) sitting next to these statement triggers,
  // both used to render a button literally labelled "📄 View" — callers
  // now label the statement one "🧾 Statement" so the two are
  // distinguishable (the statement sheet keeps the WhatsApp/Telegram/
  // email/PDF action bar the plain preview doesn't have).
  //
  // 2026-10-16 — `renderView`: "view nahi kar sakte jo A4 dialog box me
  // khulna chahiye tha, print naye page par lekar jata hai" — when set, a
  // "👁 View" button opens the row's read-only A4 sheet inside the shared
  // A4Dialog (NOT a navigation), with Print / Save PDF in the dialog
  // footer. Wired for the 6 flat Document Entry types (Credit Note,
  // Debit Note, Washing Entry, Internal Invoice, Purchase Bill, CSB
  // Filing) via doc-entry-a4.tsx; their old printHref links (which
  // navigated to a separate /report page) were removed for exactly these
  // types. Journal Voucher / Received Chalan keep their report-page links
  // unchanged — they weren't part of this request.
  rows: {
    id: string;
    no: string;
    date: string;
    sub: string;
    amount: string;
    record: T;
    notes?: RelatedNote[];
    printHref?: string;
    statementBillId?: string;
    docStatement?: { type: DocType; id: string };
    statementLabel?: string;
  }[];
  // 2026-08-29 (evening, follow-up round) — optional: Material OUT Chalan
  // and Received Chalan (multi-item chalans, create+delete only, matching
  // Material OUT Chalan's own established shape) have no edit form — when
  // omitted, the Edit button itself doesn't render rather than opening a
  // dead end. Every other caller still passes this and is unaffected.
  renderEdit?: (record: T, onDone: () => void) => ReactNode;
  // 2026-10-16 — same shape as renderEdit: returns the read-only A4 sheet
  // (a DocEntryA4 wrapped in its own PrintArea — see doc-entry-a4.tsx).
  renderView?: (record: T) => ReactNode;
  onDelete: (id: string) => Promise<SimpleResult>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
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
      {total && <p className="mb-2 text-xs font-medium text-slate-500">{total}</p>}
      <div className="space-y-1.5">
        {rows.map((r) =>
          /* 2026-09-19 — "baki kisi or page par bhi kuch update karte hai to
              dusre page par le jane ki bajaye A4 sige me dialogbox open hoye usi
              me change karke save kar sake": every document tab's Edit now
              opens in the shared A4 dialog instead of reflowing the list. */
          editingId === r.id && renderEdit ? (
            <A4Dialog
              key={r.id}
              open
              onClose={() => setEditingId(null)}
              title={`Edit — ${r.no}`}
              subtitle="A4-size dialog — edit the fields and press Save."
            >
              {renderEdit(r.record, () => setEditingId(null))}
            </A4Dialog>
          ) : viewingId === r.id && renderView ? (
            <A4Dialog
              key={r.id}
              open
              onClose={() => setViewingId(null)}
              title={`View — ${r.no}`}
              subtitle="A4 preview — Print / Save PDF prints this document only; no page navigation."
              fitContent
              footer={
                <div className="flex items-center justify-end gap-2">
                  <PrintButton label="🖨 Print / Save PDF" />
                  <button
                    type="button"
                    onClick={() => setViewingId(null)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Close
                  </button>
                </div>
              }
            >
              {renderView(r.record)}
            </A4Dialog>
          ) : (
            <div key={r.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5 font-medium text-slate-900">
                    {r.no}
                    {r.notes && r.notes.length > 0 && <RelatedNotesBadge notes={r.notes} />}
                  </div>
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
                  {renderView && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setViewingId(r.id);
                      }}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
                    >
                      👁 View
                    </button>
                  )}
                  {r.printHref && (
                    <PrintDialog
                      href={r.printHref}
                      title={`Print — ${r.no}`}
                      subtitle="A4 preview — prints exactly this document."
                    />
                  )}
                  {r.statementBillId && <BillStatementDialog billId={r.statementBillId} label={r.statementLabel} />}
                  {r.docStatement && (
                    <DocStatementDialog type={r.docStatement.type} id={r.docStatement.id} label={r.statementLabel} />
                  )}
                  {renderEdit && (
                    <button
                      type="button"
                      onClick={() => setEditingId(r.id)}
                      className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                  )}
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
