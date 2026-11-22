// 2026-11-22d — Phase 4: GET /api/purchase-orders/[id]/pdf
//
// The PO's real PDF file (the print page stays as the on-screen sheet). Same
// gate as the PO module itself: order_entry capability + the PO's company.
// Close-up photos are read through getPurchaseOrder → getOrderCloseupPhotos,
// i.e. the LIVE list from the linked order — the PO still owns no photos.
import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth/require-capability";
import { getPurchaseOrder } from "@/lib/purchase-orders/data";
import { renderPurchaseOrderPdf } from "@/lib/purchase-orders/po-pdf";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  let employee;
  try {
    employee = await requireCapability("order_entry");
  } catch {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const { id } = await context.params;
  const detail = await getPurchaseOrder(id, employee.companyIds);
  if (!detail) return NextResponse.json({ error: "Purchase order not found." }, { status: 404 });

  const { po, items, order, supplierName, companyName, companyLogoUrl, photos } = detail;

  const buffer = await renderPurchaseOrderPdf({
    poNo: po.po_no,
    poDate: po.po_date,
    expectedDate: po.expected_date,
    status: po.status,
    currency: po.currency,
    supplierName,
    orderRef: order?.ref_no ?? null,
    buyerName: order?.buyer_name_address ?? null,
    companyName,
    companyLogoUrl,
    lines: items.map((item) => ({ sku_label: item.sku_label, qty: item.qty, unit_cost: item.unit_cost })),
    photoUrls: photos.map((photo) => photo.url),
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${po.po_no}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
