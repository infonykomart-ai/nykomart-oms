"use client";

import { useState, useTransition, type ReactNode } from "react";
import { CreditNoteForm } from "./credit-note-form";
import { DebitNoteForm } from "./debit-note-form";
import { WashingEntryForm } from "./washing-entry-form";
import { InternalInvoiceForm } from "./internal-invoice-form";
import { CreditNoteEditForm, type EditableCreditNote } from "./credit-note-edit-form";
import { DebitNoteEditForm, type EditableDebitNote } from "./debit-note-edit-form";
import { WashingEntryEditForm, type EditableWashingEntry } from "./washing-entry-edit-form";
import { InternalInvoiceEditForm, type EditableInternalInvoice } from "./internal-invoice-edit-form";
import { deleteCreditNote, deleteDebitNote, deleteWashingEntry, deleteInternalInvoice, type SimpleResult } from "./actions";

type Company = { id: string; name: string };
type Party = { id: string; name: string };
type Store = { id: string; name: string; company_id: string };

type Recent = {
  creditNotes: (EditableCreditNote & { companyName: string })[];
  debitNotes: (EditableDebitNote & { companyName: string })[];
  washingEntries: (EditableWashingEntry & { companyName: string; amount: number })[];
  internalInvoices: (EditableInternalInvoice & { fromCompanyName: string; toCompanyName: string; total_amount: number })[];
};

const TABS = [
  { key: "credit-note", label: "Credit Note" },
  { key: "debit-note", label: "Debit Note" },
  { key: "washing-entry", label: "Washing Entry" },
  { key: "internal-invoice", label: "Internal Invoice" },
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
