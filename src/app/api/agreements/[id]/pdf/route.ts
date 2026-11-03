// 2026-11-03 — authenticated PDF streaming for the agreement workspace.
//
// Agreements are stored in a PRIVATE bucket; this route is the only way an
// employee's browser reads them. Access is re-checked here (signed-in
// employee + agreement capability + company scope) — the PDF is never exposed
// through a public storage URL.
import { NextResponse } from "next/server";
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAgreementPdf } from "@/lib/agreements/storage";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  let employee;
  try {
    employee = await getAuthedEmployee();
  } catch {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (!employee.capabilities.includes("hr_letters") && !employee.capabilities.includes("party_admin")) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const { id } = await context.params;
  const url = new URL(request.url);
  const requestedVersion = Number(url.searchParams.get("v") ?? "");
  const download = url.searchParams.get("download") === "1";

  const supabase = createServiceRoleClient();
  const { data: agreement } = await supabase
    .from("agreement_documents")
    .select("id, company_id, ref_no")
    .eq("id", id)
    .maybeSingle();

  if (!agreement) return NextResponse.json({ error: "Agreement not found." }, { status: 404 });
  if (!employee.companyIds.includes(agreement.company_id)) {
    return NextResponse.json({ error: "Not authorised for this company." }, { status: 403 });
  }

  let versionQuery = supabase
    .from("agreement_document_versions")
    .select("version, pdf_path")
    .eq("document_id", id)
    .order("version", { ascending: false })
    .limit(1);

  if (Number.isFinite(requestedVersion) && requestedVersion > 0) {
    versionQuery = supabase
      .from("agreement_document_versions")
      .select("version, pdf_path")
      .eq("document_id", id)
      .eq("version", requestedVersion)
      .limit(1);
  }

  const { data: version } = await versionQuery.maybeSingle();
  if (!version) return NextResponse.json({ error: "No PDF has been generated yet." }, { status: 404 });

  const buffer = await getAgreementPdf(version.pdf_path);
  if (!buffer) return NextResponse.json({ error: "The stored PDF could not be read." }, { status: 500 });

  // Audit the actual read (the workspace also logs an explicit download).
  await supabase.from("agreement_sharing_logs").insert({
    document_id: id,
    channel: "download",
    provider: download ? "authenticated_download" : "authenticated_preview",
    status: "sent",
    actor_employee_id: employee.id,
  });

  const fileName = `${agreement.ref_no}-v${version.version}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
