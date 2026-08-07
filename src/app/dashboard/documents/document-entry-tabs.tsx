"use client";

import { useState } from "react";
import { CreditNoteForm } from "./credit-note-form";
import { DebitNoteForm } from "./debit-note-form";
import { WashingEntryForm } from "./washing-entry-form";
import { InternalInvoiceForm } from "./internal-invoice-form";

type Company = { id: string; name: string };
type Party = { id: string; name: string };
type Store = { id: string; name: string; company_id: string };

type Recent = {
  creditNotes: { id: string; cn_no: string | null; credit_note_date: string; refund_amount: number; buyer_name: string | null; companyName: string }[];
  debitNotes: { id: string; debit_note_no: string | null; debit_note_date: string; debit_amount: number; particulars: string | null; companyName: string }[];
  washingEntries: { id: string; chalan_no: string | null; chalan_date: string; amount: number; companyName: string }[];
  internalInvoices: { id: string; invoice_no: string | null; invoice_date: string; total_amount: number; fromCompanyName: string; toCompanyName: string }[];
};

const TABS = [
  { key: "credit-note", label: "Credit Note" },
  { key: "debit-note", label: "Debit Note" },
  { key: "washing-entry", label: "Washing Entry" },
  { key: "internal-invoice", label: "Internal Invoice" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function DocumentEntryTabs({
  companies,
  parties,
  stores,
  recent,
}: {
  companies: Company[];
  parties: Party[];
  stores: Store[];
  recent: Recent;
}) {
  const [tab, setTab] = useState<TabKey>("credit-note");

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          {tab === "credit-note" && <CreditNoteForm companies={companies} stores={stores} />}
          {tab === "debit-note" && <DebitNoteForm companies={companies} parties={parties} />}
          {tab === "washing-entry" && <WashingEntryForm companies={companies} parties={parties} stores={stores} />}
          {tab === "internal-invoice" && <InternalInvoiceForm companies={companies} />}
        </div>
      </div>

      <div className="space-y-6">
        <RecentList
          title="Recent Credit Notes"
          rows={recent.creditNotes.map((r) => ({
            id: r.id,
            no: r.cn_no ?? "—",
            date: r.credit_note_date,
            sub: `${r.companyName} · ${r.buyer_name ?? ""}`,
            amount: `₹${r.refund_amount}`,
          }))}
        />
        <RecentList
          title="Recent Debit Notes"
          rows={recent.debitNotes.map((r) => ({
            id: r.id,
            no: r.debit_note_no ?? "—",
            date: r.debit_note_date,
            sub: `${r.companyName} · ${r.particulars ?? ""}`,
            amount: `₹${r.debit_amount}`,
          }))}
        />
        <RecentList
          title="Recent Washing Entries"
          rows={recent.washingEntries.map((r) => ({
            id: r.id,
            no: r.chalan_no ?? "—",
            date: r.chalan_date,
            sub: r.companyName,
            amount: `₹${r.amount}`,
          }))}
        />
        <RecentList
          title="Recent Internal Invoices"
          rows={recent.internalInvoices.map((r) => ({
            id: r.id,
            no: r.invoice_no ?? "—",
            date: r.invoice_date,
            sub: `${r.fromCompanyName} → ${r.toCompanyName}`,
            amount: `₹${r.total_amount}`,
          }))}
        />
      </div>
    </div>
  );
}

function RecentList({ title, rows }: { title: string; rows: { id: string; no: string; date: string; sub: string; amount: string }[] }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">{title}</h2>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
            <div>
              <div className="font-medium text-slate-900">{r.no}</div>
              <div className="text-slate-400">{r.sub}</div>
            </div>
            <div className="text-right">
              <div className="text-slate-700">{r.amount}</div>
              <div className="text-slate-400">{r.date}</div>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs text-slate-400">Abhi tak koi nahi bana.</p>}
      </div>
    </div>
  );
}
