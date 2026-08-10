import { NextResponse } from "next/server";
import { requireCapability, UnauthorizedError, ForbiddenError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Serves the shipping label PDF Shipglobal returned from addOrder.php
// (stored as base64 in shipglobal_shipments.label_pdf_base64 — see
// db/2026-08-10-shipglobal.sql). Mirrors the existing order-photo-proxy
// route's pattern of a small capability-gated binary-serving endpoint
// rather than needing Supabase Storage bucket setup for one PDF per
// shipment.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireCapability("shipglobal_shipment");
  } catch (err) {
    if (err instanceof UnauthorizedError) return new NextResponse("Not signed in.", { status: 401 });
    if (err instanceof ForbiddenError) return new NextResponse("Forbidden.", { status: 403 });
    throw err;
  }

  const { id } = await params;
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("shipglobal_shipments").select("label_pdf_base64").eq("id", id).maybeSingle();

  if (error) return new NextResponse(error.message, { status: 500 });
  if (!data?.label_pdf_base64) return new NextResponse("No label available for this shipment.", { status: 404 });

  const buffer = Buffer.from(data.label_pdf_base64, "base64");
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="shipglobal-label-${id}.pdf"`,
    },
  });
}
