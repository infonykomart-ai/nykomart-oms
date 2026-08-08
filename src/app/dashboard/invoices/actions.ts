"use server";

import { requireCapability, type AuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { originDeclarationFor } from "@/lib/invoices/origin-declaration";
import { computeDepartmentReferenceNo, isFedEx } from "@/lib/invoices/department-reference";
import { revalidatePath } from "next/cache";

export type InvoiceFormState = {
  error: string | null;
  success: { invoiceId: string; invoiceNo: string } | null;
};

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
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Mirrors fy_label() in db/schema.sql exactly (April = start of Indian FY)
// — kept in sync deliberately rather than round-tripping an RPC call for
// something this cheap; see reserve_next_number()'s own RPC call below for
// the part that genuinely needs to be atomic/server-side.
function fyLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1-12
  const startYear = month < 4 ? year - 1 : year;
  const endYear = month < 4 ? year : year + 1;
  return `${String(startYear).slice(2)}-${String(endYear).slice(2)}`;
}

function formatInvoiceNo(prefix: string, fy: string, num: number): string {
  return `${prefix}-${fy}-${String(num).padStart(3, "0")}`;
}

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

type GenerateInvoiceParams = {
  orderIds: string[];
  shipmentTerm: string;
  csbType: string;
  courierCompany: string;
  destinationCountry: string | null;
  iossNumber: string | null;
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  remark: string | null;
  buyerNameAddressOverride: string | null;
  invoiceDate: string;
};

/**
 * The actual invoice-generation logic — pulled out of generateInvoice() so
 * bulkGenerateInvoices() (CSV upload, below) can run the EXACT same
 * numbering/validation/dispatch-marking for every batch in an uploaded
 * file, same "core function, thin per-caller wrapper" pattern as
 * createOrderCore() in orders/new/actions.ts. See claude/invoice-origin-
 * declarations-and-numbering.md for the full spec this implements.
 */
