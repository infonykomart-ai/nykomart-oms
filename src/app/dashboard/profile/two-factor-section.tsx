"use client";

/**
 * 2026-09-12 — restyle of the 2FA card to match the FedEx-style profile
 * redesign (rounded card, icon header, theme-token colors, a proper
 * switch-style control). All the enrollment flow logic — enroll → scan QR →
 * confirm code → verified, and the confirm-before-disable step — is
 * unchanged from the original 2026-08-24 implementation.
 */
import { useState, useTransition } from "react";
import { enrollTwoFactor, confirmTwoFactorEnrollment, unenrollTwoFactor, type EnrollResult } from "./two-factor-actions";

const inputClass =
  "w-full max-w-[200px] rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-canvas)] px-2.5 py-1.5 text-sm text-[var(--oms-text)] outline-none focus:border-[var(--oms-accent)] focus:ring-1 focus:ring-[var(--oms-accent)]";

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
    <div className="oms-card rounded-2xl border p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-lg">🛡️</span>
          <h3 className="text-sm font-semibold text-[var(--oms-text)]">Two-Factor Authentication</h3>
        </div>
        {/* FedEx-style switch — a labelled checkbox, styled as a toggle */}
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            role="switch"
            aria-label="Two-factor authentication"
            checked={enrolled}
            disabled={isPending}
            onChange={() => (enrolled ? setConfirmingDisable(true) : handleStart())}
            className="peer sr-only"
          />
          <span className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-[var(--oms-surface-border)] transition-colors peer-checked:bg-green-500 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--oms-accent)] after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
          <span className="w-8 text-xs font-semibold text-[var(--oms-text)]">{enrolled ? "ON" : "OFF"}</span>
        </label>
      </div>
      <p className="mt-2 text-xs text-[var(--oms-text-muted)]">
        Adds a 6-digit code from an authenticator app (Google Authenticator, Authy, etc.) on top of your password at
        login.
      </p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-800">{error}</p>}

      {enrolled && confirmingDisable && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs">
          <span className="text-[var(--oms-text)]">Turn off 2FA on your account?</span>
          <button
            type="button"
            disabled={isPending}
            onClick={handleDisable}
            className="rounded border border-red-300 bg-white px-2 py-1 font-semibold text-red-600 transition hover:bg-red-100 disabled:opacity-50"
          >
            Confirm off
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDisable(false)}
            className="rounded border border-[var(--oms-surface-border)] bg-white px-2 py-1 text-[var(--oms-text-muted)] transition hover:bg-[var(--oms-canvas)]"
          >
            Cancel
          </button>
        </div>
      )}

      {enrolled && !confirmingDisable && (
        <p className="mt-3 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-800">
          ✓ Enabled — a second factor is required at every login.
        </p>
      )}

      {!enrolled && enrollData && (
        <div className="mt-3 space-y-3 rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-canvas)] p-4">
          <p className="text-xs text-[var(--oms-text-muted)]">
            Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
          </p>
          {enrollData.qrCode && (
            // eslint-disable-next-line @next/next/no-img-element -- data: URI from Supabase, not a static/remote asset
            <img src={enrollData.qrCode} alt="2FA QR code" className="h-40 w-40 rounded border border-[var(--oms-surface-border)] bg-white p-2" />
          )}
          {enrollData.secret && (
            <p className="break-all text-xs text-[var(--oms-text-muted)]">
              Can&apos;t scan? Enter this key manually:{" "}
              <code className="rounded bg-[var(--oms-surface)] px-1 py-0.5 text-[var(--oms-text)]">{enrollData.secret}</code>
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--oms-text-muted)]" htmlFor="twofa-code">
                6-digit code
              </label>
              <input
                id="twofa-code"
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
              {isPending ? "Verifying…" : "Verify & Enable"}
            </button>
            <button
              type="button"
              onClick={() => setEnrollData(null)}
              className="rounded-lg border border-[var(--oms-surface-border)] px-3 py-1.5 text-sm text-[var(--oms-text-muted)] transition hover:bg-[var(--oms-surface)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
