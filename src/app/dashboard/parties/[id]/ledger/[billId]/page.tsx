// 2026-09-15 — "ek chij ho jaye agar invoice no par click kar ke uski puri
// entry dekhni ho to usme read only form open ho jaye jiska print kiya ja
// sake whatsapp bhej ja sake" — the Party Ledger's INVOICE NO. cell is now
// a link to /dashboard/parties/[id]/ledger/[billId], a READ-ONLY bill
// statement styled like the courier bill / internal invoice views (company
// logo + profile header via PrintArea, Arial doc font). "jo jo importent
// section hai vo apne aap aajaye": the statement auto-includes whatever
// applies to the bill — vendor + company header, PO line items (Purchase),
// per-AWB shipment lines (Courier Freight/Duty), payment history, credit /
// debit note adjustments, wallet settlements, and the bank details the
// vendor needs to be paid. "couriour ka form dekh lena uske hisab se
// purchase ka & other party ke liye banega" — source-type-aware layout.
//
// The PAYMENT NOTIFY section (also on this page, per the same request):
// vendor ko payment hua to usse WhatsApp/email per bhejne ka option. No
// WhatsApp Business API — a wa.me deep link with a pre-filled payment
// intimation message (same pattern as shareOnWhatsApp / order-whatsapp-
// button) and a mailto: fallback, prefilled from the party's contact_no /
// email and the bill's real payment rows. WhatsApp/email can't receive
// server-to-server attachments anyway; this is the notification, not a
// document transfer — the statement itself is the printable/downloadable
// artifact (Print → PDF) that can be attached from the phone.
//
// Server Component (requireCapability + service-role Supabase); the
// print/WhatsApp/email buttons live in the client wrapper
// bill-statement-actions.tsx, same split as ledger-export-bar.tsx.

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea } from "@/components/print-view";
import { BillStatementActions } from "./bill-statement-actions";

