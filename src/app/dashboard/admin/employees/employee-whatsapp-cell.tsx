"use client";

// 2026-09-30 — one cell of the Employees table: shows the stored WhatsApp
// number (or "—"), a validity badge checked with the EXACT normalizer the
// punch-notification sender uses (no drift between "looks fine" and "will
// actually send"), and a one-click 🧪 Test button that fires a REAL Whapi
// message and renders exactly what happened — the visible answer to
// "kisi ke msg gaya, kisi ke nahi". If it fails, the error is shown right
// here verbatim (missing number / unusable shape / Whapi's own rejection),
// so the fix is an edit on this same page, not guesswork.
//
// Known limitation, deliberate: a "✓ usable" badge means the NUMBER is
// well-formed — it cannot prove the handset is WhatsApp-registered or the
// message was delivered. The Test button exists for exactly that: it is
// the only check that goes all the way through Whapi.
import { useState, useTransition } from "react";
import { testEmployeeWhatsapp, type WhatsappTestState } from "./actions";
import { isUsableWhatsappNumber } from "@/lib/whatsapp/normalize";

export function EmployeeWhatsappCell({ employeeId, raw }: { employeeId: string; raw: string | null }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<WhatsappTestState | null>(null);

  const usable = isUsableWhatsappNumber(raw);

  function runTest() {
    setResult(null);
    startTransition(async () => {
      const res = await testEmployeeWhatsapp(employeeId);
      setResult(res);
    });
  }

  return (
    <div className="min-w-[10rem]">
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-slate-700">{raw ? raw : "—"}</span>
        {raw ? (
          usable ? (
            <span
              title="Number shape is valid — messages can be attempted to it"
              className="rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700"
            >
              ✓ OK
            </span>
          ) : (
            <span
              title="Not a usable Indian mobile number — fix it (10 digits, 0-prefixed, or 91-prefixed)"
              className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
            >
              ✕ Invalid
            </span>
          )
        ) : (
          <span
            title="No number saved — notifications silently skip this employee"
            className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
          >
            Missing
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={runTest}
          disabled={isPending}
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
        >
          {isPending ? "Sending…" : "🧪 Test"}
        </button>
        {result && result.ok && (
          <span className="text-xs text-green-700">
            ✓ Sent{result.to ? ` to ${result.to}` : ""} — check the phone
          </span>
        )}
        {result && !result.ok && <span className="text-xs text-red-700">{result.error}</span>}
      </div>
    </div>
  );
}
