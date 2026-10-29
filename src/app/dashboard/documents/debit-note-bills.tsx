"use client";

// 2026-10-29 — "kisi ek party ko multiple po order ka debit note send kare to
// usme ye bhi clear hona chahiye ki debit note kis invoice ke against me hai,
// or kese kese hai; jese 4 PO 4 alag alag bill me hai lekin debit note ek hi
// banega".
//
// One Debit Note can now cover SEVERAL of the party's invoices: tick each
// invoice, type the amount being debited on it, and the note's total becomes
// exactly the sum of those lines — the server recomputes the total from these
// lines, so a hand-typed total can never disagree with what is actually being
// adjusted (the old "calculation mistake" complaint).
//
// Every ticked invoice is also adjusted by its own amount, so the note both
// LINKS (which invoices, and how much on each) and POSTS (each invoice's
// payable drops by that amount) in one save.
import { useEffect, useMemo, useState, useTransition } from "react";
import { listBillsForParty, type PartyBillOption } from "./actions";

const inputClass =
  "rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

export type DebitNoteBillLine = { billId: string; invoiceNo: string; amount: number };

export function DebitNoteBillPicker({
  companyId,
  partyId,
  lines,
  onChange,
}: {
  companyId: string;
  partyId: string;
  lines: DebitNoteBillLine[];
  onChange: (next: DebitNoteBillLine[]) => void;
}) {
  const [options, setOptions] = useState<PartyBillOption[]>([]);
  // 2026-10-29 — "PO NUMBER TO KAHI SELECT KARNE KA OPTION NAHI HAI": each
  // row now names its PO/RF/RG no. and this box filters the list down to one
  // PO (or one invoice), so ticking the right bill no longer means scanning
  // a long list of same-invoice-no rows.
  const [poQuery, setPoQuery] = useState("");
  const [isLoading, startLoading] = useTransition();

  useEffect(() => {
    const t = setTimeout(() => {
      if (!companyId || !partyId) {
        setOptions([]);
        return;
      }
      startLoading(async () => {
        setOptions(await listBillsForParty(companyId, partyId));
      });
    }, 0);
    return () => clearTimeout(t);
  }, [companyId, partyId]);

  const selectedIds = new Set(lines.map((l) => l.billId));

  // Flattened once so the PO filter can act on rows, not on invoices — two
  // items of one invoice legitimately sit on two different POs.
  const rows = useMemo(
    () =>
      options.flatMap((o) =>
        o.items.map((it) => ({ option: o, item: it }))
      ),
    [options]
  );
  const q = poQuery.trim().toLowerCase();
  const visibleRows = q
    ? rows.filter(
        (r) =>
          (r.item.poNo ?? "").toLowerCase().includes(q) ||
          r.option.label.toLowerCase().includes(q)
      )
    : rows;

  function toggle(option: PartyBillOption, billId: string, checked: boolean) {
    if (!checked) {
      onChange(lines.filter((l) => l.billId !== billId));
      return;
    }
    if (selectedIds.has(billId)) return;
    // Default: the invoice's full outstanding balance — the usual "yeh bill
    // galti se dobara chadh gaya hai, poora debit karo" case. Still editable.
    const item = option.items.find((i) => i.billPassRegisterId === billId);
    onChange([
      ...lines,
      { billId, invoiceNo: option.label, amount: Math.round(Number(item?.balanceDue ?? option.balanceDue ?? 0) * 100) / 100 },
    ]);
  }

  function setAmount(billId: string, raw: string) {
    const n = Number(raw);
    onChange(lines.map((l) => (l.billId === billId ? { ...l, amount: Number.isFinite(n) ? n : 0 } : l)));
  }

  const total = Math.round(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100) / 100;

  if (!partyId) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-400">
        Select a party to pick the invoice(s) this Debit Note is against.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-slate-700">
          Invoices this Debit Note is against {lines.length > 0 && <span className="text-slate-400">({lines.length} selected)</span>}
        </p>
        <span className="text-[11px] text-slate-500">
          Total debit: <strong className="text-slate-800">₹{total.toFixed(2)}</strong>
        </span>
      </div>
      <p className="mb-1.5 text-[11px] text-slate-500">
        One note can cover several invoices / POs of the same party. Tick each invoice and enter the amount being debited on it —
        the Debit Amount below is the sum of these lines (it cannot drift). Each ticked invoice&apos;s payable drops by its own amount.
      </p>
      <input
        value={poQuery}
        onChange={(e) => setPoQuery(e.target.value)}
        placeholder="Filter by PO / Order No. or invoice no. — e.g. PO-A881"
        className={`${inputClass} mb-1.5 w-full`}
        aria-label="Filter invoices by PO or invoice number"
      />
      <div className="max-h-48 overflow-y-auto rounded border border-slate-100">
        {isLoading && <p className="px-2 py-1.5 text-xs text-slate-400">Loading this party&apos;s invoices…</p>}
        {!isLoading && rows.length === 0 && <p className="px-2 py-1.5 text-xs text-slate-400">No invoices in the Finance ledger for this party yet.</p>}
        {!isLoading && rows.length > 0 && visibleRows.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-slate-400">No invoice or PO matches “{poQuery.trim()}”.</p>
        )}
        {!isLoading &&
          visibleRows.map(({ option: o, item: it }) => {
            const checked = selectedIds.has(it.billPassRegisterId);
            const line = lines.find((l) => l.billId === it.billPassRegisterId);
            return (
              <div
                key={it.billPassRegisterId}
                className={`flex flex-wrap items-center gap-2 border-b border-slate-100 px-2 py-1 text-xs last:border-b-0 ${checked ? "bg-amber-50/60" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggle(o, it.billPassRegisterId, e.target.checked)}
                  aria-label={`Debit against ${o.label}`}
                />
                <span className="min-w-0 flex-1">
                  {it.poNo && (
                    <span className="mr-1 rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                      {it.poNo}
                    </span>
                  )}
                  <span className="font-medium text-slate-800">{o.label}</span>
                  {o.items.length > 1 && <span className="text-slate-500"> · {it.description}</span>}
                  <span className="ml-1 text-slate-400">balance ₹{Number(it.balanceDue ?? 0).toFixed(2)}</span>
                </span>
                {checked && (
                  <input
                    type="number"
                    step="0.01"
                    value={line?.amount ?? 0}
                    onChange={(e) => setAmount(it.billPassRegisterId, e.target.value)}
                    className={`${inputClass} w-28 text-right`}
                    aria-label={`Debit amount for ${o.label}`}
                  />
                )}
              </div>
            );
          })}
      </div>
      {lines.length > 0 && (
        <p className="mt-1.5 text-[11px] text-amber-700">
          Against: {lines.map((l) => `${l.invoiceNo} (₹${Number(l.amount).toFixed(2)})`).join(" · ")}
        </p>
      )}
    </div>
  );
}
