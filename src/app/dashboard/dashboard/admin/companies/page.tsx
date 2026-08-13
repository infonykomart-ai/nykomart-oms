import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { CompanyItemAdmin } from "./company-item-admin";

// Company & Item Admin (round 11) — see actions.ts header comment.
export default async function CompanyItemAdminPage() {
  await requireCapability("company_item_admin");
  const supabase = await createClient();

  const [{ data: companies }, { data: itemCategories }, { data: sizes }] = await Promise.all([
    supabase.from("companies").select("id, name, short_code, ref_prefix, master_invoice_prefix, active, weekly_off_days").order("name"),
    supabase.from("item_categories").select("id, name, hsn_code, harmonized_tariff_number").order("name"),
    supabase.from("sizes").select("id, label").order("label"),
  ]);

  const companyRows = (companies ?? []).map((c) => ({ ...c, weekly_off_days: (c.weekly_off_days ?? []) as number[] }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">🏢 Company & Item Admin</h1>
        <p className="mt-1 text-sm text-slate-500">
          Add new companies, item categories, and sizes — these show up immediately in every dropdown across the
          app (Order Entry, Document Entry, Stock, etc.).
        </p>
      </div>

      <CompanyItemAdmin companies={companyRows} itemCategories={itemCategories ?? []} sizes={sizes ?? []} />
    </div>
  );
}
