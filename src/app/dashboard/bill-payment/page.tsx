import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { BillPaymentList, type PayableBillRow } from "./bill-payment-list";
import { listRelatedNotesForBills } from "../documents/actions";

// Bill Payment (round 11) — see actions.ts header comment. Lists every
// bill_pass_register row (any invoice_type — vendor/courier/duty/salary/
// advance, this ledger is shared by all of them) with balance_due > 0,
// scoped to the CURRENTLY SELECTED company (top-nav switcher), oldest due
// date first.
// 2026-08-17 fix — same bug/fix as Party Ledger: this used to scope to
// `employee.companyIds` (every company this login can access), so an
// admin with access to all 3 companies saw every company's outstanding
// bills mixed together regardless of which company was selected up top.
// Now matches the pattern used by orders/new, shipglobal, attendance, etc.
//
// 2026-08-22 — filter UI added (GET-form + searchParams, same pattern as
// Orders): Company, Status, Due. This page had zero filter UI before —
// every unpaid bill for the selected company, full stop. `status` here is
// a DERIVED condition (there is no stored status column on
// bill_pass_register — see db/schema.sql), computed from balance_due vs 0
// and due_date vs today, same idea as Orders' "Late Order" derived filter:
//   - "" (default)   -> balance_due > 0 (unchanged default behaviour)
//   - "pending"       -> balance_due > 0 AND due_date >= today (not yet due)
//   - "overdue"       -> balance_due > 0 AND due_date <  today
//   - "paid"          -> balance_due <= 0
//
// 2026-08-27 — rows here are grouped client-side (see bill-payment-list.tsx
// + src/lib/bill-grouping.ts) so a multi-item/multi-order Purchase Bill's
// several bill_pass_register rows show as one invoice row. The query below
// is unchanged (still fetches every underlying row) — grouping is a
// display/action concern, not a query concern.
export default async function BillPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();
  const sp = await searchParams;

  // Same "respect the top-nav company switcher by default, but let an
  // explicit ?company= (including an explicit blank = All) override it" as
  // Orders (see that page.tsx's 2026-08-17 comment for the full reasoning).
  const companyParam = typeof sp.company === "string" ? sp.company : "";
  const companyParamPresent = "company" in sp;
  const effectiveCompanyIds = companyParam
    ? [companyParam]
    : companyParamPresent
      ? employee.companyIds
      : [employee.currentCompanyId];
  const status = typeof sp.status === "string" ? sp.status : "";
  const todayStr = new Date().toISOString().slice(0, 10);

  const [{ data: companies }, { data: parties }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("parties").select("id, name, party_type, invoice_type"),
  ]);

  let query = supabase
    .from("bill_pass_register")
    .select(
      "id, company_id, invoice_no, vendor_invoice_no, invoice_type, invoice_date, invoice_recv_date, party_id, party_type, source, due_date, total_amt, credit_note_amt, to_be_pay, total_paid, balance_due, remark"
    )
    .in("company_id", effectiveCompanyIds)
    .order("due_date", { ascending: true, nullsFirst: false });

  if (status === "paid") {
    query = query.lte("balance_due", 0);
  } else if (status === "pending") {
    query = query.gt("balance_due", 0).gte("due_date", todayStr);
  } else if (status === "overdue") {
    query = query.gt("balance_due", 0).lt("due_date", todayStr);
  } else {
    // Default (no status filter picked yet) — unchanged from before this
    // filter UI existed: every unpaid/partially-paid bill.
    query = query.gt("balance_due", 0);
  }

  const { data: bills } = await query;

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));

  // 2026-08-27 (later same day) — "credite note ya debit note agar us
  // invoice se related ho to vaha dikhna cahiye": one batched lookup for
  // every bill on this page, then fanned back out per row below — never
  // call listRelatedNotesForBills per-row (see its own comment).
  const relatedNotes = await listRelatedNotesForBills((bills ?? []).map((b) => b.id));
  const notesByBillId = new Map<string, typeof relatedNotes>();
  for (const n of relatedNotes) {
    const list = notesByBillId.get(n.billPassRegisterId) ?? [];
    list.push(n);
    notesByBillId.set(n.billPassRegisterId, list);
  }

  const rows: PayableBillRow[] = (bills ?? []).map((b) => ({
    id: b.id,
    company_id: b.company_id,
    company_name: companyName.get(b.company_id) ?? "—",
    invoice_no: b.invoice_no,
    vendor_invoice_no: b.vendor_invoice_no,
    invoice_type: b.invoice_type,
    invoice_date: b.invoice_date,
    invoice_recv_date: b.invoice_recv_date,
    party_id: b.party_id,
    party_name: b.party_id ? partyName.get(b.party_id) ?? null : null,
    party_type: b.party_type,
    // 2026-08-17: null = manually entered/imported straight onto this
    // table — editable here. Non-null means it was auto-mirrored FROM a
    // Purchase Bill / Courier Bill / Duty & Tax Bill / Salary / Advance
    // row, so editing belongs at that source instead (see actions.ts's
    // comment on updateBillPassRegisterEntry).
    source: b.source,
    due_date: b.due_date,
    total_amt: Number(b.total_amt),
    credit_note_amt: Number(b.credit_note_amt),
    to_be_pay: Number(b.to_be_pay),
    total_paid: Number(b.total_paid),
    balance_due: Number(b.balance_due),
    remark: b.remark,
    related_notes: notesByBillId.get(b.id) ?? [],
  }));

  const totalOutstanding = rows.reduce((sum, r) => sum + r.balance_due, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">💳 Bill Payment</h1>
        <p className="mt-1 text-sm text-slate-500">
          {status === "paid" ? "Paid" : status === "overdue" ? "Overdue" : status === "pending" ? "Not-yet-due" : "Unpaid/partially-paid"}{" "}
          Bill Pass Register entries — record a payment against any of them below. Total outstanding:{" "}
          <span className="font-semibold text-slate-800">₹{totalOutstanding.toFixed(2)}</span>
        </p>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="company">Company</label>
          <select id="company" name="company" defaultValue={companyParamPresent ? companyParam : employee.currentCompanyId} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500">
            <option value="">All</option>
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={status} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500">
            <option value="">All Unpaid (default)</option>
            <option value="pending">Pending (not yet due)</option>
            <option value="overdue">Overdue</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
          Filter
        </button>
        <a href="/dashboard/bill-payment" className="text-xs text-slate-400 underline">Clear</a>
      </form>

      <BillPaymentList bills={rows} parties={parties ?? []} />
    </div>
  );
}
