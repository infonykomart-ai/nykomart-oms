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

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocating(true);
    try {
      const geo = await geolocationBestEffort();
      const fd = new FormData(e.currentTarget);
      if (geo) {
        fd.set("lat", String(geo.lat));
        fd.set("lng", String(geo.lng));
        fd.set("accuracy_m", String(geo.accuracyM));
      }
      formAction(fd);
    } finally {
      setLocating(false);
    }
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
