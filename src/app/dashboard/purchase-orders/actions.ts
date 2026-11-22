"use server";

// 2026-11-22c — Phase 3: Purchase Order write actions.
//
// A Purchase Order LINKS one order (orders.id) and never writes to that
// order, its photos or order_attachments. The close-up photos it shows are
// read at view/print time through src/lib/orders/closeup-photos.ts.
//
// Numbering uses the same shared machinery as every other document:
// reserve_next_number(company_id, 'PURCHASE_ORDER', false) + fy_label(), so a
// PO is `NPO-<FY>-####`. The NPO- prefix keeps it visibly distinct from an
// order's own `PO-####` reference.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient, createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log-audit";
import { buildPoNumber, isPoStatus, parsePoLines, poTotal, PO_STATUSES, type PoStatus } from "@/lib/purchase-orders/lines";

export type PoFormState = {
  error: string | null;
  success: boolean;
  poNo?: string | null;
  id?: string | null;
};

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function strOrNull(formData: FormData, key: string): string | null {
  const value = str(formData, key);
  return value ? value : null;
}

function revalidatePurchaseOrders(id?: string) {
  revalidatePath("/dashboard/purchase-orders");
  revalidatePath("/dashboard/purchase-orders/print");
  if (id) revalidatePath(`/dashboard/purchase-orders/${id}`);
}

function parseLines(formData: FormData): { lines: ReturnType<typeof parsePoLines>["lines"]; error: string | null } {
  return parsePoLines(
    formData.getAll("item_sku_label").map((v) => String(v)),
    formData.getAll("item_qty").map((v) => String(v)),
    formData.getAll("item_unit_cost").map((v) => String(v))
  );
}

export async function savePurchaseOrder(
  _prev: PoFormState,
  formData: FormData
): Promise<PoFormState> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClientUnchecked();

  const poId = str(formData, "po_id");
  const orderId = str(formData, "order_id");
  const poDate = str(formData, "po_date");
  const expectedDate = strOrNull(formData, "expected_date");
  const currency = strOrNull(formData, "currency");
  const supplierId = strOrNull(formData, "supplier_party_id");

  if (!orderId) return { error: "Pick the order this purchase order is for.", success: false };
  if (!poDate) return { error: "PO date is required.", success: false };
  if (expectedDate && expectedDate < poDate) {
    return { error: "Expected date cannot be before the PO date.", success: false };
  }

  const { lines, error: linesError } = parseLines(formData);
  if (linesError) return { error: linesError, success: false };

  // The linked order is the company scope — the PO belongs to the order's
  // company, and the employee must have access to it.
  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .select("id, company_id, ref_no")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) return { error: orderError.message, success: false };
  if (!orderRow || !employee.companyIds.includes(orderRow.company_id)) {
    return { error: "That order was not found, or you don't have access to its company.", success: false };
  }

  const total = poTotal(lines);

  if (poId) {
    // ── update ───────────────────────────────────────────────────────────
    const { data: existing, error: existingError } = await supabase
      .from("purchase_orders")
      .select("id, company_id, po_no")
      .eq("id", poId)
      .in("company_id", employee.companyIds)
      .maybeSingle();
    if (existingError) return { error: existingError.message, success: false };
    if (!existing) return { error: "Purchase order not found in your companies.", success: false };
    if (existing.company_id !== orderRow.company_id) {
      return { error: "The linked order must belong to the same company as this purchase order.", success: false };
    }

    const { error: updateError } = await supabase
      .from("purchase_orders")
      .update({
        order_id: orderId,
        supplier_party_id: supplierId,
        po_date: poDate,
        expected_date: expectedDate,
        currency,
        total_amount: total,
        updated_at: new Date().toISOString(),
      })
      .eq("id", poId);
    if (updateError) return { error: `Save failed: ${updateError.message}`, success: false };

    // ── lines: INSERT the new ones FIRST, then DELETE the old ones ────────
    //
    // The previous order was delete-then-insert, so a failed insert left the
    // PO with NO lines and a total that no longer matched anything. Now a
    // failed insert leaves the lines (and the stored total) exactly as they
    // were, and the old rows are only removed once the new ones are in.
    //
    // The old ids are read before the insert and deleted BY ID, never by
    // purchase_order_id — otherwise the new rows would be caught too.
    const { data: oldRows, error: oldRowsError } = await supabase
      .from("purchase_order_items")
      .select("id")
      .eq("purchase_order_id", poId);
    if (oldRowsError) return { error: `Save failed: ${oldRowsError.message}`, success: false };

    const { data: newRows, error: itemsError } = await supabase
      .from("purchase_order_items")
      .insert(lines.map((line) => ({ ...line, purchase_order_id: poId })))
      .select("id");
    if (itemsError || !newRows?.length) {
      return { error: `Save failed: ${itemsError?.message ?? "no lines written"}`, success: false };
    }

    const oldIds = ((oldRows ?? []) as { id: string }[]).map((row) => row.id);
    if (oldIds.length) {
      const { error: clearError } = await supabase
        .from("purchase_order_items")
        .delete()
        .in("id", oldIds);
      if (clearError) {
        // Put the PO back exactly as it was: drop the rows just inserted and
        // leave the previous lines in place, so the user can retry instead of
        // being left with duplicated (or doubled) lines.
        const { error: rollbackError } = await supabase
          .from("purchase_order_items")
          .delete()
          .in("id", (newRows as { id: string }[]).map((row) => row.id));
        return {
          error: rollbackError
            ? `Save failed: ${clearError.message}. The new lines could not be rolled back either (${rollbackError.message}); please check this purchase order's lines.`
            : `Save failed: ${clearError.message}. The previous lines were kept unchanged.`,
          success: false,
        };
      }
    }

    await logAudit(createServiceRoleClient(), {
      companyId: existing.company_id,
      employeeId: employee.id,
      employeeName: employee.name,
      action: "purchase_order.updated",
      entityType: "purchase_order",
      entityId: poId,
      entityLabel: existing.po_no,
      changes: { orderRef: orderRow.ref_no, total },
    });

    revalidatePurchaseOrders(poId);
    // Land back on the PO so the saved lines/total (and the photos read from
    // the linked order) are always re-rendered from the database.
    redirect(`/dashboard/purchase-orders/${poId}`);
  }

  // ── create ─────────────────────────────────────────────────────────────
  const fy = await supabase.rpc("fy_label", { p_date: poDate });
  if (fy.error) return { error: `Numbering failed: ${fy.error.message}`, success: false };

  const reserved = await supabase.rpc("reserve_next_number", {
    p_company_id: orderRow.company_id,
    p_scope: "PURCHASE_ORDER",
    p_use_fy: false,
    p_as_of_date: poDate,
  });
  if (reserved.error) return { error: `Numbering failed: ${reserved.error.message}`, success: false };

  const poNo = buildPoNumber(String(fy.data ?? ""), Number(reserved.data));

  const { data: inserted, error: insertError } = await supabase
    .from("purchase_orders")
    .insert({
      company_id: orderRow.company_id,
      order_id: orderId,
      po_no: poNo,
      supplier_party_id: supplierId,
      status: "Draft" satisfies PoStatus,
      po_date: poDate,
      expected_date: expectedDate,
      currency,
      total_amount: total,
      created_by: employee.id,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    return { error: `Save failed: ${insertError?.message ?? "no row returned"}`, success: false };
  }

  const { error: itemsError } = await supabase
    .from("purchase_order_items")
    .insert(lines.map((line) => ({ ...line, purchase_order_id: inserted.id })));
  if (itemsError) return { error: `Lines not saved: ${itemsError.message}`, success: false };

  await logAudit(createServiceRoleClient(), {
    companyId: orderRow.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "purchase_order.created",
    entityType: "purchase_order",
    entityId: inserted.id,
    entityLabel: poNo,
    changes: { orderRef: orderRow.ref_no, total },
  });

  revalidatePurchaseOrders(inserted.id);
  redirect(`/dashboard/purchase-orders/${inserted.id}`);
}

