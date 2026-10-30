"use client";

// 2026-10-29 — the Finance-ledger gate for Purchase / Printing bills.
//
// User: "jab tak usko finance ledger se company se bheja nahi jaye ... ledger
// ya bill pass register me reflect nahi hoga" and "baad me bhi finance ledger
// me bhejne ke baad bhi company change ki ja sake".
//
// One box per vendor invoice:
//  - NOT sent yet → pick the company that actually books this bill, confirm the
//    payable (pre-filled with the invoice's own grand total — editable for a
//    reviewed amount), press Send. Nothing has reached Bill Payment / Party
//    Ledger before this click.
//  - Already sent → shows which company holds it and offers Change company,
//    which MOVES the existing ledger row (payments and notes travel with it)
//    instead of forcing a delete + re-post (the old duplicate-entry trap).
import { useActionState, useEffect, useState } from "react";
import {
  moveBillFinanceCompany,
  sendPurchaseBillInvoiceToFinance,
  type FinancePostState,
  type SimpleResult,
} from "./actions";
import { RoundOffField } from "./round-off-field";

const initialPost: FinancePostState = { error: null, success: null };
const initialMove: SimpleResult = { error: null, success: false };
const inputClass =
  "rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

/**
 * 2026-10-29 — "finance ledger me bhejne ke baad bhi company change ki ja
 * sake": a one-line mover for a bill that is already in the Finance ledger
 * (Courier / Duty / anything with a bill_pass_register row). It MOVES the same
 * entry — payments and notes stay attached — instead of delete + re-post.
 */
