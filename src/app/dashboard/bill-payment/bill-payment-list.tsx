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
import { mergeDuplicateBills, type MergeBillsState } from "./merge-actions";
import { groupPartyOptions, type PartyOption } from "../documents/party-options";
import { RelatedNotesBadge } from "../documents/related-notes-badge";
import type { RelatedNote } from "../documents/actions";
import { CreditNotePanel, type AppliedCn } from "./credit-note-panel";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-0.5 block text-[11px] text-slate-400";
const initialBulkState: BulkPaymentState = { error: null, success: null };
const initialEditState: EditBillState = { error: null, success: false };
const initialMergeState: MergeBillsState = { error: null, success: null };

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
  // 2026-09-13 — applied credit-note adjustments (bill_pass_register_
  // adjustments joined to their credit_notes.cn_no) for the per-bill
  // Credit Notes panel below.
  credit_notes: AppliedCn[];
};

export function BillPaymentList({
  bills,
  parties,
  existingCreditNotes = [],
  isPaidLockedViewer = false,
}: {
  bills: PayableBillRow[];
  parties: PartyOption[];
  // 2026-09-13 — this company(ies)' recent credit notes, for the panel's
  // "link an existing credit note" dropdown.
  existingCreditNotes?: { id: string; cn_no: string | null; credit_note_date: string; refund_amount: number }[];
  // 2026-09-13 — "payment ho gaya ho to phir uski entry edit SIRF ADMIN SE
  // ho": true when the signed-in user is not an Admin (Admin = holds
  // permissions_admin); the bill edit form AND the credit-note panel of
  // any bill with total_paid > 0 lock themselves when it's set.
  isPaidLockedViewer?: boolean;
}) {
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

  // 2026-09-14 — "AGAR ESE KOI INVOICE AAYE TO USKO MERGE KARNE KA OPTION
  // BANANA HAI": among the SELECTED groups, detect the same invoice
  // (party + vendor invoice no. + type) appearing under DIFFERENT
  // companies — exactly the Nyko Mart/Rugara/CASA ARRA split. When ≥2
  // companies hold one identical invoice, a merge bar offers to pick a
  // KEEPER company and fold the other rows into it (payments + CN/DN
  // adjustments move to the keeper; losers are zeroed and tagged, never
  // deleted). Guarded against grouped invoices (one company's own
  // multi-item group) — those already display as one row and must not
  // fold into a different company's row.
  const mergeCandidates = useMemo(() => {
    const byInvoice = new Map<string, PayableBillRow[]>();
    for (const g of selectedGroups) {
      if (g.isGroup) continue; // multi-item purchase-bill groups never merge cross-company
      const first = g.bills[0];
      if (!first.party_id || !first.vendor_invoice_no) continue;
      const key = `${first.party_id}|${first.vendor_invoice_no.toLowerCase().trim()}|${first.invoice_type ?? ""}`;
      const list = byInvoice.get(key) ?? [];
      list.push(first);
      byInvoice.set(key, list);
    }
    for (const list of byInvoice.values()) {
      const companies = new Set(list.map((b) => b.company_id));
      if (list.length >= 2 && companies.size >= 2) return list;
    }
    return null;
  }, [selectedGroups]);

  const [mergeCompany, setMergeCompany] = useState("");
  const keeperRow = mergeCandidates?.find((b) => b.company_id === mergeCompany) ?? mergeCandidates?.[0];
  const mergeLoserIds = (mergeCandidates ?? []).filter((b) => b.id !== keeperRow?.id).map((b) => b.id);

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
                <GroupRow
                  key={g.key}
                  group={g}
                  parties={parties}
                  existingCreditNotes={existingCreditNotes}
                  isPaidLockedViewer={isPaidLockedViewer}
                  checked={selected.has(g.key)}
                  onToggle={() => toggle(g.key)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {mergeCandidates && keeperRow && (
        <MergeBar
          candidates={mergeCandidates}
          keeper={keeperRow}
          loserIds={mergeLoserIds}
          mergeCompany={mergeCompany}
          setMergeCompany={setMergeCompany}
          onDone={() => setSelected(new Set())}
        />
      )}

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
  existingCreditNotes,
  isPaidLockedViewer,
  checked,
  onToggle,
}: {
  group: BillGroup<PayableBillRow>;
  parties: PartyOption[];
  existingCreditNotes: { id: string; cn_no: string | null; credit_note_date: string; refund_amount: number }[];
  isPaidLockedViewer: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const [payOpen, setPayOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cnOpen, setCnOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editState, editFormAction, editPending] = useActionState(updateBillPassRegisterEntry, initialEditState);

  const first = group.bills[0];
  const overdue = first.due_date && new Date(first.due_date) < new Date();
  // 2026-08-17: only manually-entered/imported rows (source IS NULL) are
  // safe to edit directly here. A grouped row is always source =
  // 'purchase_bill' (see bill-grouping.ts), so it's never editable here —
  // consistent with the pre-existing rule, unaffected by grouping.
  const editable = !first.source && !group.isGroup;
  // 2026-09-13 — "payment ho gaya ho to phir uski entry edit sirf ADMIN se
  // ho": a bill with payments recorded is locked for editing unless the
  // viewer is an Admin. (Server side enforces it too — see
  // updateBillPassRegisterEntry.)
  const editLockedForPayments = isPaidLockedViewer && first.total_paid > 0;
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
        <td className="whitespace-nowrap px-3 py-2 text-slate-600">
          {first.party_name ?? "—"}
          {/* 2026-09-13 — \"ladger to bill master ke sath usme hi dikhna
              chahiye\": the party's full ledger (bills + partial payments
              + CN/DN adjustments, passbook format) is one click from the
              bill row itself — no need to route through Party Master. */}
          {first.party_id && (
            <Link
              href={`/dashboard/parties/${first.party_id}/ledger?allCompanies=1`}
              target="_blank"
              title="Open this party's full ledger (bills, payments, credit/debit notes)"
              className="ml-1 text-[11px] text-teal-700 underline decoration-dotted hover:text-teal-900"
            >
              📒 ledger
            </Link>
          )}
        </td>
        <td className={`whitespace-nowrap px-3 py-2 ${overdue ? "font-semibold text-red-600" : "text-slate-600"}`}>
          {first.due_date ?? "—"}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{toBePay.toFixed(2)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{totalPaid.toFixed(2)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-900">{balanceDue.toFixed(2)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right space-x-2">
          {editable && !editLockedForPayments ? (
            <button type="button" onClick={() => setEditOpen((v) => !v)} className="text-xs font-semibold text-slate-600 hover:underline">
              {editOpen ? "Cancel" : "✏️ Edit"}
            </button>
          ) : editable && editLockedForPayments ? (
            <span className="text-[11px] text-amber-600" title="Payments recorded on this bill — only an Admin can edit its entry.">
              🔒 admin only
            </span>
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
              vendor/invoice concept to fit the JV template.
              2026-09-02 fix — "jv item ke against me nahi banegi invoice ke
              against me banegi bataya tha na": there was already only ever
              ONE Journal Voucher per real invoice (createJournalVoucherForBill
              resolves and dedupes across the whole multi-item group
              regardless of which item's id you pass it) — but this link used
              to be hidden for grouped rows in favor of a separate "JV" icon
              on EVERY item in the expanded breakdown below, which visually
              read as "one JV per item". Now shown here unconditionally
              (any member of the group resolves to the same JV, so first.id
              is fine), and the misleading per-item icons are gone — see
              below. */}
          {first.party_id && (
            <Link
              href={`/dashboard/documents/journal-vouchers/by-bill/${first.id}`}
              target="_blank"
              className="text-xs font-semibold text-slate-600 hover:underline"
            >
              🖨 JV
            </Link>
          )}
          {/* 2026-09-13 (visibility fix) — was a bare teal text-link that
              blended into the row's far-right actions cell and users could
              not find it ("ye kaha par hai mujhe to dikh nahi raha"). Now
              a filled chip — same visual weight as everything else in the
              actions column, impossible to miss. */}
          <button
            type="button"
            onClick={() => setCnOpen((v) => !v)}
            className={cnOpen ? "rounded-md bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-300" : "rounded-md bg-teal-600 px-2 py-1 text-xs font-semibold text-white shadow-sm hover:bg-teal-700"}
            title="Apply one or more credit notes against this bill (Purchase / Courier / Duty — any bill type)"
          >
            {cnOpen ? "Cancel" : `🧾 Credit Notes${group.bills.some((b) => b.credit_notes.length > 0) ? ` (${group.bills.reduce((s, b) => s + b.credit_notes.length, 0)})` : ""}`}
          </button>
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
                </tr>
              </thead>
              <tbody>
                {/* No per-item JV link here — see the header row's own "🖨
                    JV" link above (2026-09-02 fix): one Journal Voucher
                    represents the WHOLE invoice, so it belongs at the
                    invoice/group level, not repeated once per item. */}
                {group.bills.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-1 text-slate-600">{b.id.slice(0, 8)}</td>
                    <td className="px-2 py-1 text-right text-slate-600">{b.to_be_pay.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right text-slate-600">{b.total_paid.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right font-medium text-slate-800">{b.balance_due.toFixed(2)}</td>
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
      {cnOpen && (
        <tr>
          {/* One panel per underlying bill (a grouped invoice's items can
              each carry their own credit notes, mirroring how payments are
              recorded per item) — for the common single-bill row this is
              just one panel. */}
          <CreditNotePanel
            billId={first.id}
            billLabel={first.invoice_no || first.vendor_invoice_no || first.id.slice(0, 8)}
            billType={first.invoice_type}
            partyId={first.party_id}
            manualCreditNoteAmt={first.credit_note_amt}
            applied={first.credit_notes}
            existingNotes={existingCreditNotes}
            isPaidLocked={isPaidLockedViewer && first.total_paid > 0}
          />
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

// -----------------------------------------------------------------------
// 2026-09-14 — the cross-company invoice merge bar ("AGAR ESE KOI INVOICE
// AAYE TO USKO MERGE KARNE KA OPTION BANANA HAI"). Appears whenever the
// current checkbox selection contains the SAME invoice (same party +
// vendor invoice no. + type) under 2+ DIFFERENT companies. Pick which
// company keeps the invoice; every other row folds into it — payments
// (recorded on any company's row) and Credit/Debit-Note adjustments all
// move onto the keeper so the combined paid/balance shows in ONE place,
// while the folded rows stay in the table as zeroed, tagged audit rows
// (never deleted). See merge-actions.ts for the server half.
// -----------------------------------------------------------------------
function MergeBar({
  candidates,
  keeper,
  loserIds,
  mergeCompany,
  setMergeCompany,
  onDone,
}: {
  candidates: PayableBillRow[];
  keeper: PayableBillRow;
  loserIds: string[];
  mergeCompany: string;
  setMergeCompany: (v: string) => void;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(mergeDuplicateBills, initialMergeState);

  useEffect(() => {
    if (state.success) {
      const t = setTimeout(onDone, 2500);
      return () => clearTimeout(t);
    }
  }, [state.success, onDone]);

  const combinedPaid = candidates.reduce((s, b) => s + b.total_paid, 0);
  const combinedBalance = candidates.reduce((s, b) => s + b.balance_due, 0);
  const keeperName = (mergeCompany ? candidates.find((b) => b.company_id === mergeCompany) : keeper)?.company_name ?? keeper.company_name;

  return (
    <div className="sticky bottom-3 mt-3 rounded-xl border border-teal-300 bg-teal-50 p-3 shadow-lg">
      {state.success ? (
        <p className="text-sm font-semibold text-teal-800">
          ✅ Merged {state.success.mergedCount} entr{state.success.mergedCount === 1 ? "y" : "ies"} into {state.success.keeperInvoiceNo} ({state.success.keeperCompany}) — {state.success.movedPayments} payment{state.success.movedPayments === 1 ? "" : "s"} and {state.success.movedAdjustments} note adjustment{state.success.movedAdjustments === 1 ? "" : "s"} moved. Refreshing…
        </p>
      ) : (
        <form action={formAction} className="space-y-2">
          <input type="hidden" name="bill_ids_json" value={JSON.stringify([keeper.id, ...loserIds])} />
          <p className="text-sm font-semibold text-teal-900">
            🔗 Same invoice in {new Set(candidates.map((b) => b.company_name)).size} companies — merge into one?
          </p>
          <p className="text-xs text-teal-700">
            {candidates.map((b) => `${b.company_name}: ${b.invoice_no || b.vendor_invoice_no} (₹${b.balance_due.toFixed(2)} due)`).join(" · ")} —
            combined paid ₹{combinedPaid.toFixed(2)}, balance ₹{combinedBalance.toFixed(2)}.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-0.5 block text-[11px] text-teal-700" htmlFor="merge-keeper">Keep in company</label>
              <select
                id="merge-keeper"
                value={mergeCompany || keeper.company_id}
                onChange={(e) => setMergeCompany(e.target.value)}
                className="rounded-lg border border-teal-300 bg-white px-2 py-1 text-sm text-slate-900"
              >
                {candidates.map((b) => (
                  <option key={b.id} value={b.company_id}>
                    {b.company_name} — {b.invoice_no || b.vendor_invoice_no}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={pending || loserIds.length === 0}
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-40"
            >
              {pending ? "Merging…" : `🔗 Merge ${loserIds.length + 1} entries into ${keeperName}`}
            </button>
            <p className="text-[11px] text-teal-600">
              Payments + CN/DN adjustments fold into the keeper; other rows stay as zeroed audit entries (never deleted).
            </p>
          </div>
          {state.error && <p className="text-sm font-medium text-red-600">{state.error}</p>}
        </form>
      )}
    </div>
  );
}
