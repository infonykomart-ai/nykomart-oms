"use client";

// Received Chalan — 2026-08-29 (evening, follow-up round). The "party ->
// company" counterpart to Material OUT Chalan (src/app/dashboard/stock/
// material-out-chalan-form.tsx), for goods coming back INTO the company —
// most often a job-work return (printing/washing done) that has no
// Purchase Bill of its own. A Purchase Bill save already auto-generates
// one of these (see actions.ts's createReceivedChalanForBillGroup) — this
// form is the MANUAL path, same multi-item-under-one-header shape but with
// free-text item descriptions instead of SKU codes (this isn't tied to the
// raw-material Stock ledger — see the SQL migration's header comment for
// why). Order/PO is optional here ("bina PO ke maal aa sakta hai"), unlike
// Material OUT Chalan where it's required.
import { useActionState, useState } from "react";
import { createReceivedChalanManual, type ReceivedChalanState, type OrderLookup } from "./actions";
import { OrderLookupBox } from "./order-lookup-box";
import { groupPartyOptions, type PartyOption } from "./party-options";

const initialState: ReceivedChalanState = { error: null, success: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";
const QTY_UNITS = ["FT", "MTR", "INCH", "YARD", "CM", "PCS"] as const;

type Line = { key: number; description: string; qty: string; qtyUnit: string; rate: string; remark: string };

let nextKey = 1;
function blankLine(): Line {
  return { key: nextKey++, description: "", qty: "", qtyUnit: "FT", rate: "", remark: "" };
}

export function ReceivedChalanForm({ companies, parties }: { companies: { id: string; name: string }[]; parties: PartyOption[] }) {
  const partyGroups = groupPartyOptions(parties);
  const [state, formAction, pending] = useActionState(createReceivedChalanManual, initialState);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [orderId, setOrderId] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);

  function handleFound(r: OrderLookup) {
    if (!r.order) return;
    setCompanyId(r.order.company_id);
    setOrderId(r.order.id);
  }

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
  }
  function removeLine(key: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  const itemsJson = JSON.stringify(
    lines
      .filter((l) => l.description.trim())
      .map((l) => ({
        description: l.description.trim(),
        qty: Number(l.qty) || 0,
        qtyUnit: l.qtyUnit,
        rate: l.rate ? Number(l.rate) : null,
        remark: l.remark.trim() || null,
      }))
  );

  if (state.success) {
    return <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Received Chalan created — <strong>{state.success.chalanNo}</strong>.</p>;
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      <input type="hidden" name="items_json" value={itemsJson} />
      <input type="hidden" name="order_id" value={orderId} />

      <OrderLookupBox label="Link to an Order/PO (optional)" onFound={handleFound} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="rc_company">Company *</label>
          <select id="rc_company" name="company_id" required value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={inputClass}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="rc_party">Party (received from) *</label>
          <select id="rc_party" name="party_id" required defaultValue="" className={inputClass}>
            <option value="" disabled>Select party</option>
            {partyGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.parties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="rc_date">Chalan Date</label>
          <input id="rc_date" name="chalan_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="rc_through">Through (optional)</label>
          <input id="rc_through" name="through" placeholder="Transport / courier" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="rc_packages">No. of Packages (optional)</label>
          <input id="rc_packages" name="no_of_packages" type="number" min="0" className={inputClass} />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <label className="block text-xs font-medium text-slate-500">Items received on this chalan</label>
          <button type="button" onClick={addLine} className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700">
            + Add item
          </button>
        </div>
        <div className="space-y-2">
          {lines.map((l) => (
            <div key={l.key} className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">Particulars *</label>
                  <input
                    value={l.description}
                    onChange={(e) => updateLine(l.key, { description: e.target.value })}
                    placeholder="e.g. Cotton Dhurri — printed"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[11px] text-slate-400">Remark</label>
                  <input value={l.remark} onChange={(e) => updateLine(l.key, { remark: e.target.value })} className={inputClass} />
                </div>
              </div>
              <div className="mt-2 flex items-end gap-2">
                <div className="flex-1">
                  <label className="mb-0.5 block text-[11px] text-slate-400">Qty *</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      step="0.01"
                      value={l.qty}
                      onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                      className={inputClass}
                    />
                    <select value={l.qtyUnit} onChange={(e) => updateLine(l.key, { qtyUnit: e.target.value })} className={inputClass} style={{ maxWidth: 90 }}>
                      {QTY_UNITS.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex-1">
                  <label className="mb-0.5 block text-[11px] text-slate-400">Rate (optional)</label>
                  <input type="number" step="0.01" value={l.rate} onChange={(e) => updateLine(l.key, { rate: e.target.value })} className={inputClass} />
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(l.key)}
                  disabled={lines.length === 1}
                  className="shrink-0 rounded border border-red-200 bg-red-50 px-2 py-1.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="rc_remark">Remark</label>
        <textarea id="rc_remark" name="remark" rows={2} className={inputClass} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : `Save Chalan (${lines.filter((l) => l.description.trim()).length} item(s))`}
      </button>
    </form>
  );
}
