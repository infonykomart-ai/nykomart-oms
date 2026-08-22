import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { OutstandingReportTable, type OutstandingBillRow } from "./outstanding-report-table";

// Party Ledger / Bill Payment Outstanding report (2026-08-22) — one of the
// 3 new report pages. "Who do we owe money to and how much", company-wide
// — source: bill_pass_register WHERE balance_due > 0 (the exact same
// query Bill Payment (bill-payment/page.tsx) already uses), grouped/listed
// by party.
//
// Grain chosen: ONE ROW PER OPEN BILL, not one row per party. Reasoning
// (per the task's own "pick whichever reads more usefully as a report and
// say which you chose"): a per-party-only table would need to either drop
// the invoice-level detail (no, so an approver can't see WHICH bill is
// overdue) or synthesize a fake "row" per party that isn't a real
// bill_pass_register row (awkward for export — a CSV of party summaries
// can't be reconciled bill-by-bill against Bill Payment). Per-bill rows
// ARE real Bill Pass Register rows (so CSV/Excel export lines up 1:1 with
// what Bill Payment/Party Ledger show) AND naturally group in Excel/Word
// by sorting on Party. To still answer "how much do we owe THIS party" at
// a glance, a small per-party summary strip renders above the table
// (company-wide, respects the same filters) — computed client-side from
// the same rows, not a second query.
//
// NOT the same as the per-party Party Ledger page
// (parties/[id]/ledger/page.tsx) — that page is one party's full ledger
// (every debit/credit line for one vendor, opened from that vendor's own
// page). This is the reverse view: every party with money currently owed,
// across the whole company, for finance/ops to triage in one place.
export default async function OutstandingReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("reports");
  const supabase = await createClient();
  const sp = await searchParams;

  const companyId = typeof sp.company === "string" && sp.company ? sp.company : "";
  const partyId = typeof sp.party === "string" && sp.party ? sp.party : "";
  const overdue = typeof sp.overdue === "string" ? sp.overdue : "";

  const [{ data: companies }, { data: parties }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("parties").select("id, name").order("name"),
  ]);

  let query = supabase
    .from("bill_pass_register")
    .select(
      "id, company_id, party_id, invoice_type, invoice_no, vendor_invoice_no, invoice_date, invoice_recv_date, due_date, total_amt, credit_note_amt, to_be_pay, total_paid, balance_due, approval_status"
    )
    .in("company_id", companyId ? [companyId] : employee.companyIds)
    .gt("balance_due", 0)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(1000);

  if (partyId) query = query.eq("party_id", partyId);

  const { data: bills } = await query;

  const today = todayIST();
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));

  let rows: OutstandingBillRow[] = (bills ?? []).map((b) => {
    const isOverdue = !!b.due_date && b.due_date < today;
    return {
      id: b.id,
      company_name: companyName.get(b.company_id) ?? "—",
      party_name: b.party_id ? partyName.get(b.party_id) ?? "—" : "— (Salary/Advance)",
      invoice_type: b.invoice_type,
      invoice_no: b.invoice_no,
      vendor_invoice_no: b.vendor_invoice_no,
      invoice_date: b.invoice_date,
      invoice_recv_date: b.invoice_recv_date,
      due_date: b.due_date,
      overdue: isOverdue,
      total_amt: Number(b.total_amt),
      credit_note_amt: Number(b.credit_note_amt),
      to_be_pay: Number(b.to_be_pay),
      total_paid: Number(b.total_paid),
      balance_due: Number(b.balance_due),
      approval_status: b.approval_status,
    };
  });

  if (overdue === "overdue") rows = rows.filter((r) => r.overdue);
  else if (overdue === "not_due") rows = rows.filter((r) => !r.overdue);

  // Per-party summary strip — company-wide, same filtered rows, no second
  // query (see header comment).
  const byParty = new Map<string, { name: string; count: number; total: number }>();
  for (const r of rows) {
    const key = r.party_name;
    const entry = byParty.get(key) ?? { name: key, count: 0, total: 0 };
    entry.count += 1;
    entry.total += r.balance_due;
    byParty.set(key, entry);
  }
  const partySummaries = Array.from(byParty.values()).sort((a, b) => b.total - a.total);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">💳 Party Ledger / Bill Payment Outstanding Report</h1>
          <p className="mt-1 text-sm text-slate-500">
            Who we owe money to and how much, company-wide (every open Bill Pass Register entry) — apply filters,
            then download or send.
          </p>
        </div>
        <Link href="/dashboard/reports" className="shrink-0 text-sm text-slate-500 hover:underline">
          ← Back to Reports
        </Link>
      </div>

      {partySummaries.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
          {partySummaries.slice(0, 8).map((p) => (
            <div key={p.name} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="truncate text-xs font-medium text-slate-500">{p.name}</div>
              <div className="mt-1 text-xl font-bold text-slate-900">₹{p.total.toFixed(2)}</div>
              <div className="text-xs text-slate-400">{p.count} open bill(s)</div>
            </div>
          ))}
          {partySummaries.length > 8 && (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-4 text-xs text-slate-400">
              +{partySummaries.length - 8} more parties — see full table below
            </div>
          )}
        </div>
      )}

      <OutstandingReportTable
        rows={rows}
        companies={companies ?? []}
        parties={parties ?? []}
        filters={{ companyId, partyId, overdue }}
      />
    </div>
  );
}
