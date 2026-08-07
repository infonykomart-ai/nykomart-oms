import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { DocumentEntryTabs } from "./document-entry-tabs";

// Document Entry module (2026-08-07) — the dashboard's "Document Entry"
// tile has pointed at /dashboard/documents since the Invoice round, but
// this route never existed (404) — this page + the 4 forms in
// document-entry-tabs.tsx are the actual build. See actions.ts's header
// comment for the full "why" — short version: Credit Note / Debit Note /
// Washing Entry all connect back to `orders` (and, via orders.invoice_id,
// to `sales_invoices`) through the shared PO/RF/RG lookup box, so the
// order <-> invoice <-> credit/debit-note chain the user asked about is
// now something you can actually see and use, not just a foreign key.
export default async function DocumentsPage() {
  const employee = await requireCapability("doc_entry");
  const supabase = await createClient();

  const [{ data: companies }, { data: parties }, { data: stores }, { data: recentCreditNotes }, { data: recentDebitNotes }, { data: recentWashingEntries }, { data: recentInternalInvoices }] =
    await Promise.all([
      supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
      supabase.from("parties").select("id, name").order("name"),
      supabase.from("stores").select("id, name, company_id").order("name"),
      supabase
        .from("credit_notes")
        .select(
          "id, cn_no, company_id, store_id, credit_note_date, item_id, buyer_name, refund_date, item_name, item_price, invoice_no, invoice_value_usd, invoice_value_inr, refund_amount, refund_amt_usd, refund_amt_inr, credit_note_status, refund_type, remark"
        )
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("debit_notes")
        .select(
          "id, debit_note_no, debit_note_date, company_id, party_id, against_invoice_bill_no, particulars, bill_no, bill_date, sq_ft, qty, rate, debit_amount, remark"
        )
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("washing_entries")
        .select("id, chalan_no, chalan_date, company_id, party_id, store_id, item_size, pcs, sq_mtr_ft, rate, debit_charges, amount")
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("internal_invoices")
        .select("id, invoice_no, invoice_date, from_company_id, to_company_id, description, qty, rate, remark, total_amount")
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">🧾 Document Entry</h1>
        <p className="mt-1 text-sm text-slate-500">
          Credit Note, Debit Note, Washing Entry, Internal Invoice — entering a PO/RF/RG number automatically fetches
          the order (and its invoice, if one has already been generated), so all documents stay linked to the order.
        </p>
      </div>

      <DocumentEntryTabs
        companies={companies ?? []}
        parties={parties ?? []}
        stores={stores ?? []}
        recent={{
          creditNotes: (recentCreditNotes ?? []).map((r) => ({
            ...r,
            item_price: r.item_price != null ? Number(r.item_price) : null,
            invoice_value_usd: r.invoice_value_usd != null ? Number(r.invoice_value_usd) : null,
            invoice_value_inr: r.invoice_value_inr != null ? Number(r.invoice_value_inr) : null,
            refund_amount: Number(r.refund_amount),
            refund_amt_usd: r.refund_amt_usd != null ? Number(r.refund_amt_usd) : null,
            refund_amt_inr: r.refund_amt_inr != null ? Number(r.refund_amt_inr) : null,
            companyName: companyName.get(r.company_id) ?? "",
          })),
          debitNotes: (recentDebitNotes ?? []).map((r) => ({
            ...r,
            sq_ft: r.sq_ft != null ? Number(r.sq_ft) : null,
            rate: r.rate != null ? Number(r.rate) : null,
            debit_amount: Number(r.debit_amount),
            companyName: companyName.get(r.company_id) ?? "",
          })),
          washingEntries: (recentWashingEntries ?? []).map((r) => ({
            ...r,
            sq_mtr_ft: r.sq_mtr_ft != null ? Number(r.sq_mtr_ft) : null,
            rate: r.rate != null ? Number(r.rate) : null,
            debit_charges: r.debit_charges != null ? Number(r.debit_charges) : null,
            amount: Number(r.amount ?? 0),
            companyName: companyName.get(r.company_id) ?? "",
          })),
          internalInvoices: (recentInternalInvoices ?? []).map((r) => ({
            ...r,
            qty: Number(r.qty),
            rate: Number(r.rate),
            total_amount: Number(r.total_amount),
            fromCompanyName: companyName.get(r.from_company_id) ?? "",
            toCompanyName: companyName.get(r.to_company_id) ?? "",
          })),
        }}
      />
    </div>
  );
}
