"use client";

import { useState } from "react";
import { BulkDocUploadForm } from "./bulk-doc-upload-form";
import {
  bulkSaveCreditNotes,
  bulkSaveDebitNotes,
  bulkSaveWashingEntries,
  bulkSavePurchaseBills,
  bulkSaveFreightBills,
  bulkSaveDutyBills,
} from "../actions";
import {
  CREDIT_NOTE_COLUMNS,
  DEBIT_NOTE_COLUMNS,
  WASHING_ENTRY_COLUMNS,
  PURCHASE_BILL_COLUMNS,
  COURIER_BILL_COLUMNS,
  DUTY_TAX_BILL_COLUMNS,
} from "./columns";

const TABS = [
  { key: "credit-note", label: "Credit Note" },
  { key: "debit-note", label: "Debit Note" },
  { key: "washing-entry", label: "Washing Entry" },
  { key: "purchase-bill", label: "Purchase Bill" },
  { key: "courier-bill", label: "Courier Bill" },
  { key: "duty-tax-bill", label: "Duty & Tax Bill" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// Same tab-bar pattern as ../document-entry-tabs.tsx, one level down — each
// tab is just a <BulkDocUploadForm> pointed at that type's columns + bulk
// action (see bulk-doc-upload-form.tsx's header comment for why this is
// generic rather than 6 near-identical files).
export function BulkUploadTabs() {
  const [tab, setTab] = useState<TabKey>("credit-note");

  return (
    <div>
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

      {tab === "credit-note" && (
        <BulkDocUploadForm
          docLabel="Credit Note"
          refLabel="PO/RF/RG No"
          filenameBase="bulk-credit-note"
          columns={CREDIT_NOTE_COLUMNS}
          action={bulkSaveCreditNotes}
        />
      )}
      {tab === "debit-note" && (
        <BulkDocUploadForm
          docLabel="Debit Note"
          refLabel="Company / Party"
          filenameBase="bulk-debit-note"
          columns={DEBIT_NOTE_COLUMNS}
          action={bulkSaveDebitNotes}
        />
      )}
      {tab === "washing-entry" && (
        <BulkDocUploadForm
          docLabel="Washing Entry"
          refLabel="Company / Party"
          filenameBase="bulk-washing-entry"
          columns={WASHING_ENTRY_COLUMNS}
          action={bulkSaveWashingEntries}
        />
      )}
      {tab === "purchase-bill" && (
        <BulkDocUploadForm
          docLabel="Purchase Bill"
          refLabel="PO/RF/RG No"
          filenameBase="bulk-purchase-bill"
          columns={PURCHASE_BILL_COLUMNS}
          action={bulkSavePurchaseBills}
        />
      )}
      {tab === "courier-bill" && (
        <BulkDocUploadForm
          docLabel="Courier Bill"
          refLabel="Invoice No"
          filenameBase="bulk-courier-bill"
          columns={COURIER_BILL_COLUMNS}
          action={bulkSaveFreightBills}
        />
      )}
      {tab === "duty-tax-bill" && (
        <BulkDocUploadForm
          docLabel="Duty & Tax Bill"
          refLabel="Invoice No"
          filenameBase="bulk-duty-tax-bill"
          columns={DUTY_TAX_BILL_COLUMNS}
          action={bulkSaveDutyBills}
        />
      )}
    </div>
  );
}
