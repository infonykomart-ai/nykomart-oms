"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveExpenseAction,
  updateExpenseAction,
  deleteExpenseAction,
  type ExpenseFormState,
} from "./actions";
import { EXPENSE_CATEGORIES } from "./categories";

const initialState: ExpenseFormState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

type Company = { id: string; name: string };
type Party = { id: string; name: string };

export type ExpenseBillItem = {
  id: string;
  category: string;
  description: string | null;
  amount: number;
};

/** One expense bill — the shape page.tsx builds from entry_group_id rows. */
export type ExpenseBill = {
  key: string;
  rowIds: string[];
  companyId: string;
  companyName: string;
  date: string;
  partyId: string | null;
  partyName: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  paymentMode: string | null;
  remark: string | null;
  items: ExpenseBillItem[];
  total: number;
};

type DraftItem = { key: string; id: string | null; category: string; description: string; amount: string };

let draftSeq = 0;
function newDraft(): DraftItem {
  draftSeq += 1;
  return { key: `d${draftSeq}`, id: null, category: "", description: "", amount: "" };
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// 2026-10-28 — the office-expense screen is now a vendor BILL like a purchase
// bill: one header (company, party, invoice no/date, payment mode, remark) plus
// any number of line items, and every saved bill can be previewed, edited in
// place or deleted. See actions.ts / db/2026-10-28-internal-expense-bills.sql.
export function ExpenseEntrySection({
  companies,
  parties,
  recentBills,
}: {
  companies: Company[];
  parties: Party[];
  recentBills: ExpenseBill[];
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [previewBill, setPreviewBill] = useState<ExpenseBill | null>(null);
  const [newFormKey, setNewFormKey] = useState(0);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Log an Expense Bill</h2>
        <ExpenseBillForm
          key={`new-${newFormKey}`}
          companies={companies}
          parties={parties}
          onSaved={() => setNewFormKey((k) => k + 1)}
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent Entries</h2>
        <div className="max-h-[46rem] space-y-1.5 overflow-y-auto">
          {recentBills.map((bill) =>
            editingKey === bill.key ? (
              <div key={bill.key} className="rounded-lg border border-amber-300 bg-amber-50/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700">Editing {bill.invoiceNo ?? bill.date}</p>
                  <button
                    type="button"
                    onClick={() => setEditingKey(null)}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    Close
                  </button>
                </div>
                <ExpenseBillForm
                  companies={companies}
                  parties={parties}
                  initial={bill}
                  onSaved={() => {
                    setEditingKey(null);
                  }}
                />
              </div>
            ) : (
              <BillCard
                key={bill.key}
                bill={bill}
                onPreview={() => setPreviewBill(bill)}
                onEdit={() => setEditingKey(bill.key)}
              />
            )
          )}
          {recentBills.length === 0 && <p className="text-xs text-slate-400">No entries yet.</p>}
        </div>
      </div>

      {previewBill && <BillPreviewDialog bill={previewBill} onClose={() => setPreviewBill(null)} />}
    </div>
  );
}

function BillCard({
  bill,
  onPreview,
  onEdit,
}: {
  bill: ExpenseBill;
  onPreview: () => void;
  onEdit: () => void;
}) {
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    if (!window.confirm(`Delete ${bill.partyName ?? bill.invoiceNo ?? "this entry"} (₹${bill.total.toFixed(2)})?`)) return;
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteExpenseAction(bill.rowIds);
      if (result.error) setDeleteError(result.error);
      else router.refresh();
    });
  }

  const firstCategory = bill.items[0]?.category ?? "Expense";
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-slate-900">
            {firstCategory}
            {bill.items.length > 1 ? ` +${bill.items.length - 1} more` : ""}
          </div>
          <div className="text-slate-400">
            {bill.companyName} · {bill.date}
            {bill.paymentMode ? ` · ${bill.paymentMode}` : ""}
          </div>
          {(bill.partyName || bill.invoiceNo || bill.invoiceDate) && (
            <div className="mt-0.5 text-slate-500">
              {[bill.partyName, bill.invoiceNo ? `Inv ${bill.invoiceNo}` : null, bill.invoiceDate]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
          {bill.remark && <div className="mt-0.5 text-slate-500">{bill.remark}</div>}
        </div>
        <div className="shrink-0 text-right font-semibold text-slate-800">₹{bill.total.toFixed(2)}</div>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
        <p className="text-red-600">{deleteError}</p>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={onPreview}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleDelete}
            className="rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
          >
            {isPending ? "…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BillPreviewDialog({ bill, onClose }: { bill: ExpenseBill; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 print:hidden">
      <div className="my-8 w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <div>
            <p className="text-sm font-semibold text-slate-800">Office Expense Bill</p>
            <p className="text-[11px] text-slate-500">{bill.companyName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
        <div className="space-y-3 p-4 text-xs text-slate-700">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Expense date" value={bill.date} />
            <Field label="Party" value={bill.partyName ?? "—"} />
            <Field label="Invoice no." value={bill.invoiceNo ?? "—"} />
            <Field label="Invoice date" value={bill.invoiceDate ?? "—"} />
            <Field label="Payment mode" value={bill.paymentMode ?? "—"} />
            <Field label="Remark" value={bill.remark ?? "—"} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                  <th className="py-1 pr-2">#</th>
                  <th className="py-1 pr-2">Category</th>
                  <th className="py-1 pr-2">Description</th>
                  <th className="py-1 pr-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {bill.items.map((it, i) => (
                  <tr key={it.id} className="border-b border-slate-100">
                    <td className="py-1 pr-2">{i + 1}</td>
                    <td className="py-1 pr-2">{it.category}</td>
                    <td className="py-1 pr-2 text-slate-500">{it.description ?? "—"}</td>
                    <td className="py-1 pr-2 text-right">₹{it.amount.toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="font-semibold text-slate-900">
                  <td className="py-1 pr-2" colSpan={3}>
                    Total
                  </td>
                  <td className="py-1 pr-2 text-right">₹{bill.total.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="font-medium text-slate-700">{value}</p>
    </div>
  );
}

function ExpenseBillForm({
  companies,
  parties,
  initial,
  onSaved,
}: {
  companies: Company[];
  parties: Party[];
  initial?: ExpenseBill;
  onSaved?: () => void;
}) {
  const isEdit = Boolean(initial);
  const [state, formAction, pending] = useActionState(
    isEdit ? updateExpenseAction : saveExpenseAction,
    initialState
  );

  const [companyId, setCompanyId] = useState(initial?.companyId ?? "");
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [partyId, setPartyId] = useState(initial?.partyId ?? "");
  const [invoiceNo, setInvoiceNo] = useState(initial?.invoiceNo ?? "");
  const [invoiceDate, setInvoiceDate] = useState(initial?.invoiceDate ?? "");
  const [paymentMode, setPaymentMode] = useState(initial?.paymentMode ?? "");
  const [remark, setRemark] = useState(initial?.remark ?? "");
  const [items, setItems] = useState<DraftItem[]>(
    initial
      ? initial.items.map((it) => ({
          key: it.id,
          id: it.id,
          category: it.category,
          description: it.description ?? "",
          amount: String(it.amount),
        }))
      : [newDraft()]
  );

  // A save clears the form only once the server has actually accepted it —
  // the action's own state is the signal, never the click.
  useEffect(() => {
    if (state.success) onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const payload = items
    .filter((it) => it.category && Number(it.amount) > 0)
    .map((it) => ({
      id: it.id,
      category: it.category,
      description: it.description.trim() || null,
      amount: Number(it.amount),
    }));

  function updateItem(key: string, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">Saved.</p>}

      {isEdit && (
        <>
          <input type="hidden" name="entry_group_id" value={initial!.key} />
          <input type="hidden" name="row_ids" value={initial!.rowIds.join(",")} />
        </>
      )}
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor={`ee_company_${initial?.key ?? "new"}`}>Company *</label>
          <select
            id={`ee_company_${initial?.key ?? "new"}`}
            name="company_id"
            required
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className={inputClass}
          >
            <option value="" disabled>Select company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`ee_date_${initial?.key ?? "new"}`}>Date *</label>
          <input
            id={`ee_date_${initial?.key ?? "new"}`}
            name="expense_date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`ee_party_${initial?.key ?? "new"}`}>Party / Vendor</label>
          <select
            id={`ee_party_${initial?.key ?? "new"}`}
            name="party_id"
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
            className={inputClass}
          >
            <option value="">— No party (internal expense) —</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor={`ee_inv_no_${initial?.key ?? "new"}`}>Invoice No.</label>
            <input
              id={`ee_inv_no_${initial?.key ?? "new"}`}
              name="invoice_no"
              value={invoiceNo ?? ""}
              onChange={(e) => setInvoiceNo(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`ee_inv_date_${initial?.key ?? "new"}`}>Invoice Date</label>
            <input
              id={`ee_inv_date_${initial?.key ?? "new"}`}
              name="invoice_date"
              type="date"
              value={invoiceDate ?? ""}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor={`ee_mode_${initial?.key ?? "new"}`}>Payment Mode</label>
          <input
            id={`ee_mode_${initial?.key ?? "new"}`}
            name="payment_mode"
            placeholder="Cash / UPI / NEFT..."
            value={paymentMode ?? ""}
            onChange={(e) => setPaymentMode(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`ee_remark_${initial?.key ?? "new"}`}>Remark</label>
          <input
            id={`ee_remark_${initial?.key ?? "new"}`}
            name="remark"
            value={remark ?? ""}
            onChange={(e) => setRemark(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
          <p className="text-xs font-semibold text-slate-700">Items</p>
          <button
            type="button"
            onClick={() => setItems((prev) => [...prev, newDraft()])}
            className="rounded border border-amber-400 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-50"
          >
            + Add item
          </button>
        </div>
        <div className="space-y-2 p-2.5">
          {items.map((it, idx) => (
            <div key={it.key} className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-4">
                <label className={labelClass}>Category *</label>
                <select
                  value={it.category}
                  onChange={(e) => updateItem(it.key, { category: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Select</option>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-5">
                <label className={labelClass}>Description</label>
                <input
                  value={it.description}
                  onChange={(e) => updateItem(it.key, { description: e.target.value })}
                  placeholder={`Item ${idx + 1}`}
                  className={inputClass}
                />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={it.amount}
                  onChange={(e) => updateItem(it.key, { amount: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="col-span-1 pb-1.5">
                <button
                  type="button"
                  disabled={items.length === 1}
                  onClick={() => setItems((prev) => prev.filter((x) => x.key !== it.key))}
                  title="Remove this item"
                  className="w-full rounded border border-red-200 bg-red-50 px-1 py-1 text-xs text-red-600 hover:bg-red-100 disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          <div className="flex justify-end border-t border-slate-100 pt-2 text-xs font-semibold text-slate-800">
            Total: ₹{total.toFixed(2)}
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : isEdit ? "Save Changes" : "Save Bill"}
      </button>
    </form>
  );
}
