"use server";

// Bulk Vendor Assignment — 2026-09-13. "Vendor Assignment (assign to
// party) me ek sath agar 100-200 po par ek sath party assign karna ho to
// kese karenge. abhi to ek ek po rf rg ke against me hota hai isko modify
// karo."
//
// One CSV, one party, N Ref Nos → for each matched order the SAME thing
// the order page's "+ Assign to a Party" button does (createVendorAssignment
// in ../vendor-assignment-actions.ts): a new order_vendor_assignments
// cycle + the orders.vendor_party_id / vendor_date / received_date mirror.
// That core is deliberately NOT re-implemented here — it's exported from
// vendor-assignment-actions.ts and called per matched order, so the
// cycle-numbering and mirror semantics can never drift between the single
// and bulk paths.
//
// Party may also be chosen by exact name (Party Name column) so the file
// is fillable from a vendor list without ids; a Party dropdown on the form
// fills the file's blank Party Name cells (dropdown wins only when the
// cell is blank, so a mixed file still works).
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { createVendorAssignment } from "../vendor-assignment-actions";

export type VendorAssignRowResult = {
  row: number;
  refNo: string;
  error: string | null;
};

export type BulkVendorAssignState = {
  error: string | null;
  results: VendorAssignRowResult[] | null;
  assigned: number | null;
  partyLabel: string | null;
};

const MAX_ROWS = 500;

function normalizeHeader(h: string): string {
  return h.replace(/\*/g, "").trim().toLowerCase();
}

function cellStr(row: Record<string, unknown>, byHeader: Map<string, string>, label: string): string {
  const key = byHeader.get(normalizeHeader(label));
  if (!key) return "";
  const v = row[key];
  return v === null || v === undefined ? "" : String(v).trim();
}

export async function bulkAssignVendor(_prev: BulkVendorAssignState, formData: FormData): Promise<BulkVendorAssignState> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV or Excel file first.", results: null, assigned: null, partyLabel: null };
  }
  const dropdownPartyId = String(formData.get("party_id") ?? "").trim();
  const fallbackDate = String(formData.get("assigned_date") ?? "").trim();

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
    return { error: "Could not read that file — make sure it's the CSV/Excel template, unmodified in structure.", results: null, assigned: null, partyLabel: null };
  }

  if (!rows.length) return { error: "No data rows found in the file.", results: null, assigned: null, partyLabel: null };
  if (rows.length > MAX_ROWS) {
    return { error: `${rows.length} rows — please upload ${MAX_ROWS} or fewer at a time.`, results: null, assigned: null, partyLabel: null };
  }

  const byHeader = new Map<string, string>();
  for (const k of headerKeys) byHeader.set(normalizeHeader(k), k);

  // Resolve the party once: dropdown id first, else each row's Party Name.
  // (Same plain follow-up lookup as listVendorAssignments — the hand-rolled
  // Database type doesn't emit precise enough relationship metadata for
  // embedded joins.)
  const { data: parties } = await supabase.from("parties").select("id, name");
  const partyIdByName = new Map((parties ?? []).map((p) => [p.name.trim().toLowerCase(), p.id]));

  const results: VendorAssignRowResult[] = new Array(rows.length);
  const refNos = Array.from(new Set(rows.map((raw) => cellStr(raw, byHeader, "Ref No")).filter((r): r is string => !!r)));

  // One batched Ref No → order lookup (ambiguous-across-companies rule
  // identical to bulkUpdateTracking's), instead of one query per row.
  const ordersByRefNo = new Map<string, { id: string }[]>();
  if (refNos.length > 0) {
    const { data: orderMatches, error: lookupError } = await supabase
      .from("orders")
      .select("id, ref_no")
      .in("ref_no", refNos)
      .in("company_id", employee.companyIds);
    if (lookupError) {
      return { error: `Order lookup failed: ${lookupError.message}`, results: null, assigned: null, partyLabel: null };
    }
    for (const o of orderMatches ?? []) {
      const list = ordersByRefNo.get(o.ref_no) ?? [];
      list.push({ id: o.id });
      ordersByRefNo.set(o.ref_no, list);
    }
  }

  type RowPlan = { index: number; rowNum: number; refNo: string; orderId: string; partyId: string; date: string; remark: string | null };
  const plans: RowPlan[] = [];
  const usedPartyIds = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2; // header is row 1
    const refNo = cellStr(raw, byHeader, "Ref No");
    if (!refNo) {
      results[i] = { row: rowNum, refNo: "", error: "Ref No is required." };
      continue;
    }
    const matches = ordersByRefNo.get(refNo) ?? [];
    if (matches.length === 0) {
      results[i] = { row: rowNum, refNo, error: "No order found with this Ref No." };
      continue;
    }
    if (matches.length > 1) {
      results[i] = { row: rowNum, refNo, error: "Ambiguous — more than one order matched this Ref No. across your companies." };
      continue;
    }

    // Party: the file's own Party Name wins; the form dropdown fills blanks.
    const partyNameCell = cellStr(raw, byHeader, "Party Name");
    const partyId = partyNameCell ? partyIdByName.get(partyNameCell.toLowerCase()) : dropdownPartyId || "";
    if (!partyId) {
      results[i] = {
        row: rowNum,
        refNo,
        error: partyNameCell ? `No party named "${partyNameCell}" found in Party Master.` : "No party — fill Party Name in the file or pick one above the upload.",
      };
      continue;
    }

    const date = cellStr(raw, byHeader, "Assigned Date") || fallbackDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      results[i] = { row: rowNum, refNo, error: "Assigned Date must be YYYY-MM-DD (or pick a default date above the upload)." };
      continue;
    }

    usedPartyIds.add(partyId);
    plans.push({
      index: i,
      rowNum,
      refNo,
      orderId: matches[0].id,
      partyId,
      date,
      remark: cellStr(raw, byHeader, "Remark") || null,
    });
  }

  // Sequential on purpose: createVendorAssignment computes cycle_no as
  // max-existing+1 per order and mirrors onto orders — running the same
  // order's rows concurrently could race two cycles onto one order. 500
  // single-row server-action calls stay well inside Vercel's limits (each
  // is a couple of small statements; the 60s cap applies to the whole
  // action, and the per-row work here is tiny).
  let assigned = 0;
  for (const plan of plans) {
    const res = await createVendorAssignment(plan.orderId, plan.partyId, plan.date, plan.remark);
    if (res.error) {
      results[plan.index] = { row: plan.rowNum, refNo: plan.refNo, error: res.error };
    } else {
      assigned++;
      results[plan.index] = { row: plan.rowNum, refNo: plan.refNo, error: null };
    }
  }

  // Revalidate the orders we actually touched.
  revalidatePath("/dashboard/orders");

  const partyLabel =
    usedPartyIds.size === 1
      ? (parties ?? []).find((p) => p.id === Array.from(usedPartyIds)[0])?.name ?? null
      : usedPartyIds.size > 1
        ? `${usedPartyIds.size} different parties (from the file)`
        : null;

  return { error: null, results, assigned, partyLabel };
}
