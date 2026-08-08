"use server";

// Courier Bill PDF upload + auto-extract (2026-08-08 round — "COURIOUR KE
// BILL IS TARIKE SE AAYENG TO TRACKING NO KE AGAINST ME KESE ENTRY HOGI
// SYSTEM BATAO"). Two-step flow, same capability ("doc_entry") and same
// underlying tables as the existing manual Courier Bill / Duty & Tax Bill
// entry in actions.ts:
//   1. parseCourierBillPdfAction — reads the uploaded PDF, detects which of
//      the 5 known UPS/FedEx templates it is (src/lib/courier-bills/
//      parsers.ts), matches each shipment to an order by tracking number,
//      and returns everything for on-screen review. NOTHING is written yet.
//   2. commitCourierBillPdfAction — takes the (possibly user-corrected)
//      reviewed data and writes it: one freight_bills/duty_tax_bills header
//      row + one freight_bill_awb_assignments/duty_bill_awb_assignments row
//      per shipment the user confirmed a match for. Any row left unmatched
//      (or where the user didn't fix a wrong auto-match) is simply skipped
//      — "MANUAL BHI HOYE" is satisfied by the review screen letting the
//      user fix/skip any row before this runs, same as typing it in by hand
//      via the existing tabs would.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { extractLayoutText } from "@/lib/courier-bills/pdf-layout";
import { parseCourierBill } from "@/lib/courier-bills/parsers";
import { matchShipmentByTracking } from "@/lib/courier-bills/match";

export type ParsedShipmentReview = {
  trackingNo: string;
  courierRefNo: string | null;
  shipDate: string | null;
  weightKg: number | null;
  dims: string | null;
  consignee: string | null;
  amount: number | null;
  dutyAmt: number | null;
  otherAmt: number | null;
  orderId: string | null;
  orderRefNo: string | null;
  alreadyAssigned: boolean;
};

export type ParsedBillReview = {
  templateId: string;
  courier: "UPS" | "FedEx";
  billCategory: "freight" | "duty";
  invoiceNo: string;
  invoiceDate: string | null;
  totalAmountDue: number | null;
  freightAmt: number | null;
  fuelAmt: number | null;
  otherCharges: number | null;
  dutyTaxAmtInr: number | null;
  gstAmt: number | null;
  computedGross: number | null; // sanity-check display vs. totalAmountDue — never written verbatim
  shipments: ParsedShipmentReview[];
};

export type ParseCourierBillResult = { error: string | null; bill: ParsedBillReview | null };

export async function parseCourierBillPdfAction(formData: FormData): Promise<ParseCourierBillResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file uploaded.", bill: null };
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return { error: "Please upload a PDF file.", bill: null };
  }

  let text: string;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    text = await extractLayoutText(buf);
  } catch (e) {
    return { error: `Could not read this PDF: ${e instanceof Error ? e.message : "unknown error"}`, bill: null };
  }

  const parsed = parseCourierBill(text);
  if (parsed.error || !parsed.bill) return { error: parsed.error ?? "Could not parse this PDF.", bill: null };
  const bill = parsed.bill;

  const shipments: ParsedShipmentReview[] = [];
  for (const s of bill.shipments) {
    const match = await matchShipmentByTracking(supabase, employee.companyIds, bill.billCategory, s.trackingNo);
    shipments.push({
      trackingNo: s.trackingNo,
      courierRefNo: s.courierRefNo,
      shipDate: s.shipDate,
      weightKg: s.weightKg,
      dims: s.dims,
      consignee: s.consignee,
      amount: s.amount,
      dutyAmt: s.dutyAmt,
      otherAmt: s.otherAmt,
      orderId: match.orderId,
      orderRefNo: match.orderRefNo,
      alreadyAssigned: match.alreadyAssigned,
    });
  }

  const computedGross =
    bill.billCategory === "freight"
      ? ((bill.freightAmt ?? 0) + (bill.fuelAmt ?? 0) + (bill.otherCharges ?? 0)) * 1.18
      : (bill.dutyTaxAmtInr ?? 0) + (bill.gstAmt ?? 0);

  return {
    error: null,
    bill: {
      templateId: bill.templateId,
      courier: bill.courier,
      billCategory: bill.billCategory,
      invoiceNo: bill.invoiceNo,
      invoiceDate: bill.invoiceDate,
      totalAmountDue: bill.totalAmountDue,
      freightAmt: bill.freightAmt,
      fuelAmt: bill.fuelAmt,
      otherCharges: bill.otherCharges,
      dutyTaxAmtInr: bill.dutyTaxAmtInr,
      gstAmt: bill.gstAmt,
      computedGross: Math.round(computedGross * 100) / 100,
      shipments,
    },
  };
}

