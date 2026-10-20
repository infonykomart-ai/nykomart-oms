"use client";

import { useActionState, useRef, useEffect, useState } from "react";
import { submitLeaveRequest, type LeaveActionState } from "./actions";

const initialState: LeaveActionState = { error: null, success: false };

// 2026-10-17 — "usme date & time nahi aata with location": same one-shot
// best-effort geolocation as the punch buttons (punch-buttons.tsx). Denied
// permission / unsupported browser / slow fix all resolve to null and the
// application still submits WITHOUT coordinates — GPS can never block a
// leave application. maximumAge 60s lets a cached fix answer instantly.
async function geolocationBestEffort(): Promise<{ lat: number; lng: number; accuracyM: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60_000 }
      );
    } catch {
      resolve(null);
    }
  });
}

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type LeaveTypeOption = { id: string; name: string; code: string | null; paid: boolean };
export type ApproverOption = { employee_id: string; name: string };

export function LeaveRequestForm({
  today,
  leaveTypes = [],
  approvers = [],
}: {
  today: string;
  leaveTypes?: LeaveTypeOption[];
  approvers?: ApproverOption[];
}) {
  const [state, formAction, pending] = useActionState(submitLeaveRequest, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  // "Waiting for location fix" — shown between the click and the action
  // dispatch so the button never looks dead while geolocation resolves.
  const [locating, setLocating] = useState(false);
  // 2026-10-20 — "ek leave application agar back date me daalni pade to uska
  // bhi karna": the From date is no longer pinned to today (min={today} was
  // the only thing blocking a back-dated application — the server has always
  // accepted past dates and the approval step writes Attendance for every
  // day in the range). Tracked in state only so the To date can be bounded
  // by it instead of by today.
  const [fromDate, setFromDate] = useState("");
  // React's documented "adjust state when a prop/state value changes"
  // pattern (same one stock-in-form.tsx uses) instead of setState inside an
  // effect — lint's react-hooks/set-state-in-effect forbids the latter, and
  // a render-phase update here can't cascade an extra render. `prevState`
  // only changes identity on a fresh useActionState result.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    // The DOM reset below clears the uncontrolled fields; the controlled
    // From date has to be cleared here or it would survive into the next
    // application (and keep bounding the To date).
    if (state.success) setFromDate("");
  }

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // 2026-10-20 — "leave to abhi bhi submit nahi hori": read the form
    // SYNCHRONOUSLY, before any await. React nulls e.currentTarget as soon
    // as this handler returns (executeDispatch → event.currentTarget = null),
    // so building FormData AFTER `await geolocationBestEffort()` was really
    // `new FormData(null)` → TypeError → the server action was never
    // dispatched and the click silently did nothing (only an unhandled
    // rejection in the console). The form values must be snapshotted here.
    const fd = new FormData(e.currentTarget);
    setLocating(true);
    try {
      const geo = await geolocationBestEffort();
      if (geo) {
        fd.set("lat", String(geo.lat));
        fd.set("lng", String(geo.lng));
        fd.set("accuracy_m", String(geo.accuracyM));
      }
    } catch {
      // GPS can never block an application — submit without coordinates.
    } finally {
      setLocating(false);
    }
    formAction(fd);
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-700">🏖️ Apply for Leave</p>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}
      {state.success && state.message && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{state.message}</p>}

      {leaveTypes.length > 0 && (
        <div>
          <label className={labelClass}>Leave Type</label>
          <select name="leave_type_id" defaultValue="" className={inputClass}>
            <option value="">— General / Unspecified —</option>
            {leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.code ? ` (${t.code})` : ""}
                {!t.paid ? " — Unpaid" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {approvers.length > 0 && (
        <div>
          <label className={labelClass}>Send for approval to</label>
          <select name="approver_employee_id" defaultValue="" className={inputClass}>
            <option value="">— MD / Admin —</option>
            {approvers.map((a) => (
              <option key={a.employee_id} value={a.employee_id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>From Date *</label>
          {/* No min: a back-dated (already-passed) leave has to be enterable
              — that is the whole point of this round. From-after-To is still
              rejected server-side (and the To field below is bounded by this
              date), so removing min cannot create an invalid range. */}
          <input
            type="date"
            name="from_date"
            required
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>To Date *</label>
          {/* min = the chosen From date (not today), so a single past day
              works and the range can never be backwards. */}
          <input type="date" name="to_date" min={fromDate || undefined} required className={inputClass} />
        </div>
      </div>
      <p className="text-[11px] text-slate-400">
        Back-dated leave bhi apply kar sakte hain — From date aaj ({today}) se pehle ki bhi ho sakti hai.
        Approve hone par us range ke dinon ki Attendance &quot;Leave&quot; mark hogi (jin dinon par koi
        Present punch nahi hai — wo din waise hi Present rahenge).
      </p>

      <div>
        <label className={labelClass}>Application / Reason *</label>
        <textarea name="reason" required rows={3} placeholder="Why are you requesting leave?" className={inputClass} />
      </div>

      <button
        type="submit"
        disabled={pending || locating}
        className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
      >
        {locating ? "📍 Locating..." : pending ? "Sending..." : "Submit Leave Application"}
      </button>
      <p className="text-[11px] text-slate-400">
        Your application is recorded with its date, time and (if you allow) location.
      </p>
    </form>
  );
}
