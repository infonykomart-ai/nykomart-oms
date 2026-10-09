"use client";

import { useActionState, useEffect, useState } from "react";
import { wallatRecharge, type WallatRechargeResult } from "./wallat.actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-400";

export function WallatRechargeForm({
  employee,
  companies,
  parties,
}: {
  employee: {
    id: string;
    companyIds: string[];
    currentCompanyId: string;
    capabilities: string[];
    name: string;
  };
  companies: { id: string; name: string }[];
  parties: { id: string; name: string; party_type: string }[];
}) {
  const [result, formAction, pending] = useActionState<WallatRechargeResult, FormData>(wallatRecharge, {
    error: null,
    success: false,
  });

  const [activeStep, setActiveStep] = useState<"amount" | "adjust" | "confirm">("amount");
  const [confirmations, setConfirmations] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (result.success) window.location.reload();
  }, [result.success]);

  const isCompanyScoped = (id: string) =>
    employee.companyIds.includes(id) && id !== "";

  const currentCompany = companies.find((c) => c.id === employee.currentCompanyId)
    ?? companies[0];
  const selectedCompanyId = currentCompany?.id ?? "";

  const payableBills = parties.filter((p) => p.party_type === "bill");
  const hasPayableBills = payableBills.length > 0;

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="text-2xl">🏦</span>
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            Courriour Wallat Recharge
          </h1>
          <p className="text-xs text-slate-500">
            Fund the courier prepaid wallet from bank 5919 before any bill
            adjust is settled.
          </p>
        </div>
      </div>

      {/* Sub-step progress: amount → adjust → confirm */}
      <ol className="mt-4 flex gap-2 text-xs">
        {(["amount", "adjust", "confirm"] as const).map((step) => (
          <li
            key={step}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
              activeStep === step
                ? "bg-amber-500 text-white"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            {step === "amount" && (
              <>
                {confirmations.amount ? "✓" : ""} Amount
              </>
            )}
            {step === "adjust" && (
              <>
                {confirmations.adjust ? "✓" : ""} Bill Adjust
              </>
            )}
            {step === "confirm" && (
              <>
                {confirmations.confirm ? "✓" : ""} Confirm
              </>
            )}
          </li>
        ))}
      </ol>

      {/* ── 1. AMOUNT FIRST ── */}
      {activeStep === "amount" && (
        <form action={formAction} className="mt-4 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <label className={labelClass} htmlFor="amount">
              Amount (₹)
            </label>
            <div className="mt-1 flex items-baseline gap-2">
              <input
                id="amount"
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                className={inputClass}
              />
              <span className="text-sm font-semibold text-slate-700">
                ₹{new FormData(
                  document
                    .getElementById("amount")
                    ?.closest("form") as HTMLFormElement
                )
                  .get("amount")
                  ?.toString()}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Charged from bank 5919 (the courier prepaid wallet).
            </p>
          </div>

          {hasPayableBills && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
                <span>📄 Bill Adjust (auto)</span>
                <span className="text-[11px] text-amber-600">
                  matched to the open courier bill
                </span>
              </div>
              <p className="mt-1 text-xs text-amber-900/70">
                The recharge amount is applied to the courier bill with the
                largest outstanding balance. No manual adjustment needed.
              </p>
              {result.error && (
                <p className="mt-1 text-xs font-medium text-rose-700">
                  {result.error}
                </p>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="party_id">
                Courier party
              </label>
              <select
                id="party_id"
                name="party_id"
                required
                defaultValue=""
                className={inputClass}
              >
                <option value="" disabled>
                  Select a courier party…
                </option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-400">
                The recharge posts to this courier&apos;s prepaid wallet.
              </p>
            </div>
            <div>
              <label className={labelClass} htmlFor="payment_material">
                Recharge from
              </label>
              <select
                id="payment_material"
                name="payment_material"
                className={inputClass}
              >
                <option value="bank">Bank (5919)</option>
                <option value="credit_card">Credit Card (5919)</option>
                <option value="phonpay">Phonpay</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-400">
                All three fund from bill 5919 first.
              </p>
            </div>
            <div>
              <label className={labelClass} htmlFor="company">
                Company
              </label>
              <select
                id="company"
                name="company_id"
                defaultValue={selectedCompanyId}
                disabled={!isCompanyScoped(selectedCompanyId)}
                className={inputClass}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {result.error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {result.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Submitting…" : "→ Continue"}
          </button>
        </form>
      )}

      {/* ── 2. BILL ADJUST AUTO ── */}
      {activeStep === "adjust" && (
        <div className="mt-4 space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <span className="text-xl">✓</span>
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Bill auto-adjusted
              </p>
              <p className="text-xs text-slate-500">
                The courier bill is now matched to the charged amount. You
                need to confirm before the funds move.
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveStep("amount")}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => setActiveStep("confirm")}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
            >
              Confirm →
            </button>
          </div>
        </div>
      )}

      {/* ── 3. CONFIRM TO THE COURIER ── */}
      {activeStep === "confirm" && (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
            <p className="text-sm font-semibold text-violet-800">
              Confirm with the courier
            </p>
            <p className="mt-1 text-xs text-violet-900/70">
              I confirm the courier wallet recharge from bank 5919.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveStep("adjust")}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              ← Back
            </button>
            <button
              type="submit"
              name="confirm_substep"
              value="confirm"
              disabled={pending}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Recharging…" : "✅ Recharge from Bank 5919"}
            </button>
          </div>
        </div>
      )}

      {result.success && (
        <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          ✓ Wallat recharged from bank 5919 and courier bill adjusted.
        </div>
      )}
    </div>
  );
}
