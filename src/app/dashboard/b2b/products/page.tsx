import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { B2BNav } from "../b2b-nav";
import { ProductsClient, type BomView, type ProductView } from "./products-client";

// 2026-10-02d — Product master (spec §2 / §4 / §5): the five export
// product types with AUTO SKUs (CD-1001 / CR-… / JR-… / CK-… / TC-… —
// prefix per type, first number 1001), trade fields + type-specific specs
// (jsonb), the 4 price points with a live profit-margin %, stock with
// min-stock reorder alerts, and a per-SKU BOM editor whose requirement
// preview (qty × consumption × 1+wastage) is the spec §7/§10 engine.
export default async function B2BProductsPage() {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();

  const [productsRes, bomRes] = await Promise.all([
    supabase
      .from("b2b_products")
      .select("*")
      .eq("company_id", me.currentCompanyId)
      .order("product_type")
      .order("name"),
    supabase.from("b2b_bom_items").select("*").eq("company_id", me.currentCompanyId).order("display_order"),
  ]);

  const products: ProductView[] = (productsRes.data ?? []).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    productType: p.product_type,
    category: p.category ?? "",
    collection: p.collection ?? "",
    material: p.material ?? "",
    design: p.design ?? "",
    color: p.color ?? "",
    sizeLabel: p.size_label ?? "",
    lengthCm: Number(p.length_cm ?? 0),
    widthCm: Number(p.width_cm ?? 0),
    gsm: Number(p.gsm ?? 0),
    pieceWeightKg: Number(p.piece_weight_kg ?? 0),
    specs: (p.specs ?? {}) as Record<string, string>,
    unit: p.unit,
    moq: Number(p.moq ?? 0),
    productionDays: Number(p.production_days ?? 0),
    packingType: p.packing_type ?? "",
    piecesPerCarton: Number(p.pieces_per_carton ?? 0),
    cartonLengthCm: Number(p.carton_length_cm ?? 0),
    cartonWidthCm: Number(p.carton_width_cm ?? 0),
    cartonHeightCm: Number(p.carton_height_cm ?? 0),
    fobPrice: Number(p.fob_price ?? 0),
    exwPrice: Number(p.exw_price ?? 0),
    wholesalePrice: Number(p.wholesale_price ?? 0),
    costPrice: Number(p.cost_price ?? 0),
    stockQty: Number(p.stock_qty ?? 0),
    minStockQty: Number(p.min_stock_qty ?? 0),
    active: p.active,
  }));

  const bom: BomView[] = (bomRes.data ?? []).map((b) => ({
    id: b.id,
    productId: b.product_id,
    material: b.material,
    consumption: Number(b.consumption),
    unit: b.unit,
    wastagePercent: Number(b.wastage_percent ?? 0),
  }));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <B2BNav />
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">📦 Product Master</h1>
        <p className="mt-1 text-sm text-slate-500">
          Auto-SKU per type (CD / CR / JR / CK / TC), type-specific specs, 4 price points with live margin, stock + min-stock
          alerts, and a BOM per SKU. New products get their SKU generated on save — leave the field blank.
        </p>
      </header>
      <ProductsClient products={products} bom={bom} />
    </main>
  );
}
