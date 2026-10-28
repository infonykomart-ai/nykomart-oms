"use client";

// Vendor Assignment history section (2026-09-08) — "order fill hone ke baad
// ek alag section: kis party ko diya, kis date; wapas aaye to received mark
// karo; galat party ko de diya to dobara assign karo". Deliberately its own
// visually-boxed section (amber-accented header, its own border/background)
// so it reads as clearly separate from the plain read-only order fields
// above it on this page — the user explicitly asked for "ek alag section",
// not another row folded into the existing status grid.
//
// Lightest-weight pattern that fits: no modal (this codebase's modal
// pattern, cancel-shipment-modal.tsx, is for a single destructive one-shot
// action popped over the page) — here the primary content itself (the
// history list) always needs to stay visible while adding/receiving, so
// this uses small inline expand-in-place forms instead, closer to
// order-edit-form.tsx's own inline-form style than to a modal overlay.
//
// Calls the vendor-assignment-actions.ts server actions directly with
// explicit arguments (not the (prevState, formData)/useActionState form
// pattern used by plain <form action> elsewhere in this app) since those
// actions are typed with explicit params — useTransition + local state here
// gives the same pending/error handling without forcing a FormData shape
// onto them.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createVendorAssignment,
  markVendorAssignmentReceived,
  type VendorAssignmentCycle,
} from "../vendor-assignment-actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function VendorAssignmentSection({
  orderId,
  parties,
  cycles,
  purchaseBillVendorName = null,
  purchaseBillLabel = null,
  plannedVendorName = null,
}: {
  orderId: string;
  parties: { id: string; name: string }[];
  cycles: VendorAssignmentCycle[];
  /**
   * 2026-10-28 — the vendor from the order's Purchase Bill (the real record
   * of who made the goods), and the invoice label. The section used to say
   * "Not assigned to any party yet" even after a Purchase Bill had been
   * entered against the order, because it only ever read
   * order_vendor_assignments — a separate, optional history. A bill IS a
   * vendor assignment, so it is shown here rather than hidden.
   */
  purchaseBillVendorName?: string | null;
  purchaseBillLabel?: string | null;
  /** orders.vendor_party_id — the vendor planned at order-entry time. */
  plannedVendorName?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignParty, setAssignParty] = useState("");
  const [assignDate, setAssignDate] = useState(todayISO());
  const [assignRemark, setAssignRemark] = useState("");

  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [receivedDate, setReceivedDate] = useState(todayISO());

  const latestCycle = cycles[0] ?? null; // listVendorAssignments returns newest-first
  const canMarkReceived = latestCycle && !latestCycle.received_date;

  function handleAssignSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!assignParty || !assignDate) {
      setError("Party and assigned date are required.");
      return;
    }
    startTransition(async () => {
      const result = await createVendorAssignment(orderId, assignParty, assignDate, assignRemark || null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setShowAssignForm(false);
      setAssignParty("");
      setAssignDate(todayISO());
      setAssignRemark("");
      router.refresh();
    });
  }

  function handleReceiveSubmit(e: React.FormEvent, assignmentId: string) {
    e.preventDefault();
    setError(null);
    if (!receivedDate) {
      setError("Received date is required.");
      return;
    }
    startTransition(async () => {
      const result = await markVendorAssignmentReceived(assignmentId, orderId, receivedDate);
      if (result.error) {
        setError(result.error);
        return;
      }
      setReceivingId(null);
      setReceivedDate(todayISO());
      router.refresh();
    });
  }

  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/30 p-3 text-xs print:hidden">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-semibold text-slate-700">Vendor Assignment History</p>
        {!showAssignForm && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setShowAssignForm(true);
            }}
            className="rounded-lg border border-amber-400 bg-white px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
          >
            {cycles.length > 0 || purchaseBillVendorName || plannedVendorName ? "+ Reassign / New Cycle" : "+ Assign to a Party"}
          </button>
        )}
      </div>

      {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-red-800">{error}</p>}

      {showAssignForm && (
        <form onSubmit={handleAssignSubmit} className="mb-3 space-y-2 rounded-lg border border-amber-300 bg-white p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="vendor-assign-party">Party *</label>
              <select
                id="vendor-assign-party"
                value={assignParty}
                onChange={(e) => setAssignParty(e.target.value)}
                required
                className={inputClass}
              >
                <option value="">Select a party</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="vendor-assign-date">Assigned Date *</label>
              <input
                id="vendor-assign-date"
                type="date"
                value={assignDate}
                onChange={(e) => setAssignDate(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="vendor-assign-remark">Remark</label>
              <input
                id="vendor-assign-remark"
                value={assignRemark}
                onChange={(e) => setAssignRemark(e.target.value)}
                placeholder="Optional"
                className={inputClass}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowAssignForm(false);
                setError(null);
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save Assignment"}
            </button>
          </div>
        </form>
      )}

      {cycles.length === 0 && purchaseBillVendorName ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-slate-700">
          <p>
            <span className="font-medium">Assigned to {purchaseBillVendorName}</span> — via Purchase Bill
            {purchaseBillLabel ? ` ${purchaseBillLabel}` : ""}.
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            The Purchase Bill against this order is the vendor record. Use “+ Reassign / New Cycle” below only if you
            also want a separate assign → receive history for it.
          </p>
        </div>
      ) : cycles.length === 0 && plannedVendorName ? (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700">
          <p>
            Planned vendor: <span className="font-medium">{plannedVendorName}</span> — no Purchase Bill or assignment
            cycle yet.
          </p>
        </div>
      ) : cycles.length === 0 ? (
        <p className="text-slate-500">Not assigned to any party yet.</p>
      ) : (
        <ul className="space-y-2">
          {cycles.map((c) => (
            <li key={c.id} className="rounded-lg border border-slate-200 bg-white p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-slate-700">Cycle {c.cycle_no}</span>{" "}
                  <span className="text-slate-600">— {c.party_name}</span>{" "}
                  <span className="text-slate-400">· assigned {c.assigned_date}</span>
                </div>
                <div>
                  {c.received_date ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                      Received {c.received_date}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">Not received yet</span>
                  )}
                </div>
              </div>
              {c.remark && <p className="mt-1 text-slate-500">Remark: {c.remark}</p>}

              {/* Only the latest cycle, and only while it's still unreceived,
                  gets the Mark Received action — an older superseded cycle
                  can't be marked from here (see markVendorAssignmentReceived's
                  own guard against a stale/old cycle clobbering the order's
                  current received_date mirror). */}
              {canMarkReceived && latestCycle && latestCycle.id === c.id && (
                <div className="mt-2 border-t border-slate-100 pt-2">
                  {receivingId === c.id ? (
                    <form onSubmit={(e) => handleReceiveSubmit(e, c.id)} className="flex flex-wrap items-end gap-2">
                      <div>
                        <label className={labelClass} htmlFor={`received-date-${c.id}`}>Received Date *</label>
                        <input
                          id={`received-date-${c.id}`}
                          type="date"
                          value={receivedDate}
                          onChange={(e) => setReceivedDate(e.target.value)}
                          required
                          className={inputClass}
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={isPending}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {isPending ? "Saving…" : "Confirm Received"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setReceivingId(null)}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setReceivingId(c.id);
                      }}
                      className="rounded-lg border border-emerald-400 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                    >
                      ✓ Mark Received
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