async function generateInvoiceCore(
  employee: AuthedEmployee,
  supabase: ServiceClient,
  params: GenerateInvoiceParams
): Promise<{ error: string | null; invoice: { id: string; invoice_no: string } | null }> {
  const {
    orderIds,
    shipmentTerm,
    csbType,
    courierCompany,
    destinationCountry,
    iossNumber,
    weightKg,
    lengthCm,
    widthCm,
    heightCm,
    remark,
    buyerNameAddressOverride,
    invoiceDate,
  } = params;

  if (orderIds.length === 0) return { error: "Select at least one order.", invoice: null };
  if (!shipmentTerm) return { error: "Shipment Term is required.", invoice: null };
  if (csbType !== "CSB-V" && csbType !== "CSB-IV") return { error: "CSB type must be CSB-V or CSB-IV.", invoice: null };
  if (!courierCompany) return { error: "Courier Company is required.", invoice: null };

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, company_id, store_id, buyer_name_address, invoice_id, status")
    .in("id", orderIds);
  if (ordersError || !orders || orders.length !== orderIds.length) {
    return { error: "Failed to load selected orders — please try again.", invoice: null };
  }
  if (orders.some((o) => o.invoice_id)) {
    return { error: "One or more of these orders are already used in an invoice.", invoice: null };
  }
  // Pending item 2 (2026-08-08) — defense in depth alongside page.tsx's
  // query filter: a Hold order is blocked from further action, a Cancelled
  // order should never be invoiced.
  if (orders.some((o) => o.status === "Hold" || o.status === "Cancelled")) {
    return { error: "One or more of these orders are on Hold or Cancelled — take them off Hold, or deselect the Cancelled order(s), first.", invoice: null };
  }
  const companyId = orders[0].company_id;
  const storeId = orders[0].store_id;
  if (orders.some((o) => o.company_id !== companyId || o.store_id !== storeId)) {
    return { error: "All selected orders must belong to the same company and store.", invoice: null };
  }
  if (!employee.companyIds.includes(companyId)) {
    return { error: "You don't have access to this company.", invoice: null };
  }

  const [{ data: store }, { data: company }] = await Promise.all([
    supabase.from("stores").select("id, invoice_ref_prefix").eq("id", storeId).single(),
    supabase.from("companies").select("id, master_invoice_prefix").eq("id", companyId).single(),
  ]);
  if (!store?.invoice_ref_prefix) {
    return { error: "This store's invoice prefix is not set — ask an Admin to set it (Company & Items).", invoice: null };
  }
  if (!company?.master_invoice_prefix) {
    return { error: "This company's master invoice prefix is not set — ask an Admin to set it.", invoice: null };
  }

  const fy = fyLabel(invoiceDate);

  const { data: num, error: numError } = await supabase.rpc("reserve_next_number", {
    p_company_id: companyId,
    p_scope: `INVOICE_${store.invoice_ref_prefix}`,
    p_use_fy: true,
    p_as_of_date: invoiceDate,
  });
  if (numError || num == null) return { error: "Failed to reserve invoice number — please try again.", invoice: null };

  const { data: mnum, error: mnumError } = await supabase.rpc("reserve_next_number", {
    p_company_id: companyId,
    p_scope: "MASTER_INVOICE",
    p_use_fy: true,
    p_as_of_date: invoiceDate,
  });
  if (mnumError || mnum == null) return { error: "Failed to reserve master invoice number — please try again.", invoice: null };

  const invoiceNo = formatInvoiceNo(store.invoice_ref_prefix, fy, num);
  const masterInvoiceNo = formatInvoiceNo(company.master_invoice_prefix, fy, mnum);
  const departmentReferenceNo = isFedEx(courierCompany)
    ? computeDepartmentReferenceNo(csbType as "CSB-V" | "CSB-IV", shipmentTerm, invoiceDate)
    : null;

  const { data: invoice, error: insertError } = await supabase
    .from("sales_invoices")
    .insert({
      company_id: companyId,
      store_id: storeId,
      invoice_no: invoiceNo,
      master_invoice_no: masterInvoiceNo,
      invoice_date: invoiceDate,
      shipment_term: shipmentTerm,
      csb_type: csbType,
      courier_company: courierCompany,
      department_reference_no: departmentReferenceNo,
      destination_country: destinationCountry,
      origin_declaration: originDeclarationFor(destinationCountry),
      ioss_number: iossNumber,
      weight_kg: weightKg,
      length_cm: lengthCm,
      width_cm: widthCm,
      height_cm: heightCm,
      buyer_name_address: buyerNameAddressOverride || orders[0].buyer_name_address || "",
      remark,
      created_by_employee_id: employee.id,
    })
    .select("id, invoice_no")
    .single();

  if (insertError || !invoice) {
    return { error: `Failed to save invoice: ${insertError?.message ?? "unknown error"}`, invoice: null };
  }

  const { error: linkError } = await supabase.from("orders").update({ invoice_id: invoice.id }).in("id", orderIds);
  if (linkError) {
    return { error: `Invoice created (${invoice.invoice_no}) but an error occurred while linking the orders — please inform an Admin.`, invoice: null };
  }

  // 2026-08-08: "SABHI ORDER LIST INVOICE VALE SECTION ME DIKHE... JESE HI
  // INVOICE SUBMIT KARE TO USKA AUTOMATIC DISPATCH MARK HO JAYE SABHI JAGH"
  // — the Invoices page no longer requires an order to already be
  // Dispatched/Delivered before it's selectable (see page.tsx), which
  // removes the old manual "edit status first, then come invoice"
  // two-step. In exchange, generating the invoice now marks these orders
  // Dispatched itself, in the same request — status lives on `orders` as a
  // single column read everywhere else (Orders hub, Late Orders filter,
  // WhatsApp button, etc.), so updating it here is enough to reflect
  // "sabhi jagh" without touching any other table. Already-Delivered
  // orders are left alone (never downgraded back to Dispatched); an
  // existing dispatch_date is preserved, only orders that never had one
  // get it defaulted to the invoice date.
  const { data: notYetDispatched } = await supabase
    .from("orders")
    .select("id, dispatch_date")
    .in("id", orderIds)
    .not("status", "in", "(Dispatched,Delivered)");

  if (notYetDispatched && notYetDispatched.length > 0) {
    await Promise.all(
      notYetDispatched.map((o) =>
        supabase
          .from("orders")
          .update({ status: "Dispatched", dispatch_date: o.dispatch_date ?? invoiceDate })
          .eq("id", o.id)
      )
    );
  }

  revalidatePath("/dashboard/invoices");
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/orders/new");
  return { error: null, invoice: { id: invoice.id, invoice_no: invoice.invoice_no } };
}

