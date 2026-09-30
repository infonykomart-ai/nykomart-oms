import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { B2BInquiryManager, type B2BInquiryView } from "./b2b-client";

// 2026-09-30 — B2B Inquiry Management ("B2B INQUIRY HANDLE / REPORT /
// INVOICE / AND RELATED SECTION PAYMENT MODE & MANY MORE"). One page, four
// sections the user named:
//   • HANDLE   — the register: every trade-buyer inquiry with buyer, source,
//                priority, follow-up date and a status lifecycle
//                (Open → In Discussion → Quotation Sent → Won/Lost/Converted)
//   • INVOICE  — the quotation (1:1 per inquiry, DB-computed totals,
//                shareable over WhatsApp / email)
//   • PAYMENT  — money actually received per quotation, mode-wise
//                (Cash / Bank Transfer / UPI / Cheque / Card / Advance)
//                with reference no + realized flag
//   • REPORT   — KPI cards + a payment-mode breakdown + Excel export
//
// All data is loaded server-side in one pass (the register is hundreds of
// rows at most — one query per table, no paging) and handed to the client
// component as plain JSON; every write goes through actions.ts
// (b2b_inquiry capability + company scoping + audit log).
export default async function B2BPage() {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const companyId = me.currentCompanyId;

  const [inquiriesRes, itemsRes, quotesRes, paymentsRes, companyRes] = await Promise.all([
    supabase
      .from("b2b_inquiries")
      .select("*")
      .eq("company_id", companyId)
      .order("inquiry_no", { ascending: false }),
    supabase
      .from("b2b_inquiry_items")
      .select("inquiry_id, description, qty, unit, unit_price, remark, display_order")
      .order("display_order"),
    supabase.from("b2b_quotations").select("*").eq("company_id", companyId),
    supabase
      .from("b2b_payments")
      .select("*")
      .eq("company_id", companyId)
      .order("payment_date", { ascending: false }),
    supabase.from("companies").select("id, name").eq("id", companyId).single(),
  ]);

  if (inquiriesRes.error) throw new Error(inquiriesRes.error.message);

  const itemsByInquiry = new Map<string, B2BInquiryView["items"]>();
  for (const it of itemsRes.data ?? []) {
    const list = itemsByInquiry.get(it.inquiry_id) ?? [];
    list.push(it);
    itemsByInquiry.set(it.inquiry_id, list);
  }
  const quoteByInquiry = new Map<string, B2BInquiryView["quote"]>();
  const paymentsByQuote = new Map<string, NonNullable<B2BInquiryView["quote"]>["payments"]>();
  for (const p of paymentsRes.data ?? []) {
    const list = paymentsByQuote.get(p.quotation_id) ?? [];
    list.push(p);
    paymentsByQuote.set(p.quotation_id, list);
  }
  for (const q of quotesRes.data ?? []) {
    quoteByInquiry.set(q.inquiry_id, { ...q, payments: paymentsByQuote.get(q.id) ?? [] });
  }

  const inquiries: B2BInquiryView[] = (inquiriesRes.data ?? []).map((i) => ({
    ...i,
    items: itemsByInquiry.get(i.id) ?? [],
    quote: quoteByInquiry.get(i.id) ?? null,
  }));

  return (
    <B2BInquiryManager
      inquiries={inquiries}
      companyId={companyId}
      companyName={companyRes.data?.name ?? ""}
      canManage
    />
  );
}
