"use server";

// 2026-10-02d — B2B Export ERP server actions, part 2: sales orders,
// payment schedule, production, QC and export shipments. Same guard
// posture as ./actions.ts and ./erp-actions.ts — requireCapability first,
// company scope on every read/write, audit after a successful write,
// revalidatePath("/dashboard/b2b", "layout").
//
// The AUTO-WORKFLOW triggers the spec asks for live here: creating
// production advances a Confirmed order to "In Production"; completing
// production advances it to "QC"; a fully-passing inspection advances it
// to "Packing"; a shipment advances it through "Booked → In Transit →
// Delivered". Manual updateOrderStatus() always wins (it sets exactly what
// the operator picked) — the triggers only auto-advance forward.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log-audit";
import { revalidatePath } from "next/cache";
import { todayIST } from "@/lib/attendance/ist-date";
import { buildPaymentSchedule, computePacking, ORDER_STATUSES, round2, SHIPMENT_STATUSES } from "@/lib/b2b/erp";
import type { Database } from "@/types/database";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;
type ProductionUpdate = Database["public"]["Tables"]["b2b_productions"]["Update"];
type ShipmentUpdate = Database["public"]["Tables"]["b2b_shipments"]["Update"];

function asPriority(v: string | undefined): "High" | "Normal" | "Low" {
  return v === "High" || v === "Low" ? v : "Normal";
}

export type SaveResult = { ok: true; id: string } | { ok: false; error: string };

function num(v: string | number | undefined | null): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v ?? "");
  return Number.isFinite(n) ? n : 0;
}

function revalidateB2B() {
  revalidatePath("/dashboard/b2b", "layout");
}

async function reserveNo(
  supabase: ServiceClient,
  companyId: string,
  scope: string,
  prefix: string,
  asOfDate: string
): Promise<{ no: string | null; error: string | null }> {
  const fy = await supabase.rpc("fy_label", { p_date: asOfDate });
  if (fy.error) return { no: null, error: `Numbering failed: ${fy.error.message}` };
  const n = await supabase.rpc("reserve_next_number", {
    p_company_id: companyId,
    p_scope: scope,
    p_use_fy: false,
    p_as_of_date: asOfDate,
  });
  if (n.error) return { no: null, error: `Numbering failed: ${n.error.message}` };
  return { no: `${prefix}-${fy.data}-${String(n.data).padStart(4, "0")}`, error: null };
}

// Pipeline order — auto-triggers only ever move an order FORWARD along this.
const ORDER_FLOW: OrderStatusLike[] = [
  "Confirmed",
  "In Production",
  "QC",
  "Packing",
  "Ready to Dispatch",
  "Booked",
  "In Transit",
  "Delivered",
  "Closed",
];
type OrderStatusLike = (typeof ORDER_STATUSES)[number];

function flowIndex(s: string): number {
  const i = ORDER_FLOW.indexOf(s as OrderStatusLike);
  return i === -1 ? -1 : i;
}

async function advanceOrderStatus(supabase: ServiceClient, orderId: string | null, target: OrderStatusLike): Promise<void> {
  if (!orderId) return;
  const { data } = await supabase.from("b2b_sales_orders").select("id, status").eq("id", orderId).maybeSingle();
  if (!data || data.status === "Cancelled") return;
  if (flowIndex(target) > flowIndex(data.status)) {
    await supabase.from("b2b_sales_orders").update({ status: target, updated_at: new Date().toISOString() }).eq("id", orderId);
  }
}

// ═══════════════════════════════ Sales orders ══════════════════════════════

export type OrderLineInput = {
  productId?: string | null;
  description: string;
  qty: string;
  unit?: string;
  unitPrice: string;
  unitCost: string;
};

export type CreateOrderInput = {
  buyerId?: string;
  inquiryId?: string;
  quotationId?: string;
  orderDate: string;
  deliveryDate?: string;
  destinationCountry?: string;
  incoterm?: string;
  paymentTerms?: string;
  currency: string;
  exchangeRate?: string;
  labourCost?: string;
  packingCost?: string;
  freightCost?: string;
  documentationCost?: string;
  bankCharges?: string;
  otherCosts?: string;
  notes?: string;
  lines: OrderLineInput[];
};