/**
 * Thin FormData wrapper around generateInvoiceCore — the single-batch
 * generation form (invoice-generate-form.tsx) still calls this exactly as
 * before; only the internals moved.
 */
export async function generateInvoice(_prev: InvoiceFormState, formData: FormData): Promise<InvoiceFormState> {
  const employee = await requireCapability("invoicing");
  const supabase = createServiceRoleClient();

  const result = await generateInvoiceCore(employee, supabase, {
    orderIds: formData.getAll("order_ids").map(String).filter(Boolean),
    shipmentTerm: str(formData, "shipment_term"),
    csbType: str(formData, "csb_type"),
    courierCompany: str(formData, "courier_company"),
    destinationCountry: strOrNull(formData, "destination_country"),
    iossNumber: strOrNull(formData, "ioss_number"),
    // 2026-08-08: "WEIGHT OR DIMENSION KYU NAHI MANG RAHA" — typed in AT
    // invoice time for customs declaration; deliberately a value of its
    // own on sales_invoices, not a read of dispatch_invoices' freight-
    // billing weight/dimensions (filled in separately, later, and can
    // legitimately differ) — see schema.sql's comment on these columns.
    weightKg: numOrNull(formData, "weight_kg"),
    lengthCm: numOrNull(formData, "length_cm"),
    widthCm: numOrNull(formData, "width_cm"),
    heightCm: numOrNull(formData, "height_cm"),
    remark: strOrNull(formData, "remark"),
    buyerNameAddressOverride: strOrNull(formData, "buyer_name_address"),
    invoiceDate: str(formData, "invoice_date") || new Date().toISOString().slice(0, 10),
  });

  if (result.error || !result.invoice) return { error: result.error, success: null };
  return { error: null, success: { invoiceId: result.invoice.id, invoiceNo: result.invoice.invoice_no } };
}

// ============================================================================
// Bulk Invoice Generation via CSV (2026-08-08 — "INVOICE DATA PADA HAI MERE
// PASS JIS JIS ORDER KA BANEGA TO CSV UPLOD OR TAMPLATE DOWNOLAD KA OPTION
// DO"). One CSV row = one order to include in an invoice; rows are grouped
// into batches by the order's (company_id, store_id, ref_no_base) — the
// exact same buyer-batch unit the single-invoice screen already groups by
// (see page.tsx) — and each batch runs through generateInvoiceCore exactly
// once, so a multi-order invoice needs one CSV row per order, all sharing
// the same PO/RF/RG base number. Invoice-level fields (date/term/csb/
// courier/etc.) are read from the FIRST row encountered for each batch —
// if they're repeated identically on every row of that batch (simplest for
// whoever prepares the CSV) that's harmless, only the first is used.
// ============================================================================

function normalizeHeader(h: string): string {
  return h.replace(/\*/g, "").trim().toLowerCase();
}
function cellStr(row: Record<string, unknown>, byHeader: Map<string, string>, label: string): string {
  const key = byHeader.get(normalizeHeader(label));
  if (!key) return "";
  const v = row[key];
  return v === null || v === undefined ? "" : String(v).trim();
}

const MAX_BULK_INVOICE_ROWS = 500;

export type BulkInvoiceResult = { row: number; refNo: string; invoiceNo: string | null; error: string | null };
export type BulkInvoiceState = { error: string | null; results: BulkInvoiceResult[] | null };

