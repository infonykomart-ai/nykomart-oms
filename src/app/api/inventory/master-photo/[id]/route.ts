import { NextResponse } from "next/server";
import { getAuthedEmployee, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";

// 2026-11-20d — serves one Master SKU photo from the PRIVATE
// `inventory-photos` Storage bucket. Same gated-download-proxy pattern as
// employee-document / message-attachment: check the requester really has the
// inventory capability, then stream through the service-role client (which
// bypasses Storage RLS — this capability check IS the security boundary).
// Master SKUs are cross-company identity, so inventory_view is the right gate:
// anyone who may look at the inventory may look at its reference photos.
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let employee;
  try {
    employee = await getAuthedEmployee();
  } catch (err) {
    if (err instanceof UnauthorizedError) return new NextResponse("Not signed in.", { status: 401 });
    throw err;
  }

  if (!employee.capabilities.includes("inventory_view")) {
    return new NextResponse("Forbidden.", { status: 403 });
  }

  const { id } = await params;
  const supabase = createServiceRoleClientUnchecked();
  const { data: photo, error } = await supabase
    .from("inventory_master_variant_photos")
    .select("image_path, mime_type")
    .eq("id", id)
    .maybeSingle();

  if (error) return new NextResponse(error.message, { status: 500 });
  if (!photo) return new NextResponse("Not found.", { status: 404 });

  const { data: blob, error: downloadError } = await supabase.storage
    .from("inventory-photos")
    .download(photo.image_path);
  if (downloadError || !blob) return new NextResponse("Could not load photo.", { status: 502 });

  return new NextResponse(Buffer.from(await blob.arrayBuffer()), {
    headers: {
      "Content-Type": photo.mime_type ?? "image/jpeg",
      // Private evidence — the browser may cache it briefly, nothing shared.
      "Cache-Control": "private, max-age=300",
    },
  });
}