export async function createSalesOrder(input: CreateOrderInput): Promise<SaveResult & { orderNo?: string }> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const lines = input.lines.filter((l) => l.description.trim() && num(l.qty) > 0);
  if (lines.length === 0) return { ok: false, error: "Add at least one line with a description and qty." };
  if (!input.orderDate) return { ok: false, error: "Order date is required." };

  const salesValue = round2(lines.reduce((s, l) => s + num(l.qty) * num(l.unitPrice), 0));
  const productCost = round2(lines.reduce((s, l) => s + num(l.qty) * num(l.unitCost), 0));

  const reserved = await reserveNo(supabase, me.currentCompanyId, "B2B_SO", "SO", input.orderDate);
  if (!reserved.no) return { ok: false, error: reserved.error ?? "Order numbering failed." };

  const { data: order, error } = await supabase
    .from("b2b_sales_orders")
    .insert({
      company_id: me.currentCompanyId,
      order_no: reserved.no,
      buyer_id: input.buyerId || null,
      inquiry_id: input.inquiryId || null,
      quotation_id: input.quotationId || null,
      order_date: input.orderDate,
      delivery_date: input.deliveryDate || null,
      destination_country: input.destinationCountry?.trim() || null,
      incoterm: input.incoterm?.trim() || null,
      payment_terms: input.paymentTerms?.trim() || null,
      currency: (input.currency || "INR").toUpperCase().slice(0, 3),
      exchange_rate: Math.max(0.000001, num(input.exchangeRate) || 1),
      status: "Confirmed",
      sales_value: salesValue,
      product_cost: productCost,
      labour_cost: num(input.labourCost),
      packing_cost: num(input.packingCost),
      freight_cost: num(input.freightCost),
      documentation_cost: num(input.documentationCost),
      bank_charges: num(input.bankCharges),
      other_costs: num(input.otherCosts),
      notes: input.notes?.trim() || null,
      entered_by_employee_id: me.id,
    })
    .select("id, order_no")
    .single();
  if (error) return { ok: false, error: error.message };

  const itemRows = lines.map((l, idx) => ({
    order_id: order.id,
    product_id: l.productId || null,
    description: l.description.trim(),
    qty: num(l.qty),
    unit: l.unit?.trim() || "pcs",
    unit_price: Math.max(0, num(l.unitPrice)),
    unit_cost: Math.max(0, num(l.unitCost)),
    display_order: idx,
  }));
  const { error: itemErr } = await supabase.from("b2b_sales_order_items").insert(itemRows);
  if (itemErr) return { ok: false, error: itemErr.message };

  // Automatic payment schedule from the terms (§13/§20) — "50/50",
  // "Net 30", "100% advance" recognised; anything else = one balance
  // instalment on the delivery date. Never guesses a split it can't read.
  const schedule = buildPaymentSchedule(input.paymentTerms || "", salesValue, input.orderDate, input.deliveryDate || null);
  if (schedule.length > 0) {
    const { error: schedErr } = await supabase.from("b2b_order_payments").insert(
      schedule.map((r) => ({
        company_id: me.currentCompanyId,
        order_id: order.id,
        label: r.label,
        due_date: r.dueDate,
        amount: r.amount,
      }))
    );
    if (schedErr) return { ok: false, error: schedErr.message };
  }

  // PI accepted → converted: mark the source inquiry Converted (same
  // fields the register's own "convert" flow writes).
  if (input.inquiryId) {
    await supabase
      .from("b2b_inquiries")
      .update({ status: "Converted", converted_order_ref: order.order_no, updated_at: new Date().toISOString() })
      .eq("id", input.inquiryId)
      .in("company_id", me.companyIds);
  }

  await logAudit(supabase, {
    companyId: me.currentCompanyId,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_order.created",
    entityType: "b2b_sales_order",
    entityId: order.id,
    entityLabel: order.order_no,
    changes: { sales: salesValue, lines: itemRows.length, payment_terms: input.paymentTerms ?? "" },
  });
  revalidateB2B();
  return { ok: true, id: order.id, orderNo: order.order_no };
}

