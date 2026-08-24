"use client";

import { useState, useTransition } from "react";
import { enrollTwoFactor, confirmTwoFactorEnrollment, unenrollTwoFactor, type EnrollResult } from "./two-factor-actions";

const inputClass =
  "w-full max-w-[200px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500";

export function TwoFactorSection({ initialStatus }: { initialStatus: { enrolled: boolean; factorId: string | null } }) {
  const [enrolled, setEnrolled] = useState(initialStatus.enrolled);
  const [factorId, setFactorId] = useState(initialStatus.factorId);
  const [enrollData, setEnrollData] = useState<EnrollResult | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleStart() {
    setError("");
    startTransition(async () => {
      const r = await enrollTwoFactor();
      if (r.error) setError(r.error);
      else setEnrollData(r);
    });
  }

  function handleConfirm() {
    if (!enrollData?.factorId) return;
    setError("");
    startTransition(async () => {
      const r = await confirmTwoFactorEnrollment(enrollData.factorId!, code);
      if (r.error) setError(r.error);
      else {
        setEnrolled(true);
        setFactorId(enrollData.factorId);
        setEnrollData(null);
        setCode("");
      }
    });
  }

  function handleDisable() {
    if (!factorId) return;
    setError("");
    startTransition(async () => {
      const r = await unenrollTwoFactor(factorId);
      if (r.error) setError(r.error);
      else {
        setEnrolled(false);
        setFactorId(null);
        setConfirmingDisable(false);
      }
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-800">Two-Factor Authentication (2FA)</h2>
      <p className="mt-1 text-xs text-slate-500">
        Adds a 6-digit code from an authenticator app (Google Authenticator, Authy, etc.) on top of your password at
        login.
      </p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-800">{error}</p>}

      {enrolled && !confirmingDisable && (
        <div className="mt-3 flex items-center gap-3">
          <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">✓ Enabled</span>
          <button
            type="button"
            onClick={() => setConfirmingDisable(true)}
            className="rounded border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Disable 2FA
          </button>
        </div>
      )}

      {enrolled && confirmingDisable && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className="text-slate-600">Disable 2FA on your account?</span>
          <button
            type="button"
            disabled={isPending}
            onClick={handleDisable}
            className="rounded border border-red-300 bg-white px-2 py-1 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Confirm disable
          </button>
          <button type="button" onClick={() => setConfirmingDisable(false)} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-500 hover:bg-slate-50">
            Cancel
          </button>
        </div>
      )}

      {!enrolled && !enrollData && (
        <button
          type="button"
          disabled={isPending}
          onClick={handleStart}
          className="mt-3 rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
        >
          {isPending ? "Starting..." : "Enable 2FA"}
        </button>
      )}

      {!enrolled && enrollData && (
        <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs text-slate-600">
            Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
          </p>
          {enrollData.qrCode && (
            // eslint-disable-next-line @next/next/no-img-element -- data: URI from Supabase, not a static/remote asset
            <img src={enrollData.qrCode} alt="2FA QR code" className="h-40 w-40 rounded border border-slate-200 bg-white p-2" />
          )}
          {enrollData.secret && (
            <p className="text-xs text-slate-400">
              Can&apos;t scan? Enter this key manually: <code className="rounded bg-white px-1 py-0.5">{enrollData.secret}</code>
            </p>
          )}
          <div className="flex items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">6-digit code</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                placeholder="123456"
                className={inputClass}
              />
            </div>
            <button
              type="button"
              disabled={isPending || code.length !== 6}
              onClick={handleConfirm}
              className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
            >
              {isPending ? "Verifying..." : "Verify & Enable"}
            </button>
            <button type="button" onClick={() => setEnrollData(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:bg-white">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
