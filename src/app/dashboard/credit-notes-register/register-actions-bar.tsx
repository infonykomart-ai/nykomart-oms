"use client";

import { useActionState } from "react";
import { applyBillCreditNote, type ApplyCreditNoteState } from "@/app/dashboard/bill-payment/credit-note-actions";

const initialState: ApplyCreditNoteState = { error: null, success: false };

// One-click "wrap this bill's manual credit_note_amt into a real Credit
// Note document" button for the register page's backlog section — a thin
// wrapper around the same applyBillCreditNote(mode="register") action the
// Bill Payment panel uses, so the behavior (idempotence, no
// double-reduction) is defined in exactly one place.
export function CreditNoteRegisterActions({ billId, manualAmt }: { billId: string; manualAmt: number }) {
  const [state, formAction, pending] = useActionState(applyBillCreditNote, initialState);

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="bill_pass_register_id" value={billId} />
      <input type="hidden" name="mode" value="register" />
      {state.error && <span className="max-w-[260px] text-[11px] text-red-600">{state.error}</span>}
      {state.success && <span className="text-[11px] text-green-700">✓ Registered</span>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-teal-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {pending ? "Registering..." : `Register ₹${manualAmt.toFixed(2)}`}
      </button>
    </form>
  );
}
