import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { RoundOffReportTable, type RoundOffRow } from "./round-off-report-table";

// Round Off report (2026-10-31) — "audit ke liye ek jagah saare round-off".
//
// Grain: ONE ROW PER DOCUMENT that carries a non-zero round-off. Every
// document type stores its round-off differently (see db/schema.sql), so
// each source below is read with its OWN sign convention rather than one
// shared formula — that is exactly the thing this report exists to audit:
//
//   • purchase_bills        g_total_plus_gst ALREADY includes round_off_amt
//   • freight_bills         gross_total_amt EXCLUDES it  (net = gross + round)
//   • duty_tax_bills        gross_total_amt EXCLUDES it  (net = gross + round)
//   • washing_entries       amount + debit_charges       (net = gross + round)
//   • debit_notes           total_amount ALREADY includes it
//   • credit_notes          refund_amount ALREADY includes it
//   • internal_invoices     total_amount ALREADY includes it
//   • journal_vouchers      debit_amount ALREADY includes it
//
// Gross is always the figure BEFORE the rounding (GST inclusive wherever the
// document has GST), so gross + round-off = net on every row.
//
// NOT included: freight_bill_awb_assignments / duty_bill_awb_assignments.
// Their round-offs are already summed into the parent bill's payable, so
// listing them here would double-count the same rupee against the grand
// total. Per-AWB figures are visible on the bill itself.
//
// Company scoping: applied wherever the table has company_id (purchase bills,
// washing, debit/credit notes, internal invoices, journal vouchers). Freight
// and Duty bills have no company_id at all — one courier invoice can span
// AWBs from several companies (see reports/freight-duty/page.tsx's comment on
// the same limitation), so those two are capability-gated only, exactly like
// the Freight/Duty report.
export default async function RoundOffReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("reports");
  const supabase = await createClient();
  const sp = await searchParams;

  const companyId = typeof sp.company === "string" && sp.company ? sp.company : "";
  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";

  const scopedCompanyIds = companyId ? [companyId] : employee.companyIds;

  const { data: companies } = await supabase
    .from("companies")
    .select("id, name")
    .in("id", employee.companyIds)
    .order("name");

  /** Date-range + non-zero round-off filter, identical for every source. */
  function ranged<T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T; neq: (c: string, v: number) => T }>(
    q: T,
    dateColumn: string
  ): T {
    let out = q.neq("round_off_amt", 0);
    if (fromDate) out = out.gte(dateColumn, fromDate);
    if (toDate) out = out.lte(dateColumn, toDate);
    return out;
  }

  const [
    { data: purchaseBills },
    { data: freightBills },
    { data: dutyBills },
    { data: washingEntries },
    { data: debitNotes },
    { data: creditNotes },
    { data: internalInvoices },
    { data: journalVouchers },
  ] = await Promise.all([
    ranged(
      supabase
        .from("purchase_bills")
        .select("id, vendor_invoice_no, vendor_invoice_date, bill_kind, round_off_amt, g_total_plus_gst")
        .in("company_id", scopedCompanyIds)
        .order("vendor_invoice_date", { ascending: false, nullsFirst: false })
        .limit(2000),
      "vendor_invoice_date"
    ),
    ranged(
      supabase
        .from("freight_bills")
        .select("id, invoice_no, invoice_date, round_off_amt, gross_total_amt")
        .order("invoice_date", { ascending: false, nullsFirst: false })
        .limit(2000),
      "invoice_date"
    ),
    ranged(
      supabase
        .from("duty_tax_bills")
        .select("id, invoice_no, invoice_date, round_off_amt, gross_total_amt")
        .order("invoice_date", { ascending: false, nullsFirst: false })
        .limit(2000),
      "invoice_date"
    ),
    ranged(
      supabase
        .from("washing_entries")
        .select("id, chalan_no, chalan_date, round_off_amt, amount, debit_charges")
        .in("company_id", scopedCompanyIds)
        .order("chalan_date", { ascending: false, nullsFirst: false })
        .limit(2000),
      "chalan_date"
    ),
    ranged(
      supabase
        .from("debit_notes")
        .select("id, debit_note_no, debit_note_date, round_off_amt, total_amount")
        .in("company_id", scopedCompanyIds)
        .order("debit_note_date", { ascending: false, nullsFirst: false })
        .limit(2000),
      "debit_note_date"
    ),
    ranged(
      supabase
        .from("credit_notes")
        .select("id, cn_no, credit_note_date, round_off_amt, refund_amount")
        .in("company_id", scopedCompanyIds)
        .order("credit_note_date", { ascending: false, nullsFirst: false })
        .limit(2000),
      "credit_note_date"
    ),
    ranged(
      supabase
        .from("internal_invoices")
        .select("id, invoice_no, invoice_date, round_off_amt, total_amount")
        .in("company_id", scopedCompanyIds)
        .order("invoice_date", { ascending: false, nullsFirst: false })
        .limit(2000),
      "invoice_date"
    ),
    ranged(
      supabase
        .from("journal_vouchers")
        .select("id, jv_no, jv_date, round_off_amt, debit_amount")
        .in("company_id", scopedCompanyIds)
        .order("jv_date", { ascending: false, nullsFirst: false })
        .limit(2000),
      "jv_date"
    ),
  ]);

  const r2 = (n: number) => Math.round(n * 100) / 100;

  /** "net already includes the rounding" — gross = net − round off. */
  const split = (net: number, roundOff: number) => ({ gross: r2(net - roundOff), net: r2(net) });
  /** "net = gross + rounding" — gross is the stored pre-round figure. */
  const add = (gross: number, roundOff: number) => ({ gross: r2(gross), net: r2(gross + roundOff) });

  const rows: RoundOffRow[] = [
    ...(purchaseBills ?? []).map((b) => {
      const roundOff = Number(b.round_off_amt ?? 0);
      const { gross, net } = split(Number(b.g_total_plus_gst ?? 0), roundOff);
      return {
        id: `pb-${b.id}`,
        doc_type: b.bill_kind === "printing" ? "Printing Bill" : "Purchase Bill",
        doc_no: b.vendor_invoice_no,
        doc_date: b.vendor_invoice_date,
        gross,
        round_off: r2(roundOff),
        net,
      };
    }),
    ...(freightBills ?? []).map((b) => {
      const roundOff = Number(b.round_off_amt ?? 0);
      const { gross, net } = add(Number(b.gross_total_amt ?? 0), roundOff);
      return { id: `fb-${b.id}`, doc_type: "Freight Bill", doc_no: b.invoice_no, doc_date: b.invoice_date, gross, round_off: r2(roundOff), net };
    }),
    ...(dutyBills ?? []).map((b) => {
      const roundOff = Number(b.round_off_amt ?? 0);
      const { gross, net } = add(Number(b.gross_total_amt ?? 0), roundOff);
      return { id: `db-${b.id}`, doc_type: "Duty & Tax Bill", doc_no: b.invoice_no, doc_date: b.invoice_date, gross, round_off: r2(roundOff), net };
    }),
    ...(washingEntries ?? []).map((e) => {
      const roundOff = Number(e.round_off_amt ?? 0);
      // Washing has no GST: payable before rounding = amount + debit charges.
      const { gross, net } = add(Number(e.amount ?? 0) + Number(e.debit_charges ?? 0), roundOff);
      return { id: `we-${e.id}`, doc_type: "Washing Entry", doc_no: e.chalan_no ?? "—", doc_date: e.chalan_date, gross, round_off: r2(roundOff), net };
    }),
    ...(debitNotes ?? []).map((n) => {
      const roundOff = Number(n.round_off_amt ?? 0);
      const { gross, net } = split(Number(n.total_amount ?? 0), roundOff);
      return { id: `dn-${n.id}`, doc_type: "Debit Note", doc_no: n.debit_note_no ?? "—", doc_date: n.debit_note_date, gross, round_off: r2(roundOff), net };
    }),
    ...(creditNotes ?? []).map((n) => {
      const roundOff = Number(n.round_off_amt ?? 0);
      const { gross, net } = split(Number(n.refund_amount ?? 0), roundOff);
      return { id: `cn-${n.id}`, doc_type: "Credit Note", doc_no: n.cn_no ?? "—", doc_date: n.credit_note_date, gross, round_off: r2(roundOff), net };
    }),
    ...(internalInvoices ?? []).map((i) => {
      const roundOff = Number(i.round_off_amt ?? 0);
      const { gross, net } = split(Number(i.total_amount ?? 0), roundOff);
      return { id: `ii-${i.id}`, doc_type: "Internal Invoice", doc_no: i.invoice_no ?? "—", doc_date: i.invoice_date, gross, round_off: r2(roundOff), net };
    }),
    ...(journalVouchers ?? []).map((j) => {
      const roundOff = Number(j.round_off_amt ?? 0);
      const { gross, net } = split(Number(j.debit_amount ?? 0), roundOff);
      return { id: `jv-${j.id}`, doc_type: "Journal Voucher", doc_no: j.jv_no ?? "—", doc_date: j.jv_date, gross, round_off: r2(roundOff), net };
    }),
  ].sort((a, b) => (b.doc_date ?? "").localeCompare(a.doc_date ?? "") || a.doc_type.localeCompare(b.doc_type));

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">💰 Round Off Report</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every document whose payable was rounded, with the figure before and after the rounding — one line per document.
          </p>
        </div>
        <Link href="/dashboard/reports" className="shrink-0 text-sm text-slate-500 hover:underline">
          ← Back to Reports
        </Link>
      </div>

      <RoundOffReportTable rows={rows} companies={companies ?? []} filters={{ companyId, fromDate, toDate }} />
    </div>
  );
}