export function FinanceCompanyMover({
  billPassRegisterId,
  currentCompanyId,
  companies,
}: {
  billPassRegisterId: string | null;
  currentCompanyId: string | null;
  companies: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(moveBillFinanceCompany, initialMove);
  if (!billPassRegisterId) return null;
  const current = currentCompanyId ?? companies[0]?.id ?? "";
  const nameOf = (id: string) => companies.find((c) => c.id === id)?.name ?? "—";
  return (
    <div className="mt-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
      {state.success ? (
        <span className="text-green-700">
          ✓ Company changed — the same Finance entry now sits in the new company.
          {state.notice && <span className="mt-0.5 block text-slate-600">{state.notice}</span>}
        </span>
      ) : (
        <form action={action} className="flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="bill_pass_register_id" value={billPassRegisterId} />
          <span>Booked in <strong>{nameOf(current)}</strong> —</span>
          <select name="company_id" defaultValue={current} className={inputClass} aria-label="Move this bill to another company">
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={pending}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            {pending ? "Moving…" : "↔ Change company"}
          </button>
          <span className="text-[10px] text-slate-400">keeps this invoice&apos;s number and payments</span>
        </form>
      )}
      {state.error && <p className="mt-0.5 text-red-700">{state.error}</p>}
    </div>
  );
}

export function PurchaseFinanceBox({
  billIds,
  companies,
  defaultCompanyId,
  total,
  sent,
  postedCount = 0,
  postedTotal = 0,
}: {
  billIds: string[];
  companies: { id: string; name: string }[];
  /** The bill's own company — pre-selected, but the booking company wins. */
  defaultCompanyId: string | null;
  /** Invoice payable (sum of the item rows) — the amount being posted. */
  total: number;
  /** Existing Finance entry for this invoice, if any. */
  sent: { billPassRegisterId: string; companyId: string } | null;
  /** How many of this invoice's item rows already have a ledger row. */
  postedCount?: number;
  /** What those already-posted rows add up to. */
  postedTotal?: number;
}) {
  const [postState, postAction, postPending] = useActionState(sendPurchaseBillInvoiceToFinance, initialPost);
  const [moveState, moveAction, movePending] = useActionState(moveBillFinanceCompany, initialMove);
  // 2026-11-01 — an invoice can be HALF booked ("ledger me 11,482.80 dikha
  // raha, aana 18,460 chahiye"): some item rows have a ledger row, the rest
  // never reached Finance. Only a fully booked invoice counts as sent; the
  // remaining amount is what its box offers to post, so the ledger can be
  // completed to the real bill total instead of staying short for ever.
  const fullyPosted = postedCount >= billIds.length;
  const partiallyPosted = postedCount > 0 && !fullyPosted;
  const remaining = Math.max(0, Math.round((total - postedTotal) * 100) / 100);
  const amountToPost = partiallyPosted ? remaining : total;

  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState(sent?.companyId || defaultCompanyId || companies[0]?.id || "");
  const [amount, setAmount] = useState(amountToPost.toFixed(2));

  // Keep the amount in step with the invoice (or with what is still unbooked)
  // until the server data changes — after a post the figure updates itself.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAmount(amountToPost.toFixed(2));
  }, [amountToPost]);

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? "—";

  if (sent && fullyPosted) {
    const current = sent.companyId;
    const moved = moveState.success;
    return (
      <div className="mt-1.5 rounded-lg border border-green-200 bg-green-50/60 px-2.5 py-1.5 text-[11px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-green-800">
            ✓ In Finance ledger · {companyName(current)} — showing in Bill Payment / Party Ledger under this same company.
          </span>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
          >
            {open ? "Close" : "↔ Change company"}
          </button>
        </div>
        {moved && (
          <p className="mt-1 text-green-700">
            Company changed — the same ledger entry (with its payments) now sits in the new company.
            {moveState.notice && <span className="mt-0.5 block text-slate-600">{moveState.notice}</span>}
          </p>
        )}
        {moveState.error && <p className="mt-1 text-red-700">{moveState.error}</p>}
        {open && (
          <form action={moveAction} className="mt-1.5 flex flex-wrap items-end gap-2">
            <input type="hidden" name="bill_pass_register_id" value={sent.billPassRegisterId} />
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-slate-500" htmlFor={`move_${sent.billPassRegisterId}`}>
                Move this bill to
              </label>
              <select id={`move_${sent.billPassRegisterId}`} name="company_id" defaultValue={current} className={inputClass}>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={movePending}
              className="rounded-lg bg-slate-800 px-3 py-1 font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {movePending ? "Moving…" : "Change company"}
            </button>
            <span className="text-[10px] text-slate-500">
              Payments, notes and the invoice number stay exactly as they are.
            </span>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-[11px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-amber-900">
          {partiallyPosted ? (
            <>
              ⚠ <strong>Partly</strong> in the Finance ledger — ₹{postedTotal.toFixed(2)} of ₹{total.toFixed(2)} is booked
              ({postedCount} of {billIds.length} items), so the ledger is short by ₹{remaining.toFixed(2)}.
            </>
          ) : (
            <>
              ⚠ Not in the Finance ledger yet — it will <strong>not</strong> appear in Bill Payment / Party Ledger until you send it.
            </>
          )}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded border border-amber-300 bg-white px-2 py-0.5 font-medium text-amber-700 hover:bg-amber-100"
        >
          {open ? "Close" : "➜ Send to Finance"}
        </button>
      </div>
      {postState.success && <p className="mt-1 text-green-700">{postState.success}</p>}
      {postState.error && <p className="mt-1 text-red-700">{postState.error}</p>}
      {open && (
        <form action={postAction} className="mt-1.5 space-y-1.5">
          <input type="hidden" name="purchase_bill_ids" value={JSON.stringify(billIds)} />
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-slate-500" htmlFor={`post_co_${billIds[0] ?? "x"}`}>
                Company that books this bill
              </label>
              <select
                id={`post_co_${billIds[0] ?? "x"}`}
                name="company_id"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className={inputClass}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-slate-500" htmlFor={`post_amt_${billIds[0] ?? "x"}`}>
                Amount payable{partiallyPosted ? " (still unbooked)" : ""}
              </label>
              <input
                id={`post_amt_${billIds[0] ?? "x"}`}
                name="total_amt"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${inputClass} w-28`}
              />
            </div>
            <div className="min-w-40 flex-1">
              <label className="mb-0.5 block text-[10px] font-medium text-slate-500" htmlFor={`post_rem_${billIds[0] ?? "x"}`}>
                Remark (optional)
              </label>
              <input id={`post_rem_${billIds[0] ?? "x"}`} name="remark" className={`${inputClass} w-full`} />
            </div>
            <button
              type="submit"
              disabled={postPending}
              className="rounded-lg bg-amber-500 px-3 py-1 font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {postPending ? "Sending…" : "Confirm — Send to Finance"}
            </button>
          </div>
          {/* 2026-10-29e — round-off belongs to this same moment: "kaha par
              kare — bill pass me roundoff ho jayega kya?" The Amount above is
              the invoice's gross; this signed figure is ADDED to it server-side
              before the ledger row is written, so Purchase / Printing reach
              Finance at the round figure too — same control Courier and Duty
              now use. */}
          <RoundOffField
            id={`post_ro_${billIds[0] ?? "x"}`}
            payable={Number(amount) || 0}
            label="Round Off at Bill Pass"
            hint="Applied to the amount posted to the Finance ledger — + rounds up, − rounds down."
          />
          <p className="text-[10px] text-slate-500">
            One ledger entry is created for this whole vendor invoice ({billIds.length} item{billIds.length === 1 ? "" : "s"}), in the
            company picked above.
          </p>
        </form>
      )}
    </div>
  );
}
