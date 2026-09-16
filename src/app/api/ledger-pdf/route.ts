import { NextResponse } from "next/server";
import { getAuthedEmployee, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { renderLedgerPdf, type LedgerPdfInput } from "@/lib/ledger-pdf";

// 2026-09-15 — "agar ladger bhi pdf bhejni ho to pdf to whatsaap or email
// par a4 ke page par portrait me sabhi fixes ke sath jaye company logo ke
// sath" — POST /api/ledger-pdf renders the party's ledger as a real A4-
// portrait PDF file (company logo header — see src/lib/ledger-pdf.tsx).
//
// POST, not GET: the ledger page computes the rows (filters applied, merge
// toggle, running balance) — POSTing them back means the PDF always shows
// EXACTLY what the user was looking at, with zero re-derivation drift.
// The party id comes from the body, but access is re-checked HERE (the
// party must be a real party and the caller must belong to the company the
// ledger was scoped to) — rows are never trusted for authorization.
export async function POST(request: Request) {
  let employee;
  try {
    employee = await getAuthedEmployee();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { partyId?: string; partyName?: string; input?: LedgerPdfInput }
    | null;
  const partyId = body?.partyId;
  const incoming = body?.input;
  if (!partyId || !incoming || !Array.isArray(incoming.rows)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data: partyRow } = await supabase
    .from("parties")
    .select("id, name, party_type, contact_no, email, gst")
    .eq("id", partyId)
    .maybeSingle();
  if (!partyRow) {
    return NextResponse.json({ ok: false, error: "Party not found." }, { status: 404 });
  }

  // Company scope: the ledger's scopeLine names the company/companies the
  // view was built from; the caller must have access to the company the
  // ledger was scoped to. The simplest sound gate: the caller must be able
  // to see this party AT ALL — which in this app means the party has bills
  // in one of the caller's companies. Check through bill_pass_register so
  // a scoped-out party id can't be PDFed by guessing ids.
  const scopeCompanyIds = Array.from(
    new Set([employee.currentCompanyId, ...(incoming.scopeLine.includes("All companies") ? employee.companyIds : [])])
  );
  const { data: anyBill, error: billErr } = await supabase
    .from("bill_pass_register")
    .select("id")
    .eq("party_id", partyId)
    .in("company_id", scopeCompanyIds)
    .limit(1);
  if (billErr || !anyBill || anyBill.length === 0) {
    return NextResponse.json({ ok: false, error: "You don't have access to this party's ledger." }, { status: 403 });
  }

  // Logo: the current company's logo (the ledger's own company scope).
  const { data: company } = await supabase
    .from("companies")
    .select("id, name, logo_url")
    .eq("id", employee.currentCompanyId)
    .maybeSingle();
  const { data: profile } = await supabase
    .from("company_profiles")
    .select("address, phone, email, gstin")
    .eq("company_id", employee.currentCompanyId)
    .maybeSingle();

  // Party fields are RE-READ here — only rows/totals come from the client.
  const input: LedgerPdfInput = {
    ...incoming,
    party: partyRow,
    companyName: company?.name ?? "—",
    logoUrl: company?.logo_url ?? null,
    profile: profile ?? null,
  };

  const buffer = await renderLedgerPdf(input);
  const filename = `ledger-${(partyRow.name || "party").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
