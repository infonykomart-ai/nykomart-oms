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

// At most three POs fit on a dropdown line; the rest are summarised as +N
// (the item dropdown and the PO filter below still know every one of them).
function poSummary(poNos: string[]): string {
  if (poNos.length === 0) return "";
  if (poNos.length <= 3) return poNos.join(", ");
  return `${poNos.slice(0, 3).join(", ")} +${poNos.length - 3}`;
}

export function PartyBillPicker({
  label,
  companyId,
  partyId,
  selectedBillId,
  onSelect,
  invoiceLevel,
}: {
  label: string;
  companyId: string;
  partyId: string;
  selectedBillId: string;
  onSelect: (billId: string) => void;
  // 2026-08-29 (later, same evening) — Journal Voucher: "INVOICE ME JO ITEM
  // HOGA UN SABKI EK HI JV BANEGI" — a JV always attaches to the WHOLE
  // invoice, never one item, unlike Debit/Credit Note's legitimate
  // per-item rate-difference linking (the default behavior below, kept
  // unchanged for those two). When true, skip the "Which item is this
  // against?" second dropdown entirely and resolve straight to the
  // group's first item — matching createJournalVoucherForBill's own
  // representative-row convention in actions.ts.
  invoiceLevel?: boolean;
}) {
  const [options, setOptions] = useState<PartyBillOption[]>([]);
  const [invoiceKey, setInvoiceKey] = useState("");
  // 2026-10-29 — "PO NUMBER TO KAHI SELECT KARNE KA OPTION NAHI HAI OR NA
  // ISME KAHI LIKHA HAI KI YE IS PO ORDER KA HAI": every invoice/item now
  // shows its PO/RF/RG no., and this box narrows both lists to that PO, so
  // the right invoice is picked by PO instead of by guessing the invoice no.
  const [poQuery, setPoQuery] = useState("");
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

  const beforeFilter = options.find((o) => o.key === invoiceKey) ?? null;

  // A PO is typed partially ("A88") far more often than in full, so the
  // match is case-insensitive substring on the PO no. — and the invoice no.
  // is searchable through the same box, since both identify the bill.
  const q = poQuery.trim().toLowerCase();
  const filteredOptions = q
    ? options.filter(
        (o) =>
          o.poNos.some((po) => po.toLowerCase().includes(q)) || o.label.toLowerCase().includes(q)
      )
    : options;
  // Keep an already-picked invoice visible even when the filter hides it, so
  // the dropdown never looks empty while a bill is actually selected.
  const visibleOptions =
    beforeFilter && !filteredOptions.some((o) => o.key === beforeFilter.key)
      ? [beforeFilter, ...filteredOptions]
      : filteredOptions;

  function itemsOf(group: PartyBillOption | null) {
    if (!group) return [];
    if (!q) return group.items;
    const byPo = group.items.filter((it) => (it.poNo ?? "").toLowerCase().includes(q));
    // A query that matched the invoice (not a PO) must not hide its items.
    return byPo.length > 0 ? byPo : group.items;
  }

  // The selection must survive being filtered out of view (e.g. the user
  // typed a PO, picked, then cleared the box) — so the selected group is
  // resolved from the full list, never from the filtered one.
  const selectedGroup = beforeFilter;
  const visibleItems = itemsOf(selectedGroup);
  const needsItemPick = !invoiceLevel && !!selectedGroup && selectedGroup.items.length > 1;

  function handleInvoiceChange(key: string) {
    setInvoiceKey(key);
    const group = options.find((o) => o.key === key);
    if (!group) {
      onSelect("");
    } else if (group.items.length === 1 || invoiceLevel) {
      // invoiceLevel: always resolve to the group's representative row,
      // even for a multi-item invoice — no item-level pick, see comment above.
      onSelect(group.items[0].billPassRegisterId);
    } else {
      // A PO filter that leaves exactly one item on this invoice IS the
      // answer — resolve it now instead of making the user pick it again.
      const narrowed = itemsOf(group);
      onSelect(narrowed.length === 1 ? narrowed[0].billPassRegisterId : ""); // otherwise wait for the item pick below
    }
  }

  function handlePoQueryChange(value: string) {
    setPoQuery(value);
    // Re-run the item resolution against the new filter, so typing a PO
    // after choosing the invoice still lands on the right item.
    if (selectedGroup && !invoiceLevel && selectedGroup.items.length > 1) {
      const narrowed = value.trim()
        ? selectedGroup.items.filter((it) => (it.poNo ?? "").toLowerCase().includes(value.trim().toLowerCase()))
        : selectedGroup.items;
      onSelect(narrowed.length === 1 ? narrowed[0].billPassRegisterId : "");
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
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <label className={labelClass} htmlFor="pbf_po_query">PO / Order No. (find the bill)</label>
          <input
            id="pbf_po_query"
            value={poQuery}
            onChange={(e) => handlePoQueryChange(e.target.value)}
            placeholder="e.g. PO-A881"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{label}</label>
          <select value={invoiceKey} onChange={(e) => handleInvoiceChange(e.target.value)} className={inputClass}>
            <option value="">
              {isLoading
                ? "Loading bills..."
                : visibleOptions.length === 0
                  ? q
                    ? `No bill for “${poQuery.trim()}”`
                    : "No bills found for this party"
                  : q
                    ? `— ${visibleOptions.length} bill(s) for “${poQuery.trim()}” —`
                    : "— None —"}
            </option>
            {visibleOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.poNos.length > 0 ? `PO ${poSummary(o.poNos)} · ` : ""}
                {o.label} — Balance ₹{o.balanceDue.toFixed(2)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedGroup && selectedGroup.poNos.length > 0 && !needsItemPick && (
        <p className="text-[11px] text-slate-500">
          <strong className="text-slate-700">PO / Order No.:</strong> {selectedGroup.poNos.join(", ")}
        </p>
      )}

      {needsItemPick && selectedGroup && (
        <div>
          <label className={labelClass}>Which item is this against? *</label>
          <select value={selectedBillId} onChange={(e) => onSelect(e.target.value)} className={inputClass}>
            <option value="">Select item</option>
            {visibleItems.map((it) => (
              <option key={it.billPassRegisterId} value={it.billPassRegisterId}>
                {it.poNo ? `PO ${it.poNo} · ` : ""}
                {it.description} — Qty {it.qty ?? "—"} {it.qtyUnit ?? ""} × {it.unitRate ?? "—"} = ₹{it.amount.toFixed(2)}
              </option>
            ))}
          </select>
          {q && visibleItems.length < selectedGroup.items.length && (
            <p className="mt-1 text-[11px] text-slate-500">
              Showing {visibleItems.length} of {selectedGroup.items.length} items for “{poQuery.trim()}”.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
