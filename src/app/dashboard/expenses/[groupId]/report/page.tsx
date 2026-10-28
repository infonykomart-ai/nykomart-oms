import Link from "next/link";
import { headers } from "next/headers";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isMissingSchemaPiece } from "@/lib/db/missing-column";
import { PrintArea, PrintButton } from "@/components/print-view";

// 2026-10-28b — the office-expense bill's own A4 sheet. "bill jis bhi company me
// chadhe ho ... uski jo report summery niklti hai according to bill puri
// nikalni chahiye jese purchase bill me hoti hai": same shape as the purchase
// bill sheet — the letterhead of the company the bill was entered under, the
// vendor block, one row per item, the bill total, and the Finance position
// (paid / balance) read live from bill_pass_register so the sheet can never
// disagree with Bill Payment or the Party Ledger.
//
// The route is addressed by entry_group_id (falling back to a single legacy
// row's own id), so one bill = one sheet no matter how many items it has.
// `select("*")` on purpose: a not-yet-run one-time SQL file must never turn
// this sheet into a 404.

const money = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dash = (v: string | number | null | undefined) => (v == null || v === "" ? "—" : String(v));

type ExpenseRow = {
  id: string;
  company_id: string;
  expense_date: string;
  category: string;
  amount_inr: number;
  payment_mode: string | null;
  remark: string | null;
  party_id: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  description: string | null;
  entry_group_id: string | null;
};

export default async function OfficeExpenseReportPage({ params }: { params: Promise<{ groupId: string }> }) {
  try {
    return await OfficeExpenseReportInner(await params);
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof UnauthorizedError) {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <p className="font-semibold">Access Denied</p>
          <p className="mt-1">{err.message}</p>
        </div>
      );
    }
    throw err;
  }
}

function SheetProblem({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
      <p className="text-base font-semibold">⚠ {title}</p>
      <p className="mt-2 leading-relaxed">{message}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/dashboard/expenses"
          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 hover:no-underline"
        >
          Open Office Expenses
        </Link>
      </div>
    </div>
  );
}

