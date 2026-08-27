"use client";

// 2026-08-27 (later same day) — "jese invoice ka preview hota hai vese hi
// credit note debit note show hone chahiye / purchase bill ho ya kisi bhi
// party ka bill ho agar apni trf se ho ya samne party ki traf se ho
// credite note ya debit note agar us invoice se related ho to vaha dikhna
// cahiye sath hi link bhi hona chahiye": a small reusable "preview" for
// wherever a bill/invoice is listed (Bill Payment, Purchase Bill / Freight
// Bill / Duty Bill recent lists, Order view) — shows the doc no/date/
// amount of every Credit/Debit Note connected to that bill (see
// actions.ts's listRelatedNotesForBills for what counts as "connected":
// either raised against it, or applied as an adjustment against it), with
// a link back to Document Entry (there's no dedicated per-note view page
// yet — same "link back to Document Entry" pattern order-view.tsx already
// used for order-linked notes).
import Link from "next/link";
import type { RelatedNote } from "./actions";

const KIND_LABEL: Record<RelatedNote["kind"], string> = { debit: "Debit Note", credit: "Credit Note" };
const KIND_COLOR: Record<RelatedNote["kind"], string> = {
  debit: "bg-red-50 text-red-700 border-red-200",
  credit: "bg-green-50 text-green-700 border-green-200",
};

export function RelatedNotesBadge({ notes }: { notes: RelatedNote[] }) {
  if (notes.length === 0) return null;

  // A note can show up twice for the same bill (raised against it AND also
  // adjusted against it) — that's two genuinely different facts worth
  // seeing, so dedupe only exact (id, relation) repeats, not across
  // relations.
  const seen = new Set<string>();
  const deduped = notes.filter((n) => {
    const key = `${n.kind}:${n.id}:${n.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <details className="group inline-block align-middle">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100">
        🔗 {deduped.length} note{deduped.length === 1 ? "" : "s"}
      </summary>
      <div className="mt-1 space-y-1 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
        {deduped.map((n) => (
          <div key={`${n.kind}-${n.id}-${n.relation}`} className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-[11px] ${KIND_COLOR[n.kind]}`}>
            <span>
              <Link href={`/dashboard/documents?tab=${n.kind}-note`} className="font-semibold underline">
                {n.docNo ?? KIND_LABEL[n.kind]}
              </Link>{" "}
              {n.relation === "raised_against" ? "— raised against this" : "— adjusted against this"}
              {n.date ? ` · ${n.date}` : ""}
            </span>
            <span className="whitespace-nowrap font-semibold">₹{n.amount.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
