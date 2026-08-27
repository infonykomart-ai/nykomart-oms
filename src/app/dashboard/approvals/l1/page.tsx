import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ApprovalList, type ApprovalBillRow } from "../approval-list";

// Approvals (L1) — see ../actions.ts header comment. Lists every
// bill_pass_register row still 'Pending' first-level sign-off, scoped to
// the CURRENTLY SELECTED company (top-nav switcher).
// 2026-08-17 fix — same bug/fix as Party Ledger / Bill Payment: used to
// scope to `employee.companyIds` (every accessible company) instead of
// the one selected up top.
// 2026-08-27 — grouped by invoice (see src/lib/bill-grouping.ts + this
// file's added source/source_id/party_id columns and the purchase_bills
// item-detail join below) so a multi-item/multi-order Purchase Bill shows
// as ONE entry with an expandable item breakdown, not N separate rows.
export default async function ApprovalsL1Page() {
  const employee = await requireCapability("approve_level1");
  const supabase = createServiceRoleClient();

  const [{ data: bills }, { data: companies }, { data: parties }, { data: employees }] = await Promise.all([
    supabase
      .from("bill_pass_register")
      .select(
        "id, company_id, invoice_no, vendor_invoice_no, invoice_type, party_id, total_amt, to_be_pay, prepared_by_employee_id, created_at, source, source_id"
      )
      .eq("company_id", employee.currentCompanyId)
      .eq("approval_status", "Pending")
      .order("created_at", { ascending: true }),
    supabase.from("companies").select("id, name"),
    supabase.from("parties").select("id, name"),
    supabase.from("employees").select("id, name"),
  ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));
  const employeeName = new Map((employees ?? []).map((e) => [e.id, e.name]));

  const purchaseBillIds = (bills ?? []).filter((b) => b.source === "purchase_bill" && b.source_id).map((b) => b.source_id as string);
  const itemDetail = new Map<string, { work_description: string | null; qty: number; qty_unit: string; unit_rate: number }>();
  if (purchaseBillIds.length > 0) {
    const { data: purchaseBills } = await supabase
      .from("purchase_bills")
      .select("id, work_description, qty, qty_unit, unit_rate")
      .in("id", purchaseBillIds);
    for (const pb of purchaseBills ?? []) {
      itemDetail.set(pb.id, { work_description: pb.work_description, qty: pb.qty, qty_unit: pb.qty_unit, unit_rate: Number(pb.unit_rate) });
    }
  }

  const rows: ApprovalBillRow[] = (bills ?? []).map((b) => {
    const detail = b.source === "purchase_bill" && b.source_id ? itemDetail.get(b.source_id) : undefined;
    return {
      id: b.id,
      company_id: b.company_id,
      company_name: companyName.get(b.company_id) ?? "—",
      invoice_no: b.invoice_no,
      vendor_invoice_no: b.vendor_invoice_no,
      invoice_type: b.invoice_type,
      party_id: b.party_id,
      party_name: b.party_id ? partyName.get(b.party_id) ?? null : null,
      source: b.source,
      total_amt: Number(b.total_amt),
      to_be_pay: Number(b.to_be_pay),
      prepared_by_name: b.prepared_by_employee_id ? employeeName.get(b.prepared_by_employee_id) ?? null : null,
      created_at: b.created_at,
      item_description: detail?.work_description ?? null,
      item_qty: detail?.qty ?? null,
      item_qty_unit: detail?.qty_unit ?? null,
      item_unit_rate: detail?.unit_rate ?? null,
    };
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">✅ Approvals (L1)</h1>
        <p className="mt-1 text-sm text-slate-500">
          First-level bill sign-off — approve here and it moves to Approvals (L2) for final sign-off. Multi-item/multi-order
          Purchase Bills show as one grouped entry per invoice — expand to see the item breakdown.
        </p>
      </div>
      <ApprovalList bills={rows} level={1} />
    </div>
  );
}
