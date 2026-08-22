"use server";

// Shipglobal shipment creation — see db/2026-08-10-shipglobal.sql's header
// comment for the full "why" and the schema-gap reasoning, and
// src/lib/couriers/shipglobal.ts for the API client. Gated behind the
// 'shipglobal_shipment' capability (Admin/MD only by default — see that
// migration's tail) since this creates a REAL external shipment + customs
// declaration the moment live credentials are configured.
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resyncDispatchSummary } from "@/lib/order-packages/resync-dispatch-summary";
import {
  shipglobalLogin,
  shipglobalAddOrder,
  shipglobalProcessDestination,
  SHIPGLOBAL_SERVICES,
  type ShipglobalServiceCode,
} from "@/lib/couriers/shipglobal";

export type ShipglobalLookupOrder = {
  id: string;
  refNo: string;
  buyerName: string | null;
  buyerMail: string | null;
  buyerContact: string | null;
  buyerCountry: string | null;
  hsnNo: string | null;
  skuLabel: string | null;
  qty: number;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  shippingWeightKg: number | null;
  iossNumber: string | null;
  alreadyShipped: boolean; // a shipglobal_shipments row already exists for this order
};

export type ShipglobalLookupState = {
  error: string | null;
  order: ShipglobalLookupOrder | null;
};

/**
 * Step 1 of the UI: find the order by Ref No. and pull whatever we
 * already know (dispatch_invoices, if a manual dispatch entry already
 * exists) to prefill the creation form. Nothing is written here.
 */
export async function lookupOrderForShipglobal(
  _prev: ShipglobalLookupState,
  formData: FormData
): Promise<ShipglobalLookupState> {
  const employee = await requireCapability("shipglobal_shipment");
  const supabase = createServiceRoleClient();

  const refNo = String(formData.get("ref_no") ?? "").trim();
  if (!refNo) return { error: "Enter a Ref No. first.", order: null };

  const { data: orders, error: orderError } = await supabase
    .from("orders")
    .select("id, ref_no, buyer_name_address, contact_no, email_id, tax_id, sku_label, qty")
    .eq("ref_no", refNo)
    .in("company_id", employee.companyIds);

  if (orderError) return { error: `Lookup failed: ${orderError.message}`, order: null };
  if (!orders || orders.length === 0) return { error: "No order found with this Ref No.", order: null };
  if (orders.length > 1) return { error: "Ambiguous — more than one order matched this Ref No.", order: null };
  const order = orders[0];

  const { data: dispatch } = await supabase
    .from("dispatch_invoices")
    .select("buyer_name, buyer_mail, buyer_contact, buyer_country, hsn_no, length_cm, width_cm, height_cm, shipping_weight_kg")
    .eq("order_id", order.id)
    .maybeSingle();

  const { data: existingShipment } = await supabase
    .from("shipglobal_shipments")
    .select("id")
    .eq("order_id", order.id)
    .maybeSingle();

  return {
    error: null,
    order: {
      id: order.id,
      refNo: order.ref_no,
      buyerName: dispatch?.buyer_name ?? order.buyer_name_address,
      buyerMail: dispatch?.buyer_mail ?? order.email_id,
      buyerContact: dispatch?.buyer_contact ?? order.contact_no,
      buyerCountry: dispatch?.buyer_country ?? null,
      hsnNo: dispatch?.hsn_no ?? null,
      skuLabel: order.sku_label,
      qty: order.qty,
      lengthCm: dispatch?.length_cm ?? null,
      widthCm: dispatch?.width_cm ?? null,
      heightCm: dispatch?.height_cm ?? null,
      shippingWeightKg: dispatch?.shipping_weight_kg ?? null,
      iossNumber: order.tax_id,
      alreadyShipped: !!existingShipment,
    },
  };
}

export type ShipglobalCreateState = {
  error: string | null;
  success: boolean;
  trackingNo: string | null;
  shipmentId: string | null;
};

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function num(formData: FormData, key: string): number {
  const v = Number(formData.get(key));
  return Number.isFinite(v) ? v : 0;
}

/**
 * Step 2: actually create the shipment. Two Shipglobal calls back to back
 * (addOrder.php then processDestination.php — see
 * src/lib/couriers/shipglobal.ts's header comment on why this app calls
 * both immediately rather than manifesting in a separate batched step).
 * Every attempt is logged to shipglobal_shipments regardless of outcome —
 * same "never silently lose data" convention as courier_webhook_log.
 */
