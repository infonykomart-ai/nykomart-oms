"use server";

// Stock module (raw material) — 2026-08-10. The `stock_entry` capability +
// a /dashboard/stock tile have existed since the original capability seed
// (db/schema.sql), but the page was never built — clicking the tile 404'd,
// discovered while building Party Master. Unlike every other module so
// far, there was no existing single-entry UI to extend here (no prior
// "Modify Stock" screen) — this is a ground-up build across 3 tables:
// stock_items (catalog), stock_in, stock_out (see db/schema.sql SECTION 10
// for the full comment on why CURRENT STOCK is a view, never stored).
//
// Same core-function-plus-thin-wrapper pattern as every other module —
// saveStockInCore()/saveStockOutCore() are shared by the single-row forms
// and the bulk CSV upload.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}
function numOrNull(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Ensures a stock_items catalog row exists for this Source+SKU (the old
// "Stock Master" sheet) — called from both Stock In and Stock Out, since
// either can be the first time a SKU is seen for a given source. Updates
// product_name if a non-empty one is supplied and the catalog row didn't
// have one yet, so the first entry to name a SKU "wins" without clobbering
// a name someone already set.
async function upsertStockItemCore(
  supabase: ServiceClient,
  sourcePartyId: string,
  skuCode: string,
  productName: string | null
): Promise<{ error: string | null }> {
  const { data: existing } = await supabase
    .from("stock_items")
    .select("id, product_name")
    .eq("source_party_id", sourcePartyId)
    .eq("sku_code", skuCode)
    .maybeSingle();

  if (!existing) {
    const { error } = await supabase
      .from("stock_items")
      .insert({ source_party_id: sourcePartyId, sku_code: skuCode, product_name: productName });
    return { error: error ? error.message : null };
  }
  if (productName && !existing.product_name) {
    const { error } = await supabase.from("stock_items").update({ product_name: productName }).eq("id", existing.id);
    return { error: error ? error.message : null };
  }
  return { error: null };
}

// -----------------------------------------------------------------------
// Stock In
// -----------------------------------------------------------------------

export type StockInInput = {
  sourcePartyId: string;
  skuCode: string;
  productName: string | null;
  chalanNo: string | null;
  inDate: string | null;
  quantityIn: number | null;
  ratePerQty: number | null;
  partyChalanNo: string | null;
  ourChalanNo: string | null;
  billNo: string | null;
  billDate: string | null;
  paidDate: string | null;
  remark: string | null;
};

// `requireChalan` is true for the single-entry form (the user's own hard
// rule — "no stock movement without a chalan") and false for bulk CSV
// backfill of historical stock, which predates that rule — see
// stock_in.chalan_no's comment in db/schema.sql.
export async function saveStockInCore(
  supabase: ServiceClient,
  rowId: string | null,
  input: StockInInput,
  requireChalan: boolean
): Promise<{ error: string | null; id: string | null }> {
  if (!input.sourcePartyId) return { error: "Source is required.", id: null };
  if (!input.skuCode) return { error: "SKU Code is required.", id: null };
  if (input.quantityIn === null) return { error: "Quantity In is required.", id: null };
  if (requireChalan && !input.chalanNo) return { error: "Chalan No. is required.", id: null };

  const itemResult = await upsertStockItemCore(supabase, input.sourcePartyId, input.skuCode, input.productName);
  if (itemResult.error) return { error: itemResult.error, id: null };

  const payload = {
    source_party_id: input.sourcePartyId,
    sku_code: input.skuCode,
    product_name: input.productName,
    chalan_no: input.chalanNo,
    in_date: input.inDate,
    quantity_in: input.quantityIn,
    rate_per_qty: input.ratePerQty,
    party_chalan_no: input.partyChalanNo,
    our_chalan_no: input.ourChalanNo,
    bill_no: input.billNo,
    bill_date: input.billDate,
    paid_date: input.paidDate,
    remark: input.remark,
  };

  if (rowId) {
    const { error } = await supabase.from("stock_in").update(payload).eq("id", rowId);
    if (error) return { error: error.message, id: null };
    return { error: null, id: rowId };
  }

  const { data, error } = await supabase.from("stock_in").insert(payload).select("id").single();
  if (error) return { error: error.message, id: null };
  return { error: null, id: data.id };
}

export type StockFormState = { error: string | null; success: boolean };

export async function saveStockIn(_prev: StockFormState, formData: FormData): Promise<StockFormState> {
  await requireCapability("stock_entry");
  const supabase = createServiceRoleClient();

  const rowId = strOrNull(formData, "row_id");
  const result = await saveStockInCore(
    supabase,
    rowId,
    {
      sourcePartyId: str(formData, "source_party_id"),
      skuCode: str(formData, "sku_code"),
      productName: strOrNull(formData, "product_name"),
      chalanNo: strOrNull(formData, "chalan_no"),
      inDate: strOrNull(formData, "in_date"),
      quantityIn: numOrNull(formData, "quantity_in"),
      ratePerQty: numOrNull(formData, "rate_per_qty"),
      partyChalanNo: strOrNull(formData, "party_chalan_no"),
      ourChalanNo: strOrNull(formData, "our_chalan_no"),
      billNo: strOrNull(formData, "bill_no"),
      billDate: strOrNull(formData, "bill_date"),
      paidDate: strOrNull(formData, "paid_date"),
      remark: strOrNull(formData, "remark"),
    },
    /* requireChalan */ true
  );

  if (result.error) return { error: result.error, success: false };
  revalidatePath("/dashboard/stock");
  return { error: null, success: true };
}

export type SimpleResult = { error: string | null; success: boolean };

export async function deleteStockIn(rowId: string): Promise<SimpleResult> {
  await requireCapability("stock_entry");
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("stock_in").delete().eq("id", rowId);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/stock");
  return { error: null, success: true };
}

// -----------------------------------------------------------------------
// Stock Out
// -----------------------------------------------------------------------

export type StockOutInput = {
  sourcePartyId: string;
  skuCode: string;
  productName: string | null;
  chalanNo: string | null;
  outDate: string | null;
  quantityOut: number | null;
  remark: string | null;
};

export async function saveStockOutCore(
  supabase: ServiceClient,
  rowId: string | null,
  input: StockOutInput,
  requireChalan: boolean
): Promise<{ error: string | null; id: string | null }> {
  if (!input.sourcePartyId) return { error: "Source is required.", id: null };
  if (!input.skuCode) return { error: "SKU Code is required.", id: null };
  if (input.quantityOut === null) return { error: "Quantity Out is required.", id: null };
  if (requireChalan && !input.chalanNo) return { error: "Chalan No. is required.", id: null };

  const itemResult = await upsertStockItemCore(supabase, input.sourcePartyId, input.skuCode, input.productName);
  if (itemResult.error) return { error: itemResult.error, id: null };

  const payload = {
    source_party_id: input.sourcePartyId,
    sku_code: input.skuCode,
    product_name: input.productName,
    chalan_no: input.chalanNo,
    out_date: input.outDate,
    quantity_out: input.quantityOut,
    remark: input.remark,
  };

  if (rowId) {
    const { error } = await supabase.from("stock_out").update(payload).eq("id", rowId);
    if (error) return { error: error.message, id: null };
    return { error: null, id: rowId };
  }

  const { data, error } = await supabase.from("stock_out").insert(payload).select("id").single();
  if (error) return { error: error.message, id: null };
  return { error: null, id: data.id };
}

export async function saveStockOut(_prev: StockFormState, formData: FormData): Promise<StockFormState> {
  await requireCapability("stock_entry");
  const supabase = createServiceRoleClient();

  const rowId = strOrNull(formData, "row_id");
  const result = await saveStockOutCore(
    supabase,
    rowId,
    {
      sourcePartyId: str(formData, "source_party_id"),
      skuCode: str(formData, "sku_code"),
      productName: strOrNull(formData, "product_name"),
      chalanNo: strOrNull(formData, "chalan_no"),
      outDate: strOrNull(formData, "out_date"),
      quantityOut: numOrNull(formData, "quantity_out"),
      remark: strOrNull(formData, "remark"),
    },
    /* requireChalan */ true
  );

  if (result.error) return { error: result.error, success: false };
  revalidatePath("/dashboard/stock");
  return { error: null, success: true };
}

export async function deleteStockOut(rowId: string): Promise<SimpleResult> {
  await requireCapability("stock_entry");
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("stock_out").delete().eq("id", rowId);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/stock");
  return { error: null, success: true };
}

// ---------------------------------------------------------------------------
// Bulk Stock In / Stock Out upload via CSV/Excel — last piece of item 10's
// "CSV upload + template download everywhere" rollout. Unlike Party Master,
// a duplicate row here is NOT an update-in-place — every Stock In/Out row
// is its own ledger movement (like Orders/Document Entry), so re-uploading
// the same file twice creates two movements, same as entering it twice by
// hand. chalan_no is NOT required in bulk uploads — see saveStockInCore's
// requireChalan param and stock_in.chalan_no's schema comment.
// ---------------------------------------------------------------------------

function normalizeHeader(h: string): string {
  return h.replace(/\*/g, "").trim().toLowerCase();
}

function cellStr(row: Record<string, unknown>, byHeader: Map<string, string>, label: string): string {
  const key = byHeader.get(normalizeHeader(label));
  if (!key) return "";
  const v = row[key];
  return v === null || v === undefined ? "" : String(v).trim();
}

function cellNum(row: Record<string, unknown>, byHeader: Map<string, string>, label: string): number | null {
  const v = cellStr(row, byHeader, label);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const MAX_BULK_STOCK_ROWS = 1000;

export type BulkStockResult = { row: number; sku: string; action: "created" | null; error: string | null };
export type BulkStockState = { error: string | null; results: BulkStockResult[] | null };

async function readBulkFile(
  file: FormDataEntryValue | null
): Promise<{ rows: Record<string, unknown>[]; headerKeys: string[] } | { error: string }> {
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV or Excel file first." };
  try {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }) as Record<string, unknown>[];
    const headerRow = (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as string[][])[0];
    const headerKeys = headerRow ?? (rows.length ? Object.keys(rows[0]) : []);
    return { rows, headerKeys };
  } catch {
    return { error: "Could not read that file — make sure it's the CSV/Excel template, unmodified in structure." };
  }
}

export async function bulkSaveStockIn(_prev: BulkStockState, formData: FormData): Promise<BulkStockState> {
  await requireCapability("stock_entry");
  const supabase = createServiceRoleClient();

  const parsed = await readBulkFile(formData.get("file"));
  if ("error" in parsed) return { error: parsed.error, results: null };
  const { rows, headerKeys } = parsed;
  if (!rows.length) return { error: "No data rows found in the file.", results: null };
  if (rows.length > MAX_BULK_STOCK_ROWS) {
    return { error: `${rows.length} rows — please upload ${MAX_BULK_STOCK_ROWS} or fewer at a time.`, results: null };
  }

  const byHeader = new Map<string, string>();
  for (const k of headerKeys) byHeader.set(normalizeHeader(k), k);

  const { data: parties } = await supabase.from("parties").select("id, name");
  const partyIdByName = new Map((parties ?? []).map((p) => [p.name.trim().toLowerCase(), p.id]));

  const results: BulkStockResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2;
    const sourceName = cellStr(raw, byHeader, "Source (Party Name)");
    const skuCode = cellStr(raw, byHeader, "SKU Code");

    if (!sourceName || !partyIdByName.has(sourceName.toLowerCase())) {
      results.push({ row: rowNum, sku: skuCode, action: null, error: `Unknown Source party "${sourceName}" — add it in Party Master first.` });
      continue;
    }
    const sourcePartyId = partyIdByName.get(sourceName.toLowerCase())!;

    const result = await saveStockInCore(
      supabase,
      null,
      {
        sourcePartyId,
        skuCode,
        productName: cellStr(raw, byHeader, "Product Name") || null,
        chalanNo: cellStr(raw, byHeader, "Chalan No") || null,
        inDate: cellStr(raw, byHeader, "In Date") || null,
        quantityIn: cellNum(raw, byHeader, "Quantity In"),
        ratePerQty: cellNum(raw, byHeader, "Rate Per Qty"),
        partyChalanNo: cellStr(raw, byHeader, "Party Chalan No") || null,
        ourChalanNo: cellStr(raw, byHeader, "Our Chalan No") || null,
        billNo: cellStr(raw, byHeader, "Bill No") || null,
        billDate: cellStr(raw, byHeader, "Bill Date") || null,
        paidDate: cellStr(raw, byHeader, "Paid Date") || null,
        remark: cellStr(raw, byHeader, "Remark") || null,
      },
      /* requireChalan */ false
    );

    if (result.error) {
      results.push({ row: rowNum, sku: skuCode, action: null, error: result.error });
      continue;
    }
    results.push({ row: rowNum, sku: skuCode, action: "created", error: null });
  }

  revalidatePath("/dashboard/stock");
  return { error: null, results };
}

