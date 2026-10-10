"use client";

import { useActionState } from "react";
import dynamic from "next/dynamic";
import { login, type LoginState } from "./actions";

// 2026-10-10 — "page load hone me time le raha": the decorative 3D hero
// statically pulled three.js (~600KB min) into /login's critical bundle on
// every visit, delaying the sign-in form itself. It's pure decoration, so
// it now streams in as a separate lazy chunk AFTER the page renders —
// ssr:false because WebGL only exists in the browser anyway.
const LoginHero3D = dynamic(
  () => import("@/components/login/login-hero-3d").then((m) => m.LoginHero3D),
  { ssr: false }
);

const initialState: LoginState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center gap-16 bg-slate-950 px-4 py-10">
      {/* 2026-09-09 — decorative 3D hero, same rotating-package scene as the
          claymock UI mockup's Landing page. /login is production's only
          public-facing page (everything else sits behind auth), so this is
          where "the real 3D on the real URL" lands. Hidden below lg and
          wrapped in two independent failure layers (see login-hero-3d.tsx)
          so it can never affect the actual sign-in form beside it. */}
      <div className="hidden h-80 w-80 shrink-0 lg:block xl:h-96 xl:w-96">
        <LoginHero3D />
      </div>

      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Nyko Mart · Rugara · CASA ARRA"
            width={64}
            height={64}
            className="mx-auto mb-4 h-16 w-16 rounded-full object-contain shadow-lg"
          />
          <h1 className="text-xl font-semibold text-white">Order Management System</h1>
          <p className="mt-1 text-sm text-slate-400">Nyko Mart · Rugara · CASA ARRA</p>
        </div>

        <form action={formAction} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-300">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 outline-none focus:border-amber-500"
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-300">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 outline-none focus:border-amber-500"
              placeholder="••••••••"
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
            {pending ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
