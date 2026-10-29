"use client";

// 2026-10-29 — "ye invoice duplicate hua hai usko ek me kar do jisme 11 AWB
// already add hai, or ek me credit note — merge kar ke single entry".
//
// The Party Ledger is where a duplicate is actually SEEN, so the merge lives
// here too: any invoice this party has more than one entry for (same company,
// same vendor invoice number, e.g. one "Courier Bill (Freight)" row and one
// legacy "FREIGHT INVOICE" row) shows a panel offering to keep the entry that
// carries the document/AWBs and fold the other into it.
//
// Same server action Bill Payment already uses (mergeDuplicateBills): payments,
// credit/debit notes and adjustments move onto the keeper, the duplicate rows
// are zeroed and tagged (never deleted), and the ledger then shows ONE entry.
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergeDuplicateBills, type MergeBillsState } from "@/app/dashboard/bill-payment/merge-actions";

const initial: MergeBillsState = { error: null, success: null };

export type LedgerDuplicateRow = {
  id: string;
  label: string;
  total: number;
  creditNote: number;
  hasDocument: boolean;
};

export type LedgerDuplicateGroup = {
  key: string;
  invoiceNo: string;
  companyName: string;
  rows: LedgerDuplicateRow[];
};

export function LedgerDuplicateMerge({ groups }: { groups: LedgerDuplicateGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <div className="mb-3 space-y-2"
    >
      {/* 2026-10-29d — real books have DOZENS of these legacy pairs (one per
          courier bill raised before the Finance gate). Merging them one panel
          at a time was the painful part, so the whole list can now be folded
          in a single click; each invoice still goes through the exact same
          mergeDuplicateBills action, one after another, so nothing about the
          accounting changes — only the number of clicks. */}
      <MergeAllBar groups={groups} />
      {groups.map((g) => (
        <DuplicateGroupRow key={g.key} group={g} />
      ))}
    </div>
  );
}

