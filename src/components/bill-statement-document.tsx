// 2026-09-15 — shared read-only BILL STATEMENT document, one component
// used by BOTH the Party Ledger's full [billId] page and the new
// BillStatementDialog (Bill Payment / Documents rows). Pure presentational
// component — all data comes from loadBillStatement() in
// ../bill-statement.ts; actions live in bill-statement-actions.tsx.
import type { ReactNode } from "react";
import Link from "next/link";
import { PrintArea } from "@/components/print-view";
import type { BillStatementData } from "@/lib/bill-statement";
import { purchaseAreaSqFt } from "@/lib/length-units";

export function BillStatementDocument({
  data,
  // 2026-10-13 — optional per-entry Edit/Delete slot (see po-line-actions.tsx).
  // Only the interactive dialog (BillStatementDialog) passes this; the
  // read-only Party Ledger page renders without it, so that page stays a
  // pure server component with no client actions.
  lineActions,
}: {
  data: BillStatementData;
  lineActions?: (line: BillStatementData["poLines"][number]) => ReactNode;
}) {
  const { bill, party, company, profile, companyName } = data;
  const inr = (n: number) => `₹${n.toFixed(2)}`;
  // 2026-10-24 — same fix as purchase-bills/[id]/report: this column is
  // purchase_bills.sq_feet, i.e. the billed AREA in the bill's own qty_unit,
  // not a length and not the order's 3X20 FT size. It is shown in Sq Ft
  // whatever unit the bill was entered in (MTR/INCH/CM/YARD converted by
  // purchaseAreaSqFt — squared factor, never the linear toFeet), with the
  // as-entered figure underneath so it still ties back to the vendor's bill.
  // PCS lines carry sq_feet = 1 as a formula placeholder → no area to show.
  const SQ_UNIT_WORD: Record<string, string> = { FT: "ft", MTR: "mtr", INCH: "in", YARD: "yd", CM: "cm" };

  return (
    <PrintArea id="bill-statement-print" companyName={companyName} companyLogoUrl={company?.logo_url}>
      <div className="mx-auto min-h-[900px] w-full bg-white p-8 text-xs text-slate-900" style={{ fontFamily: "Arial, sans-serif" }}>
        <div className="mb-1 text-right text-sm font-bold tracking-wide">{data.docTitle}</div>
        <div className="mb-4 flex items-start justify-between border-b-2 border-slate-800 pb-3">
          <div className="flex items-start gap-3">
            {company?.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logo_url} alt={company.name} className="h-12 w-12 object-contain" />
            )}
            <div>
              <div className="text-lg font-bold">{companyName}</div>
              <div className="text-[11px] text-slate-600">{profile?.address}</div>
              <div className="text-[11px] text-slate-600">
                {[profile?.phone && `Phone: ${profile.phone}`, profile?.whatsapp && `WhatsApp: ${profile.whatsapp}`]
                  .filter(Boolean)
                  .join(" | ")}
              </div>
              <div className="text-[11px] text-slate-600">Email: {profile?.email}</div>
            </div>
          </div>
          <div className="text-right text-[10px] leading-relaxed">
            <div>GSTIN: {profile?.gstin ?? "—"}</div>
            <div>Bank: {profile?.bank_name ?? "—"}</div>
            <div>A/C No.: {profile?.account_no ?? "—"}</div>
            <div>IFSC: {profile?.ifsc_code ?? "—"}</div>
          </div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-4 border-b border-slate-300 pb-3">
          <div>
            <div className="font-semibold">VENDOR —</div>
            <div className="font-bold">{party.name}</div>
            <div className="whitespace-pre-wrap text-slate-600">{party.address}</div>
            {party.contact_no && <div>Phone: {party.contact_no}</div>}
            {party.email && <div>Email: {party.email}</div>}
            {party.gst && <div>GST: {party.gst}</div>}
          </div>
          <div>
            <div className="font-semibold">BILL DETAILS</div>
            <div>
              Invoice No.: <strong>{data.invoiceRef}</strong>
            </div>
            <div>Bill Date: {bill.invoice_date ?? "—"}</div>
            <div>Received: {bill.invoice_recv_date ?? "—"}</div>
            <div>Due Date: {bill.due_date ?? "—"}</div>
            <div>Type: {bill.invoice_type ?? "—"}</div>
            <div>Company: {companyName}</div>
          </div>
        </div>

        {data.poLines.length > 0 && (
          <div className="mb-3 border-b border-slate-300 pb-3">
            <div className="mb-1 font-semibold">
              {data.poLines.length > 1 ? `PO ENTRIES ON THIS INVOICE (${data.poLines.length})` : "PURCHASE LINE ITEM"}
            </div>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                  <th className="py-1 pr-2">PO / Order Ref</th>
                  <th className="py-1 pr-2">Description</th>
                  <th className="py-1 pr-2 text-right">
                    {data.poLines.some((l) => l.asBilled)
                      ? data.poLines.some((l) => !l.asBilled)
                        ? "Sq Ft / As billed"
                        : "As billed"
                      : "Sq Ft"}
                  </th>
                  <th className="py-1 pr-2 text-right">Qty</th>
                  <th className="py-1 pr-2">Unit</th>
                  <th className="py-1 pr-2 text-right">Rate</th>
                  <th className="py-1 pr-2 text-right">GST%</th>
                  <th className="py-1 pr-2 text-right">Amount</th>
                  {lineActions && <th className="py-1 pr-2 text-right">Action</th>}
                </tr>
              </thead>
              <tbody>
                {data.poLines.map((l, i) => (
                  <tr key={l.purchaseBillId ?? i} className="border-b border-slate-100">
                    <td className="py-1 pr-2">{l.refNo ?? "—"}</td>
                    <td className="py-1 pr-2">{l.description ?? "—"}</td>
                    <td className="py-1 pr-2 text-right">
                      {(() => {
                        // 2026-10-24b — a linear length billed in MTR/CM is
                        // shown exactly as the vendor billed it.
                        if (l.asBilled) return `${l.size} ${SQ_UNIT_WORD[l.unit] ?? l.unit}`;
                        const sqFt = purchaseAreaSqFt(l.size, l.unit);
                        if (sqFt == null) return "—";
                        return (
                          <>
                            {sqFt.toFixed(2)}
                            {l.unit !== "FT" && (
                              <div className="text-[9px] text-slate-400">
                                ({l.size} sq {SQ_UNIT_WORD[l.unit] ?? l.unit})
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    <td className="py-1 pr-2 text-right">{l.qty}</td>
                    <td className="py-1 pr-2">{l.unit}</td>
                    <td className="py-1 pr-2 text-right">{inr(l.rate)}</td>
                    <td className="py-1 pr-2 text-right">
                      {l.gstRatePct != null
                        ? `${l.gstType === "IGST" ? l.gstRatePct : l.gstRatePct * 2}% ${l.gstType === "IGST" ? "(IGST)" : "(CGST+SGST)"}`
                        : "—"}
                    </td>
                    <td className="py-1 pr-2 text-right">
                      {inr(l.amount)}
                      {l.gstRatePct != null && <div className="text-[9px] text-slate-400">+ GST {inr(l.gstAmount)} = {inr(l.amountWithGst)}</div>}
                    </td>
                    {lineActions && <td className="py-1 pr-2">{lineActions(l)}</td>}
                  </tr>
                ))}
              </tbody>
              {data.poLines.length > 1 && (
                <tfoot>
                  <tr className="border-t border-slate-800 font-semibold">
                    <td className="py-1 pr-2" colSpan={7}>Total (all entries, incl. GST)</td>
                    <td className="py-1 pr-2 text-right">{inr(data.poSubtotal)}</td>
                    {lineActions && <td />}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {data.awbLines.length > 0 && (
          <div className="mb-3 border-b border-slate-300 pb-3">
            <div className="mb-1 font-semibold">SHIPMENTS ON THIS BILL ({data.awbLines.length})</div>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                  <th className="py-1 pr-2">AWB / Tracking No.</th>
                  <th className="py-1 pr-2">Order Ref</th>
                  <th className="py-1 pr-2 text-right">Weight (kg)</th>
                  <th className="py-1 pr-2 text-right">Billed ₹</th>
                </tr>
              </thead>
              <tbody>
                {data.awbLines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1 pr-2 font-mono">{l.awb}</td>
                    <td className="py-1 pr-2">{l.refNo ?? "—"}</td>
                    <td className="py-1 pr-2 text-right">{l.weightKg != null ? l.weightKg.toFixed(3) : "—"}</td>
                    <td className="py-1 pr-2 text-right">{l.billedAmt != null ? inr(l.billedAmt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mb-3 border-b border-slate-300 pb-3">
          <div className="mb-1 font-semibold">BILL SUMMARY</div>
          <table className="w-full text-left">
            <tbody>
              <tr>
                <td className="py-0.5">Bill Amount</td>
                <td className="py-0.5 text-right">{inr(bill.total_amt)}</td>
              </tr>
              {/* 2026-10-29e — round-off entered at Bill Pass (or a reviewed
                  payable edited before sending) sits between the line items and
                  what Finance was actually posted with. Without this row the
                  summary total and the item table above simply disagreed with
                  no way to see why. */}
              {data.poLines.length > 0 && Math.abs(bill.total_amt - data.poSubtotal) > 0.005 && (
                <tr>
                  <td className="py-0.5">Round-off / reviewed adjustment vs line items</td>
                  <td className="py-0.5 text-right">
                    {bill.total_amt - data.poSubtotal >= 0 ? "+" : "−"} {inr(Math.abs(bill.total_amt - data.poSubtotal))}
                  </td>
                </tr>
              )}
              {bill.credit_note_amt > 0 && (
                <tr>
                  <td className="py-0.5">Credit Note</td>
                  <td className="py-0.5 text-right">− {inr(bill.credit_note_amt)}</td>
                </tr>
              )}
              {bill.adj_amt > 0 && (
                <tr>
                  <td className="py-0.5">CN/DN Adjustments</td>
                  <td className="py-0.5 text-right">− {inr(bill.adj_amt)}</td>
                </tr>
              )}
              <tr className="border-t border-slate-300 font-semibold">
                <td className="py-0.5">Net Payable</td>
                <td className="py-0.5 text-right">{inr(bill.total_amt - bill.credit_note_amt - bill.adj_amt)}</td>
              </tr>
              {data.settledTotal > 0 && (
                <tr>
                  <td className="py-0.5">Paid (bank + wallet)</td>
                  <td className="py-0.5 text-right">− {inr(data.settledTotal)}</td>
                </tr>
              )}
              <tr className="border-t border-slate-800 text-sm font-bold">
                <td className="py-1">{data.fullyPaid ? "STATUS: PAID IN FULL" : "BALANCE DUE"}</td>
                <td className="py-1 text-right">{data.fullyPaid ? "✓" : inr(data.outstanding)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {data.payments.length > 0 && (
          <div className="mb-3 border-b border-slate-300 pb-3">
            <div className="mb-1 font-semibold">PAYMENTS RECEIVED FROM US ({data.payments.length})</div>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                  <th className="py-1 pr-2">Date</th>
                  <th className="py-1 pr-2">Mode</th>
                  <th className="py-1 pr-2">UTR / Ref No.</th>
                  <th className="py-1 pr-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="py-1 pr-2">{p.payment_date}</td>
                    <td className="py-1 pr-2">{p.payment_mode ?? "—"}</td>
                    <td className="py-1 pr-2 font-mono">{p.reference_no ?? "—"}</td>
                    <td className="py-1 pr-2 text-right">
                      {inr(p.amount)}
                      {/* 2026-10-29d — every recorded payment now has its own
                          printable PAYMENT VOUCHER (amount in words, company
                          letterhead of the bill's own company). Screen-only:
                          the statement itself is the printed document. */}
                      <Link
                        href={`/dashboard/bill-payment/voucher/${p.id}`}
                        target="_blank"
                        className="ml-2 whitespace-nowrap rounded border border-teal-300 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 hover:bg-teal-50 print:hidden"
                        title="Open the printable Payment Voucher for this payment"
                      >
                        🧾 Voucher
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data.walletConsumes.length > 0 && (
          <div className="mb-3 border-b border-slate-300 pb-3">
            <div className="mb-1 font-semibold">COURIER WALLET SETTLEMENT</div>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                  <th className="py-1 pr-2">Date</th>
                  <th className="py-1 pr-2">Mode / Ref</th>
                  <th className="py-1 pr-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.walletConsumes.map((w) => (
                  <tr key={w.id} className="border-b border-slate-100">
                    <td className="py-1 pr-2">{w.txn_date}</td>
                    <td className="py-1 pr-2">{[w.payment_mode, w.reference_no].filter(Boolean).join(" · ") || "Wallet"}</td>
                    <td className="py-1 pr-2 text-right">{inr(w.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data.adjustments.length > 0 && (
          <div className="mb-3 border-b border-slate-300 pb-3">
            <div className="mb-1 font-semibold">CREDIT / DEBIT NOTE ADJUSTMENTS ({data.adjustments.length})</div>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                  <th className="py-1 pr-2">Date</th>
                  <th className="py-1 pr-2">Note</th>
                  <th className="py-1 pr-2">Remark</th>
                  <th className="py-1 pr-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.adjustments.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100">
                    <td className="py-1 pr-2">{a.createdDate}</td>
                    <td className="py-1 pr-2">{a.label}</td>
                    <td className="py-1 pr-2">{a.remark ?? "—"}</td>
                    <td className="py-1 pr-2 text-right">{inr(a.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(party.bank_name || party.account_no) && (
          <div className="mb-3 border-b border-slate-300 pb-3">
            <div className="mb-1 font-semibold">VENDOR BANK DETAILS</div>
            <div>
              {[
                party.bank_name && `Bank: ${party.bank_name}`,
                party.account_no && `A/C: ${party.account_no}`,
                party.ifsc_code && `IFSC: ${party.ifsc_code}`,
                party.account_holder_name && `Holder: ${party.account_holder_name}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        )}

        <div className="pt-2 text-[10px] text-slate-500">
          <div>Remark: {bill.remark ?? "—"}</div>
          <div className="mt-2 italic">
            This is a computer-generated statement from the Nyko Mart Order Management System — no signature required.
          </div>
        </div>
      </div>
    </PrintArea>
  );
}
