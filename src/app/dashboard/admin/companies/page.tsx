import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { CompanyItemAdmin } from "./company-item-admin";

// Company & Item Admin (round 11) — see actions.ts header comment.
//
// 2026-09-13 (#3) — added the stores query + company-name join that feeds
// the new Stores tab (add / rename / deactivate stores per company).
// company_name is resolved here (Map join, no embedded-resource join) for
// the same "plain queries type-check reliably with this hand-rolled
// Database type" reason require-capability.ts documents. All stores across
// every company are shown — this is an admin screen, and company_item_admin
// is Admin/MD by default, the same trust level the Companies tab already
// assumes for its own cross-company table.
export default async function CompanyItemAdminPage() {
  await requireCapability("company_item_admin");
  const supabase = await createClient();

  const [{ data: companies }, { data: itemCategories }, { data: sizes }, { data: stores }] = await Promise.all([
    supabase.from("companies").select("id, name, short_code, ref_prefix, master_invoice_prefix, active, weekly_off_days").order("name"),
    supabase.from("item_categories").select("id, name, hsn_code, harmonized_tariff_number").order("name"),
    supabase.from("sizes").select("id, label").order("label"),
    supabase.from("stores").select("id, company_id, name, active, invoice_ref_prefix").order("name"),
  ]);

  const companyRows = (companies ?? []).map((c) => ({ ...c, weekly_off_days: (c.weekly_off_days ?? []) as number[] }));
  const companyName = new Map(companyRows.map((c) => [c.id, c.name]));
  const storeRows = (stores ?? []).map((s) => ({ ...s, company_name: companyName.get(s.company_id) ?? "—" }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">🏢 Company &amp; Item Admin</h1>
        <p className="mt-1 text-sm text-slate-500">
          Add new companies, stores, item categories, and sizes — these show up immediately in every dropdown across the
          app (Order Entry, Document Entry, Stock, Ad Spend, etc.).
        </p>
      </div>

      <CompanyItemAdmin companies={companyRows} itemCategories={itemCategories ?? []} sizes={sizes ?? []} stores={storeRows} />
    </div>
  );
}
