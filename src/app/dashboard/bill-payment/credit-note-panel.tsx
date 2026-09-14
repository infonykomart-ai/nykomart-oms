"use client";

// Per-bill Credit Notes panel (2026-09-13) — "couriour ka bill ho ya
// purchase ka agar inme ek se jyada credit note adjust karne ka option
// nahi bs ek hi entry hoti hai" + "bina credit note ki entry kiye agar
// kisi bill me entry kar di hai to vo auto sambandhit section ke credit
// note me chali jaye". One expander under a bill row with three modes:
//
//   NEW      — create a real credit_notes document AND apply it to this
//              bill (repeatable: one per credit note, adj_amt re-sums).
//   LINK     — apply an already-existing credit note to this bill.
//   REGISTER — wrap this bill's manual credit_note_amt into a proper
//              Credit Note document so it shows in the register.
//
// Existing applied adjustments are listed with a remove button (Admin and
// Finance both hold doc_entry, which the actions require anyway). The
// panel is fed by props from the Server Component (bill-payment-list
// gets them from page.tsx) — no client-side fetching.
import { useActionState, useEffect, useState } from "react";
import {
  applyBillCreditNote,
  removeBillCreditNote,
  listPartyBillsForCn,
  type ApplyCreditNoteState,
  type RegisterCnRow,
  type PartyAwbBill,
} from "./credit-note-actions";
import { SUPPLIER_GST_OPTIONS, defaultGstRatePct } from "./credit-note-kinds";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-0.5 block text-[11px] text-slate-400";
const initialState: ApplyCreditNoteState = { error: null, success: false };

export type AppliedCn = {
  adjustment_id: string;
  credit_note_id: string | null;
  cn_no: string | null;
  vendor_cn_no: string | null;
  gst_rate_pct: number | null;
  amount: number;
  remark: string | null;
};