export type CommitShipmentInput = {
  trackingNo: string;
  orderId: string | null; // null = skip this row (unmatched or user chose not to fix it)
  weightKg: number | null;
  amount: number | null; // duty bills: duty_tax_amt_inr for this shipment
  otherAmt: number | null; // duty bills: other_charge for this shipment
};

export type CommitCourierBillInput = {
  billCategory: "freight" | "duty";
  invoiceNo: string;
  invoiceDate: string | null;
  freightAmt: number | null;
  fuelAmt: number | null;
  otherCharges: number | null;
  dutyTaxAmtUsd: number | null;
  dutyTaxAmtInr: number | null;
  gstAmt: number | null;
  shipments: CommitShipmentInput[];
};

export type CommitCourierBillResult = {
  error: string | null;
  success: { docNo: string; assignedCount: number; skippedCount: number } | null;
};

export async function commitCourierBillPdfAction(input: CommitCourierBillInput): Promise<CommitCourierBillResult> {
  const employee = await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const invoiceNo = input.invoiceNo.trim();
  if (!invoiceNo) return { error: "Invoice No. is required.", success: null };
  if (input.shipments.length === 0) return { error: "No shipments to save.", success: null };

  if (input.billCategory === "freight") {
    const { data: bill, error } = await supabase
      .from("freight_bills")
      .insert({
        invoice_no: invoiceNo,
        invoice_date: input.invoiceDate,
        freight_amt: input.freightAmt ?? 0,
        fuel_amt: input.fuelAmt ?? 0,
        other_charges: input.otherCharges ?? 0,
      })
      .select("id, invoice_no")
      .single();

    if (error || !bill) {
      const msg = error?.message.includes("duplicate key") ? "A Courier Bill with that Invoice No. already exists." : error?.message;
      return { error: `Failed to save Courier Bill: ${msg ?? "unknown error"}`, success: null };
    }

    let assigned = 0;
    let skipped = 0;
    for (const s of input.shipments) {
      if (!s.orderId) {
        skipped++;
        continue;
      }
      const { data: order } = await supabase.from("orders").select("id, company_id").eq("id", s.orderId).maybeSingle();
      if (!order || !employee.companyIds.includes(order.company_id)) {
        skipped++;
        continue;
      }
      const { error: aErr } = await supabase.from("freight_bill_awb_assignments").insert({
        freight_bill_id: bill.id,
        order_id: s.orderId,
        bill_weight_kg: s.weightKg,
        remark: `Auto-extracted from PDF (tracking ${s.trackingNo})`,
      });
      if (aErr) skipped++;
      else assigned++;
    }

    revalidatePath("/dashboard/documents");
    return { error: null, success: { docNo: bill.invoice_no, assignedCount: assigned, skippedCount: skipped } };
  }

  const { data: bill, error } = await supabase
    .from("duty_tax_bills")
    .insert({
      invoice_no: invoiceNo,
      invoice_date: input.invoiceDate,
      duty_tax_amt_usd: input.dutyTaxAmtUsd,
      duty_tax_amt_inr: input.dutyTaxAmtInr ?? 0,
      gst_18pct_amt: input.gstAmt ?? 0,
    })
    .select("id, invoice_no")
    .single();

  if (error || !bill) {
    const msg = error?.message.includes("duplicate key") ? "A Duty & Tax Bill with that Invoice No. already exists." : error?.message;
    return { error: `Failed to save Duty & Tax Bill: ${msg ?? "unknown error"}`, success: null };
  }

  let assigned = 0;
  let skipped = 0;
  for (const s of input.shipments) {
    if (!s.orderId) {
      skipped++;
      continue;
    }
    const { data: order } = await supabase.from("orders").select("id, company_id").eq("id", s.orderId).maybeSingle();
    if (!order || !employee.companyIds.includes(order.company_id)) {
      skipped++;
      continue;
    }
    const { error: aErr } = await supabase.from("duty_bill_awb_assignments").insert({
      duty_tax_bill_id: bill.id,
      order_id: s.orderId,
      duty_tax_amt_inr: s.amount,
      other_charge: s.otherAmt,
      remark: `Auto-extracted from PDF (tracking ${s.trackingNo})`,
    });
    if (aErr) skipped++;
    else assigned++;
  }

  revalidatePath("/dashboard/documents");
  return { error: null, success: { docNo: bill.invoice_no, assignedCount: assigned, skippedCount: skipped } };
}
