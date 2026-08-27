"use client";

// 2026-08-27 (follow-up) — "party select karte hi uske invocie no drop
// down aajaye us invoice me kya itme hai ya kis item par debit lagana
// ahi": as soon as Company + Party are picked, this auto-loads that
// party's bills as a plain dropdown (no typing) — see
// actions.ts/listBillsForParty's own comment. When the picked invoice is
// a grouped multi-item Purchase Bill, a second dropdown appears listing
// its items so the note attaches to the SPECIFIC item, not just the
// invoice as a whole.
import { useEffect, useState, useTransition } from "react";
import { listBillsForParty, type PartyBillOption } from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export function PartyBillPicker({
  label,
  companyId,
  partyId,
  selectedBillId,
  onSelect,
}: {
  label: string;
  companyId: string;
  partyId: string;
  selectedBillId: string;
  onSelect: (billId: string) => void;
}) {
  const [options, setOptions] = useState<PartyBillOption[]>([]);
  const [invoiceKey, setInvoiceKey] = useState("");
  const [isLoading, startLoading] = useTransition();

  useEffect(() => {
    // setTimeout defers these off the synchronous effect body — same
    // pattern the Multi-Item/Multi-Order Purchase Bill forms use for their
    // own post-save resets — avoiding react-hooks/set-state-in-effect's
    // cascading-render warning for a direct setState call inside an effect.
    const t = setTimeout(() => {
      setInvoiceKey("");
      onSelect("");
      if (!companyId || !partyId) {
        setOptions([]);
        return;
      }
      startLoading(async () => {
        const hits = await listBillsForParty(companyId, partyId);
        setOptions(hits);
      });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, partyId]);

  const selectedGroup = options.find((o) => o.key === invoiceKey) ?? null;
  const needsItemPick = !!selectedGroup && selectedGroup.items.length > 1;

  function handleInvoiceChange(key: string) {
    setInvoiceKey(key);
    const group = options.find((o) => o.key === key);
    if (!group) {
      onSelect("");
    } else if (group.items.length === 1) {
      onSelect(group.items[0].billPassRegisterId);
    } else {
      onSelect(""); // wait for the item pick below
    }
  }

  if (!partyId) {
    return (
      <div>
        <label className={labelClass}>{label}</label>
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-400">
          Select a party first to see its bills.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div>
        <label className={labelClass}>{label}</label>
        <select value={invoiceKey} onChange={(e) => handleInvoiceChange(e.target.value)} className={inputClass}>
          <option value="">{isLoading ? "Loading bills..." : options.length === 0 ? "No bills found for this party" : "— None —"}</option>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label} — Balance ₹{o.balanceDue.toFixed(2)}
            </option>
          ))}
        </select>
      </div>

      {needsItemPick && selectedGroup && (
        <div>
          <label className={labelClass}>Which item is this against? *</label>
          <select value={selectedBillId} onChange={(e) => onSelect(e.target.value)} className={inputClass}>
            <option value="">Select item</option>
            {selectedGroup.items.map((it) => (
              <option key={it.billPassRegisterId} value={it.billPassRegisterId}>
                {it.description} — Qty {it.qty ?? "—"} {it.qtyUnit ?? ""} × {it.unitRate ?? "—"} = ₹{it.amount.toFixed(2)}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
