import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireAnyCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";
import { loadVoucherDetail } from "@/lib/accounts/data";

const money = (n: number | null | undefined) =>
  n == null
    ? "—"
    : Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function ExpenseVoucherReportPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    return await ExpenseVoucherReportInner(await params);
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

async function ExpenseVoucherReportInner({ id }: { id: string }) {
  await requireAnyCapability("accounts_view", "accounts_expense_entry", "accounts_expense_approve", "accounts_setup");
  const supabase = createServiceRoleClient();

  const detail = await loadVoucherDetail(supabase, id);
  if (!detail) notFound();
  const { voucher, items, charges, events } = detail;

  const [{ data: company }, { data: profile }, { data: categories }, { data: accounts }, { data: employees }] =
    await Promise.all([
      supabase.from("companies").select("id, name, logo_url").eq("id", voucher.company_id).maybeSingle(),
      supabase.from("company_profiles").select("address, phone, email, gstin").eq("company_id", voucher.company_id).maybeSingle(),
      supabase.from("expense_categories").select("id, name, group_name").or(`company_id.eq.${voucher.company_id},company_id.is.null`),
      supabase.from("fin_accounts").select("id, name, code").eq("company_id", voucher.company_id),
      supabase.from("employees").select("id, name").in("company_id", [voucher.company_id]),
    ]);

  const categoryMap = new Map((categories ?? []).map((c) => [c.id, c]));
  const accountMap = new Map((accounts ?? []).map((a) => [a.id, a]));
  const employeeMap = new Map((employees ?? []).map((e) => [e.id, e.name]));

  const paymentAccount = voucher.payment_account_id ? accountMap.get(voucher.payment_account_id) : null;
  const submittedBy = voucher.submitted_by_employee_id ? employeeMap.get(voucher.submitted_by_employee_id) : null;
  const approvedBy = voucher.approved_by_employee_id ? employeeMap.get(voucher.approved_by_employee_id) : null;
  const postedBy = voucher.posted_by_employee_id ? employeeMap.get(voucher.posted_by_employee_id) : null;

  const embedded = (await headers()).get("x-embed") === "1";

  return (
    <div>
      {!embedded && (
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link href="/dashboard/accounts?tab=expenses" className="text-sm text-slate-500 hover:underline">
            ← Back to Expense Vouchers
          </Link>
          <PrintButton label="🖨 Download PDF" />
        </div>
      )}

      <PrintArea id="expense-voucher-report-area" companyName={company?.name} companyLogoUrl={company?.logo_url ?? undefined}>
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-xs text-slate-900 print:border-0 print:p-0">
          {/* Letterhead */}
          <div className="mb-4 flex items-start justify-between gap-6 border-b-2 border-slate-800 pb-3">
            <div className="flex items-start gap-3">
              {company?.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.logo_url} alt={company?.name ?? ""} className="h-10 w-10 object-contain" />
              )}
              <div className="leading-tight">
                {company?.name && <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{company.name}</p>}
                {profile?.address && <p className="max-w-[22rem] whitespace-pre-wrap text-[10px] text-slate-500">{profile.address}</p>}
                {(profile?.gstin || profile?.phone || profile?.email) && (
                  <p className="text-[10px] text-slate-500">
                    {[profile?.gstin ? `GSTIN: ${profile.gstin}` : null, profile?.phone ? `Ph: ${profile.phone}` : null, profile?.email]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                <h1 className="mt-1 text-lg font-bold text-slate-900">EXPENSE VOUCHER</h1>
                <p className="text-slate-500">
                  Voucher No. {voucher.voucher_no ?? "—"} · {voucher.voucher_date}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="rounded-full border border-slate-300 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                {voucher.status}
              </span>
              {voucher.is_interstate && <p className="mt-1 text-[10px] text-sky-700">IGST (inter-state)</p>}
              {!voucher.is_interstate && <p className="mt-1 text-[10px] text-slate-500">CGST + SGST (intra-state)</p>}
            </div>
          </div>

          {/* Voucher details */}
          <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
            <div className="space-y-0.5">
              <p><span className="font-semibold text-slate-700">Expense type:</span> {voucher.expense_type}</p>
              <p><span className="font-semibold text-slate-700">Payment mode:</span> {voucher.payment_mode}{voucher.upi_reference ? ` · UPI ref ${voucher.upi_reference}` : ""}</p>
              <p><span className="font-semibold text-slate-700">Payment account:</span> {paymentAccount ? `${paymentAccount.code} · ${paymentAccount.name}` : "—"}</p>
              <p><span className="font-semibold text-slate-700">Paid to:</span> {voucher.paid_to ?? "—"}</p>
              <p><span className="font-semibold text-slate-700">Employee:</span> {voucher.employee_id ? (employeeMap.get(voucher.employee_id) ?? "—") : "—"}</p>
              <p><span className="font-semibold text-slate-700">Department:</span> {voucher.department_id ?? "—"}</p>
            </div>
            <div className="space-y-0.5">
              <p><span className="font-semibold text-slate-700">Invoice no:</span> {voucher.invoice_no ?? "—"}</p>
              <p><span className="font-semibold text-slate-700">Invoice date:</span> {voucher.invoice_date ?? "—"}</p>
              <p><span className="font-semibold text-slate-700">GSTIN:</span> {voucher.gstin ?? "—"}</p>
              <p><span className="font-semibold text-slate-700">Vendor state:</span> {voucher.vendor_state ?? "—"}</p>
              <p><span className="font-semibold text-slate-700">Place of supply:</span> {voucher.place_of_supply ?? "—"}</p>
              <p><span className="font-semibold text-slate-700">Branch / Cost centre:</span> {[voucher.branch, voucher.cost_centre].filter(Boolean).join(" · ") || "—"}</p>
            </div>
          </div>
          {voucher.description && (
            <p className="mb-3 text-[11px]"><span className="font-semibold text-slate-700">Description:</span> {voucher.description}</p>
          )}
          {voucher.remarks && (
            <p className="mb-3 text-[11px]"><span className="font-semibold text-slate-700">Remarks:</span> {voucher.remarks}</p>
          )}

          {/* Items */}
          <p className="mb-1 text-[11px] font-semibold text-slate-700">Expense lines</p>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">Description</th>
                <th className="py-1 pr-2">Category</th>
                <th className="py-1 pr-2 text-right">Qty</th>
                <th className="py-1 pr-2">Unit</th>
                <th className="py-1 pr-2 text-right">Rate</th>
                <th className="py-1 pr-2 text-right">Gross</th>
                <th className="py-1 pr-2 text-right">Discount</th>
                <th className="py-1 pr-2 text-right">Taxable</th>
                <th className="py-1 pr-2 text-right">GST %</th>
                <th className="py-1 pr-2 text-right">CGST</th>
                <th className="py-1 pr-2 text-right">SGST/IGST</th>
                <th className="py-1 pr-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={13} className="py-3 text-center text-slate-400">No expense lines.</td>
                </tr>
              )}
              {items.map((it, i) => {
                const cat = it.category_id ? categoryMap.get(it.category_id) : null;
                const sgstIgst = voucher.is_interstate ? Number(it.igst) : Number(it.sgst);
                return (
                  <tr key={it.id} className="border-b border-slate-100 text-slate-700">
                    <td className="py-1 pr-2">{i + 1}</td>
                    <td className="py-1 pr-2">{it.description}</td>
                    <td className="py-1 pr-2">{cat ? `${cat.group_name} · ${cat.name}` : "—"}</td>
                    <td className="py-1 pr-2 text-right">{it.qty ?? "—"}</td>
                    <td className="py-1 pr-2">{it.unit ?? "—"}</td>
                    <td className="py-1 pr-2 text-right">{it.rate != null ? money(it.rate) : "—"}</td>
                    <td className="py-1 pr-2 text-right">{money(it.gross_amount)}</td>
                    <td className="py-1 pr-2 text-right">{Number(it.discount) > 0 ? money(it.discount) : "—"}</td>
                    <td className="py-1 pr-2 text-right">{money(it.taxable_value)}</td>
                    <td className="py-1 pr-2 text-right">{Number(it.gst_rate)}%</td>
                    <td className="py-1 pr-2 text-right">{Number(it.cgst) > 0 ? money(it.cgst) : "—"}</td>
                    <td className="py-1 pr-2 text-right">{sgstIgst > 0 ? money(sgstIgst) : "—"}</td>
                    <td className="py-1 pr-2 text-right font-semibold">{money(it.total_amount)}</td>
                  </tr>
                );
              })}
              {items.length > 0 && (
                <tr className="border-t-2 border-slate-400 font-bold text-slate-900">
                  <td colSpan={6} className="py-1 pr-2 text-right">TOTAL</td>
                  <td className="py-1 pr-2 text-right">{money(voucher.gross_total)}</td>
                  <td className="py-1 pr-2 text-right">{Number(voucher.discount_total) > 0 ? money(voucher.discount_total) : "—"}</td>
                  <td className="py-1 pr-2 text-right">{money(voucher.taxable_total)}</td>
                  <td className="py-1 pr-2" />
                  <td className="py-1 pr-2 text-right">{Number(voucher.cgst_total) > 0 ? money(voucher.cgst_total) : "—"}</td>
                  <td className="py-1 pr-2 text-right">{(Number(voucher.sgst_total) + Number(voucher.igst_total)) > 0 ? money(Number(voucher.sgst_total) + Number(voucher.igst_total)) : "—"}</td>
                  <td className="py-1 pr-2 text-right">{money(voucher.grand_total)}</td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Charges */}
          {charges.length > 0 && (
            <div className="mt-4">
              <p className="mb-1 text-[11px] font-semibold text-slate-700">Additional charges</p>
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                    <th className="py-1 pr-2">Charge</th>
                    <th className="py-1 pr-2 text-right">Amount</th>
                    <th className="py-1 pr-2 text-right">GST %</th>
                    <th className="py-1 pr-2 text-right">CGST</th>
                    <th className="py-1 pr-2 text-right">SGST/IGST</th>
                    <th className="py-1 pr-2 text-right">Total</th>
                    <th className="py-1 pr-2">Allocation</th>
                  </tr>
                </thead>
                <tbody>
                  {charges.map((c) => {
                    const sgstIgst = voucher.is_interstate ? Number(c.igst) : Number(c.sgst);
                    return (
                      <tr key={c.id} className="border-b border-slate-100 text-slate-700">
                        <td className="py-1 pr-2">{c.charge_name}</td>
                        <td className="py-1 pr-2 text-right">{money(c.amount)}</td>
                        <td className="py-1 pr-2 text-right">{Number(c.gst_rate)}%</td>
                        <td className="py-1 pr-2 text-right">{Number(c.cgst) > 0 ? money(c.cgst) : "—"}</td>
                        <td className="py-1 pr-2 text-right">{sgstIgst > 0 ? money(sgstIgst) : "—"}</td>
                        <td className="py-1 pr-2 text-right font-semibold">{money(c.total_amount)}</td>
                        <td className="py-1 pr-2">{c.allocation_method}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-slate-300 font-bold text-slate-900">
                    <td className="py-1 pr-2 text-right">Charges total</td>
                    <td className="py-1 pr-2 text-right">{money(voucher.charges_total)}</td>
                    <td colSpan={5} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Totals */}
          <div className="mt-4 grid grid-cols-2 gap-6 border-t border-slate-300 pt-3">
            <div className="text-[11px] text-slate-600">
              <p className="mb-1 font-semibold text-slate-700">Summary</p>
              <p>Lines: {items.length} · Charges: {charges.length}</p>
              <p>Taxable total: ₹{money(voucher.taxable_total)}</p>
              {Number(voucher.non_gst_total) > 0 && <p>Non-GST amount: ₹{money(voucher.non_gst_total)}</p>}
              {Number(voucher.itc_total) > 0 && <p>ITC eligible: ₹{money(voucher.itc_total)}</p>}
              {Number(voucher.cess_total) > 0 && <p>Cess: ₹{money(voucher.cess_total)}</p>}
              {Number(voucher.round_off) !== 0 && <p>Round off: ₹{money(voucher.round_off)}</p>}
            </div>
            <div className="text-right text-[11px]">
              <p className="text-slate-600">Gross total: ₹{money(voucher.gross_total)}</p>
              <p className="text-slate-600">Discount: ₹{money(voucher.discount_total)}</p>
              <p className="text-slate-600">Taxable: ₹{money(voucher.taxable_total)}</p>
              <p className="text-slate-600">CGST: ₹{money(voucher.cgst_total)}</p>
              <p className="text-slate-600">SGST: ₹{money(voucher.sgst_total)}</p>
              <p className="text-slate-600">IGST: ₹{money(voucher.igst_total)}</p>
              <p className="text-slate-600">CESS: ₹{money(voucher.cess_total)}</p>
              <p className="text-slate-600">Charges: ₹{money(voucher.charges_total)}</p>
              <p className="mt-1 text-sm font-bold text-slate-900">GRAND TOTAL: ₹{money(voucher.grand_total)}</p>
            </div>
          </div>

          {/* Approval trail */}
          {events.length > 0 && (
            <div className="mt-4 border-t border-slate-300 pt-3">
              <p className="mb-1 text-[11px] font-semibold text-slate-700">Approval / posting trail</p>
              <table className="w-full border-collapse text-left text-[10px]">
                <thead>
                  <tr className="text-slate-500">
                    <th className="py-0.5 pr-2">When</th>
                    <th className="py-0.5 pr-2">Action</th>
                    <th className="py-0.5 pr-2">From → To</th>
                    <th className="py-0.5 pr-2">Actor</th>
                    <th className="py-0.5 pr-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} className="border-b border-slate-100 text-slate-700">
                      <td className="py-0.5 pr-2">{new Date(e.created_at).toLocaleString("en-IN")}</td>
                      <td className="py-0.5 pr-2">{e.action}</td>
                      <td className="py-0.5 pr-2">{e.from_status ?? "—"} → {e.to_status ?? "—"}</td>
                      <td className="py-0.5 pr-2">{e.actor_name ?? (e.actor_employee_id ? employeeMap.get(e.actor_employee_id) ?? "—" : "—")}</td>
                      <td className="py-0.5 pr-2">{e.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Stamps */}
          <div className="mt-2 text-[10px] text-slate-500">
            {submittedBy && <p>Submitted by: {submittedBy}{voucher.submitted_at ? ` on ${new Date(voucher.submitted_at).toLocaleString("en-IN")}` : ""}</p>}
            {approvedBy && <p>Approved by: {approvedBy}{voucher.approved_at ? ` on ${new Date(voucher.approved_at).toLocaleString("en-IN")}` : ""}</p>}
            {postedBy && <p>Posted by: {postedBy}{voucher.posted_at ? ` on ${new Date(voucher.posted_at).toLocaleString("en-IN")}` : ""}</p>}
            {voucher.paid_at && <p>Paid on: {new Date(voucher.paid_at).toLocaleString("en-IN")}</p>}
            {voucher.reversal_of && <p className="text-amber-700">Reversal of voucher {voucher.reversal_of}</p>}
            {voucher.rejection_reason && <p className="text-red-700">Rejection reason: {voucher.rejection_reason}</p>}
          </div>

          {/* Signatures */}
          <div className="mt-10 grid grid-cols-3 gap-6 text-xs text-slate-600">
            <div><div className="border-t border-slate-300 pt-2">Prepared By</div></div>
            <div><div className="border-t border-slate-300 pt-2">Approved By</div></div>
            <div><div className="border-t border-slate-300 pt-2">Posted By</div></div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