export async function bulkGenerateInvoices(_prev: BulkInvoiceState, formData: FormData): Promise<BulkInvoiceState> {
  const employee = await requireCapability("invoicing");
  const supabase = createServiceRoleClient();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV or Excel file first.", results: null };
  }

  let rows: Record<string, unknown>[];
  let headerKeys: string[];
  try {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }) as Record<string, unknown>[];
    const headerRow = (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as string[][])[0];
    headerKeys = headerRow ?? (rows.length ? Object.keys(rows[0]) : []);
  } catch {
    return {
      error: "Could not read that file — make sure it's the CSV/Excel template, unmodified in structure.",
      results: null,
    };
  }

  if (!rows.length) return { error: "No data rows found in the file.", results: null };
  if (rows.length > MAX_BULK_INVOICE_ROWS) {
    return { error: `${rows.length} rows — please upload ${MAX_BULK_INVOICE_ROWS} or fewer at a time.`, results: null };
  }

  const byHeader = new Map<string, string>();
  for (const k of headerKeys) byHeader.set(normalizeHeader(k), k);

  // Resolve every row's order FIRST (read-only), so a bad PO/RF/RG number
  // fails just that row without touching the database — only rows that
  // resolve get grouped into batches and actually processed below.
  type ResolvedRow = {
    rowNum: number;
    refNo: string;
    orderId: string;
    companyId: string;
    storeId: string;
    refNoBase: string;
    fields: GenerateInvoiceParams;
  };
  const resolved: ResolvedRow[] = [];
  const rowErrors: BulkInvoiceResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // header is row 1
    const raw = rows[i];
    const refNo = cellStr(raw, byHeader, "PO/RF/RG No.");
    if (!refNo) {
      rowErrors.push({ row: rowNum, refNo: "", invoiceNo: null, error: "PO/RF/RG No. is required." });
      continue;
    }

    const { data: order } = await supabase
      .from("orders")
      .select("id, company_id, store_id, ref_no_base, buyer_name_address, invoice_id, status")
      .ilike("ref_no", refNo)
      .in("company_id", employee.companyIds)
      .maybeSingle();

    if (!order) {
      rowErrors.push({ row: rowNum, refNo, invoiceNo: null, error: `No order found for "${refNo}".` });
      continue;
    }
    if (order.invoice_id) {
      rowErrors.push({ row: rowNum, refNo, invoiceNo: null, error: "This order already has an invoice." });
      continue;
    }
    if (order.status === "Hold" || order.status === "Cancelled") {
      rowErrors.push({ row: rowNum, refNo, invoiceNo: null, error: `Order is ${order.status} — cannot invoice.` });
      continue;
    }

    const csbType = cellStr(raw, byHeader, "CSB Type");
    resolved.push({
      rowNum,
      refNo,
      orderId: order.id,
      companyId: order.company_id,
      storeId: order.store_id,
      refNoBase: order.ref_no_base ?? refNo,
      fields: {
        orderIds: [],
        shipmentTerm: cellStr(raw, byHeader, "Shipment Term"),
        csbType,
        courierCompany: cellStr(raw, byHeader, "Courier Company"),
        destinationCountry: cellStr(raw, byHeader, "Destination Country") || null,
        iossNumber: cellStr(raw, byHeader, "IOSS Number") || null,
        weightKg: cellStr(raw, byHeader, "Weight (kg)") ? Number(cellStr(raw, byHeader, "Weight (kg)")) : null,
        lengthCm: cellStr(raw, byHeader, "Length (cm)") ? Number(cellStr(raw, byHeader, "Length (cm)")) : null,
        widthCm: cellStr(raw, byHeader, "Width (cm)") ? Number(cellStr(raw, byHeader, "Width (cm)")) : null,
        heightCm: cellStr(raw, byHeader, "Height (cm)") ? Number(cellStr(raw, byHeader, "Height (cm)")) : null,
        remark: cellStr(raw, byHeader, "Remark") || null,
        buyerNameAddressOverride: cellStr(raw, byHeader, "Buyer Name & Address Override") || null,
        invoiceDate: cellStr(raw, byHeader, "Invoice Date") || new Date().toISOString().slice(0, 10),
      },
    });
  }

  // Group resolved rows into batches — same company+store+ref_no_base,
  // exactly what the single-invoice screen groups by. Field values come
  // from the first row seen for each batch key.
  const batchOrder: string[] = [];
  const batches = new Map<string, ResolvedRow[]>();
  for (const r of resolved) {
    const key = `${r.companyId}|${r.storeId}|${r.refNoBase}`;
    if (!batches.has(key)) {
      batches.set(key, []);
      batchOrder.push(key);
    }
    batches.get(key)!.push(r);
  }

  // Sequential — reserve_next_number() must reserve in a stable order, same
  // reasoning as bulkCreateOrders() in orders/new/actions.ts.
  const results: BulkInvoiceResult[] = [...rowErrors];
  for (const key of batchOrder) {
    const groupRows = batches.get(key)!;
    const first = groupRows[0];
    const result = await generateInvoiceCore(employee, supabase, {
      ...first.fields,
      orderIds: groupRows.map((r) => r.orderId),
    });
    for (const r of groupRows) {
      results.push({
        row: r.rowNum,
        refNo: r.refNo,
        invoiceNo: result.invoice?.invoice_no ?? null,
        error: result.error,
      });
    }
  }

  results.sort((a, b) => a.row - b.row);
  return { error: null, results };
}