export async function updateOrderStatus(orderId: string, status: string): Promise<SaveResult> {
  const me = await requireCapability("b2b_inquiry");
  if (!ORDER_STATUSES.includes(status as OrderStatusLike)) return { ok: false, error: "Unknown order status." };
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("b2b_sales_orders")
    .select("id, order_no, status")
    .eq("id", orderId)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (!data) return { ok: false, error: "Order not found in your companies." };
  const { error } = await supabase.from("b2b_sales_orders").update({ status: status as OrderStatusLike, updated_at: new Date().toISOString() }).eq("id", orderId);
  if (error) return { ok: false, error: error.message };
  await logAudit(supabase, {
    companyId: me.currentCompanyId,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_order.status_changed",
    entityType: "b2b_sales_order",
    entityId: orderId,
    entityLabel: data.order_no,
    changes: { status: { from: data.status, to: status } },
  });
  revalidateB2B();
  return { ok: true, id: orderId };
}

export type OrderCostsInput = {
  labourCost?: string;
  packingCost?: string;
  freightCost?: string;
  documentationCost?: string;
  bankCharges?: string;
  otherCosts?: string;
  productCost?: string;
  deliveryDate?: string;
  paymentTerms?: string;
  destinationCountry?: string;
  incoterm?: string;
  notes?: string;
};

export async function saveOrderCosts(orderId: string, input: OrderCostsInput): Promise<SaveResult> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("b2b_sales_orders")
    .select("id, order_no")
    .eq("id", orderId)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (!data) return { ok: false, error: "Order not found in your companies." };
  const { error } = await supabase
    .from("b2b_sales_orders")
    .update({
      product_cost: input.productCost !== undefined ? Math.max(0, num(input.productCost)) : undefined,
      labour_cost: input.labourCost !== undefined ? Math.max(0, num(input.labourCost)) : undefined,
      packing_cost: input.packingCost !== undefined ? Math.max(0, num(input.packingCost)) : undefined,
      freight_cost: input.freightCost !== undefined ? Math.max(0, num(input.freightCost)) : undefined,
      documentation_cost: input.documentationCost !== undefined ? Math.max(0, num(input.documentationCost)) : undefined,
      bank_charges: input.bankCharges !== undefined ? Math.max(0, num(input.bankCharges)) : undefined,
      other_costs: input.otherCosts !== undefined ? Math.max(0, num(input.otherCosts)) : undefined,
      delivery_date: input.deliveryDate !== undefined ? input.deliveryDate || null : undefined,
      payment_terms: input.paymentTerms !== undefined ? input.paymentTerms.trim() || null : undefined,
      destination_country: input.destinationCountry !== undefined ? input.destinationCountry.trim() || null : undefined,
      incoterm: input.incoterm !== undefined ? input.incoterm.trim() || null : undefined,
      notes: input.notes !== undefined ? input.notes.trim() || null : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  if (error) return { ok: false, error: error.message };
  revalidateB2B();
  return { ok: true, id: orderId };
}

export type OrderPackingInput = {
  qty: string;
  pcsPerCarton: string;
  cartonLengthCm?: string;
  cartonWidthCm?: string;
  cartonHeightCm?: string;
  netWeightEachKg?: string;
  cartonTareKg?: string;
};

export async function saveOrderPacking(orderId: string, input: OrderPackingInput): Promise<SaveResult> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("b2b_sales_orders")
    .select("id, order_no")
    .eq("id", orderId)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (!data) return { ok: false, error: "Order not found in your companies." };

  const calc = computePacking({
    qty: num(input.qty),
    pcsPerCarton: num(input.pcsPerCarton),
    cartonLengthCm: num(input.cartonLengthCm) || undefined,
    cartonWidthCm: num(input.cartonWidthCm) || undefined,
    cartonHeightCm: num(input.cartonHeightCm) || undefined,
    netWeightEachKg: num(input.netWeightEachKg) || undefined,
    cartonTareKg: num(input.cartonTareKg) || undefined,
  });

  const { error } = await supabase
    .from("b2b_sales_orders")
    .update({
      pack_pcs_per_carton: Math.max(0, Math.round(num(input.pcsPerCarton))),
      pack_cartons: calc.cartons,
      pack_net_weight_kg: calc.netWeightKg,
      pack_gross_weight_kg: calc.grossWeightKg,
      pack_cbm: calc.cbm,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);
  if (error) return { ok: false, error: error.message };
  revalidateB2B();
  return { ok: true, id: orderId };
}

// ── payment schedule rows ───────────────────────────────────────────────────

export async function receiveOrderPayment(
  paymentId: string,
  input: { amount: string; mode?: string; referenceNo?: string; receivedDate?: string }
): Promise<SaveResult> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("b2b_order_payments")
    .select("id, company_id, order_id, amount, received_amount")
    .eq("id", paymentId)
    .maybeSingle();
  if (!data || !me.companyIds.includes(data.company_id)) return { ok: false, error: "Instalment not found in your companies." };

  const add = Math.max(0, num(input.amount));
  const next = Math.min(data.amount, round2(data.received_amount + add));
  const { error } = await supabase
    .from("b2b_order_payments")
    .update({
      received_amount: next,
      received_date: input.receivedDate || todayIST(),
      payment_mode: input.mode?.trim() || null,
      reference_no: input.referenceNo?.trim() || null,
    })
    .eq("id", paymentId);
  if (error) return { ok: false, error: error.message };
  await logAudit(supabase, {
    companyId: me.currentCompanyId,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_order.payment_received",
    entityType: "b2b_order_payment",
    entityId: paymentId,
    changes: { received: next, of: data.amount },
  });
  revalidateB2B();
  return { ok: true, id: paymentId };
}