export function CreditNotePanel({
  billId,
  billLabel,
  billType,
  partyId,
  manualCreditNoteAmt,
  applied,
  existingNotes,
  isPaidLocked,
}: {
  billId: string;
  billLabel: string;
  // The bill's invoice_type drives the GST slab pre-selection (freight/
  // duty → 18% total, purchase & everything else → 5% total) — the
  // user's own slab table, see credit-note-kinds.ts.
  billType: string | null;
  // The bill's party — drives the multi-AWB mode's bill list.
  partyId: string | null;
  manualCreditNoteAmt: number;
  applied: AppliedCn[];
  existingNotes: Pick<RegisterCnRow, "id" | "cn_no" | "credit_note_date" | "refund_amount">[];
  // True when payments exist on this bill and the viewer is not an Admin
  // — the panel becomes read-only ("edit sirf admin se ho").
  isPaidLocked: boolean;
}) {
  const [state, formAction, pending] = useActionState(applyBillCreditNote, initialState);
  const [mode, setMode] = useState<"new" | "link" | "register" | "multi_awb">("new");
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // 2026-09-13 — multi-AWB mode: lazily loads the party's outstanding
  // bills when the radio is picked (one query, cached in state; server
  // action so it can't run during render).
  const [awbBills, setAwbBills] = useState<PartyAwbBill[] | null>(null);
  const [awbBillsError, setAwbBillsError] = useState<string | null>(null);
  const [awbAmounts, setAwbAmounts] = useState<Record<string, string>>({});
  const [awbBase, setAwbBase] = useState("");
  useEffect(() => {
    if (mode !== "multi_awb" || awbBills || !partyId) return;
    let alive = true;
    listPartyBillsForCn(partyId).then((rows) => {
      if (alive) setAwbBills(rows);
    }).catch(() => {
      if (alive) setAwbBillsError("Party ke outstanding bills load nahi ho paye — page refresh karke dobara try karein.");
    });
    return () => {
      alive = false;
    };
  }, [mode, awbBills, partyId]);
  const awbSplitSum = Object.values(awbAmounts).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const awbGstTotal = awbBase !== "" && Number(awbBase) > 0 ? Number(awbBase) * 1.18 : null;

  async function handleRemove(adjustmentId: string) {
    setRemoveError(null);
    setRemoving(adjustmentId);
    const res = await removeBillCreditNote(adjustmentId);
    setRemoving(null);
    if (res.error) setRemoveError(res.error);
  }

  return (
    <td colSpan={10} className="bg-teal-50/60 px-3 py-3">
      {isPaidLocked ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          🔒 Payments have been recorded against this bill, so its credit notes are locked — only an Admin can add,
          link or remove them. Every applied note is still listed below.
        </p>
      ) : (
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="bill_pass_register_id" value={billId} />
        <input type="hidden" name="mode" value={mode} />
        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Credit note applied.</p>}
        {removeError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{removeError}</p>}

        <div className="flex flex-wrap gap-3 text-xs font-medium text-slate-600">
          <label className="flex items-center gap-1">
            <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} />
            New credit note
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={mode === "link"} onChange={() => setMode("link")} />
            Link existing credit note
          </label>
          {/* 2026-09-13 — "EK CREDIT NOTE ME 1 SE JYADA AWB HUYE TO KYA
              UNKE AGAINST ME ADJUST KARNE KA OPTION HAI": one courier CN
              document split across several AWB bills. */}
          {partyId && (
            <label className="flex items-center gap-1">
              <input type="radio" checked={mode === "multi_awb"} onChange={() => setMode("multi_awb")} />
              Multi-AWB (ek CN, kai AWB bills)
            </label>
          )}
          {manualCreditNoteAmt > 0 && (
            <label className="flex items-center gap-1">
              <input type="radio" checked={mode === "register"} onChange={() => setMode("register")} />
              Register this bill&apos;s manual credit note (₹{manualCreditNoteAmt.toFixed(2)})
            </label>
          )}
        </div>

        {mode === "new" && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <label className={labelClass}>Credit Note Amount *</label>
              <input name="amount" type="number" step="0.01" min="0.01" required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Credit Note Date *</label>
              <input name="credit_note_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
            </div>
            {/* 2026-09-13 — "credit note no ka option nahi hai usme gst
                kitni hai": the issuing party's own CN number + the GST
                rate, pre-selected from THIS bill's type via the user's
                slab table (courier/duty → 18% total, purchase → 5%
                total; 12% option for kurti). Blank = no GST. */}
            <div>
              <label className={labelClass}>Party ka CN No. (optional)</label>
              <input name="vendor_cn_no" placeholder="vendor ka apna number" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>GST % (blank = no GST)</label>
              <select name="gst_rate_pct" defaultValue={String(defaultGstRatePct(billType))} className={inputClass}>
                <option value="">— No GST —</option>
                {SUPPLIER_GST_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label} (rate {o.value})
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Remark</label>
              <input name="remark" placeholder="e.g. shortage / rate diff / damage / freight quote vs billed" className={inputClass} />
            </div>
          </div>
        )}

        {mode === "link" && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className={labelClass}>Existing Credit Note *</label>
              <select name="credit_note_id" required defaultValue="" className={inputClass}>
                <option value="">— Choose —</option>
                {existingNotes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.cn_no ?? n.id.slice(0, 8)} · {n.credit_note_date} · ₹{n.refund_amount.toFixed(2)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Amount (blank = note&apos;s full amount)</label>
              <input name="amount" type="number" step="0.01" min="0.01" className={inputClass} />
            </div>
          </div>
        )}

        {mode === "multi_awb" && partyId && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div>
                <label className={labelClass}>CN Base Amount (GST ke pehle) *</label>
                <input
                  name="base_amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={awbBase}
                  onChange={(e) => setAwbBase(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>GST % (total)</label>
                <select name="gst_rate_pct" defaultValue="9" className={inputClass}>
                  {SUPPLIER_GST_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label} (rate {o.value})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Party ka CN No.</label>
                <input name="vendor_cn_no" placeholder="courier ka CN number" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>AWB No(s).</label>
                <input name="awb_no" placeholder="AWB1, AWB2, …" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Credit Note Date *</label>
                <input name="credit_note_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Remark</label>
                <input name="remark" placeholder="e.g. rate diff — quoted 3k billed 5k" className={inputClass} />
              </div>
            </div>
            {/* Live GST math — "CREDTI AMMOUNT + GST 18% = TOTAL AMMOUNT". */}
            {awbGstTotal != null && (
              <p className="text-[11px] font-medium text-slate-600">
                Base ₹{Number(awbBase).toFixed(2)} + GST 18% = <strong>Total ₹{awbGstTotal.toFixed(2)}</strong> (CN document par yahi total jayega; har AWB bill ko base share split hoga)
              </p>
            )}
            {awbBillsError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{awbBillsError}</p>}
            {!awbBills && !awbBillsError && <p className="text-[11px] text-slate-400">Party ke bills load ho rahe hain…</p>}
            {awbBills && (
              <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full text-xs">
                  <tbody>
                    {awbBills.length === 0 && (
                      <tr>
                        <td className="px-3 py-2 text-slate-400">Is party ka koi outstanding bill nahi hai.</td>
                      </tr>
                    )}
                    {awbBills.map((b) => (
                      <tr key={b.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-2 py-1.5 font-medium text-slate-700">{b.vendor_invoice_no ?? b.invoice_no ?? b.id.slice(0, 8)}</td>
                        <td className="px-2 py-1.5 text-slate-500">{b.invoice_type ?? ""}</td>
                        <td className="px-2 py-1.5 text-right text-slate-500">due ₹{b.balance_due.toFixed(2)}</td>
                        <td className="px-2 py-1.5 text-right">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={awbAmounts[b.id] ?? ""}
                            onChange={(e) => setAwbAmounts((prev) => ({ ...prev, [b.id]: e.target.value }))}
                            className="w-24 rounded border border-slate-300 px-1.5 py-1 text-right text-xs outline-none focus:border-amber-500"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className={`text-[11px] ${awbSplitSum > 0 && Math.abs(awbSplitSum - (Number(awbBase) || 0)) <= 0.05 ? "text-green-700" : "text-slate-500"}`}>
              AWB split total: ₹{awbSplitSum.toFixed(2)} {awbBase !== "" && Number(awbBase) > 0 ? (Math.abs(awbSplitSum - Number(awbBase)) <= 0.05 ? "✓ base amount ke barabar hai" : `— base amount ₹${Number(awbBase).toFixed(2)} ke barabar hona chahiye`) : ""}
            </p>
            {/* The per-bill split rides to the action as JSON. */}
            <input type="hidden" name="awb_amounts" value={JSON.stringify(awbAmounts)} />
            <input type="hidden" name="party_id" value={partyId} />
          </div>
        )}

        {mode === "register" && manualCreditNoteAmt > 0 && (
          <p className="text-[11px] text-slate-500">
            Creates a proper Credit Note document (own CN number, shows under Documents → Credit Notes and in the
            per-party register) for the ₹{manualCreditNoteAmt.toFixed(2)} already entered on{" "}
            <strong>{billLabel}</strong>. The bill&apos;s payable does NOT change again — the amount already reduced it.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {pending ? "Saving..." : mode === "register" ? "Register Credit Note" : mode === "multi_awb" ? "Apply to AWB Bills" : "Apply to Bill"}
        </button>
      </form>
      )}

      {applied.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Applied credit notes ({applied.length})
          </p>
          <table className="min-w-full text-xs">
            <tbody>
              {applied.map((a) => (
                <tr key={a.adjustment_id} className="border-b border-slate-100 last:border-0">
                  <td className="py-1 pr-3 font-medium text-slate-700">
                    {a.cn_no ?? "—"}
                    {a.vendor_cn_no ? <span className="ml-1 text-[10px] text-slate-400">(party: {a.vendor_cn_no})</span> : null}
                    {a.gst_rate_pct != null ? <span className="ml-1 text-[10px] text-slate-400">GST {a.gst_rate_pct * 2}%</span> : null}
                  </td>
                  <td className="py-1 pr-3 text-right text-slate-700">₹{a.amount.toFixed(2)}</td>
                  <td className="py-1 pr-3 text-slate-500">{a.remark ?? ""}</td>
                  <td className="py-1 text-right">
                    {isPaidLocked ? (
                      <span className="text-[10px] text-slate-400">admin only</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleRemove(a.adjustment_id)}
                        disabled={removing === a.adjustment_id}
                        className="text-red-500 hover:underline disabled:opacity-40"
                      >
                        {removing === a.adjustment_id ? "Removing..." : "Remove"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </td>
  );
}
