"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  saveDutyBill,
  deleteDutyBill,
  assignDutyAwb,
  deleteDutyAwbAssignment,
  lookupOrderForReconciliation,
  bulkAssignDutyAwbs,
  updateDutyAwbAssignmentNotes,
  updateDutyBillDetails,
  type DocFormState,
  type ReconciliationLookup,
  type SimpleResult,
  type BulkAwbResult,
  type RelatedNote,
} from "./actions";
import { SendToFinanceForm } from "./freight-bill-section";
import { groupPartyOptions, type PartyOption } from "./party-options";
import { RelatedNotesBadge } from "./related-notes-badge";

const initialFormState: DocFormState = { error: null, success: null };
const initialSimple: SimpleResult = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type DutyBillAssignment = {
  id: string;
  order_ref_no: string;
  duty_tax_amt_usd: number | null;
  duty_tax_amt_inr: number | null;
  other_charge: number | null;
  gst_18pct: number | null;
  credit_note_no: string | null;
  credit_note_date: string | null;
  credit_note_amt: number | null;
  debit_note_no: string | null;
  debit_note_date: string | null;
  debit_note_amt: number | null;
  remark: string | null;
};

export type DutyBillRow = {
  id: string;
  invoice_no: string;
  invoice_date: string | null;
  duty_tax_amt_usd: number | null;
  duty_tax_amt_inr: number;
  gst_18pct_amt: number;
  gross_total_amt: number | null;
  credit_note_no: string | null;
  credit_note_date: string | null;
  credit_note_amt: number;
  disbursement_fee: number;
  courier_duty_charges_adj: number;
  total_payable_amt: number | null;
  assignments: DutyBillAssignment[];
  sentToFinance: boolean;
  // 2026-08-17: same optional vendor/party linkage as FreightBillRow — see
  // freight-bill-section.tsx's comment.
  vendor_party_id: string | null;
  vendor_name: string | null;
  // 2026-08-27 (later same day) — see freight-bill-section.tsx's
  // FreightBillRow.related_notes comment — same real linked-note preview.
  related_notes: RelatedNote[];
};

