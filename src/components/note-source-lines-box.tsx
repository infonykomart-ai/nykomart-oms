// 2026-10-29f — "WHAT THIS NOTE IS FOR" block for the Debit Note / Credit Note
// printed sheets: PO/order ref + the actual invoice item lines (item, qty,
// rate, amount, GST) and how much of the note sits on each invoice.
//
// Data comes from loadNoteSourceLines() (src/lib/notes/note-source-lines.ts),
// which walks note -> adjustment -> invoice -> purchase item -> order. Plain
// server component (no hooks) so it renders inside PrintArea.
import type { NoteSourceInfo } from "@/lib/notes/note-source-lines";

const inr = (n: number | null) =>
  n == null ? "—" : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number | null) => (n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-IN"));

export function NoteSourceLinesBox({ info, label = "This note is for" }: { info: NoteSourceInfo; label?: string }) {
  // Nothing resolved: say so explicitly instead of printing an empty block —
  // a sheet with no order/item behind it means the note was entered as a flat
  // amount, and the reader should know that rather than wonder.
  if (info.lines.length === 0) {
    return (
      <div className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
        <span className="font-semibold text-slate-700">Order / item reference: </span>
        This note was entered as a flat amount — no invoice, PO or item line is linked to it.
      </div>
    );
  }

  return (
    <div className="mb-4 border-b border-slate-300 pb-3">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold uppercase tracking-wide text-slate-700">{label}</span>
        {info.orderRefs.length > 0 && (
          <span className="text-[11px] font-semibold text-slate-800">
            PO / Order No.: {info.orderRefs.join(", ")}
          </span>
        )}
      </div>
      <table className="w-full border-collapse text-left text-[11px]">
        <thead>
          <tr className="border-b border-slate-300 uppercase text-slate-500">
            <th className="py-1 pr-2">Invoice No.</th>
            <th className="py-1 pr-2">Date</th>
            <th className="py-1 pr-2">PO No.</th>
            <th className="py-1 pr-2">Item</th>
            <th className="py-1 pr-2 text-right">Qty</th>
            <th className="py-1 pr-2">Unit</th>
            <th className="py-1 pr-2 text-right">Rate</th>
            <th className="py-1 pr-2 text-right">Amount</th>
            <th className="py-1 pr-2 text-right">GST</th>
            <th className="py-1 text-right">This Note</th>
          </tr>
        </thead>
        <tbody>
          {info.lines.map((l, i) => (
            <tr key={`${l.billId ?? "x"}-${i}`} className="border-b border-slate-100">
              <td className="py-1 pr-2 text-slate-800">{l.invoiceNo}</td>
              <td className="py-1 pr-2 text-slate-500">{l.invoiceDate ?? "—"}</td>
              <td className="py-1 pr-2 text-slate-600">{l.poRefs.length ? l.poRefs.join(", ") : "—"}</td>
              <td className="py-1 pr-2 text-slate-700">{l.item ?? "—"}</td>
              <td className="py-1 pr-2 text-right text-slate-700">{num(l.qty)}</td>
              <td className="py-1 pr-2 text-slate-600">{l.unit ?? "—"}</td>
              <td className="py-1 pr-2 text-right text-slate-700">{inr(l.rate)}</td>
              <td className="py-1 pr-2 text-right text-slate-700">{inr(l.amount)}</td>
              <td className="py-1 pr-2 text-right text-slate-700">
                {l.gstPctTotal == null ? "—" : `${l.gstPctTotal}%`}
                {l.gstAmount != null && l.gstAmount > 0 && (
                  <div className="text-[9px] text-slate-400">+ {inr(l.gstAmount)}</div>
                )}
              </td>
              <td className="py-1 text-right font-semibold text-slate-900">{l.applied == null ? "—" : inr(l.applied)}</td>
            </tr>
          ))}
        </tbody>
        {info.appliedTotal > 0 && (
          <tfoot>
            <tr className="border-t border-slate-800 font-semibold">
              <td className="py-1 pr-2" colSpan={9}>
                Total on this note ({info.lines.filter((l) => l.applied != null).length} invoice
                {info.lines.filter((l) => l.applied != null).length === 1 ? "" : "s"})
              </td>
              <td className="py-1 text-right">{inr(info.appliedTotal)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