export async function addOrderPaymentRow(
  orderId: string,
  input: { label?: string; dueDate: string; amount: string }
): Promise<SaveResult> {
  const me = await requireCapability("b2b_inquiry");
  const amount = Math.max(0, num(input.amount));
  if (!input.dueDate || amount <= 0) return { ok: false, error: "Due date and a positive amount are required." };
  const supabase = createServiceRoleClient();
  const { data: order } = await supabase
    .from("b2b_sales_orders")
    .select("id, order_no, company_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || !me.companyIds.includes(order.company_id)) return { ok: false, error: "Order not found in your companies." };
  const { data, error } = await supabase
    .from("b2b_order_payments")
    .insert({
      company_id: me.currentCompanyId,
      order_id: orderId,
      label: input.label?.trim() || "Instalment",
      due_date: input.dueDate,
      amount,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidateB2B();
  return { ok: true, id: data.id };
}

export async function deleteOrderPayment(paymentId: string): Promise<SaveResult> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("b2b_order_payments")
    .select("id, company_id")
    .eq("id", paymentId)
    .maybeSingle();
  if (!data || !me.companyIds.includes(data.company_id)) return { ok: false, error: "Instalment not found in your companies." };
  const { error } = await supabase.from("b2b_order_payments").delete().eq("id", paymentId);
  if (error) return { ok: false, error: error.message };
  revalidateB2B();
  return { ok: true, id: paymentId };
}

// ═══════════════════════════════ Production ════════════════════════════════

export type CreateProductionInput = {
  orderId?: string;
  productId?: string;
  description: string;
  plannedQty: string;
  startDate?: string;
  dueDate?: string;
  priority?: string;
  stages?: string[];
  notes?: string;
};

export async function createProduction(input: CreateProductionInput): Promise<SaveResult & { productionNo?: string }> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const description = input.description.trim();
  const planned = num(input.plannedQty);
  if (!description) return { ok: false, error: "Describe what is being produced." };
  if (planned <= 0) return { ok: false, error: "Planned quantity must be positive." };

  if (input.orderId) {
    const { data } = await supabase
      .from("b2b_sales_orders")
      .select("id, company_id")
      .eq("id", input.orderId)
      .maybeSingle();
    if (!data || !me.companyIds.includes(data.company_id)) return { ok: false, error: "Order not found in your companies." };
  }

  const reserved = await reserveNo(supabase, me.currentCompanyId, "B2B_PRD", "PRD", todayIST());
  if (!reserved.no) return { ok: false, error: reserved.error ?? "Production numbering failed." };

  const stages = (input.stages ?? []).map((s) => s.trim()).filter(Boolean);
  const { data, error } = await supabase
    .from("b2b_productions")
    .insert({
      company_id: me.currentCompanyId,
      production_no: reserved.no,
      order_id: input.orderId || null,
      product_id: input.productId || null,
      description,
      planned_qty: planned,
      start_date: input.startDate || null,
      due_date: input.dueDate || null,
      priority: asPriority(input.priority),
      ...(stages.length > 0 ? { stages, current_stage: stages[0] } : {}),
      notes: input.notes?.trim() || null,
    })
    .select("id, production_no")
    .single();
  if (error) return { ok: false, error: error.message };

  // AUTO-WORKFLOW: starting production moves the order along.
  await advanceOrderStatus(supabase, input.orderId ?? null, "In Production");

  await logAudit(supabase, {
    companyId: me.currentCompanyId,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_production.created",
    entityType: "b2b_production",
    entityId: data.id,
    entityLabel: data.production_no,
    changes: { planned },
  });
  revalidateB2B();
  return { ok: true, id: data.id, productionNo: data.production_no };
}

export async function addProductionEntry(
  productionId: string,
  input: { qty: string; stage?: string; status?: string }
): Promise<SaveResult> {
  const me = await requireCapability("b2b_inquiry");
  const qty = num(input.qty);
  if (qty <= 0) return { ok: false, error: "Entry quantity must be positive." };
  const supabase = createServiceRoleClient();
  const { data: prod } = await supabase
    .from("b2b_productions")
    .select("id, company_id, order_id, planned_qty, produced_qty, production_no")
    .eq("id", productionId)
    .maybeSingle();
  if (!prod || !me.companyIds.includes(prod.company_id)) return { ok: false, error: "Production not found in your companies." };

  const produced = round2(prod.produced_qty + qty);
  const completed = produced >= prod.planned_qty;
  const status: ProductionUpdate["status"] = completed ? "Completed" : "In Progress";
  const patch: ProductionUpdate = {
    produced_qty: produced,
    status,
    updated_at: new Date().toISOString(),
  };
  if (input.stage?.trim()) patch.current_stage = input.stage.trim();

  const { error } = await supabase.from("b2b_productions").update(patch).eq("id", productionId);
  if (error) return { ok: false, error: error.message };

  // AUTO-WORKFLOW: production done → order waits for QC.
  if (completed) await advanceOrderStatus(supabase, prod.order_id, "QC");

  await logAudit(supabase, {
    companyId: me.currentCompanyId,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_production.entry",
    entityType: "b2b_production",
    entityId: productionId,
    entityLabel: prod.production_no,
    changes: { entry: qty, produced, planned: prod.planned_qty },
  });
  revalidateB2B();
  return { ok: true, id: productionId };
}

export async function updateProductionMeta(
  productionId: string,
  input: { dueDate?: string; priority?: string; status?: string; stage?: string; stages?: string[]; notes?: string }
): Promise<SaveResult> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("b2b_productions")
    .select("id, company_id")
    .eq("id", productionId)
    .maybeSingle();
  if (!data || !me.companyIds.includes(data.company_id)) return { ok: false, error: "Production not found in your companies." };
  const stages = (input.stages ?? []).map((s) => s.trim()).filter(Boolean);
  const { error } = await supabase
    .from("b2b_productions")
    .update({
      due_date: input.dueDate !== undefined ? input.dueDate || null : undefined,
      priority: input.priority && ["High", "Normal", "Low"].includes(input.priority) ? asPriority(input.priority) : undefined,
      status: input.status && ["Planned", "In Progress", "Completed", "Delayed"].includes(input.status) ? (input.status as ProductionUpdate["status"]) : undefined,
      current_stage: input.stage?.trim() || undefined,
      stages: stages.length > 0 ? stages : undefined,
      notes: input.notes !== undefined ? input.notes.trim() || null : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", productionId);
  if (error) return { ok: false, error: error.message };
  revalidateB2B();
  return { ok: true, id: productionId };
}

// ═══════════════════════════════ QC ════════════════════════════════════════

export type QcInput = {
  orderId?: string;
  productionId?: string;
  productId?: string;
  inspectedQty: string;
  passedQty: string;
  rejectedQty: string;
  reworkQty: string;
  inspectionDate: string;
  inspector?: string;
  remarks?: string;
};

export async function createQcInspection(input: QcInput): Promise<SaveResult & { qcNo?: string }> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const inspected = num(input.inspectedQty);
  const passed = num(input.passedQty);
  const rejected = num(input.rejectedQty);
  const rework = num(input.reworkQty);
  if (inspected <= 0) return { ok: false, error: "Inspected qty must be positive." };
  if (passed + rejected + rework > inspected) return { ok: false, error: "Passed + rejected + rework cannot exceed inspected qty." };
  if (!input.inspectionDate) return { ok: false, error: "Inspection date is required." };

  if (input.orderId) {
    const { data } = await supabase.from("b2b_sales_orders").select("id, company_id").eq("id", input.orderId).maybeSingle();
    if (!data || !me.companyIds.includes(data.company_id)) return { ok: false, error: "Order not found in your companies." };
  }

  const reserved = await reserveNo(supabase, me.currentCompanyId, "B2B_QC", "QC", input.inspectionDate);
  if (!reserved.no) return { ok: false, error: reserved.error ?? "QC numbering failed." };

  const { data, error } = await supabase
    .from("b2b_qc_inspections")
    .insert({
      company_id: me.currentCompanyId,
      qc_no: reserved.no,
      order_id: input.orderId || null,
      production_id: input.productionId || null,
      product_id: input.productId || null,
      inspected_qty: inspected,
      passed_qty: passed,
      rejected_qty: rejected,
      rework_qty: rework,
      inspection_date: input.inspectionDate,
      inspector: input.inspector?.trim() || null,
      remarks: input.remarks?.trim() || null,
      entered_by_employee_id: me.id,
    })
    .select("id, qc_no")
    .single();
  if (error) return { ok: false, error: error.message };

  // AUTO-WORKFLOW: a spotless inspection releases the order to Packing.
  // Any rejection/rework leaves the status alone — the 🔴 QC-failed alert
  // on the Control Center picks that up instead.
  if (rejected === 0 && rework === 0 && passed === inspected) {
    await advanceOrderStatus(supabase, input.orderId ?? null, "Packing");
  }

  await logAudit(supabase, {
    companyId: me.currentCompanyId,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_qc.inspected",
    entityType: "b2b_qc_inspection",
    entityId: data.id,
    entityLabel: data.qc_no,
    changes: { inspected, passed, rejected, rework },
  });
  revalidateB2B();
  return { ok: true, id: data.id, qcNo: data.qc_no };
}

// ═══════════════════════════════ Shipments ═════════════════════════════════

export type CreateShipmentInput = {
  orderId?: string;
  destinationCountry?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  forwarder?: string;
  shippingLine?: string;
  containerNo?: string;
  sealNo?: string;
  blAwb?: string;
  etd?: string;
  eta?: string;
  freightCost?: string;
  insuranceCost?: string;
  notes?: string;
};

export async function createShipment(input: CreateShipmentInput): Promise<SaveResult & { shipmentNo?: string }> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  if (input.orderId) {
    const { data } = await supabase.from("b2b_sales_orders").select("id, company_id").eq("id", input.orderId).maybeSingle();
    if (!data || !me.companyIds.includes(data.company_id)) return { ok: false, error: "Order not found in your companies." };
  }

  const reserved = await reserveNo(supabase, me.currentCompanyId, "B2B_SHP", "SHP", todayIST());
  if (!reserved.no) return { ok: false, error: reserved.error ?? "Shipment numbering failed." };

  const { data, error } = await supabase
    .from("b2b_shipments")
    .insert({
      company_id: me.currentCompanyId,
      shipment_no: reserved.no,
      order_id: input.orderId || null,
      status: "Booking",
      destination_country: input.destinationCountry?.trim() || null,
      port_of_loading: input.portOfLoading?.trim() || null,
      port_of_discharge: input.portOfDischarge?.trim() || null,
      forwarder: input.forwarder?.trim() || null,
      shipping_line: input.shippingLine?.trim() || null,
      container_no: input.containerNo?.trim() || null,
      seal_no: input.sealNo?.trim() || null,
      bl_awb: input.blAwb?.trim() || null,
      etd: input.etd || null,
      eta: input.eta || null,
      freight_cost: Math.max(0, num(input.freightCost)),
      insurance_cost: Math.max(0, num(input.insuranceCost)),
      notes: input.notes?.trim() || null,
      entered_by_employee_id: me.id,
    })
    .select("id, shipment_no")
    .single();
  if (error) return { ok: false, error: error.message };

  await advanceOrderStatus(supabase, input.orderId ?? null, "Booked");

  await logAudit(supabase, {
    companyId: me.currentCompanyId,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_shipment.created",
    entityType: "b2b_shipment",
    entityId: data.id,
    entityLabel: data.shipment_no,
  });
  revalidateB2B();
  return { ok: true, id: data.id, shipmentNo: data.shipment_no };
}