// Duty & Tax Bill (duty_tax_bills) — exact mirror of Courier Bill's shape:
// invoice-level header covering many AWBs/orders. Header now supports full
// edit (2026-08-17 round 2 — "SABHI PARKAR KE BILL"), assignments stay
// create + delete only. See freight-bill-section.tsx and actions.ts's
// header comment for the "why".
export function DutyBillSection({
  bills,
  companies,
  parties,
  filter,
}: {
  bills: DutyBillRow[];
  companies: { id: string; name: string }[];
  parties: PartyOption[];
  // 2026-08-22: current {vendor, from, to} filter values, same as
  // FreightBillSection's own `filter` prop — see that file's comment.
  filter: { vendor: string; from: string; to: string };
}) {
  const [state, formAction, pending] = useActionState(saveDutyBill, initialFormState);
  const partyGroups = groupPartyOptions(parties);

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">New Duty &amp; Tax Bill</h3>
        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
            Duty &amp; Tax Bill saved — <strong>{state.success.docNo}</strong>.
          </p>
        )}
        {/* 2026-08-17: same optional vendor/party dropdown as Courier Bill — see freight-bill-section.tsx's comment. */}
        <div>
          <label className={labelClass} htmlFor="db_party">Vendor / Courier Party</label>
          <select id="db_party" name="vendor_party_id" defaultValue="" className={inputClass}>
            <option value="">— Not linked to a party yet —</option>
            {partyGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.parties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="db_inv_no">Invoice No. *</label>
            <input id="db_inv_no" name="invoice_no" required className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="db_inv_date">Invoice Date</label>
            <input id="db_inv_date" name="invoice_date" type="date" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="db_usd">Duty/Tax Amt (USD)</label>
            <input id="db_usd" name="duty_tax_amt_usd" type="number" step="0.01" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="db_inr">Duty/Tax Amt (INR)</label>
            <input id="db_inr" name="duty_tax_amt_inr" type="number" step="0.01" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="db_gst">GST @18% Amt</label>
            <input id="db_gst" name="gst_18pct_amt" type="number" step="0.01" className={inputClass} />
          </div>
        </div>

        {/* 2026-08-12: "shipment ke against me courier ka credit note
            aagya" — optional, only fill in if the courier actually issued
            one against this invoice. */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="mb-1.5 text-xs font-medium text-amber-800">Courier Credit Note (if any) — whole-invoice level</div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelClass} htmlFor="db_cn_no">Credit Note No.</label>
              <input id="db_cn_no" name="credit_note_no" className={inputClass} placeholder="optional" />
            </div>
            <div>
              <label className={labelClass} htmlFor="db_cn_date">Credit Note Date</label>
              <input id="db_cn_date" name="credit_note_date" type="date" className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="db_cn_amt">Credit Note Amt</label>
              <input id="db_cn_amt" name="credit_note_amt" type="number" step="0.01" className={inputClass} placeholder="0" />
            </div>
          </div>
        </div>

        {/* 2026-08-12 (round 10): bottom-summary block off the real Duty
            Tax Bill document — manual, matches what the physical bill
            says, not a computed formula (see schema.sql's comment). */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-1.5 text-xs font-medium text-slate-600">Bottom Summary (off the physical bill)</div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelClass} htmlFor="db_disb">Disbursement Fee</label>
              <input id="db_disb" name="disbursement_fee" type="number" step="0.01" className={inputClass} placeholder="0" />
            </div>
            <div>
              <label className={labelClass} htmlFor="db_adj">Courier Duty Charges (adj.)</label>
              <input id="db_adj" name="courier_duty_charges_adj" type="number" step="0.01" className={inputClass} placeholder="0, can be negative" />
            </div>
            <div>
              <label className={labelClass} htmlFor="db_total">Total Payable Amt</label>
              <input id="db_total" name="total_payable_amt" type="number" step="0.01" className={inputClass} placeholder="off the bill" />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save Duty & Tax Bill"}
        </button>
      </form>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-700">Recent Duty &amp; Tax Bills</h3>
        <form method="get" action="/dashboard/documents" className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <input type="hidden" name="tab" value="duty-tax-bill" />
          <div>
            <label className="mb-0.5 block text-[11px] font-medium text-slate-500" htmlFor="dbVendor">Vendor / Courier</label>
            <select id="dbVendor" name="dbVendor" defaultValue={filter.vendor} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-amber-500">
              <option value="">All</option>
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
            <label className="mb-0.5 block text-[11px] font-medium text-slate-500" htmlFor="dbFrom">From</label>
            <input id="dbFrom" name="dbFrom" type="date" defaultValue={filter.from} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-amber-500" />
          </div>
          <div>
            <label className="mb-0.5 block text-[11px] font-medium text-slate-500" htmlFor="dbTo">To</label>
            <input id="dbTo" name="dbTo" type="date" defaultValue={filter.to} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-amber-500" />
          </div>
          <button type="submit" className="rounded-lg bg-slate-800 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700">
            Filter
          </button>
          <a href="/dashboard/documents?tab=duty-tax-bill" className="text-[11px] text-slate-400 underline">Clear</a>
        </form>
        {bills.map((b) => (
          <DutyBillCard key={b.id} bill={b} companies={companies} parties={parties} />
        ))}
        {bills.length === 0 && <p className="text-xs text-slate-400">None created yet.</p>}
      </div>
    </div>
  );
}

