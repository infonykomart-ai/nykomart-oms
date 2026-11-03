// 2026-11-03 — vendor PDF download through the expiring token link.
// Validates the token on EVERY request (expiry + revocation are re-checked),
// streams the stored PDF from the private bucket, and records the access in
// the agreement history so the admin can see when the vendor opened it.
import { NextResponse } from "next/server";
import { resolveVendorAccessToken } from "@/app/dashboard/agreements/actions";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAgreementPdf } from "@/lib/agreements/storage";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const resolved = await resolveVendorAccessToken(token);
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 403 });

  const supabase = createServiceRoleClient();
  const { data: version } = await supabase
    .from("agreement_document_versions")
    .select("version, pdf_path")
    .eq("document_id", resolved.document.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!version) return NextResponse.json({ error: "The agreement PDF is not available yet." }, { status: 404 });

  const buffer = await getAgreementPdf(version.pdf_path);
  if (!buffer) return NextResponse.json({ error: "The agreement PDF could not be read." }, { status: 500 });

  await supabase.from("agreement_history").insert({
    document_id: resolved.document.id,
    action: "vendor_link_opened",
    actor_employee_id: null,
    actor_name: "Vendor (secure link)",
    note: `Vendor downloaded PDF v${version.version}`,
    meta: { version: version.version, linkId: resolved.linkId },
  });
  await supabase.from("agreement_sharing_logs").insert({
    document_id: resolved.document.id,
    channel: "vendor_link",
    provider: "token_link",
    status: "sent",
    actor_employee_id: null,
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${resolved.document.ref_no}-v${version.version}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