export async function setPurchaseOrderStatus(
  poId: string,
  status: string
): Promise<{ error: string | null }> {
  const employee = await requireCapability("order_entry");
  if (!isPoStatus(status)) return { error: `Status must be one of: ${PO_STATUSES.join(", ")}.` };

  const supabase = createServiceRoleClientUnchecked();
  const { data: existing, error: readError } = await supabase
    .from("purchase_orders")
    .select("id, company_id, po_no, status")
    .eq("id", poId)
    .in("company_id", employee.companyIds)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!existing) return { error: "Purchase order not found in your companies." };

  const { error } = await supabase
    .from("purchase_orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", poId);
  if (error) return { error: error.message };

  await logAudit(createServiceRoleClient(), {
    companyId: existing.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "purchase_order.status_changed",
    entityType: "purchase_order",
    entityId: poId,
    entityLabel: existing.po_no,
    changes: { status: { from: existing.status, to: status } },
  });

  revalidatePurchaseOrders(poId);
  return { error: null };
}

export async function deletePurchaseOrder(poId: string): Promise<{ error: string | null }> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClientUnchecked();

  const { data: existing, error: readError } = await supabase
    .from("purchase_orders")
    .select("id, company_id, po_no")
    .eq("id", poId)
    .in("company_id", employee.companyIds)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!existing) return { error: "Purchase order not found in your companies." };

  // Lines go with it (ON DELETE CASCADE). The linked order and its photos are
  // untouched — this module never owns them.
  const { error } = await supabase.from("purchase_orders").delete().eq("id", poId);
  if (error) return { error: error.message };

  await logAudit(createServiceRoleClient(), {
    companyId: existing.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "purchase_order.deleted",
    entityType: "purchase_order",
    entityId: poId,
    entityLabel: existing.po_no,
    changes: null,
  });

  revalidatePath("/dashboard/purchase-orders");
  revalidatePath("/dashboard/purchase-orders/print");
  return { error: null };
}
