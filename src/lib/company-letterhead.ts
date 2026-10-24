// 2026-10-24 — "jo bill jis company me add hua hai report me usi company ka
// letterhead aaye": one loader for the printed letterhead (company name, logo,
// address, GSTIN, phone, email) so every bill sheet shows the SAME details,
// and always the details of the company the document belongs to — never the
// company picked in the top-nav switcher.
//
// Why a resolver and not just `bill.company_id`: purchase_bills carries
// company_id, but freight_bills and duty_tax_bills do NOT — a courier/duty
// bill's owning company is only known from the finance-ledger row it was
// posted as (bill_pass_register.company_id, keyed by source + source_id), or,
// for a bill that was never sent to Finance, from the company of the orders
// its AWBs point at. resolveBillCompanyId() answers that in one place instead
// of every page guessing.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type CompanyLetterhead = {
  id: string;
  name: string;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
};

/**
 * The company's printed identity. Returns null (and the callers simply render
 * no letterhead) when the id is missing or the row can't be read — a sheet
 * must never fail over branding.
 */
export async function loadCompanyLetterhead(supabase: Client, companyId: string | null): Promise<CompanyLetterhead | null> {
  if (!companyId) return null;

  const [{ data: company }, { data: profile }] = await Promise.all([
    supabase.from("companies").select("id, name, logo_url").eq("id", companyId).maybeSingle(),
    supabase
      .from("company_profiles")
      .select("address, phone, email, gstin")
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);

  if (!company) return null;
  return {
    id: company.id,
    name: company.name,
    logo_url: company.logo_url ?? null,
    address: profile?.address ?? null,
    phone: profile?.phone ?? null,
    email: profile?.email ?? null,
    gstin: profile?.gstin ?? null,
  };
}

/**
 * Which company a Courier / Duty bill was entered for.
 *
 * 1. The finance-ledger row is authoritative (source + source_id → company_id)
 *    because that is the company that OWNS the payable.
 * 2. A bill not yet sent to Finance falls back to the company of its orders —
 *    every AWB on it belongs to one company in practice.
 */
export async function resolveBillCompanyId(
  supabase: Client,
  args: { source: "freight_bill" | "duty_tax_bill"; sourceId: string; orderIds?: string[] }
): Promise<string | null> {
  const { data: ledgerRow } = await supabase
    .from("bill_pass_register")
    .select("company_id")
    .eq("source", args.source)
    .eq("source_id", args.sourceId)
    .limit(1)
    .maybeSingle();
  if (ledgerRow?.company_id) return ledgerRow.company_id;

  const orderIds = Array.from(new Set(args.orderIds ?? [])).filter(Boolean);
  if (orderIds.length === 0) return null;
  const { data: orderRow } = await supabase
    .from("orders")
    .select("company_id")
    .in("id", orderIds)
    .limit(1)
    .maybeSingle();
  return orderRow?.company_id ?? null;
}
