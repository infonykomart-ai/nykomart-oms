import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { InvoiceView } from "./invoice-view";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const employee = await requireCapability("invoicing");
  const { id } = await params;
  const supabase = await createClient();

  const { data: invoice } = await supabase.from("sales_invoices").select("*").eq("id", id).single();
  if (!invoice || !employee.companyIds.includes(invoice.company_id)) notFound();

  const [{ data: orders }, { data: company }, { data: profile }, { data: store }, { data: itemCategories }] = await Promise.all([
    // 2026-08-18 — "conversation rate are not showing" (currency conversion
    // rate): order_value_inr/exchange_rate_source already exist on orders
    // (computed at Order Entry time, see computeCurrencyConversion) but
    // weren't being selected here, so the invoice page had no way to show
    // what rate was used to convert a foreign-currency order into INR.
    // Added for the reference-only panel in invoice-view.tsx — purely
    // informational, doesn't change anything about the printed customs
    // invoice itself.
    supabase
      .from("orders")
      .select(
        "id, ref_no, ref_no_base, sku_label, size_label, qty, item_category_id, order_value_original, order_currency, order_value_usd, order_value_inr, exchange_rate_source, colour"
      )
      .eq("invoice_id", id),
    supabase.from("companies").select("id, name, logo_url").eq("id", invoice.company_id).single(),
    supabase.from("company_profiles").select("*").eq("company_id", invoice.company_id).single(),
    supabase.from("stores").select("id, name").eq("id", invoice.store_id).single(),
    supabase.from("item_categories").select("id, name, hsn_code, harmonized_tariff_number"),
  ]);

  const categoryMap = new Map((itemCategories ?? []).map((c) => [c.id, c]));
  const items = (orders ?? []).map((o) => ({
    ...o,
    item_category_name: categoryMap.get(o.item_category_id)?.name ?? "",
    hsn_code: categoryMap.get(o.item_category_id)?.hsn_code ?? "",
    harmonized_tariff_number: categoryMap.get(o.item_category_id)?.harmonized_tariff_number ?? "",
  }));

  // 2026-11-23 — "dusara jo PO me add ho gaya hai usko pura update ho jaye":
  // a PO/RF/RG can gain another order row AFTER this invoice was generated.
  // That row is untouched by this invoice (orders.invoice_id is null), so the
  // page lists how many are still un-invoiced on the same PO number instead of
  // letting the invoice look like it covers the whole PO.
  const invoiceRefBases = Array.from(
    new Set((orders ?? []).map((o) => o.ref_no_base).filter((v): v is string => !!v))
  );
  const { data: pendingSamePo } = invoiceRefBases.length
    ? await supabase
        .from("orders")
        .select("id, ref_no")
        .eq("company_id", invoice.company_id)
        .in("ref_no_base", invoiceRefBases)
        .is("invoice_id", null)
        .not("status", "in", "(Hold,Cancelled)")
    : { data: [] };

  // 2026-08-07: surface the order -> credit/debit-note connection here too
  // (not just in Document Entry's lookup box) — see claude/document-entry-
  // and-pending-work-notes.md follow-up. This invoice's own orders may
  // already have refund/debit history against them.
  const orderIds = (orders ?? []).map((o) => o.id);
  const [{ data: relatedCreditNotes }, { data: relatedDebitNotes }] = orderIds.length
    ? await Promise.all([
        supabase.from("credit_notes").select("id, cn_no, refund_amount, order_id").in("order_id", orderIds),
        supabase.from("debit_notes").select("id, debit_note_no, debit_amount, order_id").in("order_id", orderIds),
      ])
    : [{ data: [] }, { data: [] }];

  // 2026-11-23 — every recalculation writes the breakdown it replaced to
  // audit_log FIRST (see recalculateInvoiceBreakdownCore), because the printed
  // totals are a snapshot that may already be on a customs invoice. Read the
  // last few back so the page can show them. A missing audit_log table just
  // yields no history; it never breaks this page.
  const { data: totalsHistoryRows } = await supabase
    .from("audit_log")
    .select("id, employee_name, created_at, changes")
    .eq("entity_type", "sales_invoice")
    .eq("entity_id", id)
    .eq("action", "sales_invoice.value_breakdown_recalculated")
    .order("created_at", { ascending: false })
    .limit(10);

  const asNumber = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const totalsHistory = (totalsHistoryRows ?? []).map((row) => {
    const changes = (row.changes ?? {}) as { previous?: Record<string, unknown>; next?: Record<string, unknown> };
    const previous = changes.previous ?? {};
    const next = changes.next ?? {};
    const currency =
      typeof previous.invoice_currency === "string"
        ? previous.invoice_currency
        : typeof next.invoice_currency === "string"
          ? next.invoice_currency
          : null;
    return {
      id: row.id,
      employeeName: row.employee_name,
      createdAt: row.created_at,
      previousPercent: asNumber(previous.value_percent),
      previousTotal: asNumber(previous.invoice_value_usd),
      previousItemCost: asNumber(previous.item_cost_total),
      previousInsurance: asNumber(previous.insurance_total),
      previousFreight: asNumber(previous.freight_total),
      nextPercent: asNumber(next.value_percent),
      nextTotal: asNumber(next.invoice_value_usd),
      currency,
    };
  });

  const refNoByOrderId = new Map((orders ?? []).map((o) => [o.id, o.ref_no]));
  const relatedNotes = {
    creditNotes: (relatedCreditNotes ?? []).map((c) => ({
      id: c.id,
      no: c.cn_no ?? "—",
      amount: Number(c.refund_amount),
      refNo: refNoByOrderId.get(c.order_id ?? "") ?? "",
    })),
    debitNotes: (relatedDebitNotes ?? []).map((d) => ({
      id: d.id,
      no: d.debit_note_no ?? "—",
      amount: Number(d.debit_amount),
      refNo: refNoByOrderId.get(d.order_id ?? "") ?? "",
    })),
  };

  return (
    <InvoiceView
      invoice={invoice}
      items={items}
      company={company ?? null}
      profile={profile ?? null}
      storeName={store?.name ?? ""}
      relatedNotes={relatedNotes}
      liveOrderValueSum={(orders ?? []).reduce((sum, o) => sum + Number(o.order_value_original || 0), 0)}
      pendingSamePo={(pendingSamePo ?? []).map((o) => ({ refNo: o.ref_no }))}
      totalsHistory={totalsHistory}
    />
  );
}