function DutyBillCard({ bill, companies, parties }: { bill: DutyBillRow; companies: { id: string; name: string }[]; parties: PartyOption[] }) {
  const [expanded, setExpanded] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [financeMode, setFinanceMode] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [editState, editAction, editPending] = useActionState(updateDutyBillDetails, initialSimple);
  const partyGroups = groupPartyOptions(parties);

  useEffect(() => {
    if (editState.success) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditMode(false);
    }
  }, [editState.success]);

  function handleDeleteBill() {
    if (!window.confirm(`Delete Duty & Tax Bill "${bill.invoice_no}"? This cannot be undone.`)) return;
    setDeleteError("");
    startTransition(async () => {
      const result = await deleteDutyBill(bill.id);
      if (result.error) setDeleteError(result.error);
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5 font-medium text-slate-900">
            {bill.invoice_no}
            <RelatedNotesBadge notes={bill.related_notes} />
          </div>
          <div className="text-slate-400">
            {bill.invoice_date ?? "—"} · {bill.assignments.length} AWB(s) assigned
            {bill.sentToFinance && <span className="ml-1 text-green-700">· ✓ in Bill Pass Register</span>}
          </div>
          <div className={bill.vendor_name ? "text-slate-500" : "text-amber-600"}>
            {bill.vendor_name ? `🚚 ${bill.vendor_name}` : "⚠ No vendor/courier party linked — won't appear in a Party Ledger"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-slate-700">₹{bill.total_payable_amt ?? bill.gross_total_amt ?? bill.duty_tax_amt_inr}</div>
          <div className="text-slate-400">
            Duty ₹{bill.duty_tax_amt_inr} + GST ₹{bill.gst_18pct_amt}
            {bill.duty_tax_amt_usd ? ` (≈ $${bill.duty_tax_amt_usd})` : ""}
          </div>
          {bill.credit_note_amt > 0 && (
            <div className="text-purple-700">
              CN {bill.credit_note_no ?? "—"} · −₹{bill.credit_note_amt}
            </div>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
        <p className="text-red-600">{deleteError}</p>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Link
            href={`/dashboard/documents/duty-bills/${bill.id}/report`}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
          >
            📄 Report / PDF
          </Link>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
          >
            {expanded ? "Hide AWBs" : "Assign / View AWBs"}
          </button>
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
          >
            ✏️ Edit Bill
          </button>
          {!bill.sentToFinance && (
            <button
              type="button"
              onClick={() => setFinanceMode((v) => !v)}
              className="rounded border border-green-200 bg-green-50 px-2 py-0.5 font-medium text-green-700 hover:bg-green-100"
            >
              💰 Send to Bill Pass Register
            </button>
          )}
          <button
            type="button"
            disabled={isPending}
            onClick={handleDeleteBill}
            className="rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      {editMode && (
        <form action={editAction} className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <input type="hidden" name="duty_tax_bill_id" value={bill.id} />
          {editState.error && <p className="rounded bg-red-50 px-2 py-1.5 text-red-800">{editState.error}</p>}
          <div>
            <label className={labelClass}>Vendor / Courier Party</label>
            <select name="vendor_party_id" defaultValue={bill.vendor_party_id ?? ""} className={inputClass}>
              <option value="">— Not linked to a party —</option>
              {partyGroups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.parties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <label className={labelClass}>Invoice No. *</label>
              <input name="invoice_no" required defaultValue={bill.invoice_no} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Invoice Date</label>
              <input name="invoice_date" type="date" defaultValue={bill.invoice_date ?? ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Duty/Tax Amt (USD)</label>
              <input name="duty_tax_amt_usd" type="number" step="0.01" defaultValue={bill.duty_tax_amt_usd ?? ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Duty/Tax Amt (INR)</label>
              <input name="duty_tax_amt_inr" type="number" step="0.01" defaultValue={bill.duty_tax_amt_inr} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>GST @18% Amt</label>
              <input name="gst_18pct_amt" type="number" step="0.01" defaultValue={bill.gst_18pct_amt} className={inputClass} />
            </div>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
            <div className="mb-1 text-[11px] font-medium text-amber-800">Courier Credit Note (if any)</div>
            <div className="grid grid-cols-3 gap-2">
              <input name="credit_note_no" defaultValue={bill.credit_note_no ?? ""} placeholder="Credit Note No." className={inputClass} />
              <input name="credit_note_date" type="date" defaultValue={bill.credit_note_date ?? ""} className={inputClass} />
              <input name="credit_note_amt" type="number" step="0.01" defaultValue={bill.credit_note_amt} placeholder="Amt" className={inputClass} />
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-2">
            <div className="mb-1 text-[11px] font-medium text-slate-600">Bottom Summary (off the physical bill)</div>
            <div className="grid grid-cols-3 gap-2">
              <input name="disbursement_fee" type="number" step="0.01" defaultValue={bill.disbursement_fee} placeholder="Disbursement Fee" className={inputClass} />
              <input name="courier_duty_charges_adj" type="number" step="0.01" defaultValue={bill.courier_duty_charges_adj} placeholder="Duty Charges (adj.)" className={inputClass} />
              <input name="total_payable_amt" type="number" step="0.01" defaultValue={bill.total_payable_amt ?? ""} placeholder="Total Payable Amt" className={inputClass} />
            </div>
          </div>
          {bill.sentToFinance && (
            <p className="text-[11px] text-slate-400">
              This bill is already in Bill Pass Register — Invoice No./Date/Vendor saved here also update that entry. Amount there stays as
              reviewed when it was sent (not auto-recalculated).
            </p>
          )}
          <button
            type="submit"
            disabled={editPending}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            {editPending ? "Saving..." : "Save Changes"}
          </button>
        </form>
      )}

      {financeMode && (
        <SendToFinanceForm
          billId={bill.id}
          kind="duty"
          companies={companies}
          defaultAmt={Number(bill.total_payable_amt ?? bill.gross_total_amt ?? bill.duty_tax_amt_inr ?? 0) - Number(bill.credit_note_amt ?? 0)}
          onDone={() => setFinanceMode(false)}
        />
      )}

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setBulkMode(false)}
              className={`rounded-full px-2.5 py-1 font-medium ${!bulkMode ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              One at a time
            </button>
            <button
              type="button"
              onClick={() => setBulkMode(true)}
              className={`rounded-full px-2.5 py-1 font-medium ${bulkMode ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Bulk (many AWBs at once)
            </button>
          </div>
          {bulkMode ? <BulkAssignAwbForm dutyTaxBillId={bill.id} /> : <AssignAwbForm dutyTaxBillId={bill.id} />}
          <div className="space-y-1.5">
            {bill.assignments.map((a) => (
              <AssignmentRow key={a.id} assignment={a} />
            ))}
            {bill.assignments.length === 0 && <p className="text-slate-400">No AWBs assigned yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function AssignAwbForm({ dutyTaxBillId }: { dutyTaxBillId: string }) {
  const [state, formAction, pending] = useActionState(assignDutyAwb, initialFormState);
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<ReconciliationLookup | null>(null);
  const [isLooking, startLookup] = useTransition();

  useEffect(() => {
    if (state.success) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      setLookup(null);
    }
  }, [state.success]);

  function handleLookup() {
    startLookup(async () => {
      const r = await lookupOrderForReconciliation(query, "duty");
      setLookup(r);
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <label className={labelClass}>Find order by PO/RF/RG or AWB No.</label>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleLookup())}
          placeholder="e.g. PO-0001 or AWB123456"
          className={inputClass}
        />
        <button
          type="button"
          onClick={handleLookup}
          disabled={isLooking}
          className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
        >
          {isLooking ? "..." : "Find"}
        </button>
      </div>

      {lookup?.error && <p className="mt-2 text-xs text-red-600">{lookup.error}</p>}

      {lookup?.order && (
        <div className="mt-2 space-y-1 rounded-lg bg-white p-2 text-xs text-slate-600">
          <p>
            <strong className="text-slate-900">{lookup.order.ref_no}</strong> · Sale Amt ₹{lookup.order.order_value_inr ?? "—"}
          </p>
          {lookup.dispatch ? (
            <p>
              AWB: {lookup.dispatch.awb_no ?? "—"} · {lookup.dispatch.courier_name ?? "—"} · {lookup.dispatch.buyer_country ?? "—"} ·{" "}
              {lookup.dispatch.shipping_weight_kg ?? "—"} kg
            </p>
          ) : (
            <p className="text-slate-400">No dispatch record found for this order yet.</p>
          )}
          {lookup.alreadyAssigned && <p className="text-amber-600">⚠ Already assigned to a Duty & Tax Bill.</p>}
        </div>
      )}

      {lookup?.order && !lookup.alreadyAssigned && (
        <form action={formAction} className="mt-3 space-y-2 border-t border-slate-200 pt-3">
          <input type="hidden" name="duty_tax_bill_id" value={dutyTaxBillId} />
          <input type="hidden" name="order_id" value={lookup.order.id} />
          <input type="hidden" name="order_shipment_id" value={lookup.orderShipmentId ?? ""} />
          {state.error && <p className="rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Duty/Tax Amt (USD)</label>
              <input name="duty_tax_amt_usd" type="number" step="0.01" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Duty/Tax Amt (INR)</label>
              <input name="duty_tax_amt_inr" type="number" step="0.01" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Other Charge</label>
              <input name="other_charge" type="number" step="0.01" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>GST @18%</label>
              <input name="gst_18pct" type="number" step="0.01" className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>Remark</label>
            <input name="remark" className={inputClass} />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            {pending ? "Assigning..." : "Assign to this Bill"}
          </button>
        </form>
      )}
    </div>
  );
}

function BulkAssignAwbForm({ dutyTaxBillId }: { dutyTaxBillId: string }) {
  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<
    { query: string; dutyTaxAmtUsd: string; dutyTaxAmtInr: string; otherCharge: string; gst18pct: string; remark: string }[]
  >([]);
  const [results, setResults] = useState<BulkAwbResult[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleParse() {
    const queries = raw
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
    setRows(queries.map((q) => ({ query: q, dutyTaxAmtUsd: "", dutyTaxAmtInr: "", otherCharge: "", gst18pct: "", remark: "" })));
    setResults(null);
  }

  function updateRow(i: number, patch: Partial<(typeof rows)[number]>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function handleAssignAll() {
    startTransition(async () => {
      const r = await bulkAssignDutyAwbs(
        dutyTaxBillId,
        rows.map((r) => ({
          query: r.query,
          dutyTaxAmtUsd: r.dutyTaxAmtUsd ? Number(r.dutyTaxAmtUsd) : null,
          dutyTaxAmtInr: r.dutyTaxAmtInr ? Number(r.dutyTaxAmtInr) : null,
          otherCharge: r.otherCharge ? Number(r.otherCharge) : null,
          gst18pct: r.gst18pct ? Number(r.gst18pct) : null,
          remark: r.remark || null,
        }))
      );
      setResults(r.results);
      // Match by position, not by query text — see the identical comment
      // in freight-bill-section.tsx's handleAssignAll for why.
      setRows((prev) => prev.filter((_, i) => !r.results[i]?.ok));
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <label className={labelClass}>Paste PO/RF/RG or AWB numbers — one per line (or comma-separated)</label>
      <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={3} className={inputClass} placeholder={"PO-0001\nPO-0002\nAWB123456"} />
      <button
        type="button"
        onClick={handleParse}
        className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
      >
        Look Up All
      </button>

      {results && (
        <div className="mt-2 space-y-1">
          {results.map((r, i) => (
            <p key={i} className={r.ok ? "text-green-700" : "text-red-700"}>
              {r.ok ? "✓" : "✗"} {r.refNo ?? r.query} — {r.ok ? "assigned" : r.error}
            </p>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <div key={r.query + i} className="grid grid-cols-6 items-end gap-1.5 rounded border border-slate-200 bg-white p-1.5">
              <div className="col-span-1 font-medium text-slate-800">{r.query}</div>
              <input value={r.dutyTaxAmtUsd} onChange={(e) => updateRow(i, { dutyTaxAmtUsd: e.target.value })} placeholder="USD" className={inputClass} />
              <input value={r.dutyTaxAmtInr} onChange={(e) => updateRow(i, { dutyTaxAmtInr: e.target.value })} placeholder="INR" className={inputClass} />
              <input value={r.otherCharge} onChange={(e) => updateRow(i, { otherCharge: e.target.value })} placeholder="Other" className={inputClass} />
              <input value={r.gst18pct} onChange={(e) => updateRow(i, { gst18pct: e.target.value })} placeholder="GST" className={inputClass} />
              <input value={r.remark} onChange={(e) => updateRow(i, { remark: e.target.value })} placeholder="Remark" className={inputClass} />
            </div>
          ))}
          <button
            type="button"
            disabled={isPending}
            onClick={handleAssignAll}
            className="w-full rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {isPending ? "Assigning..." : `Assign All (${rows.length})`}
          </button>
        </div>
      )}
    </div>
  );
}

function AssignmentRow({ assignment }: { assignment: DutyBillAssignment }) {
  const [deleteError, setDeleteError] = useState("");
  const [noteMode, setNoteMode] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [noteState, noteAction, notePending] = useActionState(updateDutyAwbAssignmentNotes, initialSimple);

  useEffect(() => {
    if (noteState.success) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNoteMode(false);
    }
  }, [noteState.success]);

  function handleDelete() {
    if (!window.confirm(`Remove AWB "${assignment.order_ref_no}" from this bill?`)) return;
    setDeleteError("");
    startTransition(async () => {
      const result = await deleteDutyAwbAssignment(assignment.id);
      if (result.error) setDeleteError(result.error);
    });
  }

  return (
    <div className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium text-slate-900">{assignment.order_ref_no}</span>
          <span className="ml-2 text-slate-400">
            ₹{assignment.duty_tax_amt_inr ?? 0}
            {assignment.duty_tax_amt_usd ? ` ($${assignment.duty_tax_amt_usd})` : ""} · GST ₹{assignment.gst_18pct ?? 0} · Other ₹
            {assignment.other_charge ?? 0}
          </span>
          {assignment.remark && <span className="ml-2 text-slate-400">· {assignment.remark}</span>}
        </div>
        <div className="flex items-center gap-2">
          <p className="text-red-600">{deleteError}</p>
          <button type="button" onClick={() => setNoteMode((v) => !v)} className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50">
            {noteMode ? "Cancel" : "+ Note"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleDelete}
            className="rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>
      {(assignment.credit_note_no || assignment.debit_note_no) && (
        <div className="mt-1 space-x-3 text-purple-700">
          {assignment.credit_note_no && <span>CN {assignment.credit_note_no} · −₹{assignment.credit_note_amt ?? 0}</span>}
          {assignment.debit_note_no && <span>DN {assignment.debit_note_no} · +₹{assignment.debit_note_amt ?? 0}</span>}
        </div>
      )}
      {noteMode && (
        <form action={noteAction} className="mt-2 space-y-1.5 rounded border border-purple-200 bg-purple-50 p-2">
          <input type="hidden" name="id" value={assignment.id} />
          {noteState.error && <p className="rounded bg-red-50 px-2 py-1 text-red-800">{noteState.error}</p>}
          <p className="font-medium text-purple-800">Credit / Debit Note — against this AWB specifically</p>
          <div className="grid grid-cols-3 gap-1.5">
            <input name="credit_note_no" defaultValue={assignment.credit_note_no ?? ""} placeholder="Credit Note No." className={inputClass} />
            <input name="credit_note_date" type="date" defaultValue={assignment.credit_note_date ?? ""} className={inputClass} />
            <input name="credit_note_amt" type="number" step="0.01" defaultValue={assignment.credit_note_amt ?? ""} placeholder="Amt" className={inputClass} />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <input name="debit_note_no" defaultValue={assignment.debit_note_no ?? ""} placeholder="Debit Note No." className={inputClass} />
            <input name="debit_note_date" type="date" defaultValue={assignment.debit_note_date ?? ""} className={inputClass} />
            <input name="debit_note_amt" type="number" step="0.01" defaultValue={assignment.debit_note_amt ?? ""} placeholder="Amt" className={inputClass} />
          </div>
          <button type="submit" disabled={notePending} className="rounded bg-purple-600 px-2 py-1 font-semibold text-white hover:bg-purple-700 disabled:opacity-50">
            {notePending ? "Saving..." : "Save Note"}
          </button>
        </form>
      )}
    </div>
  );
}