export default async function LedgerBillStatementPage({
  params,
}: {
  params: Promise<{ id: string; billId: string }>;
}) {
  const { id: partyId, billId } = await params;
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  const { data: party } = await supabase
    .from("parties")
    .select("id, name, party_type, address, contact_no, email, gst, bank_name, account_no, ifsc_code, account_holder_name")
    .eq("id", partyId)
    .maybeSingle();
  if (!party) notFound();

  const { data: bill } = await supabase
    .from("bill_pass_register")
    .select(
      "id, company_id, party_id, invoice_no, vendor_invoice_no, invoice_type, invoice_date, invoice_recv_date, total_amt, credit_note_amt, adj_amt, to_be_pay, total_paid, balance_due, due_date, approval_status, remark, source, source_id, created_at"
    )
    .eq("id", billId)
    .eq("party_id", partyId)
    .maybeSingle();
  if (!bill || !employee.companyIds.includes(bill.company_id)) notFound();

  const [companyRes, profileRes, paymentsRes, adjustmentsRes, walletRes, companiesRes] = await Promise.all([
    supabase.from("companies").select("id, name, logo_url").eq("id", bill.company_id).maybeSingle(),
    supabase
      .from("company_profiles")
      .select("address, phone, whatsapp, email, gstin, bank_name, account_no, ifsc_code")
      .eq("company_id", bill.company_id)
      .maybeSingle(),
    supabase
      .from("bill_pass_register_payments")
      .select("id, amount, payment_date, payment_mode, reference_no, remark")
      .eq("bill_pass_register_id", bill.id)
      .order("payment_date", { ascending: true }),
    supabase
      .from("bill_pass_register_adjustments")
      .select("id, amount, remark, created_at, debit_note_id, credit_note_id")
      .eq("bill_pass_register_id", bill.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("party_wallet_txns")
      .select("id, txn_type, direction, amount, txn_date, payment_mode, reference_no, remark")
      .eq("bill_pass_register_id", bill.id)
      .eq("party_id", partyId)
      .order("txn_date", { ascending: true }),
    supabase.from("companies").select("id, name"),
  ]);

  const company = companyRes.data;
  const profile = profileRes.data;
  const payments = paymentsRes.data ?? [];
  const adjustments = adjustmentsRes.data ?? [];
  const walletTxns = walletRes.data ?? [];

  // "jo jo importent section hai vo apne aap aajaye" — enrich the bill
  // with its SOURCE document's detail, per source type:
  //  - purchase_bill → purchase_bills rows (qty/unit/rate/GST per PO) —
  //    "couriour ka form dekh lena uske hisab se purchase ka banega"
  //  - freight_bill / duty_tax_bill → per-AWB assignment lines
  // Manual (source IS NULL) bills have no source document; the header
  // math still tells the whole story.
  type PoLine = { refNo: string | null; description: string | null; qty: number; unit: string; rate: number; amount: number };
  type AwbLine = { awb: string; refNo: string | null; weightKg: number | null; billedAmt: number | null };
  let poLines: PoLine[] = [];
  let awbLines: AwbLine[] = [];
  if (bill.source === "purchase_bill" && bill.source_id) {
    // Manual follow-up fetches instead of embedded joins — the generated
    // types' Relationships array has gone stale before (order_shipment_id
    // FK), and SelectQueryError surfaces at runtime, not just in tsc.
    const { data: pb } = await supabase
      .from("purchase_bills")
      .select("id, order_id, qty, qty_unit, unit_rate, total_amount, work_description")
      .eq("id", bill.source_id)
      .maybeSingle();
    if (pb) {
      let refNo: string | null = null;
      if (pb.order_id) {
        const { data: o } = await supabase.from("orders").select("id, ref_no").eq("id", pb.order_id).maybeSingle();
        refNo = o?.ref_no ?? null;
      }
      poLines = [
        {
          refNo,
          description: pb.work_description,
          qty: Number(pb.qty),
          unit: pb.qty_unit,
          rate: Number(pb.unit_rate),
          amount: Number(pb.total_amount ?? 0),
        },
      ];
    }
  } else if (bill.source === "freight_bill" && bill.source_id) {
    // Freight bills: per-AWB assignments with billed weight + billed amount.
    const { data: assigns } = await supabase
      .from("freight_bill_awb_assignments")
      .select("order_id, order_shipment_id, bill_weight_kg, billed_freight_amt")
      .eq("freight_bill_id", bill.source_id);
    const shipmentIds = (assigns ?? []).map((a) => a.order_shipment_id);
    const { data: ships } = shipmentIds.length
      ? await supabase.from("order_shipments").select("id, awb_no").in("id", shipmentIds)
      : { data: [] };
    const awbById = new Map((ships ?? []).map((s) => [s.id, s.awb_no] as const));
    const orderIds = Array.from(new Set((assigns ?? []).map((a) => a.order_id)));
    const { data: ords } = orderIds.length
      ? await supabase.from("orders").select("id, ref_no").in("id", orderIds)
      : { data: [] };
    const refById = new Map((ords ?? []).map((o) => [o.id, o.ref_no] as const));
    awbLines = (assigns ?? []).map((a) => ({
      awb: awbById.get(a.order_shipment_id) ?? "—",
      refNo: refById.get(a.order_id) ?? null,
      weightKg: a.bill_weight_kg != null ? Number(a.bill_weight_kg) : null,
      billedAmt: a.billed_freight_amt != null ? Number(a.billed_freight_amt) : null,
    }));
  } else if (bill.source === "duty_tax_bill" && bill.source_id) {
    // Duty bills: per-AWB duty amount (INR) instead of freight.
    const { data: assigns } = await supabase
      .from("duty_bill_awb_assignments")
      .select("order_id, order_shipment_id, duty_tax_amt_inr")
      .eq("duty_tax_bill_id", bill.source_id);
    const shipmentIds = (assigns ?? []).map((a) => a.order_shipment_id);
    const { data: ships } = shipmentIds.length
      ? await supabase.from("order_shipments").select("id, awb_no").in("id", shipmentIds)
      : { data: [] };
    const awbById = new Map((ships ?? []).map((s) => [s.id, s.awb_no] as const));
    const orderIds = Array.from(new Set((assigns ?? []).map((a) => a.order_id)));
    const { data: ords } = orderIds.length
      ? await supabase.from("orders").select("id, ref_no").in("id", orderIds)
      : { data: [] };
    const refById = new Map((ords ?? []).map((o) => [o.id, o.ref_no] as const));
    awbLines = (assigns ?? []).map((a) => ({
      awb: awbById.get(a.order_shipment_id) ?? "—",
      refNo: refById.get(a.order_id) ?? null,
      weightKg: null,
      billedAmt: a.duty_tax_amt_inr != null ? Number(a.duty_tax_amt_inr) : null,
    }));
  }

  const companyNames = new Map((companiesRes.data ?? []).map((c) => [c.id, c.name]));
  const companyName = companyNames.get(bill.company_id) ?? "—";
  const invoiceRef = (bill.vendor_invoice_no || bill.invoice_no || "").trim();

  const paidTotal = payments.reduce((s, p) => s + Number(p.amount), 0);
  const walletPaid = walletTxns.filter((w) => w.txn_type === "consume").reduce((s, w) => s + Number(w.amount), 0);
  const settledTotal = paidTotal + walletPaid;
  const outstanding = Math.max(Number(bill.balance_due ?? 0), 0);
  const fullyPaid = Number(bill.balance_due ?? 0) <= 0.005;

  const noteIds = adjustments.map((a) => a.credit_note_id ?? a.debit_note_id).filter((v): v is string => !!v);
  const [cnRes, dnRes] = await Promise.all([
    noteIds.length
      ? supabase.from("credit_notes").select("id, cn_no, vendor_cn_no").in("id", noteIds)
      : Promise.resolve({ data: [] }),
    noteIds.length ? supabase.from("debit_notes").select("id, debit_note_no").in("id", noteIds) : Promise.resolve({ data: [] }),
  ]);
  const noteLabel = new Map<string, string>();
  for (const n of cnRes.data ?? []) {
    noteLabel.set(n.id, n.vendor_cn_no ? `${n.cn_no ?? "CN"} (party: ${n.vendor_cn_no})` : n.cn_no ?? "CN");
  }
  for (const n of dnRes.data ?? []) noteLabel.set(n.id, n.debit_note_no ?? "DN");

  const waPhoneRaw = (party.contact_no ?? "").replace(/\D/g, "");
  const waPhone = waPhoneRaw.length === 10 ? `91${waPhoneRaw}` : waPhoneRaw;
  const docTitle =
    bill.source === "freight_bill"
      ? "COURIER FREIGHT BILL STATEMENT"
      : bill.source === "duty_tax_bill"
        ? "DUTY & TAX BILL STATEMENT"
        : "PURCHASE BILL STATEMENT";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/dashboard/parties/${partyId}/ledger`}
          className="text-sm text-slate-500 hover:underline"
        >
          ← Back to Party Ledger
        </Link>
        <BillStatementActions
          docTitle={docTitle}
          vendorName={party.name}
          invoiceRef={invoiceRef || bill.invoice_no || ""}
          companyName={companyName}
          totalAmt={Number(bill.total_amt ?? 0)}
          creditNoteAmt={Number(bill.credit_note_amt ?? 0) + Number(bill.adj_amt ?? 0)}
          paidAmt={settledTotal}
          outstandingAmt={outstanding}
          fullyPaid={fullyPaid}
          paymentMode={payments.length ? (payments[payments.length - 1].payment_mode ?? "NEFT") : walletPaid > 0 ? "Courier Wallet" : ""}
          lastPaymentDate={payments.length ? payments[payments.length - 1].payment_date : ""}
          lastUtr={payments.length ? payments[payments.length - 1].reference_no ?? "" : ""}
          waPhone={waPhone}
          partyEmail={party.email}
        />
      </div>

      <PrintArea id="bill-statement-print">
        <div
          className="mx-auto min-h-[900px] w-full bg-white p-8 text-xs text-slate-900"
          style={{ fontFamily: "Arial, sans-serif" }}
        >
          {/* Header — same shape as the courier/internal invoice views: logo,
              company profile block, GSTIN/bank column. */}
          <div className="mb-1 text-right text-sm font-bold tracking-wide">{docTitle}</div>
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

          {/* Vendor block — the party this bill belongs to. */}
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
              <div>Invoice No.: <strong>{invoiceRef || bill.invoice_no || "—"}</strong></div>
              <div>Bill Date: {bill.invoice_date ?? "—"}</div>
              <div>Received: {bill.invoice_recv_date ?? "—"}</div>
              <div>Due Date: {bill.due_date ?? "—"}</div>
              <div>Type: {bill.invoice_type ?? "—"}</div>
              <div>Company: {companyName}</div>
            </div>
          </div>

          {/* Purchase bills: the PO line item(s). Courier bills: per-AWB
              shipment lines. Nothing fetched = section silently omitted. */}
          {poLines.length > 0 && (
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
                  {poLines.map((l, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-1 pr-2">{l.refNo ?? "—"}</td>
                      <td className="py-1 pr-2">{l.description ?? "—"}</td>
                      <td className="py-1 pr-2 text-right">{l.qty}</td>
                      <td className="py-1 pr-2">{l.unit}</td>
                      <td className="py-1 pr-2 text-right">₹{l.rate.toFixed(2)}</td>
                      <td className="py-1 pr-2 text-right">₹{l.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {awbLines.length > 0 && (
            <div className="mb-3 border-b border-slate-300 pb-3">
              <div className="mb-1 font-semibold">SHIPMENTS ON THIS BILL ({awbLines.length})</div>
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
                  {awbLines.map((l, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-1 pr-2 font-mono">{l.awb}</td>
                      <td className="py-1 pr-2">{l.refNo ?? "—"}</td>
                      <td className="py-1 pr-2 text-right">{l.weightKg != null ? l.weightKg.toFixed(3) : "—"}</td>
                      <td className="py-1 pr-2 text-right">{l.billedAmt != null ? `₹${l.billedAmt.toFixed(2)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* The math — mirrors the ledger's own Credit/Debit convention. */}
          <div className="mb-3 border-b border-slate-300 pb-3">
            <div className="mb-1 font-semibold">BILL SUMMARY</div>
            <table className="w-full text-left">
              <tbody>
                <tr>
                  <td className="py-0.5">Bill Amount</td>
                  <td className="py-0.5 text-right">₹{Number(bill.total_amt ?? 0).toFixed(2)}</td>
                </tr>
                {Number(bill.credit_note_amt ?? 0) > 0 && (
                  <tr>
                    <td className="py-0.5">Credit Note</td>
                    <td className="py-0.5 text-right">− ₹{Number(bill.credit_note_amt).toFixed(2)}</td>
                  </tr>
                )}
                {Number(bill.adj_amt ?? 0) > 0 && (
                  <tr>
                    <td className="py-0.5">CN/DN Adjustments</td>
                    <td className="py-0.5 text-right">− ₹{Number(bill.adj_amt).toFixed(2)}</td>
                  </tr>
                )}
                <tr className="border-t border-slate-300 font-semibold">
                  <td className="py-0.5">Net Payable</td>
                  <td className="py-0.5 text-right">
                    ₹{(Number(bill.total_amt ?? 0) - Number(bill.credit_note_amt ?? 0) - Number(bill.adj_amt ?? 0)).toFixed(2)}
                  </td>
                </tr>
                {settledTotal > 0 && (
                  <tr>
                    <td className="py-0.5">Paid (bank + wallet)</td>
                    <td className="py-0.5 text-right">− ₹{settledTotal.toFixed(2)}</td>
                  </tr>
                )}
                <tr className="border-t border-slate-800 text-sm font-bold">
                  <td className="py-1">{fullyPaid ? "STATUS: PAID IN FULL" : "BALANCE DUE"}</td>
                  <td className="py-1 text-right">{fullyPaid ? "✓" : `₹${outstanding.toFixed(2)}`}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {payments.length > 0 && (
            <div className="mb-3 border-b border-slate-300 pb-3">
              <div className="mb-1 font-semibold">PAYMENTS RECEIVED FROM US ({payments.length})</div>
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
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100">
                      <td className="py-1 pr-2">{p.payment_date}</td>
                      <td className="py-1 pr-2">{p.payment_mode ?? "—"}</td>
                      <td className="py-1 pr-2 font-mono">{p.reference_no ?? "—"}</td>
                      <td className="py-1 pr-2 text-right">₹{Number(p.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {walletPaid > 0 && (
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
                  {walletTxns
                    .filter((w) => w.txn_type === "consume")
                    .map((w) => (
                      <tr key={w.id} className="border-b border-slate-100">
                        <td className="py-1 pr-2">{w.txn_date}</td>
                        <td className="py-1 pr-2">{[w.payment_mode, w.reference_no].filter(Boolean).join(" · ") || "Wallet"}</td>
                        <td className="py-1 pr-2 text-right">₹{Number(w.amount).toFixed(2)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {adjustments.length > 0 && (
            <div className="mb-3 border-b border-slate-300 pb-3">
              <div className="mb-1 font-semibold">CREDIT / DEBIT NOTE ADJUSTMENTS ({adjustments.length})</div>
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
                  {adjustments.map((a) => (
                    <tr key={a.id} className="border-b border-slate-100">
                      <td className="py-1 pr-2">{a.created_at.slice(0, 10)}</td>
                      <td className="py-1 pr-2">
                        {a.credit_note_id ? "Credit Note" : "Debit Note"}{" "}
                        {noteLabel.get(a.credit_note_id ?? a.debit_note_id ?? "") ?? ""}
                      </td>
                      <td className="py-1 pr-2">{a.remark ?? "—"}</td>
                      <td className="py-1 pr-2 text-right">₹{Number(a.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Vendor's own bank details — the block the accounts team uses to
              actually pay this bill. */}
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
    </div>
  );
}
