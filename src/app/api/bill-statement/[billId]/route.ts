import { NextResponse } from "next/server";
import { loadBillStatement } from "@/lib/bill-statement";

// 2026-09-15 — GET /api/bill-statement/[billId] — the access-checked
// endpoint behind BillStatementDialog's sheet. Delegates EVERYTHING
// (session, company scope, bill lookup, source-aware sections) to
// loadBillStatement(), the same loader the Party Ledger's full [billId]
// page uses — one access gate, one data shape, no drift. A caller whose
// companies don't include the bill's company gets 403 and the dialog
// shows that error instead of any bill data.
//
// 2026-09-15 (evening) — "agar whatsaap email par update bhej rahe hai to
// pdf file bhi jani chahiye na" + "a4 ke page par portrait me":
// ?format=pdf returns the statement as a real A4-portrait PDF FILE (see
// src/lib/bill-statement-pdf.tsx — @react-pdf/renderer, company logo
// header). Same access gate: 401/403/404 before any byte is generated.
// The dialog's 📱 WhatsApp / ✉️ Email / Telegram buttons download this
// blob first and attach it; 🖨 Print stays window.print() on the HTML.
export async function GET(request: Request, { params }: { params: Promise<{ billId: string }> }) {
  const { billId } = await params;
  const result = await loadBillStatement(billId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  const wantsPdf = new URL(request.url).searchParams.get("format") === "pdf";
  if (wantsPdf) {
    const { renderBillStatementPdf } = await import("@/lib/bill-statement-pdf");
    const buffer = await renderBillStatementPdf(result.data);
    const filename = `bill-statement-${(result.data.invoiceRef || result.data.bill.id).replace(/[^a-zA-Z0-9._-]+/g, "_")}.pdf`;
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