async function OfficeExpenseReportInner({ groupId }: { groupId: string }) {
  const employee = await requireCapability("internal_expense_entry");
  const supabase = createServiceRoleClient();

  // A bill is every row sharing this entry_group_id; a row created before the
  // bill columns existed has no group and is addressed by its own id.
  let rows: ExpenseRow[] = [];
  const byGroup = await supabase.from("internal_expenses").select("*").eq("entry_group_id", groupId);
  if (!byGroup.error) {
    rows = (byGroup.data ?? []) as ExpenseRow[];
  } else if (!isMissingSchemaPiece(byGroup.error)) {
    return <SheetProblem title="This expense bill could not be loaded" message={`The database refused the request: ${byGroup.error.message}`} />;
  }
  if (rows.length === 0) {
    const single = await supabase.from("internal_expenses").select("*").eq("id", groupId).maybeSingle();
    if (single.error) {
      return <SheetProblem title="This expense bill could not be loaded" message={`The database refused the request: ${single.error.message}`} />;
    }
    if (single.data) rows = [single.data as ExpenseRow];
  }
  if (rows.length === 0) {
    return (
      <SheetProblem
        title="This expense bill no longer exists"
        message="The bill was deleted after its Finance entry was posted (or the link is stale). Re-enter the bill from Office Expenses — an un-run one-time SQL file never causes this."
      />
    );
  }
  if (rows.some((r) => !employee.companyIds.includes(r.company_id))) {
    return <SheetProblem title="No access" message="This bill belongs to a company your login cannot open." />;
  }

  const first = rows[0];
  const total = rows.reduce((s, r) => s + Number(r.amount_inr ?? 0), 0);
  const billKey = first.entry_group_id ?? first.id;

  const [{ data: company }, { data: profile }, { data: party }, { data: ledgerRows }] = await Promise.all([
    supabase.from("companies").select("id, name, logo_url").eq("id", first.company_id).maybeSingle(),
    supabase
      .from("company_profiles")
      .select("company_id, address, phone, whatsapp, email, gstin")
      .eq("company_id", first.company_id)
      .maybeSingle(),
    first.party_id
      ? supabase.from("parties").select("id, name, address, contact_no, email, gst").eq("id", first.party_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("bill_pass_register")
      .select("id, total_amt, credit_note_amt, adj_amt, total_paid, balance_due")
      .eq("source", "office_expense")
      .eq("source_id", billKey),
  ]);

  const ledger = (ledgerRows ?? [])[0] ?? null;
  const billed = ledger ? Number(ledger.total_amt ?? 0) : total;
  const credited = ledger ? Number(ledger.credit_note_amt ?? 0) + Number(ledger.adj_amt ?? 0) : 0;
  const paid = ledger ? Number(ledger.total_paid ?? 0) : 0;
  const balance = ledger ? Number(ledger.balance_due ?? 0) : 0;

  const contact = [profile?.gstin ? `GSTIN: ${profile.gstin}` : null, profile?.phone ? `Ph: ${profile.phone}` : null, profile?.email]
    .filter(Boolean)
    .join(" · ");

  const embedded = (await headers()).get("x-embed") === "1";

  return (
    <div>
      {!embedded && (
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link href="/dashboard/expenses" className="text-sm text-slate-500 hover:underline">
            ← Back to Office Expenses
          </Link>
          <PrintButton label="🖨 Download PDF" />
        </div>
      )}

      <PrintArea id="office-expense-report-area" companyName={company?.name} companyLogoUrl={company?.logo_url ?? undefined}>
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-xs text-slate-900 print:border-0 print:p-0">
          <div className="mb-4 flex items-start justify-between gap-6 border-b-2 border-slate-800 pb-3">
            <div className="flex items-start gap-3">
              {company?.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element -- print document; a plain <img> keeps the logo out of next/image's optimizer
                <img src={company.logo_url} alt={company.name} className="h-10 w-10 object-contain" />
              )}
              <div className="leading-tight">
                {company?.name && <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{company.name}</p>}
                {profile?.address && (
                  <p className="max-w-[22rem] whitespace-pre-wrap text-[10px] text-slate-500">{profile.address}</p>
                )}
                {contact && <p className="text-[10px] text-slate-500">{contact}</p>}
                <h1 className="mt-1 text-lg font-bold text-slate-900">Office Expense Bill</h1>
                <p className="text-slate-500">
                  Invoice {dash(first.invoice_no)} · {dash(first.invoice_date ?? first.expense_date)}
                </p>
              </div>
            </div>
            <div className="text-right text-slate-600">
              <p className="font-semibold text-slate-900">{party?.name ?? "—"}</p>
              {party?.address && <p className="max-w-[15rem] whitespace-pre-wrap text-[11px]">{party.address}</p>}
              {party?.contact_no && <p className="text-[11px]">Phone: {party.contact_no}</p>}
              {party?.gst && <p className="text-[11px]">GST: {party.gst}</p>}
              {!party ? <p className="text-[10px] text-slate-400">Internal expense (no party)</p> : null}
            </div>
          </div>

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                <th className="py-1 pr-2">Sr.</th>
                <th className="py-1 pr-2">Category</th>
                <th className="py-1 pr-2">Description</th>
                <th className="py-1 pr-2">Expense Date</th>
                <th className="py-1 pr-2">Payment Mode</th>
                <th className="py-1 pr-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-b border-slate-100 text-slate-700">
                  <td className="py-1 pr-2">{i + 1}</td>
                  <td className="py-1 pr-2 font-medium text-slate-900">{r.category}</td>
                  <td className="py-1 pr-2">{dash(r.description)}</td>
                  <td className="py-1 pr-2">{r.expense_date}</td>
                  <td className="py-1 pr-2">{dash(r.payment_mode)}</td>
                  <td className="py-1 pr-2 text-right">{money(Number(r.amount_inr ?? 0))}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-400 font-bold text-slate-900">
                <td colSpan={5} className="py-1 pr-2 text-right">
                  TOTAL
                </td>
                <td className="py-1 pr-2 text-right">{money(total)}</td>
              </tr>
            </tbody>
          </table>

          <p className="mt-2 text-[10px] text-slate-500">
            GST is not applicable on this bill — office expenses are recorded without GST, so the total above is exactly
            what is payable.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-6 border-t border-slate-300 pt-3">
            <div className="text-[11px] text-slate-600">
              <p className="mb-1 font-semibold text-slate-700">Bill Summary</p>
              <p>
                {rows.length} item{rows.length === 1 ? "" : "s"} · {company?.name ?? "—"}
              </p>
              {first.remark && <p className="mt-1">Remark: {first.remark}</p>}
              {party?.email && <p>Email: {party.email}</p>}
              {!ledger && <p className="mt-1 text-amber-700">Not posted to Bill Payment (no party on this bill).</p>}
            </div>
            <div className="text-right">
              <p className="text-slate-600">BILL TOTAL: ₹{money(total)}</p>
              {ledger && (
                <div className="mt-1 border-t border-slate-200 pt-1">
                  <p className="text-slate-600">BILLED (finance): ₹{money(billed)}</p>
                  <p className="text-slate-600">CREDIT NOTES / ADJ: ₹{money(credited)}</p>
                  <p className="text-slate-600">PAID: ₹{money(paid)}</p>
                  <p className={`font-semibold ${balance > 0.005 ? "text-amber-800" : "text-emerald-700"}`}>
                    BALANCE DUE: ₹{money(balance)}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
