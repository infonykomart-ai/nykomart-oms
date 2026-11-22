// 2026-11-22d — Phase 4: GET /api/orders/[id]/pdf?type=order|invoice|tax-invoice|packing-list
//
// One order as a real PDF file (not window.print()): A4 portrait, company
// letterhead on every page, repeated table head, "Page X of Y". The data is
// read here with the SAME columns the order detail page shows, and the
// document model (src/lib/documents/order-document.ts) is pure, so the PDF
// cannot disagree with the screen.
//
// Access is the order detail page's: any signed-in employee whose companyIds
// include the order's company. A foreign company gets 404, exactly like the
// page, so the route leaks nothing about other companies' orders.
import { NextResponse } from "next/server";
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { buildOrderDocument, documentFileName, isDocumentKind } from "@/lib/documents/order-document";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  let employee;
  try {
    employee = await getAuthedEmployee();
  } catch {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await context.params;
  const requested = new URL(request.url).searchParams.get("type") ?? "order";
  const kind = isDocumentKind(requested) ? requested : "order";

  const supabase = await createClient();
  // "*" for the same reason the detail loader uses it: a pending migration
  // must not blank the document.
  const { data: order } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const [{ data: company }, { data: profile }, { data: store }, { data: category }, { data: invoice }] =
    await Promise.all([
      supabase.from("companies").select("id, name, logo_url").eq("id", order.company_id).maybeSingle(),
      supabase.from("company_profiles").select("*").eq("company_id", order.company_id).maybeSingle(),
      order.store_id
        ? supabase.from("stores").select("id, name").eq("id", order.store_id).maybeSingle()
        : Promise.resolve({ data: null }),
      order.item_category_id
        ? supabase.from("item_categories").select("id, name, hsn_code").eq("id", order.item_category_id).maybeSingle()
        : Promise.resolve({ data: null }),
      order.invoice_id
        ? supabase
            .from("sales_invoices")
            .select("invoice_no, invoice_date, master_invoice_no")
            .eq("id", order.invoice_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const model = buildOrderDocument({
    kind,
    order,
    company,
    profile,
    invoice,
    storeName: store?.name ?? null,
    hsnCode: category?.hsn_code ?? null,
  });

  const { renderOrderDocumentPdf } = await import("@/lib/documents/order-pdf");
  const buffer = await renderOrderDocumentPdf(model);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${documentFileName(model)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