function MergeAllBar({ groups }: { groups: LedgerDuplicateGroup[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // 2026-10-29l — only groups whose entries actually carry the SAME invoice
  // value are merged in bulk; a group whose amounts differ is not a duplicate
  // (the server rejects it too), so it is skipped and reported instead of
  // stopping the whole run halfway.
  const eligible = groups.filter((g) => {
    const keeper = g.rows.find((r) => r.hasDocument) ?? g.rows[0];
    return g.rows.filter((r) => r.id !== keeper.id).every((r) => Math.abs(r.total - keeper.total) <= 0.005);
  });
  const skipped = groups.length - eligible.length;

  if (done) {
    return (
      <p className="rounded-lg bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800">
        ✓ {eligible.length} duplicate invoice{eligible.length === 1 ? "" : "s"} merged into one entry each — refresh to see the single lines.
        {skipped > 0 && ` ${skipped} skipped because their invoice values differ (aage alag se dekh lo).`}
      </p>
    );
  }

  function mergeAll() {
    setFailure(null);
    startTransition(async () => {
      let merged = 0;
      for (const group of eligible) {
        const keeper = group.rows.find((r) => r.hasDocument) ?? group.rows[0];
        const losers = group.rows.filter((r) => r.id !== keeper.id);
        if (!keeper || losers.length === 0) continue;
        setProgress(`${merged + 1} of ${eligible.length} — invoice ${group.invoiceNo}`);
        const fd = new FormData();
        fd.set("bill_ids_json", JSON.stringify([keeper.id, ...losers.map((l) => l.id)]));
        const result = await mergeDuplicateBills({ error: null, success: null }, fd);
        if (result.error) {
          setFailure(`Stopped at invoice ${group.invoiceNo}: ${result.error} ${merged > 0 ? `(${merged} already merged)` : ""}`);
          setProgress(null);
          router.refresh();
          return;
        }
        merged++;
      }
      setProgress(null);
      setDone(true);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-teal-900">
          🔗 {groups.length} invoice{groups.length === 1 ? "" : "s"} in this ledger have more than one entry (same company, same invoice no.).
        </span>
        <button
          type="button"
          onClick={mergeAll}
          disabled={pending || eligible.length === 0}
          title={eligible.length === 0 ? "Har group me invoice value alag hai — duplicate nahi." : undefined}
          className="rounded-lg bg-teal-700 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-40"
        >
          {pending ? progress ?? "Merging…" : `🔗 Merge all ${eligible.length} into one entry each`}
        </button>
        {skipped > 0 && (
          <span className="text-[10px] font-medium text-amber-700">
            {skipped} group{skipped === 1 ? "" : "s"} skipped — invoice value alag hai
          </span>
        )}
        <span className="text-[10px] text-teal-700">
          Keeps the entry that carries the document/AWBs and folds the other into it — payments, credit/debit notes and adjustments move across, duplicate amounts are dropped.
        </span>
      </div>
      {failure && <p className="mt-1 font-medium text-red-600">{failure}</p>}
    </div>
  );
}

function DuplicateGroupRow({ group }: { group: LedgerDuplicateGroup }) {
  const [state, action, pending] = useActionState(mergeDuplicateBills, initial);
  // Keep the entry that carries the real document (the Courier Bill with its
  // AWBs) — that is the one the user pointed at. A loose/manual duplicate is
  // folded into it, credit note included.
  const preferred = group.rows.find((r) => r.hasDocument) ?? group.rows[0];
  const [keeperId, setKeeperId] = useState(preferred.id);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!state.success) return;
    const t = setTimeout(() => setDone(true), 1200);
    return () => clearTimeout(t);
  }, [state.success]);

  if (done) {
    return (
      <p className="rounded-lg bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800">
        ✓ {group.invoiceNo} merged into one entry — refresh to see the single line.
      </p>
    );
  }

  const losers = group.rows.filter((r) => r.id !== keeperId);
  const keeper = group.rows.find((r) => r.id === keeperId) ?? group.rows[0];
  // 2026-10-29l — "jis bill ke sath merge ho raha uska check bhi kare ki invoice
  // value kitna hai": the kept entry's invoice value is stated explicitly and
  // every other entry is compared against it. A merge is only a duplicate when
  // the value matches (the server also requires the invoice date to match).
  const valueMismatch = losers.some((l) => Math.abs(l.total - keeper.total) > 0.005);

  return (
    <form action={action} className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-2 text-xs">
      <input type="hidden" name="bill_ids_json" value={JSON.stringify([keeperId, ...losers.map((l) => l.id)])} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-teal-900">
          🔗 Duplicate invoice {group.invoiceNo} — {group.rows.length} entries in {group.companyName}
        </span>
        <span className="text-teal-700">
          {group.rows.map((r) => `${r.label} ₹${r.total.toFixed(2)}${r.creditNote ? ` (CN ₹${r.creditNote.toFixed(2)})` : ""}`).join("  ·  ")}
        </span>
      </div>
      <div className="mt-1 rounded border border-teal-200 bg-white px-2 py-1 text-[11px] text-slate-700">
        <span className="font-semibold text-teal-900">Kept entry invoice value: ₹{keeper.total.toFixed(2)}</span>
        {losers.map((l) => {
          const same = Math.abs(l.total - keeper.total) <= 0.005;
          return (
            <span key={l.id} className="ml-2">
              {same ? "✓" : "✗"} {l.label} ₹{l.total.toFixed(2)}
            </span>
          );
        })}
        {valueMismatch && (
          <p className="mt-0.5 font-semibold text-red-600">
            Value alag hai — ye duplicate nahi, merge server par reject hoga.
          </p>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-0.5 block text-[10px] font-medium text-teal-700" htmlFor={`keep-${group.key}`}>
            Entry to keep
          </label>
          <select
            id={`keep-${group.key}`}
            value={keeperId}
            onChange={(e) => setKeeperId(e.target.value)}
            className="rounded-lg border border-teal-300 bg-white px-2 py-1 text-xs text-slate-900"
          >
            {group.rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} — ₹{r.total.toFixed(2)}
                {r.creditNote ? ` · CN ₹${r.creditNote.toFixed(2)}` : ""}
                {r.hasDocument ? " · with document" : ""}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending || valueMismatch}
          title={valueMismatch ? "Invoice value must agree — these are different bills." : undefined}
          className="rounded-lg bg-teal-700 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-40"
        >
          {pending ? "Merging…" : `🔗 Merge ${group.rows.length} entries into one`}
        </button>
        <span className="text-[10px] text-teal-700">
          Payments, credit/debit notes and adjustments move onto <strong>{keeper.label}</strong>; duplicate amounts are dropped.
        </span>
      </div>
      {state.error && <p className="mt-1 font-medium text-red-600">{state.error}</p>}
    </form>
  );
}
