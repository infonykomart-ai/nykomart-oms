import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { groupBills } from "@/lib/bill-grouping";
import { PartyLedgerReportTable, type PartyLedgerRow } from "./party-ledger-report-table";

// Party / Vendor Ledger report (2026-08-22) — one of the 3 new report
// pages requested after "Reports hub — remaining scope" (the user picked
// this + Sale & Profit + Salary/Attendance from a list of candidates).
//
// This generalizes the single-party ledger already at
// parties/[id]/ledger/page.tsx (debit/credit/running-balance, standard
// Dr/Cr vendor-account convention — see that page's own header comments
// for the full history of that design) into a company-wide, exportable
// report on the standard Reports-hub ExportBar/useColumnVisibility
// pattern, instead of the bespoke LedgerExportBar that single page uses.
//
// Grain: one row per ledger line (a bill, a credit note, or a payment),
// same as the single-party page — NOT one row per party — because the
// running Balance column only makes sense at that grain, and it's what
// exports 1:1 against what Finance is used to seeing.
//
// Running-balance grouping key is (company_id, party_id), not just
// party_id — reusing the exact lesson from the 2026-08-17 fix on the
// single-party page ("RUGARA ME RUG ARA KI SUMMERY DIKHNI CHAHIYE NYKO
// MART ME KYU AARI HAI"): a party can have bills against more than one
// company (parties is not company-scoped), and mixing those into one
// running balance would silently combine two unrelated accounts. So this
// report computes each (company, party) pair's own full balance history
// independently — fetched WITHOUT a date filter, so the running balance
// is always correct — then the From/To/Type filter below only trims which
// already-computed rows are DISPLAYED/exported, exactly like the
// single-party page's own from/to/type filter does for its Closing
// Balance.
export default async function PartyLedgerReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("reports");
  const supabase = await createClient();
  const finSupabase = createServiceRoleClient();
  const sp = await searchParams;

  const companyId = typeof sp.company === "string" && sp.company ? sp.company : "";
  const partyId = typeof sp.party === "string" && sp.party ? sp.party : "";
  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";
  const txnType = typeof sp.type === "string" ? sp.type : "";

  const [{ data: companies }, { data: parties }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("parties").select("id, name").order("name"),
  ]);

  let query = finSupabase
    .from("bill_pass_register")
    .select(
      "id, company_id, party_id, invoice_no, vendor_invoice_no, invoice_type, invoice_date, invoice_recv_date, total_amt, credit_note_amt, adj_amt, source, created_at"
    )
    .in("company_id", companyId ? [companyId] : employee.companyIds)
    .not("party_id", "is", null)
    .order("invoice_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(5000);

  if (partyId) query = query.eq("party_id", partyId);

  const { data: entriesRaw } = await query;

  const billIds = (entriesRaw ?? []).map((e) => e.id);
  const { data: paymentsRaw } = billIds.length
    ? await finSupabase
        .from("bill_pass_register_payments")
        .select("id, bill_pass_register_id, amount, payment_date, payment_mode, reference_no")
        .in("bill_pass_register_id", billIds)
        .order("payment_date", { ascending: true })
    : { data: [] };

  type Payment = { id: string; bill_pass_register_id: string; amount: number; payment_date: string; payment_mode: string | null; reference_no: string | null };
  const paymentsByBill = new Map<string, Payment[]>();
  for (const p of paymentsRaw ?? []) {
    const list = paymentsByBill.get(p.bill_pass_register_id) ?? [];
    list.push({ ...p, amount: Number(p.amount) });
    paymentsByBill.set(p.bill_pass_register_id, list);
  }

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));

  const sourceLabel: Record<string, string> = {
    purchase_bill: "Purchase Bill",
    freight_bill: "Courier Bill",
    duty_tax_bill: "Duty & Tax Bill",
  };

  type Txn = { date: string; particulars: string; type: "Debit" | "Credit"; debit: number; credit: number; sortKey: string };

  // Same Dr/Cr convention as the single-party page: a bill (we now owe
  // more) posts Credit, a credit note/adjustment or payment (we owe less)
  // posts Debit — see that page's 2026-08-20 comment for the full
  // reasoning.
  //
  // 2026-08-27 — "party ladger me bhi ese hi dikh raha hai" (same N-rows-
  // per-invoice bug as Approvals/Bill Payment): a multi-item/multi-order
  // Purchase Bill's several bill_pass_register rows are grouped (see
  // src/lib/bill-grouping.ts) into ONE "Credit" ledger line per invoice
  // (summed total_amt) and ONE combined "Debit" line for any credit-note/
  // adjustment amount, BEFORE building txns — every member row's own
  // payments still post individually (a payment is its own real-world
  // event, not something to merge), just all labeled against the shared
  // invoice ref.
  const groups = new Map<string, { companyId: string; partyId: string; txns: Txn[] }>();
  const partyIdEntries = (entriesRaw ?? []).filter((e): e is typeof e & { party_id: string } => !!e.party_id);
  for (const eg of groupBills(partyIdEntries)) {
    const first = eg.bills[0];
    const groupKey = `${first.company_id}__${first.party_id}`;
    const group = groups.get(groupKey) ?? { companyId: first.company_id, partyId: first.party_id, txns: [] };

    const ref = first.vendor_invoice_no ?? first.invoice_no ?? "—";
    const label = sourceLabel[first.source ?? ""] ?? first.invoice_type ?? "Bill";
    const billDate = first.invoice_date ?? first.invoice_recv_date ?? first.created_at.slice(0, 10);
    const totalAmt = eg.bills.reduce((sum, b) => sum + Number(b.total_amt), 0);
    const creditNoteAmt = eg.bills.reduce((sum, b) => sum + Number(b.credit_note_amt), 0);
    const adjAmt = eg.bills.reduce((sum, b) => sum + Number(b.adj_amt ?? 0), 0);
    const itemsSuffix = eg.isGroup ? ` (${eg.bills.length} items)` : "";

    if (totalAmt !== 0) {
      group.txns.push({ date: billDate, particulars: `${label} ${ref}${itemsSuffix}`, type: "Credit", debit: 0, credit: totalAmt, sortKey: `${billDate}_0` });
    }
    if (creditNoteAmt > 0) {
      group.txns.push({ date: billDate, particulars: `Credit Note against ${ref}`, type: "Debit", debit: creditNoteAmt, credit: 0, sortKey: `${billDate}_1` });
    }
    if (adjAmt > 0) {
      group.txns.push({ date: billDate, particulars: `Debit/Credit Note adjustment against ${ref}`, type: "Debit", debit: adjAmt, credit: 0, sortKey: `${billDate}_1` });
    }
    for (const b of eg.bills) {
      for (const p of paymentsByBill.get(b.id) ?? []) {
        group.txns.push({
          date: p.payment_date,
          particulars: `Payment against ${ref}${p.payment_mode ? ` (${p.payment_mode})` : ""}${p.reference_no ? ` · ${p.reference_no}` : ""}`,
          type: "Debit",
          debit: p.amount,
          credit: 0,
          sortKey: `${p.payment_date}_2`,
        });
      }
    }
    groups.set(groupKey, group);
  }

  const allRows: PartyLedgerRow[] = [];
  const groupList = Array.from(groups.entries()).sort(([, a], [, b]) => {
    const nameA = partyName.get(a.partyId) ?? "";
    const nameB = partyName.get(b.partyId) ?? "";
    return nameA.localeCompare(nameB);
  });

  for (const [groupKey, group] of groupList) {
    const sortedTxns = [...group.txns].sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
    let balance = 0;
    let i = 0;
    for (const t of sortedTxns) {
      balance += t.credit - t.debit;
      i += 1;
      allRows.push({
        id: `${groupKey}_${i}`,
        company_name: companyName.get(group.companyId) ?? "—",
        party_name: partyName.get(group.partyId) ?? "—",
        date: t.date,
        particulars: t.particulars,
        type: t.type,
        debit: t.debit,
        credit: t.credit,
        balance,
      });
    }
  }

  const rows = allRows.filter((r) => {
    if (fromDate && r.date < fromDate) return false;
    if (toDate && r.date > toDate) return false;
    if (txnType === "debit" && !(r.debit > 0)) return false;
    if (txnType === "credit" && !(r.credit > 0)) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📒 Party / Vendor Ledger Report</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every debit/credit line across all parties (or one party), company-wide — apply filters, then download
            or send.
          </p>
        </div>
        <Link href="/dashboard/reports" className="shrink-0 text-sm text-slate-500 hover:underline">
          ← Back to Reports
        </Link>
      </div>

      <PartyLedgerReportTable
        rows={rows}
        companies={companies ?? []}
        parties={parties ?? []}
        filters={{ companyId, partyId, from: fromDate, to: toDate, type: txnType }}
      />
    </div>
  );
}
