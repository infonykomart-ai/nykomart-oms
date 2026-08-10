"use server";

// Party Master (2026-08-10) — the "party_admin" capability + a
// /dashboard/parties tile have existed since the very first capability
// seed (db/schema.sql), but the actual page was never built — clicking
// the tile 404'd. Every Document Entry form (Debit Note, Washing Entry,
// Purchase Bill) and the raw-material Stock module already reference
// `parties` via a dropdown/lookup, but nothing let you actually manage
// that list — new vendors had to be inserted directly in Supabase.
//
// Same core-function-plus-thin-wrapper pattern as every other module
// (see documents/actions.ts): savePartyCore() is shared by the single-row
// create/edit form (saveParty) and the bulk CSV upload (bulkSaveParties).
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

const PAYMENT_TYPES = new Set(["ADVANCE", "AGAINST BILL", "CASH", "NO BILL", "SALARY"]);
const INVOICE_TYPES = new Set([
  "DUTY TAX",
  "Purchase",
  "FREIGHT INVOICE",
  "Printing",
  "Washing",
  "Disbursement FEE",
  "Service",
  "JOB WORK",
]);

export type PartyInput = {
  name: string;
  partyType: string | null;
  paymentType: string | null;
  invoiceType: string | null;
  address: string | null;
  contactNo: string | null;
  email: string | null;
  gst: string | null;
  remark: string | null;
};

export async function savePartyCore(
  supabase: ServiceClient,
  partyId: string | null,
  input: PartyInput
): Promise<{ error: string | null; id: string | null }> {
  if (!input.name) return { error: "Party Name is required.", id: null };
  if (input.paymentType && !PAYMENT_TYPES.has(input.paymentType)) {
    return { error: `Payment Type must be one of: ${Array.from(PAYMENT_TYPES).join(", ")}.`, id: null };
  }
  if (input.invoiceType && !INVOICE_TYPES.has(input.invoiceType)) {
    return { error: `Invoice Type must be one of: ${Array.from(INVOICE_TYPES).join(", ")}.`, id: null };
  }

  const payload = {
    name: input.name,
    party_type: input.partyType,
    payment_type: input.paymentType as
      | "ADVANCE"
      | "AGAINST BILL"
      | "CASH"
      | "NO BILL"
      | "SALARY"
      | null,
    invoice_type: input.invoiceType as
      | "DUTY TAX"
      | "Purchase"
      | "FREIGHT INVOICE"
      | "Printing"
      | "Washing"
      | "Disbursement FEE"
      | "Service"
      | "JOB WORK"
      | null,
    address: input.address,
    contact_no: input.contactNo,
    email: input.email,
    gst: input.gst,
    remark: input.remark,
  };

  if (partyId) {
    const { error } = await supabase.from("parties").update(payload).eq("id", partyId);
    if (error) return { error: error.message, id: null };
    return { error: null, id: partyId };
  }

  const { data, error } = await supabase.from("parties").insert(payload).select("id").single();
  if (error) {
    // `parties.name` is a UNIQUE citext column — Postgres error code 23505.
    if (error.code === "23505") {
      return { error: `A party named "${input.name}" already exists.`, id: null };
    }
    return { error: error.message, id: null };
  }
  return { error: null, id: data.id };
}

export type PartyFormState = { error: string | null; success: boolean };

export async function saveParty(_prev: PartyFormState, formData: FormData): Promise<PartyFormState> {
  await requireCapability("party_admin");
  const supabase = createServiceRoleClient();

  const partyId = strOrNull(formData, "party_id");
  const result = await savePartyCore(supabase, partyId, {
    name: str(formData, "name"),
    partyType: strOrNull(formData, "party_type"),
    paymentType: strOrNull(formData, "payment_type"),
    invoiceType: strOrNull(formData, "invoice_type"),
    address: strOrNull(formData, "address"),
    contactNo: strOrNull(formData, "contact_no"),
    email: strOrNull(formData, "email"),
    gst: strOrNull(formData, "gst"),
    remark: strOrNull(formData, "remark"),
  });

  if (result.error) return { error: result.error, success: false };
  revalidatePath("/dashboard/parties");
  return { error: null, success: true };
}

export type SimpleResult = { error: string | null; success: boolean };

