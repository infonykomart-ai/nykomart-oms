"use client";

// 2026-08-17 — bulk payment selection added: "FEDEX KE YA UPS KE 5 BILL EK
// SATH PAYMENT KIYA HAI UN SABHI KO SELECT KAR KE EK SATH PAYMENT
// REFRANCE UPDATE KAR SAKE" — checkbox per row (+ a "select all for this
// party" shortcut, matching the FedEx/UPS example directly) feeds a
// bottom bar where payment date/mode/reference/remark are entered ONCE
// and applied to every selected bill; each bill's own amount defaults to
// its balance due but stays editable. See actions.ts's
// recordBulkBillPayment. The original single-row "Record Payment" inline
// form is unchanged for the common one-bill-at-a-time case.
//
// 2026-08-27 — "bill payment section me bhi alag alag dikha raha ahi": a
// multi-item/multi-order Purchase Bill's N bill_pass_register rows (one
// per item/order — see src/lib/bill-grouping.ts) now display as ONE row
// per invoice with combined To Be Pay/Paid/Balance Due. The payment
// ledger itself is UNCHANGED — a payment is still recorded per underlying
// bill_pass_register row, since each item can have its own balance — but
// "Record Payment" on a grouped row now opens a per-item amount
// breakdown (same UI/action as the existing multi-select bulk payment
// bar below) instead of a single amount field, so one bank transaction
// against the whole invoice can be entered in one place. Selection
// checkboxes now operate per GROUP (selecting a grouped row selects every
// underlying bill id), so the bulk bar still works across several
// different invoices/parties at once exactly as before.
import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { groupBills, type BillGroup } from "@/lib/bill-grouping";
import {
  recordBulkBillPayment,
  updateBillPassRegisterEntry,
  type BulkPaymentState,
  type EditBillState,
} from "./actions";
import { groupPartyOptions, type PartyOption } from "../documents/party-options";
import { RelatedNotesBadge } from "../documents/related-notes-badge";
import type { RelatedNote } from "../documents/actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-0.5 block text-[11px] text-slate-400";
const initialBulkState: BulkPaymentState = { error: null, success: null };
const initialEditState: EditBillState = { error: null, success: false };

export type PayableBillRow = {
  id: string;
  company_id: string;
  company_name: string;
  invoice_no: string | null;
  vendor_invoice_no: string | null;
  invoice_type: string | null;
  invoice_date: string | null;
  invoice_recv_date: string | null;
  party_id: string | null;
  party_name: string | null;
  party_type: string | null;
  source: string | null;
  due_date: string | null;
  total_amt: number;
  credit_note_amt: number;
  to_be_pay: number;
  total_paid: number;
  balance_due: number;
  remark: string | null;
  related_notes: RelatedNote[];
};

export function BillPaymentList({ bills, parties }: { bills: PayableBillRow[]; parties: PartyOption[] }) {
  const groups = useMemo(() => groupBills(bills), [bills]);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // group keys
  const [partyFilter, setPartyFilter] = useState("");

  const partyNames = useMemo(
    () => Array.from(new Set(bills.map((b) => b.party_name).filter((n): n is string => !!n))).sort(),
    [bills]
  );

  function toggle(groupKey: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === groups.length ? new Set() : new Set(groups.map((g) => g.key))));
  }

  function selectAllForParty() {
    if (!partyFilter) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const g of groups) if (g.bills[0].party_name === partyFilter) next.add(g.key);
      return next;
    });
  }

  const selectedGroups = groups.filter((g) => selected.has(g.key));
  const selectedBills = selectedGroups.flatMap((g) => g.bills);

  return (
    <div>
      {partyNames.length > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2">
          <span className="text-xs text-slate-500">Quick select:</span>
          <select
            value={partyFilter}
            onChange={(e) => setPartyFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
          >
            <option value="">Choose a party...</option>
            {partyNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={selectAllForParty}
            disabled={!partyFilter}
            className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
          >
            Select all bills for this party
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="ml-auto text-xs font-medium text-slate-500 hover:underline"
            >
              Clear selection ({selected.size})
            </button>
          )}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={groups.length > 0 && selected.size === groups.length}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Company</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Invoice No.</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Type</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Party</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Due Date</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">To Be Pay</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Paid</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Balance Due</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-slate-400">No outstanding bills. 🎉</td>
                </tr>
              )}
              {groups.map((g) => (
                <GroupRow key={g.key} group={g} parties={parties} checked={selected.has(g.key)} onToggle={() => toggle(g.key)} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedBills.length > 0 && (
        <PerBillAmountForm
          bills={selectedBills}
          title={`${selectedBills.length} bill${selectedBills.length === 1 ? "" : "s"} selected`}
          onDone={() => setSelected(new Set())}
          sticky
        />
      )}
    </div>
  );
}

