import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { ETSY_LANGUAGES } from "@/lib/etsy/languages";
import { EtsyTranslationsClient, type EtsyProductWithTranslations, type EtsyTranslationRecord } from "./etsy-translations-client";

// 2026-11-17 — Etsy Multilingual Translation & SEO module (page).
// One company-scoped read of the English sources + their saved translations;
// every write goes through ./actions.ts (etsy_translation capability + audit).
// Degrades to a setup card naming the SQL file instead of crashing when the
// tables have not been created yet — same pattern as the B2B module.
export default async function EtsyTranslationsPage() {
  const me = await requireCapability("etsy_translation");
  // 2026-11-17 — etsy_* tables come from db/2026-11-17-etsy-translations.sql and
  // are not in the generated Database type yet (same reason the Inventory
  // module uses the unchecked client — see lib/supabase/server.ts).
  const supabase = createServiceRoleClientUnchecked();

  const { data: products, error } = await supabase
    .from("etsy_products")
    .select("*")
    .eq("company_id", me.currentCompanyId)
    .order("updated_at", { ascending: false });

  const loadError = error ? error.message : null;
  const ids = (products ?? []).map((p) => p.id);

  let translations: EtsyTranslationRecord[] = [];
  if (!loadError && ids.length > 0) {
    const { data, error: trError } = await supabase
      .from("etsy_product_translations")
      .select("*")
      .in("product_id", ids);
    if (trError) {
      return (
        <main className="mx-auto max-w-7xl px-4 py-8">
          <SetupNotice error={trError.message} />
        </main>
      );
    }
    translations = (data ?? []) as EtsyTranslationRecord[];
  }

  const byProduct = new Map<string, EtsyTranslationRecord[]>();
  for (const t of translations) {
    const list = byProduct.get(t.product_id) ?? [];
    list.push(t);
    byProduct.set(t.product_id, list);
  }

  const rows: EtsyProductWithTranslations[] = (products ?? []).map((p) => ({
    id: p.id,
    sku: p.sku,
    product_name: p.product_name,
    original_title: p.original_title,
    original_description: p.original_description,
    original_tags: p.original_tags,
    category: p.category,
    material: p.material,
    size: p.size,
    colour: p.colour,
    technique: p.technique,
    features: p.features,
    updated_at: p.updated_at,
    translations: byProduct.get(p.id) ?? [],
  }));

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-5 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">Etsy Export</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Multilingual Listings &amp; SEO</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          One English source listing → localized Etsy titles, descriptions and exactly 13 SEO tags in{" "}
          {ETSY_LANGUAGES.length} languages. Every language is saved independently, and the English source is never
          overwritten.
        </p>
      </header>
      {loadError ? <SetupNotice error={loadError} /> : <EtsyTranslationsClient products={rows} languages={ETSY_LANGUAGES} />}
    </main>
  );
}

function SetupNotice({ error }: { error: string }) {
  const missing = /does not exist|schema cache|relation/i.test(error);
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
      <h2 className="font-bold">Etsy translation module is not set up yet</h2>
      {missing ? (
        <p className="mt-1">
          Run <code className="rounded bg-white px-1">db/2026-11-17-etsy-translations.sql</code> in Supabase (SQL
          editor), then reload this page. The module keeps every other screen untouched until then.
        </p>
      ) : (
        <p className="mt-1">Database error: {error}</p>
      )}
    </section>
  );
}