// Every table that references `parties(id)` — see db/schema.sql. Checked
// before allowing a hard delete, same "block on real FK reference, fall
// back to editing instead" pattern as deleteOrder() in ../orders/actions.ts.
export async function deleteParty(partyId: string): Promise<SimpleResult> {
  await requireCapability("party_admin");
  const supabase = createServiceRoleClient();

  const [orders, purchaseBills, washingEntries, debitNotes, stockItems, stockIn, stockOut, billPass] = await Promise.all([
    supabase.from("orders").select("id").eq("vendor_party_id", partyId).limit(1).maybeSingle(),
    supabase.from("purchase_bills").select("id").eq("vendor_party_id", partyId).limit(1).maybeSingle(),
    supabase.from("washing_entries").select("id").eq("party_id", partyId).limit(1).maybeSingle(),
    supabase.from("debit_notes").select("id").eq("party_id", partyId).limit(1).maybeSingle(),
    supabase.from("stock_items").select("id").eq("source_party_id", partyId).limit(1).maybeSingle(),
    supabase.from("stock_in").select("id").eq("source_party_id", partyId).limit(1).maybeSingle(),
    supabase.from("stock_out").select("id").eq("source_party_id", partyId).limit(1).maybeSingle(),
    supabase.from("bill_pass_register").select("id").eq("party_id", partyId).limit(1).maybeSingle(),
  ]);
  const blocked = [orders, purchaseBills, washingEntries, debitNotes, stockItems, stockIn, stockOut, billPass].some(
    (r) => r.data
  );
  if (blocked) {
    return {
      error: "This party is referenced by existing Orders/Purchase Bills/Washing Entries/Debit Notes/Stock records — it cannot be deleted. Edit its details instead.",
      success: false,
    };
  }

  const { error } = await supabase.from("parties").delete().eq("id", partyId);
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/parties");
  return { error: null, success: true };
}

// ---------------------------------------------------------------------------
// Bulk Party Master upload via CSV/Excel (2026-08-10) — last piece of the
// "CSV upload + template download everywhere" rollout (item 10) besides
// Stock. Each row is create-or-update: an existing party (matched
// case-insensitively by Name, same as the UNIQUE citext column) gets
// updated in place rather than rejected as a duplicate, since re-uploading
// a refreshed vendor list is a normal, expected workflow — unlike Orders/
// Documents, where a duplicate ref/doc number is a real error.
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

const MAX_BULK_PARTY_ROWS = 500;

export type BulkPartyResult = { row: number; name: string; action: "created" | "updated" | null; error: string | null };
export type BulkPartyState = { error: string | null; results: BulkPartyResult[] | null };

export async function bulkSaveParties(_prev: BulkPartyState, formData: FormData): Promise<BulkPartyState> {
  await requireCapability("party_admin");
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
  if (rows.length > MAX_BULK_PARTY_ROWS) {
    return { error: `${rows.length} rows — please upload ${MAX_BULK_PARTY_ROWS} or fewer at a time.`, results: null };
  }

  const byHeader = new Map<string, string>();
  for (const k of headerKeys) byHeader.set(normalizeHeader(k), k);

  const { data: existingParties } = await supabase.from("parties").select("id, name");
  const partyIdByName = new Map((existingParties ?? []).map((p) => [p.name.trim().toLowerCase(), p.id]));

  const results: BulkPartyResult[] = [];

  // Sequential — a CSV can legitimately list the same party name twice
  // (e.g. a correction row further down); processing in order and
  // updating partyIdByName as we go means the second row updates the
  // first row's just-created party instead of colliding on the UNIQUE
  // name constraint.
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2; // header is row 1 in the file

    const name = cellStr(raw, byHeader, "Party Name");
    if (!name) {
      results.push({ row: rowNum, name: "", action: null, error: "Party Name is required." });
      continue;
    }

    const partyType = cellStr(raw, byHeader, "Party Type") || null;
    const paymentType = cellStr(raw, byHeader, "Payment Type") || null;
    const invoiceType = cellStr(raw, byHeader, "Invoice Type") || null;
    const address = cellStr(raw, byHeader, "Address") || null;
    const contactNo = cellStr(raw, byHeader, "Contact No") || null;
    const email = cellStr(raw, byHeader, "Email") || null;
    const gst = cellStr(raw, byHeader, "GST") || null;
    const remark = cellStr(raw, byHeader, "Remark") || null;

    const existingId = partyIdByName.get(name.toLowerCase()) ?? null;

    const result = await savePartyCore(supabase, existingId, {
      name,
      partyType,
      paymentType,
      invoiceType,
      address,
      contactNo,
      email,
      gst,
      remark,
    });

    if (result.error) {
      results.push({ row: rowNum, name, action: null, error: result.error });
      continue;
    }

    if (!existingId && result.id) partyIdByName.set(name.toLowerCase(), result.id);
    results.push({ row: rowNum, name, action: existingId ? "updated" : "created", error: null });
  }

  revalidatePath("/dashboard/parties");
  return { error: null, results };
}
