import { NextResponse } from "next/server";
import { getAuthedEmployee, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

// 2026-09-11 (Payroll Phase 3) — serves one employee_documents file from
// the PRIVATE "employee-documents" Storage bucket. Same gated-download-
// proxy pattern as message-attachment/order-photo-proxy: verify identity,
// explicitly check the requester actually has employee_admin for the
// document's own company, only THEN stream the file via the service-role
// client (which bypasses Storage RLS — this capability check IS the
// security boundary, same as everywhere else in this app).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let employee;
  try {
    employee = await getAuthedEmployee();
  } catch (err) {
    if (err instanceof UnauthorizedError) return new NextResponse("Not signed in.", { status: 401 });
    throw err;
  }

  if (!employee.capabilities.includes("employee_admin")) {
    return new NextResponse("Forbidden.", { status: 403 });
  }

  const { id } = await params;
  const supabase = createServiceRoleClient();
  const { data: doc, error } = await supabase
    .from("employee_documents")
    .select("company_id, storage_path, file_name, mime_type")
    .eq("id", id)
    .maybeSingle();

  if (error) return new NextResponse(error.message, { status: 500 });
  if (!doc) return new NextResponse("Not found.", { status: 404 });
  if (!employee.companyIds.includes(doc.company_id)) return new NextResponse("Forbidden.", { status: 403 });

  const { data: blob, error: downloadError } = await supabase.storage.from("employee-documents").download(doc.storage_path);
  if (downloadError || !blob) return new NextResponse("Could not load document.", { status: 502 });

  const buffer = Buffer.from(await blob.arrayBuffer());
  const name = (doc.file_name ?? "document").replace(/"/g, "");
  const isImage = (doc.mime_type ?? "").startsWith("image/");
  const isPdf = (doc.mime_type ?? "") === "application/pdf";
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": doc.mime_type ?? "application/octet-stream",
      "Content-Disposition": `${isImage || isPdf ? "inline" : "attachment"}; filename="${name}"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}
