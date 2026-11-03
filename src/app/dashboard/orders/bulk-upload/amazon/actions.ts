"use server";

// 2026-11-03 — "isi formate me bulk order sirf amazon ke dalne ka set kar
// do": Amazon-only bulk order import, in two passes over the SAME uploaded
// file:
//   1. PREVIEW — parse + validate every row, show what would be created and
//      exactly which rows can't be read. Nothing is written.
//   2. CREATE  — the operator presses "Create N orders"; the file is parsed
//      again (deterministic) and only the valid rows are created, each
//      through createOrderCore() — the same PO/RF/RG reservation, buyer
//      batching and currency conversion every other order path uses.
// Preview-before-create is deliberate: creating orders is not something to
// find out about afterwards.
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { parseAmazonOrders } from "@/lib/orders/amazon-import";
import { createOrderCore } from "../../new/actions";

export type AmazonPreviewRow = {
  line: number;
  orderNo: string;
  orderDate: string | null;
  buyer: string;
  size: string;
  qty: number | null;
  amount: number | null;
  currency: string | null;
  remark: string;
  /** Validation problem — the row is skipped on create when set. */
  error: string | null;
};

export type AmazonCreateResult = { line: number; orderNo: string; refNo: string | null; error: string | null };

export type AmazonImportState = {
  error: string | null;
  mode: "preview" | "create" | null;
  shape: string | null;
  issues: string[];
  preview: AmazonPreviewRow[] | null;
  results: AmazonCreateResult[] | null;
};

const EMPTY: AmazonImportState = { error: null, mode: null, shape: null, issues: [], preview: null, results: null };
const MAX_FILE_BYTES = 900_000;
const MAX_ROWS = 200;

async function readSheet(file: FormDataEntryValue | null): Promise<{ aoa: unknown[][] } | { error: string }> {
  if (!(file instanceof File) || file.size === 0) return { error: "Pehle Amazon ka Excel/CSV file choose karo." };
  if (file.size > MAX_FILE_BYTES) return { error: "File ~1MB se bada hai — thodi chhoti file/batch me bhejo." };
  const buf = await file.arrayBuffer();
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt") || name.endsWith(".tsv")) {
    const text = new TextDecoder().decode(buf);
    const XLSX = await import("xlsx");
    const wb = XLSX.read(text, { type: "string", raw: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return { aoa: XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][] };
  }
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "array", raw: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return { error: "Workbook me koi readable sheet nahi mili." };
    return { aoa: XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][] };
  } catch {
    return { error: "Excel file read nahi hui — .xlsx ya .csv me save karke dobara bhejo." };
  }
}

