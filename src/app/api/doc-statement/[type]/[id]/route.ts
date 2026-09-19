import { NextResponse } from "next/server";
import { loadDocStatement, type DocType } from "@/lib/doc-statement";

// 2026-09-19 — GET /api/doc-statement/[type]/[id] — the access-checked
// endpoint behind DocStatementDialog, same shape as
// /api/bill-statement/[billId] (see that route's header comment). One
// route for all 4 types (Credit Note / CSB Filing / Refund / Order
// Refund) — loadDocStatement dispatches, so there's still exactly one
// access gate per type, just not one route per type.
const VALID_TYPES: DocType[] = ["credit_note", "csb_filing", "refund", "order_refund"];

export async function GET(request: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  if (!VALID_TYPES.includes(type as DocType)) {
    return NextResponse.json({ ok: false, error: "Unknown document type." }, { status: 404 });
  }

  const result = await loadDocStatement(type as DocType, id);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const wantsPdf = new URL(request.url).searchParams.get("format") === "pdf";
  if (wantsPdf) {
    const { renderDocStatementPdf } = await import("@/lib/doc-statement-pdf");
    const buffer = await renderDocStatementPdf(result.data);
    const filename = `${result.data.kind}-${(result.data.invoiceRef || result.data.id).replace(/[^a-zA-Z0-9._-]+/g, "_")}.pdf`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({ ok: true, data: result.data });
}