export async function createShipglobalShipment(
  _prev: ShipglobalCreateState,
  formData: FormData
): Promise<ShipglobalCreateState> {
  const employee = await requireCapability("shipglobal_shipment");
  const supabase = createServiceRoleClient();

  const orderId = str(formData, "order_id");
  const refNo = str(formData, "ref_no");
  const service = str(formData, "service") as ShipglobalServiceCode;
  if (!orderId || !refNo) return { error: "Missing order — look it up again.", success: false, trackingNo: null, shipmentId: null };
  if (!SHIPGLOBAL_SERVICES.some((s) => s.code === service)) {
    return { error: "Choose a valid service.", success: false, trackingNo: null, shipmentId: null };
  }

  const { data: seller, error: sellerError } = await supabase
    .from("shipglobal_seller_profiles")
    .select("*")
    .eq("company_id", employee.currentCompanyId)
    .maybeSingle();
  if (sellerError) return { error: `Could not load seller profile: ${sellerError.message}`, success: false, trackingNo: null, shipmentId: null };
  if (!seller) {
    return {
      error: "No Shipglobal seller profile set up for this company yet — fill in the seller profile section above first.",
      success: false,
      trackingNo: null,
      shipmentId: null,
    };
  }

  const input = {
    service,
    currencyCode: str(formData, "currency_code") || "USD",
    csb5Status: 1,
    packageWeightG: num(formData, "package_weight_g"),
    packageLengthCm: num(formData, "package_length_cm"),
    packageBreadthCm: num(formData, "package_breadth_cm"),
    packageHeightCm: num(formData, "package_height_cm"),
    seller: {
      nickname: seller.seller_nickname,
      firstname: seller.seller_firstname,
      lastname: seller.seller_lastname,
      mobile: seller.seller_mobile,
      email: seller.seller_email,
      company: seller.seller_company,
      address1: seller.seller_address1,
      address2: seller.seller_address2,
      address3: seller.seller_address3,
      city: seller.seller_city,
      postcode: seller.seller_postcode,
      countryCode: seller.seller_country_code,
      state: seller.seller_state,
      taxIdType: seller.seller_tax_id_type,
      taxId: seller.seller_tax_id,
    },
    shipping: {
      firstname: str(formData, "ship_firstname"),
      lastname: str(formData, "ship_lastname"),
      mobile: str(formData, "ship_mobile"),
      email: str(formData, "ship_email"),
      company: str(formData, "ship_company"),
      address1: str(formData, "ship_address1"),
      address2: str(formData, "ship_address2"),
      address3: str(formData, "ship_address3"),
      city: str(formData, "ship_city"),
      postcode: str(formData, "ship_postcode"),
      countryCode: str(formData, "ship_country_code"),
      state: str(formData, "ship_state"),
    },
    iossNumber: str(formData, "ioss_number") || null,
    item: {
      name: str(formData, "item_name"),
      sku: str(formData, "item_sku"),
      quantity: num(formData, "item_qty") || 1,
      unitPrice: num(formData, "item_unit_price"),
      hsn: str(formData, "item_hsn"),
      taxRate: num(formData, "item_tax_rate"),
    },
    sellerReference: str(formData, "seller_reference") || refNo,
    mailClass: str(formData, "mail_class") || null,
    deliveryConfirmation: str(formData, "delivery_confirmation") || null,
  };

  const orderReference = `${refNo}-${orderId.slice(0, 8)}`;
  const invoiceNo = str(formData, "invoice_no") || refNo;
  const invoiceDate = str(formData, "invoice_date") || new Date().toISOString().slice(0, 10);

  let token: string;
  try {
    token = await shipglobalLogin();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("shipglobal_shipments").upsert(
      {
        order_id: orderId,
        service_code: service,
        currency_code: input.currencyCode,
        ship_firstname: input.shipping.firstname,
        ship_lastname: input.shipping.lastname,
        ship_mobile: input.shipping.mobile,
        ship_email: input.shipping.email,
        ship_address1: input.shipping.address1,
        ship_address2: input.shipping.address2,
        ship_city: input.shipping.city,
        ship_postcode: input.shipping.postcode,
        ship_country_code: input.shipping.countryCode,
        ship_state: input.shipping.state,
        item_name: input.item.name,
        item_sku: input.item.sku,
        item_qty: input.item.quantity,
        item_unit_price: input.item.unitPrice,
        item_hsn: input.item.hsn,
        item_tax_rate: input.item.taxRate,
        package_weight_g: input.packageWeightG,
        package_length_cm: input.packageLengthCm,
        package_breadth_cm: input.packageBreadthCm,
        package_height_cm: input.packageHeightCm,
        seller_reference: input.sellerReference,
        status: "failed",
        error_message: `Login failed: ${message}`,
        created_by: employee.id,
      },
      { onConflict: "order_id" }
    );
    return { error: `Shipglobal login failed: ${message}`, success: false, trackingNo: null, shipmentId: null };
  }

  let created;
  try {
    created = await shipglobalAddOrder(token, { ...input, invoiceNo, invoiceDate, orderReference });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("shipglobal_shipments").upsert(
      {
        order_id: orderId,
        service_code: service,
        currency_code: input.currencyCode,
        ship_firstname: input.shipping.firstname,
        ship_lastname: input.shipping.lastname,
        ship_mobile: input.shipping.mobile,
        ship_email: input.shipping.email,
        ship_address1: input.shipping.address1,
        ship_address2: input.shipping.address2,
        ship_city: input.shipping.city,
        ship_postcode: input.shipping.postcode,
        ship_country_code: input.shipping.countryCode,
        ship_state: input.shipping.state,
        item_name: input.item.name,
        item_sku: input.item.sku,
        item_qty: input.item.quantity,
        item_unit_price: input.item.unitPrice,
        item_hsn: input.item.hsn,
        item_tax_rate: input.item.taxRate,
        package_weight_g: input.packageWeightG,
        package_length_cm: input.packageLengthCm,
        package_breadth_cm: input.packageBreadthCm,
        package_height_cm: input.packageHeightCm,
        seller_reference: input.sellerReference,
        status: "failed",
        error_message: message,
        created_by: employee.id,
      },
      { onConflict: "order_id" }
    );
    return { error: message, success: false, trackingNo: null, shipmentId: null };
  }

  const { data: shipmentRow, error: insertError } = await supabase
    .from("shipglobal_shipments")
    .upsert(
      {
        order_id: orderId,
        service_code: service,
        currency_code: input.currencyCode,
        ship_firstname: input.shipping.firstname,
        ship_lastname: input.shipping.lastname,
        ship_mobile: input.shipping.mobile,
        ship_email: input.shipping.email,
        ship_company: input.shipping.company,
        ship_address1: input.shipping.address1,
        ship_address2: input.shipping.address2,
        ship_address3: input.shipping.address3,
        ship_city: input.shipping.city,
        ship_postcode: input.shipping.postcode,
        ship_country_code: input.shipping.countryCode,
        ship_state: input.shipping.state,
        item_name: input.item.name,
        item_sku: input.item.sku,
        item_qty: input.item.quantity,
        item_unit_price: input.item.unitPrice,
        item_hsn: input.item.hsn,
        item_tax_rate: input.item.taxRate,
        package_weight_g: input.packageWeightG,
        package_length_cm: input.packageLengthCm,
        package_breadth_cm: input.packageBreadthCm,
        package_height_cm: input.packageHeightCm,
        ioss_number: input.iossNumber,
        seller_reference: input.sellerReference,
        mail_class: input.mailClass,
        delivery_confirmation: input.deliveryConfirmation,
        status: "created",
        shipglobal_order_number: created.orderNumber,
        shipglobal_waybill_number: created.waybillNumber,
        label_pdf_base64: created.labelPdfBase64,
        raw_create_response: created.raw as never,
        created_by: employee.id,
      },
      { onConflict: "order_id" }
    )
    .select("id")
    .single();

  if (insertError || !shipmentRow) {
    return { error: `Shipment created on Shipglobal but failed to save locally: ${insertError?.message ?? "unknown error"}`, success: false, trackingNo: null, shipmentId: null };
  }

  const manifestCode = `SG-${new Date().toISOString().slice(0, 10)}-${orderId.slice(0, 8)}`;
  try {
    const manifested = await shipglobalProcessDestination(token, service, [orderReference], manifestCode);
    await supabase
      .from("shipglobal_shipments")
      .update({
        status: "manifested",
        manifest_code: manifestCode,
        tracking_no: manifested.trackingNo,
        raw_manifest_response: manifested.raw as never,
      })
      .eq("id", shipmentRow.id);

    if (manifested.trackingNo) {
      const carrierName = SHIPGLOBAL_SERVICES.find((s) => s.code === service)?.carrier ?? service;
      // Gap 1 (2026-08-20): writes order_shipments (shipment_no=1) +
      // order_packages (package_no=1) instead of dispatch_invoices
      // directly, then resyncs the order-level summary — see
      // claude/gap1-multipackage-design-2026-08-20.md. Shipglobal itself
      // only ever manifests one shipment per call, so this always targets
      // shipment_no 1 (a Shipglobal-manifested order that separately also
      // has manually-entered extra packages/shipments is an edge case not
      // handled specially here — shipment 1 stays Shipglobal's own).
      const { data: shipment } = await supabase
        .from("order_shipments")
        .upsert(
          {
            order_id: orderId,
            shipment_no: 1,
            awb_no: manifested.trackingNo,
            courier_name: `${carrierName} (Shipglobal)`,
            last_update_date: new Date().toISOString().slice(0, 10),
            created_by_employee_id: employee.id,
          },
          { onConflict: "order_id,shipment_no" }
        )
        .select("id")
        .single();

      if (shipment) {
        await supabase.from("order_packages").upsert(
          {
            order_shipment_id: shipment.id,
            package_no: 1,
            length_cm: input.packageLengthCm,
            width_cm: input.packageBreadthCm,
            height_cm: input.packageHeightCm,
            weight_kg: input.packageWeightG / 1000,
          },
          { onConflict: "order_shipment_id,package_no" }
        );
        await resyncDispatchSummary(supabase, orderId);
        // buyer_name/mail/contact/hsn_no aren't part of the shipment/package
        // summary resync (those stay dispatch_invoices-only fields, out of
        // scope for this round) — write them directly, same as before.
        await supabase
          .from("dispatch_invoices")
          .upsert(
            {
              order_id: orderId,
              buyer_name: `${input.shipping.firstname} ${input.shipping.lastname}`.trim(),
              buyer_mail: input.shipping.email,
              buyer_contact: input.shipping.mobile,
              buyer_country: input.shipping.countryCode,
              hsn_no: input.item.hsn,
            },
            { onConflict: "order_id" }
          );
      }
      await supabase.from("orders").update({ shipment_status: "Shipped" }).eq("id", orderId);
    }

    revalidatePath("/dashboard/shipglobal");
    revalidatePath("/dashboard/orders");
    return { error: null, success: true, trackingNo: manifested.trackingNo, shipmentId: shipmentRow.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("shipglobal_shipments")
      .update({ status: "failed", error_message: `Manifest failed: ${message}` })
      .eq("id", shipmentRow.id);
    return {
      error: `Shipment + label created on Shipglobal, but manifesting failed (no tracking number yet): ${message}`,
      success: false,
      trackingNo: null,
      shipmentId: shipmentRow.id,
    };
  }
}

export type SellerProfileState = { error: string | null; success: boolean };

export async function saveShipglobalSellerProfile(_prev: SellerProfileState, formData: FormData): Promise<SellerProfileState> {
  const employee = await requireCapability("shipglobal_shipment");
  const supabase = createServiceRoleClient();

  const required = [
    "seller_nickname",
    "seller_firstname",
    "seller_lastname",
    "seller_mobile",
    "seller_email",
    "seller_company",
    "seller_address1",
    "seller_address2",
    "seller_city",
    "seller_postcode",
    "seller_country_code",
    "seller_state",
  ];
  for (const key of required) {
    if (!str(formData, key)) return { error: `${key.replace("seller_", "").replace("_", " ")} is required.`, success: false };
  }

  const { error } = await supabase.from("shipglobal_seller_profiles").upsert(
    {
      company_id: employee.currentCompanyId,
      seller_nickname: str(formData, "seller_nickname"),
      seller_firstname: str(formData, "seller_firstname"),
      seller_lastname: str(formData, "seller_lastname"),
      seller_mobile: str(formData, "seller_mobile"),
      seller_email: str(formData, "seller_email"),
      seller_company: str(formData, "seller_company"),
      seller_address1: str(formData, "seller_address1"),
      seller_address2: str(formData, "seller_address2"),
      seller_address3: str(formData, "seller_address3") || null,
      seller_city: str(formData, "seller_city"),
      seller_postcode: str(formData, "seller_postcode"),
      seller_country_code: str(formData, "seller_country_code"),
      seller_state: str(formData, "seller_state"),
      seller_tax_id_type: str(formData, "seller_tax_id_type") || null,
      seller_tax_id: str(formData, "seller_tax_id") || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" }
  );

  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/shipglobal");
  return { error: null, success: true };
}
