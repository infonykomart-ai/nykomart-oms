// 2026-11-22d — Phase 4: GET /api/invoices/[id]/pdf?type=invoice|tax-invoice|packing-list
//
// The invoice's real PDF file. An invoice covers one or more orders, so every
// order becomes a line (the same rows /dashboard/invoices/[id] lists). The
// invoice page itself stays the editable/printable HTML sheet; this route is
// the downloadable document.
//
// Access is the invoice page's gate: requireCapability("invoicing") + the
// invoice's company must be one of the employee's companies.
import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { buildInvoiceDocument, documentFileName, DOCUMENT_TITLES, isDocumentKind, type DocumentKind } from "@/lib/documents/order-document";

export const dynamic = "force-dynamic";

const INVOICE_KINDS: DocumentKind[] = ["invoice", "tax-invoice", "packing-list"];

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  let employee;
  try {
    employee = await requireCapability("invoicing");
  } catch {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const { id } = await context.params;
  const requested = new URL(request.url).searchParams.get("type") ?? "invoice";
  const kind = isDocumentKind(requested) && INVOICE_KINDS.includes(requested) ? requested : "invoice";

  const supabase = await createClient();
  const { data: invoice } = await supabase.from("sales_invoices").select("*").eq("id", id).maybeSingle();
  if (!invoice || !employee.companyIds.includes(invoice.company_id)) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const [{ data: orders }, { data: company }, { data: profile }, { data: store }, { data: categories }] =
    await Promise.all([
      supabase
        .from("orders")
        .select(
          "id, ref_no, order_date, buyer_name_address, contact_no, destination_country, sku_label, size_label, colour, qty, order_currency, order_value_original, order_value_inr, status, item_category_id, photo_url, photo_urls"
        )
        .eq("invoice_id", id),
      supabase.from("companies").select("id, name, logo_url").eq("id", invoice.company_id).maybeSingle(),
      supabase.from("company_profiles").select("*").eq("company_id", invoice.company_id).maybeSingle(),
      invoice.store_id
        ? supabase.from("stores").select("id, name").eq("id", invoice.store_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("item_categories").select("id, hsn_code"),
    ]);

  // HSN is per order (its item category), keyed by the order reference because
  // that is what the document model's lines carry.
  const hsnById = new Map(
    ((categories ?? []) as { id: string; hsn_code: string | null }[]).map((category) => [category.id, category.hsn_code])
  );
  const hsnByRef: Record<string, string | null> = {};
  for (const order of orders ?? []) {
    hsnByRef[order.ref_no] = hsnById.get(order.item_category_id) ?? null;
  }

  const model = buildInvoiceDocument({
    kind,
    invoice: {
      invoice_no: invoice.invoice_no,
      invoice_date: invoice.invoice_date,
      master_invoice_no: invoice.master_invoice_no,
    },
    orders: orders ?? [],
    company,
    profile,
    storeName: store?.name ?? null,
    hsnByRef,
  });

  const { renderOrderDocumentPdf } = await import("@/lib/documents/order-pdf");
  const buffer = await renderOrderDocumentPdf(model);

  const fileName = documentFileName(model) || `${DOCUMENT_TITLES[kind]}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
