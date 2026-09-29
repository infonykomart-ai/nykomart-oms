"use client";

/**
 * 2026-09-12 — self-service password change, part of the FedEx-style
 * "Login & Security" group on My Profile (alongside the 2FA card).
 * changeMyPassword (actions.ts) verifies the CURRENT password on a
 * throwaway auth client before updating — see that action's comment for why
 * (protecting the session's AAL2 for 2FA-enrolled users).
 */
import { useActionState } from "react";
import { changeMyPassword, type ChangePasswordState } from "./actions";

const initialState: ChangePasswordState = { error: null, success: false };

const inputClass =
  "w-full rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-canvas)] px-3 py-2 text-sm text-[var(--oms-text)] outline-none focus:border-[var(--oms-accent)] focus:ring-1 focus:ring-[var(--oms-accent)]";
const labelClass = "mb-1 block text-sm font-medium text-[var(--oms-text-muted)]";

export function PasswordSection() {
  const [state, formAction, pending] = useActionState(changeMyPassword, initialState);

  return (
    <div className="oms-card rounded-2xl border p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span aria-hidden className="text-lg">🔑</span>
        <h3 className="text-sm font-semibold text-[var(--oms-text)]">Password</h3>
      </div>
      <p className="text-xs text-[var(--oms-text-muted)]">
        Use at least 8 characters. Changing your password signs other devices out.
      </p>

      {state.error && <p className="mt-3 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-800">{state.error}</p>}
      {state.success && (
        <p className="mt-3 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs text-green-800">✓ Password changed.</p>
      )}

      <form action={formAction} className="mt-3 space-y-3">
        <div>
          <label className={labelClass} htmlFor="current_password">Current password</label>
          <input id="current_password" name="current_password" type="password" autoComplete="current-password" className={inputClass} required />
        </div>
        <div>
          <label className={labelClass} htmlFor="new_password">New password</label>
          <input id="new_password" name="new_password" type="password" autoComplete="new-password" minLength={8} className={inputClass} required />
        </div>
        <div>
          <label className={labelClass} htmlFor="confirm_password">Confirm new password</label>
          <input id="confirm_password" name="confirm_password" type="password" autoComplete="new-password" minLength={8} className={inputClass} required />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-[var(--oms-accent)] px-4 py-2 text-sm font-semibold text-[var(--oms-accent-contrast)] transition hover:opacity-90 disabled:opacity-60 sm:w-auto"
        >
          {pending ? "Changing…" : "Change Password"}
        </button>
      </form>
    </div>
  );
}
