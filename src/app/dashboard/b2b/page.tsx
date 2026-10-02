import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { B2BInquiryManager, type B2BInquiryView } from "./b2b-client";
import { B2BNav } from "./b2b-nav";

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
//
// 2026-09-30b — "jab koi inquiry daal raha hu to logout ho raha baar baar":
// before the one-time migration runs, every query here failed with
// "relation b2b_inquiries does not exist", the page THREW, and the
// dashboard error boundary offered a Sign-in button — which read exactly
// like being logged out after every save. The queries now degrade to
// safe fallbacks and the failure reason is passed to the client, which
// shows a clear "run the migration" setup card instead of crashing.
export default async function B2BPage() {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const companyId = me.currentCompanyId;

  const [inquiriesRes, itemsRes, quotesRes, quoteItemsRes, paymentsRes, docsRes, companyRes] = await Promise.all([
    supabase
      .from("b2b_inquiries")
      .select("*")
      .eq("company_id", companyId)
      .order("inquiry_no", { ascending: false })
      .then(
        (r) => r,
        (err) => ({ data: null, error: err as { message: string } })
      ),
    supabase
      .from("b2b_inquiry_items")
      .select("inquiry_id, description, qty, unit, unit_price, remark, display_order")
      .order("display_order")
      .then(
        (r) => r,
        () => ({ data: [], error: null })
      ),
    supabase
      .from("b2b_quotations")
      .select("*")
      .eq("company_id", companyId)
      .then(
        (r) => r,
        () => ({ data: [], error: null })
      ),
    supabase
      .from("b2b_quotation_items")
      .select("*")
      .order("display_order")
      .then(
        (r) => r,
        () => ({ data: [], error: null })
      ),
    supabase
      .from("b2b_payments")
      .select("*")
      .eq("company_id", companyId)
      .order("payment_date", { ascending: false })
      .then(
        (r) => r,
        () => ({ data: [], error: null })
      ),
    supabase
      .from("b2b_documents")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at")
      .then(
        (r) => r,
        () => ({ data: [], error: null })
      ),
    supabase
      .from("companies")
      .select("id, name")
      .eq("id", companyId)
      .single()
      .then(
        (r) => r,
        () => ({ data: null, error: null })
      ),
  ]);

  // 2026-09-30b — "logout ho raha baar baar" root cause: a missing table
  // used to throw here and crash the whole page into the error boundary.
  // Now the raw reason travels to the client as a setup notice.
  const loadError = inquiriesRes.error ? inquiriesRes.error.message : null;

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
  // Part-2 wire-up: per-quote line items (the money rows PI/CI print) and
  // issued commercial documents (PI / CI / PL register).
  const quoteItemsByQuote = new Map<string, NonNullable<B2BInquiryView["quote"]>["items"]>();
  for (const it of quoteItemsRes.data ?? []) {
    const list = quoteItemsByQuote.get(it.quotation_id) ?? [];
    list.push({ ...it, line_total: it.line_total ?? 0 });
    quoteItemsByQuote.set(it.quotation_id, list);
  }
  const docsByQuote = new Map<string, NonNullable<B2BInquiryView["quote"]>["documents"]>();
  for (const d of docsRes.data ?? []) {
    const list = docsByQuote.get(d.quotation_id) ?? [];
    list.push(d);
    docsByQuote.set(d.quotation_id, list);
  }
  for (const q of quotesRes.data ?? []) {
    quoteByInquiry.set(q.inquiry_id, {
      ...q,
      // GENERATED columns come back nullable from the introspected types
      // (Postgres catalogs report them nullable even though the app never
      // writes null) — coalesce at the load boundary so the client keeps
      // its non-null number contract.
      tax_amount: q.tax_amount ?? 0,
      total_amount: q.total_amount ?? 0,
      payments: paymentsByQuote.get(q.id) ?? [],
      items: (quoteItemsByQuote.get(q.id) ?? []).map((it) => ({ ...it, line_total: it.line_total ?? 0 })),
      documents: docsByQuote.get(q.id) ?? [],
    });
  }

  const inquiries: B2BInquiryView[] = (inquiriesRes.data ?? []).map((i) => ({
    ...i,
    items: itemsByInquiry.get(i.id) ?? [],
    quote: quoteByInquiry.get(i.id) ?? null,
  }));

  return (
    <>
      {/* 2026-10-02d — the register keeps working exactly as before; the
          nav strip above it just links out to the new ERP pages. */}
      <B2BNav />
      <B2BInquiryManager
        inquiries={inquiries}
        companyId={companyId}
        companyName={companyRes.data?.name ?? ""}
        canManage
        loadError={loadError}
      />
    </>
  );
}
