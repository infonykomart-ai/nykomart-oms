import { requireAnyCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { listCreditNoteRegister, findUnregisteredManualCreditNotes } from "@/app/dashboard/bill-payment/credit-note-actions";
import { cnKindLabel } from "../bill-payment/credit-note-kinds";
import { CreditNoteRegisterActions } from "./register-actions-bar";

// Credit Note Register — 2026-09-13. "us se ye hoga ki apne ko pata chal
// jayega ki kis party se apne ko kitne ammonut ka credit mil gaya tha."
//
// One page, two sections:
//
//   1. Per-party groups — every credit note in the selected company(ies),
//      grouped by party, each group with its own TOTAL, grand total on
//      top. Includes notes created against bills (Courier/Purchase/Duty)
//      via the Bill Payment panel, buyer-refund CNs (no party → their own
//      "(No party)" group), and anything entered manually in Documents →
//      Credit Note. Same source table (credit_notes), so nothing can be
//      missed here.
//
//   2. Backlog — bills whose manual credit_note_amt column holds an
//      amount with no credit_notes document behind it (the "bina credit
//      note ki entry kiye" gap): each gets a one-click "Register"
//      button that wraps that amount into a proper CN document, so the
//      per-party totals above become complete without double-reducing any
//      bill's payable.
export default async function CreditNotesRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // 2026-09-13 (visibility fix follow-up) — was doc_entry-only, which
  // locked out bill_payment-only roles clicking the register link FROM
  // Bill Payment ("link to open hi nahi ho raha" — they got a
  // ForbiddenError screen instead). Either module's capability now grants
  // the register; writes (applyBillCreditNote) enforce the same dual gate.
  const employee = await requireAnyCapability("bill_payment", "doc_entry");
  const supabase = createServiceRoleClient();
  const sp = await searchParams;

  // Same company-select pattern as Bill Payment: respect the top-nav
  // switcher by default; ?company= (incl. blank = all my companies)
  // overrides.
  const companyParam = typeof sp.company === "string" ? sp.company : "";
  const companyParamPresent = "company" in sp;
  const effectiveCompanyIds = companyParam
    ? [companyParam]
    : companyParamPresent
      ? employee.companyIds
      : [employee.currentCompanyId];

  const [{ data: companies }, groups, backlog] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    listCreditNoteRegister(effectiveCompanyIds),
    findUnregisteredManualCreditNotes(effectiveCompanyIds),
  ]);

  const grandTotal = groups.reduce((s, g) => s + g.total, 0);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🧾 Credit Note Register</h1>
        </div>
        <form method="get" className="flex items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="company">Company</label>
            <select id="company" name="company" defaultValue={companyParamPresent ? companyParam : employee.currentCompanyId} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500">
              <option value="">All</option>
              {(companies ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
            Filter
          </button>
        </form>
      </div>

      <div className="mb-4 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-800">
        Total credit received: ₹{grandTotal.toFixed(2)} across {groups.length} part{groups.length === 1 ? "y" : "ies"}
      </div>

      <div className="space-y-4">
        {groups.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
            No credit notes yet for this selection.
          </div>
        )}
        {groups.map((g) => (
          <details key={g.party_id ?? "__none__"} className="rounded-xl border border-slate-200 bg-white" open={groups.length <= 3}>
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="text-sm font-semibold text-slate-800">
                {g.party_name} <span className="ml-1 text-xs font-normal text-slate-400">({g.notes.length} note{g.notes.length === 1 ? "" : "s"})</span>
              </span>
              <span className="text-sm font-bold text-teal-700">₹{g.total.toFixed(2)}</span>
            </summary>
            <div className="overflow-x-auto border-t border-slate-100">
              <table className="min-w-full divide-y divide-slate-100 text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-500">CN No.</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-500">Kind</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-500">Party&apos;s CN No.</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-500">GST (total)</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-500">Date</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-500">Against Invoice</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-500">Status</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-500">Remark</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-500">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {g.notes.map((n) => (
                    <tr key={n.id}>
                      <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-700">{n.cn_no ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            n.cn_kind === "buyer_refund"
                              ? "bg-sky-100 text-sky-700"
                              : n.cn_kind === "supplier"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {n.cn_kind === "buyer_refund" ? n.buyer_name || "Buyer refund" : cnKindLabel(n.cn_kind)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{n.vendor_cn_no ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{n.gst_rate_pct != null ? `${n.gst_rate_pct * 2}%` : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{n.credit_note_date}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{n.invoice_no ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">{n.status ?? "—"}</td>
                      <td className="px-3 py-1.5 text-slate-500">{n.remark ?? ""}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold text-slate-800">₹{n.refund_amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>

      <div className="mt-8">
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Backlog — manual credit-note amounts without a Credit Note document</h2>
        <p className="mb-3 text-sm text-slate-500">
          These bills already have a manual Credit Note Amt entered directly on the bill (Courier/Duty entry or the
          bill&apos;s edit form). It reduces the bill&apos;s payable but never appeared under Credit Notes — register
          each one to complete the per-party picture above. Registering does NOT reduce the bill again.
        </p>
        {backlog.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">Nothing pending — every manual credit-note amount is registered. 🎉</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Company</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Invoice</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Party</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Manual CN Amt</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {backlog.map((b) => (
                  <tr key={b.bill_id}>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700">{b.company_name}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">{b.vendor_invoice_no ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{b.invoice_type ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{b.party_name ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-900">₹{b.credit_note_amt.toFixed(2)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <CreditNoteRegisterActions billId={b.bill_id} manualAmt={b.credit_note_amt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
