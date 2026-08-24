"use client";

import { useActionState } from "react";
import { verifyTwoFactorLogin, type VerifyTwoFactorState } from "./actions";

const initialState: VerifyTwoFactorState = { error: null };

export default function VerifyTwoFactorPage() {
  const [state, formAction, pending] = useActionState(verifyTwoFactorLogin, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Nyko Mart · Rugara · CASA ARRA"
            className="mx-auto mb-4 h-16 w-16 rounded-full object-contain shadow-lg"
          />
          <h1 className="text-xl font-semibold text-white">Two-Factor Verification</h1>
          <p className="mt-1 text-sm text-slate-400">Enter the 6-digit code from your authenticator app</p>
        </div>

        <form action={formAction} className="space-y-4">
          <div>
            <label htmlFor="code" className="mb-1 block text-sm font-medium text-slate-300">
              Authentication code
            </label>
            <input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              pattern="\d{6}"
              autoFocus
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-center text-lg tracking-[0.5em] text-white placeholder-slate-500 outline-none focus:border-amber-500"
              placeholder="000000"
            />
          </div>

          {state.error && (
            <p className="rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2.5 font-medium text-white shadow-lg transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Verifying…" : "Verify"}
          </button>
        </form>
      </div>
    </div>
  );
}