export async function updateShipmentStatus(shipmentId: string, status: string): Promise<SaveResult> {
  const me = await requireCapability("b2b_inquiry");
  if (!SHIPMENT_STATUSES.includes(status as (typeof SHIPMENT_STATUSES)[number])) {
    return { ok: false, error: "Unknown shipment status." };
  }
  const supabase = createServiceRoleClient();
  const { data: ship } = await supabase
    .from("b2b_shipments")
    .select("id, company_id, order_id, shipment_no, status, actual_departure, actual_arrival")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!ship || !me.companyIds.includes(ship.company_id)) return { ok: false, error: "Shipment not found in your companies." };

  const today = todayIST();
  const patch: ShipmentUpdate = { status: status as ShipmentUpdate["status"], updated_at: new Date().toISOString() };
  if ((status === "Departed" || status === "In Transit") && !ship.actual_departure) patch.actual_departure = today;
  if (status === "Arrived" || status === "Delivered") {
    if (!ship.actual_arrival) patch.actual_arrival = today;
  }

  const { error } = await supabase.from("b2b_shipments").update(patch).eq("id", shipmentId);
  if (error) return { ok: false, error: error.message };

  // AUTO-WORKFLOW: mirror the shipment's movement onto the order.
  if (status === "Booking" || status === "Ready" || status === "Stuffed") {
    await advanceOrderStatus(supabase, ship.order_id, "Booked");
  } else if (status === "Departed" || status === "In Transit") {
    await advanceOrderStatus(supabase, ship.order_id, "In Transit");
  } else if (status === "Delivered") {
    await advanceOrderStatus(supabase, ship.order_id, "Delivered");
  }

  await logAudit(supabase, {
    companyId: me.currentCompanyId,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_shipment.status_changed",
    entityType: "b2b_shipment",
    entityId: shipmentId,
    entityLabel: ship.shipment_no,
    changes: { status: { from: ship.status, to: status } },
  });
  revalidateB2B();
  return { ok: true, id: shipmentId };
}
