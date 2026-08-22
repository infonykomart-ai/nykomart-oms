"use server";

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { resyncDispatchSummary } from "@/lib/order-packages/resync-dispatch-summary";
import { SHIPMENT_STATUSES, DELIVERED_STATUSES } from "./columns";

export type TrackingRowResult = {
  row: number;
  refNo: string;
  error: string | null;
};

export type BulkTrackingState = {
  error: string | null;
  results: TrackingRowResult[] | null;
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

/**
 * Bulk Courier Tracking Update via CSV (2026-08-08, pending item 8). Rows
 * match EXISTING orders by Ref No. (PO/RF/RG) — nothing is created here,
 * unlike bulkCreateOrders(). Shipment Status writes to orders.shipment_status
 * directly (the simple status the Orders hub badge shows); AWB/Courier/
 * Delivered Status/Delivered Date/Remark upsert into order_shipments (Gap 1,
 * 2026-08-20 — one row per AWB, targeting the optional "Shipment No" column
 * or defaulting to 1), preserving whatever other fields already exist on
 * that row (only the columns present in this row's data are written), then
 * resync dispatch_invoices' order-level summary from it — see
 * claude/gap1-multipackage-design-2026-08-20.md.
 */
export async function bulkUpdateTracking(_prev: BulkTrackingState, formData: FormData): Promise<BulkTrackingState> {
  const employee = await requireCapability("order_entry");
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
  if (rows.length > MAX_ROWS) {
    return { error: `${rows.length} rows — please upload ${MAX_ROWS} or fewer at a time.`, results: null };
  }

  const byHeader = new Map<string, string>();
  for (const k of headerKeys) byHeader.set(normalizeHeader(k), k);

  const results: TrackingRowResult[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2; // header is row 1 in the file
    const refNo = cellStr(raw, byHeader, "Ref No");

    if (!refNo) {
      results.push({ row: rowNum, refNo: "", error: "Ref No is required." });
      continue;
    }

    const { data: matches, error: findError } = await supabase
      .from("orders")
      .select("id")
      .eq("ref_no", refNo)
      .in("company_id", employee.companyIds);

    if (findError) {
      results.push({ row: rowNum, refNo, error: `Lookup failed: ${findError.message}` });
      continue;
    }
    if (!matches || matches.length === 0) {
      results.push({ row: rowNum, refNo, error: "No order found with this Ref No." });
      continue;
    }
    if (matches.length > 1) {
      results.push({ row: rowNum, refNo, error: "Ambiguous — more than one order matched this Ref No. across your companies." });
      continue;
    }
    const orderId = matches[0].id;

    const shipmentStatusRaw = cellStr(raw, byHeader, "Shipment Status");
    const shipmentStatus = (SHIPMENT_STATUSES as readonly string[]).includes(shipmentStatusRaw) ? shipmentStatusRaw : null;
    if (shipmentStatusRaw && !shipmentStatus) {
      results.push({
        row: rowNum,
        refNo,
        error: `Shipment Status "${shipmentStatusRaw}" is not valid — allowed: ${SHIPMENT_STATUSES.join(", ")}.`,
      });
      continue;
    }

    const deliveredStatusRaw = cellStr(raw, byHeader, "Delivered Status");
    const deliveredStatus = (DELIVERED_STATUSES as readonly string[]).includes(deliveredStatusRaw) ? deliveredStatusRaw : null;
    if (deliveredStatusRaw && !deliveredStatus) {
      results.push({
        row: rowNum,
        refNo,
        error: `Delivered Status "${deliveredStatusRaw}" is not valid — must be "Delivered" or "NOT Delivered".`,
      });
      continue;
    }

    if (shipmentStatus) {
      const { error: statusError } = await supabase
        .from("orders")
        .update({ shipment_status: shipmentStatus as "Order Placed" | "In Production" | "Ready to Ship" | "Shipped" | "In Transit" | "Delivered" | "Returned" | "Cancelled" })
        .eq("id", orderId);
      if (statusError) {
        results.push({ row: rowNum, refNo, error: `Failed to update Shipment Status: ${statusError.message}` });
        continue;
      }
    }

    const awbNo = cellStr(raw, byHeader, "AWB No") || null;
    const courierName = cellStr(raw, byHeader, "Courier Name") || null;
    const deliveredDate = cellStr(raw, byHeader, "Delivered Date") || null;
    const remark = cellStr(raw, byHeader, "Remark") || null;
    // Gap 1 (2026-08-20): defaults to shipment 1 — see the "Shipment No"
    // column's help text in columns.ts and claude/gap1-multipackage-
    // design-2026-08-20.md. Writes order_shipments now, not
    // dispatch_invoices directly, then resyncs the order-level summary.
    const shipmentNoRaw = cellStr(raw, byHeader, "Shipment No");
    const shipmentNo = shipmentNoRaw ? parseInt(shipmentNoRaw, 10) : 1;
    if (!Number.isInteger(shipmentNo) || shipmentNo < 1) {
      results.push({ row: rowNum, refNo, error: `Shipment No "${shipmentNoRaw}" is not a valid positive whole number.` });
      continue;
    }

    if (awbNo || courierName || deliveredStatus || deliveredDate || remark) {
      const { error: upsertError } = await supabase
        .from("order_shipments")
        .upsert(
          {
            order_id: orderId,
            shipment_no: shipmentNo,
            ...(awbNo ? { awb_no: awbNo } : {}),
            ...(courierName ? { courier_name: courierName } : {}),
            ...(deliveredStatus ? { delivered_status: deliveredStatus as "Delivered" | "NOT Delivered" } : {}),
            ...(deliveredDate ? { delivered_date: deliveredDate } : {}),
            ...(remark ? { remark } : {}),
            last_update_date: today,
          },
          { onConflict: "order_id,shipment_no" }
        );
      if (upsertError) {
        results.push({ row: rowNum, refNo, error: `Failed to update tracking details: ${upsertError.message}` });
        continue;
      }
      await resyncDispatchSummary(supabase, orderId);
    }

    results.push({ row: rowNum, refNo, error: null });
  }

  revalidatePath("/dashboard/orders");

  return { error: null, results };
}