function GroupRow({
  group,
  parties,
  checked,
  onToggle,
}: {
  group: BillGroup<PayableBillRow>;
  parties: PartyOption[];
  checked: boolean;
  onToggle: () => void;
}) {
  const [payOpen, setPayOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editState, editFormAction, editPending] = useActionState(updateBillPassRegisterEntry, initialEditState);

  const first = group.bills[0];
  const overdue = first.due_date && new Date(first.due_date) < new Date();
  // 2026-08-17: only manually-entered/imported rows (source IS NULL) are
  // safe to edit directly here. A grouped row is always source =
  // 'purchase_bill' (see bill-grouping.ts), so it's never editable here —
  // consistent with the pre-existing rule, unaffected by grouping.
  const editable = !first.source && !group.isGroup;
  const partyGroups = groupPartyOptions(parties);

  const toBePay = group.bills.reduce((sum, b) => sum + b.to_be_pay, 0);
  const totalPaid = group.bills.reduce((sum, b) => sum + b.total_paid, 0);
  const balanceDue = group.bills.reduce((sum, b) => sum + b.balance_due, 0);

  useEffect(() => {
    if (editState.success) {
      const t = setTimeout(() => setEditOpen(false), 1200);
      return () => clearTimeout(t);
    }
  }, [editState.success]);

  return (
    <>
      <tr className={group.isGroup ? "bg-amber-50/40" : undefined}>
        <td className="px-3 py-2">
          <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Select ${first.invoice_no ?? first.id}`} />
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{first.company_name}</td>
        <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">
          <div className="flex items-center gap-1.5">
            {group.isGroup && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="rounded border border-slate-300 px-1 text-[10px] text-slate-500 hover:bg-slate-100"
                aria-label={expanded ? "Collapse items" : "Expand items"}
              >
                {expanded ? "▾" : "▸"}
              </button>
            )}
            <span>{first.invoice_no || first.vendor_invoice_no || "—"}</span>
            {group.isGroup && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                {group.bills.length} items · 1 invoice
              </span>
            )}
            <RelatedNotesBadge notes={group.bills.flatMap((b) => b.related_notes)} />
          </div>
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-slate-600">{first.invoice_type ?? "—"}</td>
        <td className="whitespace-nowrap px-3 py-2 text-slate-600">{first.party_name ?? "—"}</td>
        <td className={`whitespace-nowrap px-3 py-2 ${overdue ? "font-semibold text-red-600" : "text-slate-600"}`}>
          {first.due_date ?? "—"}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{toBePay.toFixed(2)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{totalPaid.toFixed(2)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-900">{balanceDue.toFixed(2)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right space-x-2">
          {editable ? (
            <button type="button" onClick={() => setEditOpen((v) => !v)} className="text-xs font-semibold text-slate-600 hover:underline">
              {editOpen ? "Cancel" : "✏️ Edit"}
            </button>
          ) : (
            <span className="text-[11px] text-slate-400" title={group.isGroup ? "Grouped invoice — edit items via Purchase Bill" : `Auto-linked from ${first.source?.replace("_", " ")} — edit it there`}>
              (auto-linked)
            </span>
          )}
          {/* 2026-08-29 (evening) — "ek genral voutcher banega jo bhi bills
              honge unke liye": a JV auto-generates for every vendor bill
              the instant it lands here (see actions.ts's
              createJournalVoucherForBill) — this just links to it.
              party_id != null excludes Salary/Advance rows, which have no
              vendor/invoice concept to fit the JV template. A grouped
              (multi-item) invoice has one JV per underlying item — see the
              expanded-items table below instead. */}
          {!group.isGroup && first.party_id && (
            <Link
              href={`/dashboard/documents/journal-vouchers/by-bill/${first.id}`}
              target="_blank"
              className="text-xs font-semibold text-slate-600 hover:underline"
            >
              🖨 JV
            </Link>
          )}
          <button type="button" onClick={() => setPayOpen((v) => !v)} className="text-xs font-semibold text-amber-600 hover:underline">
            {payOpen ? "Cancel" : "Record Payment"}
          </button>
        </td>
      </tr>
      {expanded && group.isGroup && (
        <tr>
          <td colSpan={10} className="bg-slate-50 px-3 py-2">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400">
                  <th className="px-2 py-1 text-left font-medium">Item</th>
                  <th className="px-2 py-1 text-right font-medium">To Be Pay</th>
                  <th className="px-2 py-1 text-right font-medium">Paid</th>
                  <th className="px-2 py-1 text-right font-medium">Balance</th>
                  <th className="px-2 py-1 text-right font-medium">JV</th>
                </tr>
              </thead>
              <tbody>
                {group.bills.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-1 text-slate-600">{b.id.slice(0, 8)}</td>
                    <td className="px-2 py-1 text-right text-slate-600">{b.to_be_pay.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right text-slate-600">{b.total_paid.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right font-medium text-slate-800">{b.balance_due.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right">
                      <Link href={`/dashboard/documents/journal-vouchers/by-bill/${b.id}`} target="_blank" className="font-semibold text-slate-600 hover:underline">
                        🖨
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
      {editOpen && editable && (
        <tr>
          <td colSpan={10} className="bg-indigo-50 px-3 py-3">
            <form action={editFormAction} className="space-y-2">
              <input type="hidden" name="bill_pass_register_id" value={first.id} />
              {editState.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{editState.error}</p>}
              {editState.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Bill updated.</p>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <label className={labelClass}>Invoice No.</label>
                  <input name="invoice_no" defaultValue={first.invoice_no ?? ""} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Vendor Invoice No.</label>
                  <input name="vendor_invoice_no" defaultValue={first.vendor_invoice_no ?? ""} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Invoice Date</label>
                  <input name="invoice_date" type="date" defaultValue={first.invoice_date ?? ""} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Invoice Recv. Date</label>
                  <input name="invoice_recv_date" type="date" defaultValue={first.invoice_recv_date ?? ""} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Party</label>
                  <select name="party_id" defaultValue={first.party_id ?? ""} className={inputClass}>
                    <option value="">— No party —</option>
                    {partyGroups.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.parties.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Party Type</label>
                  <input name="party_type" defaultValue={first.party_type ?? ""} placeholder="Purchase / Courier / ..." className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Total Amt *</label>
                  <input name="total_amt" type="number" step="0.01" required defaultValue={first.total_amt} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Credit Note Amt</label>
                  <input name="credit_note_amt" type="number" step="0.01" defaultValue={first.credit_note_amt} className={inputClass} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Remark</label>
                <input name="remark" defaultValue={first.remark ?? ""} className={inputClass} />
              </div>
              <p className="text-[11px] text-slate-400">
                Total Paid isn&apos;t editable here — it&apos;s tracked only through Record Payment above, so it never drifts from the payment ledger.
              </p>
              <button
                type="submit"
                disabled={editPending}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {editPending ? "Saving..." : "Save Changes"}
              </button>
            </form>
          </td>
        </tr>
      )}
      {payOpen && (
        <tr>
          <td colSpan={10} className="bg-slate-50 px-3 py-3">
            <PerBillAmountForm
              bills={group.bills}
              title={group.isGroup ? "Record payment for this invoice (per item)" : undefined}
              onDone={() => setPayOpen(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Per-bill amount entry + one shared payment date/mode/reference/remark,
 * submitted via recordBulkBillPayment. Used both for a single grouped
 * invoice's "Record Payment" (one row per underlying item) and for the
 * sticky multi-select bar at the bottom (one row per selected bill,
 * possibly spanning several different invoices/parties) — same action
 * either way, since recordBulkBillPayment already handles a list of any
 * size, including one.
 */
function PerBillAmountForm({
  bills,
  title,
  onDone,
  sticky,
}: {
  bills: PayableBillRow[];
  title?: string;
  onDone: () => void;
  sticky?: boolean;
}) {
  const [state, formAction, pending] = useActionState(recordBulkBillPayment, initialBulkState);
  const total = bills.reduce((s, b) => s + b.balance_due, 0);

  return (
    <div className={sticky ? "sticky bottom-3 mt-3 rounded-xl border border-amber-300 bg-white p-3 shadow-lg" : "rounded-xl border border-amber-200 bg-white p-3"}>
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="bill_ids_json" value={JSON.stringify(bills.map((b) => b.id))} />

        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800">
            {title ?? `${bills.length} bill${bills.length === 1 ? "" : "s"}`} — ₹{total.toFixed(2)} total
          </p>
          <button type="button" onClick={onDone} className="text-xs font-medium text-slate-500 hover:underline">
            {sticky ? "Clear selection" : "Cancel"}
          </button>
        </div>

        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && (
          <div className="space-y-1 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
            {state.success.results.map((r) => (
              <p key={r.billId} className={r.ok ? "text-green-700" : "text-red-700"}>
                {r.ok ? "✓" : "✗"} {r.label} {r.error ? `— ${r.error}` : ""}
              </p>
            ))}
            <button type="button" onClick={onDone} className="mt-1 rounded border border-green-300 bg-white px-2 py-0.5 font-medium text-green-700 hover:bg-green-50">
              Done
            </button>
          </div>
        )}

        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
          {bills.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-600">
                {b.invoice_no || b.vendor_invoice_no || "—"} <span className="text-slate-400">· {b.party_name ?? "—"} (balance {b.balance_due.toFixed(2)})</span>
              </span>
              <input
                name={`amount_${b.id}`}
                type="number"
                step="0.01"
                max={b.balance_due}
                defaultValue={b.balance_due.toFixed(2)}
                className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-right text-xs"
              />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-0.5 block text-[11px] text-slate-400">Payment Date *</label>
            <input name="payment_date" type="date" required className={inputClass} />
          </div>
          <div>
            <label className="mb-0.5 block text-[11px] text-slate-400">Mode</label>
            <input name="payment_mode" placeholder="NEFT / Cheque / Cash" className={inputClass} />
          </div>
          <div>
            <label className="mb-0.5 block text-[11px] text-slate-400">Reference No.</label>
            <input name="reference_no" className={inputClass} />
          </div>
          <div>
            <label className="mb-0.5 block text-[11px] text-slate-400">Remark</label>
            <input name="remark" className={inputClass} />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {pending ? "Saving..." : `Save Payment for ${bills.length} bill${bills.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </form>
    </div>
  );
}