export async function importAmazonOrders(_prev: AmazonImportState, formData: FormData): Promise<AmazonImportState> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const mode = String(formData.get("mode") ?? "preview") === "create" ? "create" : "preview";
  const storeId = String(formData.get("store_id") ?? "").trim();
  const itemCategoryId = String(formData.get("item_category_id") ?? "").trim();
  const fallbackCurrency = String(formData.get("fallback_currency") ?? "USD").trim().toUpperCase() || "USD";

  if (!storeId) return { ...EMPTY, error: "Amazon store select karo." };
  if (!itemCategoryId) return { ...EMPTY, error: "Item Category select karo (sheet me category nahi hoti)." };

  const { data: store } = await supabase.from("stores").select("id, name, company_id").eq("id", storeId).maybeSingle();
  if (!store || !employee.companyIds.includes(store.company_id)) {
    return { ...EMPTY, error: "Selected store is company ke liye available nahi hai." };
  }
  const { data: category } = await supabase.from("item_categories").select("id").eq("id", itemCategoryId).maybeSingle();
  if (!category) return { ...EMPTY, error: "Item Category nahi mili — page refresh karke dobara try karo." };

  const sheet = await readSheet(formData.get("file"));
  if ("error" in sheet) return { ...EMPTY, error: sheet.error };

  const parsed = parseAmazonOrders(sheet.aoa);
  if (!parsed.rows.length) return { ...EMPTY, error: "Is file me koi order row nahi mili.", issues: parsed.issues, shape: parsed.shape };
  if (parsed.rows.length > MAX_ROWS) {
    return {
      ...EMPTY,
      error: `${parsed.rows.length} orders mile — ek baar me ${MAX_ROWS} tak. File ko do hisson me bhejo.`,
      issues: parsed.issues,
      shape: parsed.shape,
    };
  }

  const preview: AmazonPreviewRow[] = parsed.rows.map((row) => {
    const problems: string[] = [];
    if (!row.orderNo) problems.push("Order No missing");
    if (!row.orderDate) problems.push("Order Date missing");
    if (row.qty == null || row.qty <= 0) problems.push("Qty missing");
    if (row.amount == null || row.amount < 0) problems.push("Amount missing");
    return {
      line: row.line,
      orderNo: row.orderNo,
      orderDate: row.orderDate,
      buyer: row.address || row.buyerName,
      size: row.size,
      qty: row.qty,
      amount: row.amount,
      currency: row.currency ?? fallbackCurrency,
      remark: row.remark,
      error: problems.length ? problems.join(" · ") : null,
    };
  });

  if (mode === "preview") {
    return { error: null, mode, shape: parsed.shape, issues: parsed.issues, preview, results: null };
  }

  // CREATE — skip anything already imported (same marketplace order no in
  // this company) so re-uploading a corrected file can't double-book orders.
  const orderNos = Array.from(new Set(parsed.rows.map((r) => r.orderNo).filter(Boolean)));
  const existingByNo = new Map<string, string>();
  for (let i = 0; i < orderNos.length; i += 150) {
    const chunk = orderNos.slice(i, i + 150);
    const { data } = await supabase
      .from("orders")
      .select("ref_no, marketplace_order_no")
      .in("company_id", [store.company_id])
      .in("marketplace_order_no", chunk);
    for (const o of data ?? []) {
      if (o.marketplace_order_no) existingByNo.set(o.marketplace_order_no.trim(), o.ref_no);
    }
  }

  const results: AmazonCreateResult[] = [];
  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const checked = preview[i];
    if (checked.error) {
      results.push({ line: row.line, orderNo: row.orderNo, refNo: null, error: checked.error });
      continue;
    }
    const already = existingByNo.get(row.orderNo.trim());
    if (already) {
      results.push({ line: row.line, orderNo: row.orderNo, refNo: already, error: `Already imported as ${already}` });
      continue;
    }
    const currency = row.currency ?? fallbackCurrency;
    const result = await createOrderCore(employee, supabase, store.company_id, {
      storeId: store.id,
      orderDate: row.orderDate!,
      marketplaceOrderNo: row.orderNo,
      buyerNameAddress: row.address || null,
      contactNo: null,
      manualRefNo: null,
      poDate: null,
      deliveryDate: null,
      estimatedDispatchDate: null,
      emailId: null,
      taxId: null,
      addressType: "Residential",
      remark: row.remark || null,
      items: [
        {
          itemCategoryId,
          skuLabel: row.sku || null,
          sizeLabel: row.size || null,
          qty: row.qty!,
          colour: row.colour || null,
          photoType: null,
          photoUrl: null,
          photoUrls: [],
          tasselFringes: false,
          orderCurrency: currency,
          orderValueOriginal: row.amount!,
          setsCount: null,
          piecesPerSet: null,
          dimensionLength: null,
          dimensionWidth: null,
          dimensionUnit: null,
        },
      ],
      photoUrls: [],
      vatNumber: null,
      eoriNumber: null,
      iossNumber: null,
      destinationCountry: row.country || null,
      buyerAddress1: row.address || null,
      buyerAddress2: null,
      buyerAddress3: null,
      buyerCity: row.city || null,
      buyerState: row.state || null,
      buyerPostalCode: row.postalCode || null,
      vendorPartyId: null,
    });
    results.push({ line: row.line, orderNo: row.orderNo, refNo: result.refNo, error: result.error });
    if (result.refNo) existingByNo.set(row.orderNo.trim(), result.refNo);
  }

  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/orders/bulk-upload/amazon");
  return { error: null, mode, shape: parsed.shape, issues: parsed.issues, preview, results };
}