export async function bulkSaveStockOut(_prev: BulkStockState, formData: FormData): Promise<BulkStockState> {
  await requireCapability("stock_entry");
  const supabase = createServiceRoleClient();

  const parsed = await readBulkFile(formData.get("file"));
  if ("error" in parsed) return { error: parsed.error, results: null };
  const { rows, headerKeys } = parsed;
  if (!rows.length) return { error: "No data rows found in the file.", results: null };
  if (rows.length > MAX_BULK_STOCK_ROWS) {
    return { error: `${rows.length} rows — please upload ${MAX_BULK_STOCK_ROWS} or fewer at a time.`, results: null };
  }

  const byHeader = new Map<string, string>();
  for (const k of headerKeys) byHeader.set(normalizeHeader(k), k);

  const { data: parties } = await supabase.from("parties").select("id, name");
  const partyIdByName = new Map((parties ?? []).map((p) => [p.name.trim().toLowerCase(), p.id]));

  const results: BulkStockResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2;
    const sourceName = cellStr(raw, byHeader, "Source (Party Name)");
    const skuCode = cellStr(raw, byHeader, "SKU Code");

    if (!sourceName || !partyIdByName.has(sourceName.toLowerCase())) {
      results.push({ row: rowNum, sku: skuCode, action: null, error: `Unknown Source party "${sourceName}" — add it in Party Master first.` });
      continue;
    }
    const sourcePartyId = partyIdByName.get(sourceName.toLowerCase())!;

    const result = await saveStockOutCore(
      supabase,
      null,
      {
        sourcePartyId,
        skuCode,
        productName: cellStr(raw, byHeader, "Product Name") || null,
        chalanNo: cellStr(raw, byHeader, "Chalan No") || null,
        outDate: cellStr(raw, byHeader, "Out Date") || null,
        quantityOut: cellNum(raw, byHeader, "Quantity Out"),
        remark: cellStr(raw, byHeader, "Remark") || null,
      },
      /* requireChalan */ false
    );

    if (result.error) {
      results.push({ row: rowNum, sku: skuCode, action: null, error: result.error });
      continue;
    }
    results.push({ row: rowNum, sku: skuCode, action: "created", error: null });
  }

  revalidatePath("/dashboard/stock");
  return { error: null, results };
}
