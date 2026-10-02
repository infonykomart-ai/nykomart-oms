import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { B2BNav } from "../b2b-nav";
import { EngineClient, type EngineInquiry, type EngineProduct, type EngineBuyer } from "./engine-client";

// 2026-10-02d — QUOTATION ENGINE (spec §4 estimate + §5 costing + §6→§7
// convert): pick an open inquiry, add product lines with qty, and every
// number the spec's calculator list demands computes live — product cost,
// packing, freight (entered, never guessed), other costs, total cost,
// selling value, gross profit, margin %, plus the target-margin suggested
// price for enquiries. Saving writes the engine columns onto the
// inquiry's 1:1 quotation (created if missing); "Convert to Sales Order"
// then runs the §7 step (order no, payment schedule, stock note).
export default async function B2BEnginePage() {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const companyId = me.currentCompanyId;

  const [inquiriesRes, productsRes, buyersRes, ratesRes] = await Promise.all([
    supabase
      .from("b2b_inquiries")
      .select("id, inquiry_no, inquiry_date, buyer_name, buyer_country, buyer_id, status, requirement_notes")
      .eq("company_id", companyId)
      .in("status", ["Open", "In Discussion", "Quotation Sent"])
      .order("inquiry_date", { ascending: false }),
    supabase
      .from("b2b_products")
      .select("id, sku, name, product_type, unit, moq, production_days, wholesale_price, fob_price, cost_price, pieces_per_carton, active")
      .eq("company_id", companyId)
      .eq("active", true)
      .order("name"),
    supabase.from("b2b_buyers").select("id, name, country, currency, payment_terms, shipping_terms").eq("company_id", companyId).eq("active", true).order("name"),
    supabase.from("exchange_rates").select("currency_code, rate_to_inr, effective_from").order("effective_from", { ascending: false }).limit(50),
  ]);

  const inquiries: EngineInquiry[] = (inquiriesRes.data ?? []).map((i) => ({
    id: i.id,
    inquiryNo: i.inquiry_no,
    inquiryDate: i.inquiry_date,
    buyerName: i.buyer_name,
    buyerCountry: i.buyer_country ?? "",
    buyerId: i.buyer_id ?? null,
    requirementNotes: i.requirement_notes ?? "",
  }));

  const products: EngineProduct[] = (productsRes.data ?? []).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    productType: p.product_type,
    unit: p.unit,
    moq: Number(p.moq ?? 0),
    productionDays: Number(p.production_days ?? 0),
    wholesalePrice: Number(p.wholesale_price ?? 0),
    fobPrice: Number(p.fob_price ?? 0),
    costPrice: Number(p.cost_price ?? 0),
    piecesPerCarton: Number(p.pieces_per_carton ?? 0),
  }));

  const buyers: EngineBuyer[] = (buyersRes.data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    country: b.country ?? "",
    currency: b.currency,
    paymentTerms: b.payment_terms ?? "",
    shippingTerms: b.shipping_terms ?? "",
  }));

  // Latest known FX snapshot per currency — prefilled, always editable
  // (the spec's rule: the rate is SNAPSHOTTED on the document, never
  // silently re-derived later).
  const rates: Record<string, number> = {};
  for (const r of ratesRes.data ?? []) {
    if (!(r.currency_code in rates)) rates[r.currency_code] = Number(r.rate_to_inr);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <B2BNav />
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">🧮 Quotation Engine</h1>
        <p className="mt-1 text-sm text-slate-500">
          Sirf product + quantity select karein — costing, freight, margin aur suggested price automatic. Freight/incoterm
          entered values se calculate hota hai (the system never guesses a rate). Save quotation → convert to sales order.
        </p>
      </header>
      <EngineClient inquiries={inquiries} products={products} buyers={buyers} rates={rates} />
    </main>
  );
}
