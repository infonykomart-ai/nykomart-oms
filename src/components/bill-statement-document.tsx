// 2026-09-15 — shared read-only BILL STATEMENT document, one component
// used by BOTH the Party Ledger's full [billId] page and the new
// BillStatementDialog (Bill Payment / Documents rows). Pure presentational
// component — all data comes from loadBillStatement() in
// ../bill-statement.ts; actions live in bill-statement-actions.tsx.
import { PrintArea } from "@/components/print-view";
import type { BillStatementData } from "@/lib/bill-statement";

export function BillStatementDocument({ data }: { data: BillStatementData }) {
  const { bill, party, company, profile, companyName } = data;
  const inr = (n: number) => `₹${n.toFixed(2)}`;

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
            <div className="mb-1 font-semibold">PURCHASE LINE ITEMS</div>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                  <th className="py-1 pr-2">Order Ref</th>
                  <th className="py-1 pr-2">Description</th>
                  <th className="py-1 pr-2 text-right">Qty</th>
                  <th className="py-1 pr-2">Unit</th>
                  <th className="py-1 pr-2 text-right">Rate</th>
                  <th className="py-1 pr-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.poLines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1 pr-2">{l.refNo ?? "—"}</td>
                    <td className="py-1 pr-2">{l.description ?? "—"}</td>
                    <td className="py-1 pr-2 text-right">{l.qty}</td>
                    <td className="py-1 pr-2">{l.unit}</td>
                    <td className="py-1 pr-2 text-right">{inr(l.rate)}</td>
                    <td className="py-1 pr-2 text-right">{inr(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
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
                    <td className="py-1 pr-2 text-right">{inr(p.amount)}</td>
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
