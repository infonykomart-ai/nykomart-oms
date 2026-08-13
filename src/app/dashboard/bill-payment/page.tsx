import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { BillPaymentList, type PayableBillRow } from "./bill-payment-list";

// Bill Payment (round 11) — see actions.ts header comment. Lists every
// bill_pass_register row (any invoice_type — vendor/courier/duty/salary/
// advance, this ledger is shared by all of them) with balance_due > 0,
// scoped to the signed-in employee's companies, oldest due date first.
export default async function BillPaymentPage() {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  const [{ data: bills }, { data: companies }, { data: parties }] = await Promise.all([
    supabase
      .from("bill_pass_register")
      .select("id, company_id, invoice_no, vendor_invoice_no, invoice_type, party_id, due_date, total_amt, credit_note_amt, to_be_pay, total_paid, balance_due")
      .in("company_id", employee.companyIds)
      .gt("balance_due", 0)
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase.from("companies").select("id, name"),
    supabase.from("parties").select("id, name"),
  ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));

  const rows: PayableBillRow[] = (bills ?? []).map((b) => ({
    id: b.id,
    company_name: companyName.get(b.company_id) ?? "—",
    invoice_no: b.invoice_no,
    vendor_invoice_no: b.vendor_invoice_no,
    invoice_type: b.invoice_type,
    party_name: b.party_id ? partyName.get(b.party_id) ?? null : null,
    due_date: b.due_date,
    total_amt: Number(b.total_amt),
    credit_note_amt: Number(b.credit_note_amt),
    to_be_pay: Number(b.to_be_pay),
    total_paid: Number(b.total_paid),
    balance_due: Number(b.balance_due),
  }));

  const totalOutstanding = rows.reduce((sum, r) => sum + r.balance_due, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">💳 Bill Payment</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every unpaid/partially-paid Bill Pass Register entry across your companies — record a payment against any
          of them below. Total outstanding: <span className="font-semibold text-slate-800">₹{totalOutstanding.toFixed(2)}</span>
        </p>
      </div>

      <BillPaymentList bills={rows} />
    </div>
  );
}
