"use client";

import { useActionState, useRef, useEffect } from "react";
import { submitLeaveRequest, type LeaveActionState } from "./actions";

const initialState: LeaveActionState = { error: null, success: false };

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export function LeaveRequestForm({ today }: { today: string }) {
  const [state, formAction, pending] = useActionState(submitLeaveRequest, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-700">🏖️ Apply for Leave</p>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}
      {state.success && state.message && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{state.message}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>From Date *</label>
          <input type="date" name="from_date" min={today} required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>To Date *</label>
          <input type="date" name="to_date" min={today} required className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass}>Application / Reason *</label>
        <textarea name="reason" required rows={3} placeholder="Why are you requesting leave?" className={inputClass} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Sending..." : "Send for MD Approval"}
      </button>
    </form>
  );
}