/**
 * Post-generation edits — invoice text (origin declaration, dept ref no.,
 * IOSS, buyer address, remark) stays editable after generation, same
 * "never auto-locked" principle as HR Letters/Certificates, but here it's
 * persisted (an invoice number is a real legal/tax document reference,
 * unlike a certificate — losing edits on refresh would be a real problem).
 */
export type SimpleResult = { error: string | null; success: boolean };

/**
 * 2026-08-07: "galat invoice ban gaya ya galat PO/RF/RG se ban gaya jiska
 * banna nahi tha uska bhi delete chahiye" — deleting a wrong/duplicate
 * invoice must ALSO free up the orders it was generated from, otherwise
 * they'd stay stuck showing as already-invoiced (orders.invoice_id set)
 * forever with no way to invoice them again. So: null out invoice_id on
 * every order pointing at this invoice FIRST (they reappear in "Ready to
 * invoice" on the Invoices page immediately), then delete the invoice row.
 * Nothing else references sales_invoices by a real foreign key — Credit
 * Notes/Debit Notes only store invoice_no as free text (a copy, not a
 * link, see db/schema.sql section 9) — so there's no other guard needed.
 */
export async function deleteInvoice(invoiceId: string): Promise<SimpleResult> {
  const employee = await requireCapability("invoicing");
  const supabase = createServiceRoleClient();

  const { data: invoice } = await supabase.from("sales_invoices").select("id, company_id").eq("id", invoiceId).single();
  if (!invoice || !employee.companyIds.includes(invoice.company_id)) {
    return { error: "Invoice not found or you don't have access to this company.", success: false };
  }

  const { error: unlinkError } = await supabase.from("orders").update({ invoice_id: null }).eq("invoice_id", invoiceId);
  if (unlinkError) return { error: `Could not unlink orders from this invoice: ${unlinkError.message}`, success: false };

  const { error } = await supabase.from("sales_invoices").delete().eq("id", invoiceId);
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/invoices");
  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  return { error: null, success: true };
}

export async function updateInvoiceFields(
  invoiceId: string,
  fields: {
    buyer_name_address?: string;
    destination_country?: string | null;
    origin_declaration?: string | null;
    department_reference_no?: string | null;
    ioss_number?: string | null;
    weight_kg?: number | null;
    length_cm?: number | null;
    width_cm?: number | null;
    height_cm?: number | null;
    remark?: string | null;
  }
): Promise<{ error: string | null }> {
  await requireCapability("invoicing");
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("sales_invoices").update(fields).eq("id", invoiceId);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  return { error: null };
}
