"use server";

// Multi-courier real booking — FedEx / UPS / Aramex / Delhivery /
// Shiprocket, added into the SAME booking flow Shipglobal already has (see
// src/app/dashboard/shipglobal/actions.ts, the proven template this file
// mirrors: requireCapability -> resolve order/seller context -> call the
// courier API -> log every attempt (success or failure) -> on success,
// write order_shipments/order_packages -> resyncDispatchSummary -> flip
// orders.shipment_status). Gated behind the 'courier_booking_shipment'
// capability — see db/2026-09-01-multi-courier-booking-and-freight-recon.sql.
//
// UNLIKE Shipglobal, these 5 couriers share ONE attempt-log table
// (courier_shipments, courier discriminator column) instead of 5 near-
// duplicate tables — see that migration's header comment for why.
//
// BOOKED AMOUNT capture (this round's reconciliation feature): every
// create* function below tries the courier's own API response first; if
// that has no price (confirmed structurally true for Aramex and Delhivery,
// possible for the others depending on account rating settings), it falls
// back to a Courier Rate Card estimate (rate-card-fallback.ts) using the
// zone_label the form submits — and if EVEN THAT has no matching slab, the
// booking still succeeds, just with booked_freight_amt left null and
// booked_amount_source null (never blocks the booking itself).
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resyncDispatchSummary } from "@/lib/order-packages/resync-dispatch-summary";
import { estimateBookedAmountFromRateCard } from "@/lib/couriers/rate-card-fallback";
import { createFedexShipment, type FedexDdpDdu } from "@/lib/couriers/fedex-ship";
import { createUpsShipment, type UpsDdpDdu } from "@/lib/couriers/ups-ship";
import { createAramexShipment, type AramexDdpDdu } from "@/lib/couriers/aramex-shipping";
import { createDelhiveryShipment } from "@/lib/couriers/delhivery-ship";
import { createShiprocketShipment } from "@/lib/couriers/shiprocket-ship";
import { createDhlShipment, type DhlDdpDdu } from "@/lib/couriers/dhl-ship";
import { resolveCourierCredentials } from "@/lib/couriers/credentials";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;
type Courier = "fedex" | "ups" | "aramex" | "delhivery" | "shiprocket" | "dhl";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}
function num(formData: FormData, key: string): number {
  const v = Number(formData.get(key));
  return Number.isFinite(v) ? v : 0;
}
function numOrNull(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// -----------------------------------------------------------------------
// Order lookup — same shape as Shipglobal's own lookupOrderForShipglobal,
// generalized (not courier-specific; every courier's create form starts
// from the same "find the order, see what's already on file" step).
// -----------------------------------------------------------------------
export type CourierBookingLookupOrder = {
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
  orderValueInr: number | null;
  alreadyBooked: Partial<Record<Courier, boolean>>;
};

export type CourierBookingLookupState = { error: string | null; order: CourierBookingLookupOrder | null };

export async function lookupOrderForCourierBooking(
  _prev: CourierBookingLookupState,
  formData: FormData
): Promise<CourierBookingLookupState> {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  const refNo = str(formData, "ref_no");
  if (!refNo) return { error: "Enter a Ref No. first.", order: null };

  const { data: orders, error: orderError } = await supabase
    .from("orders")
    .select("id, ref_no, buyer_name_address, contact_no, email_id, sku_label, qty, order_value_inr")
    .eq("ref_no", refNo)
    .in("company_id", employee.companyIds);

  if (orderError) return { error: `Lookup failed: ${orderError.message}`, order: null };
  if (!orders || orders.length === 0) return { error: "No order found with this Ref No.", order: null };
  if (orders.length > 1) return { error: "Ambiguous — more than one order matched this Ref No.", order: null };
  const order = orders[0];

  const [{ data: dispatch }, { data: existing }] = await Promise.all([
    supabase
      .from("dispatch_invoices")
      .select("buyer_name, buyer_mail, buyer_contact, buyer_country, hsn_no, length_cm, width_cm, height_cm, shipping_weight_kg")
      .eq("order_id", order.id)
      .maybeSingle(),
    supabase.from("courier_shipments").select("courier, status").eq("order_id", order.id),
  ]);

  const alreadyBooked: Partial<Record<Courier, boolean>> = {};
  for (const row of existing ?? []) {
    if (row.status === "created") alreadyBooked[row.courier as Courier] = true;
  }

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
      orderValueInr: order.order_value_inr,
      alreadyBooked,
    },
  };
}

// -----------------------------------------------------------------------
// Shared "ship from" profile — one per company, reused by all 5 couriers.
// -----------------------------------------------------------------------
export type ShipperProfileState = { error: string | null; success: boolean };

export async function saveCourierShipperProfile(_prev: ShipperProfileState, formData: FormData): Promise<ShipperProfileState> {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  const required = ["contact_name", "company_name", "phone", "email", "address1", "city", "state", "postcode"];
  for (const key of required) {
    if (!str(formData, key)) return { error: `${key.replace("_", " ")} is required.`, success: false };
  }

  const { error } = await supabase.from("courier_shipper_profiles").upsert(
    {
      company_id: employee.currentCompanyId,
      contact_name: str(formData, "contact_name"),
      company_name: str(formData, "company_name"),
      phone: str(formData, "phone"),
      email: str(formData, "email"),
      address1: str(formData, "address1"),
      address2: strOrNull(formData, "address2"),
      city: str(formData, "city"),
      state: str(formData, "state"),
      postcode: str(formData, "postcode"),
      country_code: str(formData, "country_code") || "IN",
      tax_id: strOrNull(formData, "tax_id"),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" }
  );

  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/courier-booking");
  return { error: null, success: true };
}

// -----------------------------------------------------------------------
// Shared plumbing every create* action below uses.
// -----------------------------------------------------------------------
async function getNextShipmentNo(supabase: ServiceClient, orderId: string): Promise<number> {
  const { data } = await supabase.from("order_shipments").select("shipment_no").eq("order_id", orderId).order("shipment_no", { ascending: false }).limit(1);
  return (data?.[0]?.shipment_no ?? 0) + 1;
}

async function logAttempt(
  supabase: ServiceClient,
  args: {
    courier: Courier;
    orderId: string;
    orderShipmentId?: string | null;
    serviceCode?: string | null;
    ddpDdu?: "DDP" | "DDU" | null;
    status: "created" | "failed";
    awbNo?: string | null;
    labelUrl?: string | null;
    bookedAmt?: number | null;
    bookedCurrency?: string | null;
    bookedAmountSource?: "api" | "rate_card_estimate" | null;
    requestPayload?: unknown;
    responsePayload?: unknown;
    errorMessage?: string | null;
    createdBy: string;
  }
): Promise<string | null> {
  const { data } = await supabase
    .from("courier_shipments")
    .upsert(
      {
        courier: args.courier,
        order_id: args.orderId,
        order_shipment_id: args.orderShipmentId ?? null,
        service_code: args.serviceCode ?? null,
        ddp_ddu: args.ddpDdu ?? null,
        status: args.status,
        awb_no: args.awbNo ?? null,
        label_url: args.labelUrl ?? null,
        booked_amt: args.bookedAmt ?? null,
        booked_currency: args.bookedCurrency ?? null,
        booked_amount_source: args.bookedAmountSource ?? null,
        request_payload: (args.requestPayload ?? null) as never,
        response_payload: (args.responsePayload ?? null) as never,
        error_message: args.errorMessage ?? null,
        created_by: args.createdBy,
      },
      { onConflict: "order_id,courier" }
    )
    .select("id")
    .single();
  return data?.id ?? null;
}

// Writes order_shipments (+ order_packages, weight/dims) for a successful
// booking and resyncs the order-level summary — identical shape to
// Shipglobal's own createShipglobalShipment (see that file's comment on
// why it always targets shipment_no 1; this instead picks the NEXT free
// shipment_no, since a unified multi-courier flow could plausibly book a
// second courier for a second package on the same order later).
async function writeOrderShipmentFromBooking(
  supabase: ServiceClient,
  args: {
    orderId: string;
    courierLabel: string;
    awbNo: string;
    employeeId: string;
    weightKg: number;
    dimsCm: { length: number; width: number; height: number };
    bookedAmt: number | null;
    bookedCurrency: string | null;
    bookedAmountSource: "api" | "rate_card_estimate" | null;
  }
): Promise<string | null> {
  const shipmentNo = await getNextShipmentNo(supabase, args.orderId);
  const { data: shipment } = await supabase
    .from("order_shipments")
    .upsert(
      {
        order_id: args.orderId,
        shipment_no: shipmentNo,
        awb_no: args.awbNo,
        courier_name: args.courierLabel,
        last_update_date: new Date().toISOString().slice(0, 10),
        created_by_employee_id: args.employeeId,
        booked_freight_amt: args.bookedAmt,
        booked_currency: args.bookedCurrency,
        booked_amount_source: args.bookedAmountSource,
      },
      { onConflict: "order_id,shipment_no" }
    )
    .select("id")
    .single();

  if (!shipment) return null;

  await supabase.from("order_packages").upsert(
    {
      order_shipment_id: shipment.id,
      package_no: 1,
      length_cm: args.dimsCm.length,
      width_cm: args.dimsCm.width,
      height_cm: args.dimsCm.height,
      weight_kg: args.weightKg,
    },
    { onConflict: "order_shipment_id,package_no" }
  );

  await resyncDispatchSummary(supabase, args.orderId);
  await supabase.from("orders").update({ shipment_status: "Shipped" }).eq("id", args.orderId);
  return shipment.id;
}

export type CourierBookingCreateState = {
  error: string | null;
  success: boolean;
  trackingNo: string | null;
  bookedAmt: number | null;
  bookedCurrency: string | null;
  bookedAmountSource: "api" | "rate_card_estimate" | null;
  // Only ever populated for the 4 couriers whose booking response includes
  // a label directly (FedEx/UPS/Aramex/DHL) — Delhivery/Shiprocket always
  // return null here, since those 2 need the separate on-demand
  // label-actions.ts flow after the shipment already exists (see that
  // file's header comment). ResultBanner in create-shipment-form.tsx shows
  // a download link only when this is non-null.
  labelUrl: string | null;
};

const CREATE_INITIAL: CourierBookingCreateState = {
  error: null,
  success: false,
  trackingNo: null,
  bookedAmt: null,
  bookedCurrency: null,
  bookedAmountSource: null,
  labelUrl: null,
};

async function resolveShipperProfile(supabase: ServiceClient, companyId: string) {
  const { data } = await supabase.from("courier_shipper_profiles").select("*").eq("company_id", companyId).maybeSingle();
  return data;
}

// -----------------------------------------------------------------------
// FedEx
// -----------------------------------------------------------------------
export async function createFedexBooking(_prev: CourierBookingCreateState, formData: FormData): Promise<CourierBookingCreateState> {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  const orderId = str(formData, "order_id");
  if (!orderId) return { ...CREATE_INITIAL, error: "Missing order — look it up again." };
  const accountNumber = str(formData, "fedex_account_number");
  if (!accountNumber) return { ...CREATE_INITIAL, error: "FedEx Account Number is required." };

  const shipper = await resolveShipperProfile(supabase, employee.currentCompanyId);
  if (!shipper) return { ...CREATE_INITIAL, error: "No shipper profile set up for this company yet — fill in the shipper profile section above first." };

  const weightKg = num(formData, "package_weight_kg");
  const dims = { length: num(formData, "package_length_cm"), width: num(formData, "package_width_cm"), height: num(formData, "package_height_cm") };
  const currencyCode = str(formData, "currency_code") || "USD";
  const zoneLabel = strOrNull(formData, "zone_label");

  const input = {
    serviceType: str(formData, "service_code") || "INTERNATIONAL_PRIORITY",
    packagingType: "YOUR_PACKAGING",
    ddpDdu: (strOrNull(formData, "ddp_ddu") as FedexDdpDdu | null) ?? null,
    shipper: {
      accountNumber,
      contactName: shipper.contact_name,
      companyName: shipper.company_name,
      phone: shipper.phone,
      address1: shipper.address1,
      address2: shipper.address2,
      city: shipper.city,
      state: shipper.state,
      postalCode: shipper.postcode,
      countryCode: shipper.country_code,
    },
    recipient: {
      contactName: str(formData, "recipient_name"),
      companyName: strOrNull(formData, "recipient_company"),
      phone: str(formData, "recipient_phone"),
      address1: str(formData, "recipient_address1"),
      address2: strOrNull(formData, "recipient_address2"),
      city: str(formData, "recipient_city"),
      state: strOrNull(formData, "recipient_state"),
      postalCode: str(formData, "recipient_postcode"),
      countryCode: str(formData, "recipient_country_code"),
    },
    packageWeightKg: weightKg,
    packageDimsCm: dims,
    currencyCode,
    customsValue: numOrNull(formData, "customs_value"),
    commodityDescription: strOrNull(formData, "goods_description"),
    referenceNo: str(formData, "ref_no"),
  };

  try {
    const credentials = await resolveCourierCredentials(supabase, employee.currentCompanyId, "fedex");
    const result = await createFedexShipment(input, credentials);
    let bookedAmt = result.bookedAmt;
    let bookedCurrency = result.bookedCurrency;
    let bookedSource: "api" | "rate_card_estimate" | null = bookedAmt != null ? "api" : null;
    if (bookedAmt == null && zoneLabel) {
      const est = await estimateBookedAmountFromRateCard(supabase, employee.currentCompanyId, "FedEx", zoneLabel, weightKg);
      if (est) {
        bookedAmt = est.amt;
        bookedCurrency = est.currency;
        bookedSource = "rate_card_estimate";
      }
    }

    if (!result.trackingNo) {
      await logAttempt(supabase, { courier: "fedex", orderId, serviceCode: input.serviceType, ddpDdu: input.ddpDdu, status: "failed", responsePayload: result.raw, errorMessage: "No tracking number in response.", createdBy: employee.id });
      return { ...CREATE_INITIAL, error: "FedEx accepted the request but returned no tracking number — see the attempt log." };
    }

    const shipmentId = await writeOrderShipmentFromBooking(supabase, {
      orderId,
      courierLabel: "FedEx",
      awbNo: result.trackingNo,
      employeeId: employee.id,
      weightKg,
      dimsCm: dims,
      bookedAmt,
      bookedCurrency,
      bookedAmountSource: bookedSource,
    });

    await logAttempt(supabase, {
      courier: "fedex",
      orderId,
      orderShipmentId: shipmentId,
      serviceCode: input.serviceType,
      ddpDdu: input.ddpDdu,
      status: "created",
      awbNo: result.trackingNo,
      labelUrl: result.labelUrl,
      bookedAmt,
      bookedCurrency,
      bookedAmountSource: bookedSource,
      responsePayload: result.raw,
      createdBy: employee.id,
    });

    revalidatePath("/dashboard/courier-booking");
    revalidatePath("/dashboard/orders");
    return { error: null, success: true, trackingNo: result.trackingNo, bookedAmt, bookedCurrency, bookedAmountSource: bookedSource, labelUrl: result.labelUrl ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAttempt(supabase, { courier: "fedex", orderId, serviceCode: input.serviceType, ddpDdu: input.ddpDdu, status: "failed", errorMessage: message, createdBy: employee.id });
    return { ...CREATE_INITIAL, error: message };
  }
}

// -----------------------------------------------------------------------
// UPS
// -----------------------------------------------------------------------
export async function createUpsBooking(_prev: CourierBookingCreateState, formData: FormData): Promise<CourierBookingCreateState> {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  const orderId = str(formData, "order_id");
  if (!orderId) return { ...CREATE_INITIAL, error: "Missing order — look it up again." };
  const shipperNumber = str(formData, "ups_shipper_number");
  if (!shipperNumber) return { ...CREATE_INITIAL, error: "UPS Shipper Number is required." };

  const shipper = await resolveShipperProfile(supabase, employee.currentCompanyId);
  if (!shipper) return { ...CREATE_INITIAL, error: "No shipper profile set up for this company yet — fill in the shipper profile section above first." };

  const weightKg = num(formData, "package_weight_kg");
  const dims = { length: num(formData, "package_length_cm"), width: num(formData, "package_width_cm"), height: num(formData, "package_height_cm") };
  const currencyCode = str(formData, "currency_code") || "USD";
  const zoneLabel = strOrNull(formData, "zone_label");

  const input = {
    serviceCode: str(formData, "service_code") || "07",
    ddpDdu: (strOrNull(formData, "ddp_ddu") as UpsDdpDdu | null) ?? null,
    shipperNumber,
    shipper: {
      name: shipper.company_name,
      attentionName: shipper.contact_name,
      phone: shipper.phone,
      address1: shipper.address1,
      address2: shipper.address2,
      city: shipper.city,
      state: shipper.state,
      postalCode: shipper.postcode,
      countryCode: shipper.country_code,
    },
    recipient: {
      name: str(formData, "recipient_name"),
      attentionName: str(formData, "recipient_name"),
      phone: str(formData, "recipient_phone"),
      address1: str(formData, "recipient_address1"),
      address2: strOrNull(formData, "recipient_address2"),
      city: str(formData, "recipient_city"),
      state: strOrNull(formData, "recipient_state"),
      postalCode: str(formData, "recipient_postcode"),
      countryCode: str(formData, "recipient_country_code"),
    },
    packageWeightKg: weightKg,
    packageDimsCm: dims,
    currencyCode,
    customsValue: numOrNull(formData, "customs_value"),
    commodityDescription: strOrNull(formData, "goods_description"),
    referenceNo: str(formData, "ref_no"),
  };

  try {
    const credentials = await resolveCourierCredentials(supabase, employee.currentCompanyId, "ups");
    const result = await createUpsShipment(input, credentials);
    let bookedAmt = result.bookedAmt;
    let bookedCurrency = result.bookedCurrency;
    let bookedSource: "api" | "rate_card_estimate" | null = bookedAmt != null ? "api" : null;
    if (bookedAmt == null && zoneLabel) {
      const est = await estimateBookedAmountFromRateCard(supabase, employee.currentCompanyId, "UPS", zoneLabel, weightKg);
      if (est) {
        bookedAmt = est.amt;
        bookedCurrency = est.currency;
        bookedSource = "rate_card_estimate";
      }
    }

    if (!result.trackingNo) {
      await logAttempt(supabase, { courier: "ups", orderId, serviceCode: input.serviceCode, ddpDdu: input.ddpDdu, status: "failed", responsePayload: result.raw, errorMessage: "No tracking number in response.", createdBy: employee.id });
      return { ...CREATE_INITIAL, error: "UPS accepted the request but returned no tracking number — see the attempt log." };
    }

    const shipmentId = await writeOrderShipmentFromBooking(supabase, {
      orderId,
      courierLabel: "UPS",
      awbNo: result.trackingNo,
      employeeId: employee.id,
      weightKg,
      dimsCm: dims,
      bookedAmt,
      bookedCurrency,
      bookedAmountSource: bookedSource,
    });

    await logAttempt(supabase, {
      courier: "ups",
      orderId,
      orderShipmentId: shipmentId,
      serviceCode: input.serviceCode,
      ddpDdu: input.ddpDdu,
      status: "created",
      awbNo: result.trackingNo,
      labelUrl: result.labelUrl,
      bookedAmt,
      bookedCurrency,
      bookedAmountSource: bookedSource,
      responsePayload: result.raw,
      createdBy: employee.id,
    });

    revalidatePath("/dashboard/courier-booking");
    revalidatePath("/dashboard/orders");
    return { error: null, success: true, trackingNo: result.trackingNo, bookedAmt, bookedCurrency, bookedAmountSource: bookedSource, labelUrl: result.labelUrl ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAttempt(supabase, { courier: "ups", orderId, serviceCode: input.serviceCode, ddpDdu: input.ddpDdu, status: "failed", errorMessage: message, createdBy: employee.id });
    return { ...CREATE_INITIAL, error: message };
  }
}

// -----------------------------------------------------------------------
// Aramex
// -----------------------------------------------------------------------
export async function createAramexBooking(_prev: CourierBookingCreateState, formData: FormData): Promise<CourierBookingCreateState> {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  const orderId = str(formData, "order_id");
  if (!orderId) return { ...CREATE_INITIAL, error: "Missing order — look it up again." };
  const accountNumber = str(formData, "aramex_account_number");
  if (!accountNumber) return { ...CREATE_INITIAL, error: "Aramex Account Number is required." };

  const shipper = await resolveShipperProfile(supabase, employee.currentCompanyId);
  if (!shipper) return { ...CREATE_INITIAL, error: "No shipper profile set up for this company yet — fill in the shipper profile section above first." };

  const weightKg = num(formData, "package_weight_kg");
  const dims = { length: num(formData, "package_length_cm"), width: num(formData, "package_width_cm"), height: num(formData, "package_height_cm") };
  const currencyCode = str(formData, "currency_code") || "USD";
  const zoneLabel = strOrNull(formData, "zone_label");
  const ddpDdu = (str(formData, "ddp_ddu") as AramexDdpDdu) || "DDU";

  const input = {
    productGroup: (str(formData, "product_group") || "EXP") as "EXP" | "DOM",
    productType: str(formData, "service_code") || "PPX",
    ddpDdu,
    shipper: {
      accountNumber,
      contactName: shipper.contact_name,
      companyName: shipper.company_name,
      phone: shipper.phone,
      email: shipper.email,
      address1: shipper.address1,
      address2: shipper.address2,
      city: shipper.city,
      stateOrProvince: shipper.state,
      postCode: shipper.postcode,
      countryCode: shipper.country_code,
    },
    consignee: {
      contactName: str(formData, "recipient_name"),
      companyName: strOrNull(formData, "recipient_company"),
      phone: str(formData, "recipient_phone"),
      email: strOrNull(formData, "recipient_email"),
      address1: str(formData, "recipient_address1"),
      address2: strOrNull(formData, "recipient_address2"),
      city: str(formData, "recipient_city"),
      stateOrProvince: strOrNull(formData, "recipient_state"),
      postCode: str(formData, "recipient_postcode"),
      countryCode: str(formData, "recipient_country_code"),
    },
    packageWeightKg: weightKg,
    packageDimsCm: dims,
    numberOfPieces: num(formData, "number_of_pieces") || 1,
    currencyCode,
    customsValue: numOrNull(formData, "customs_value"),
    goodsDescription: str(formData, "goods_description") || "General merchandise",
    goodsOriginCountry: shipper.country_code,
    referenceNo: str(formData, "ref_no"),
  };

  try {
    const credentials = await resolveCourierCredentials(supabase, employee.currentCompanyId, "aramex");
    const result = await createAramexShipment(input, credentials);
    // Aramex's own create response never carries pricing (see
    // aramex-shipping.ts header comment) — always falls back to the rate
    // card here, not conditionally.
    let bookedAmt: number | null = null;
    let bookedCurrency: string | null = null;
    let bookedSource: "api" | "rate_card_estimate" | null = null;
    if (zoneLabel) {
      const est = await estimateBookedAmountFromRateCard(supabase, employee.currentCompanyId, "Aramex", zoneLabel, weightKg);
      if (est) {
        bookedAmt = est.amt;
        bookedCurrency = est.currency;
        bookedSource = "rate_card_estimate";
      }
    }

    if (!result.trackingNo) {
      await logAttempt(supabase, { courier: "aramex", orderId, serviceCode: input.productType, ddpDdu, status: "failed", responsePayload: result.raw, errorMessage: "No tracking number in response.", createdBy: employee.id });
      return { ...CREATE_INITIAL, error: "Aramex accepted the request but returned no tracking number — see the attempt log." };
    }

    const shipmentId = await writeOrderShipmentFromBooking(supabase, {
      orderId,
      courierLabel: "Aramex",
      awbNo: result.trackingNo,
      employeeId: employee.id,
      weightKg,
      dimsCm: dims,
      bookedAmt,
      bookedCurrency,
      bookedAmountSource: bookedSource,
    });

    await logAttempt(supabase, {
      courier: "aramex",
      orderId,
      orderShipmentId: shipmentId,
      serviceCode: input.productType,
      ddpDdu,
      status: "created",
      awbNo: result.trackingNo,
      labelUrl: result.labelUrl,
      bookedAmt,
      bookedCurrency,
      bookedAmountSource: bookedSource,
      responsePayload: result.raw,
      createdBy: employee.id,
    });

    revalidatePath("/dashboard/courier-booking");
    revalidatePath("/dashboard/orders");
    return { error: null, success: true, trackingNo: result.trackingNo, bookedAmt, bookedCurrency, bookedAmountSource: bookedSource, labelUrl: result.labelUrl ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAttempt(supabase, { courier: "aramex", orderId, serviceCode: input.productType, ddpDdu, status: "failed", errorMessage: message, createdBy: employee.id });
    return { ...CREATE_INITIAL, error: message };
  }
}

// -----------------------------------------------------------------------
// Delhivery — domestic-only, no DDP/DDU (see delhivery-ship.ts header).
// -----------------------------------------------------------------------
export async function createDelhiveryBooking(_prev: CourierBookingCreateState, formData: FormData): Promise<CourierBookingCreateState> {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  const orderId = str(formData, "order_id");
  if (!orderId) return { ...CREATE_INITIAL, error: "Missing order — look it up again." };
  const pickupLocationName = str(formData, "pickup_location_name");
  if (!pickupLocationName) return { ...CREATE_INITIAL, error: "Delhivery Pickup Location Name is required (must match a location registered on the Delhivery dashboard)." };

  const weightKg = num(formData, "package_weight_kg");
  const dims = { length: num(formData, "package_length_cm"), width: num(formData, "package_width_cm"), height: num(formData, "package_height_cm") };
  const zoneLabel = strOrNull(formData, "zone_label");
  const paymentMode = (str(formData, "payment_mode") as "Prepaid" | "COD") || "Prepaid";

  const input = {
    pickupLocationName,
    paymentMode,
    consignee: {
      name: str(formData, "recipient_name"),
      phone: str(formData, "recipient_phone"),
      address: str(formData, "recipient_address1"),
      city: str(formData, "recipient_city"),
      state: str(formData, "recipient_state"),
      pincode: str(formData, "recipient_postcode"),
      country: "India",
    },
    packageWeightGrams: Math.round(weightKg * 1000),
    packageDimsCm: dims,
    productDescription: str(formData, "goods_description") || "General merchandise",
    orderRefNo: str(formData, "ref_no"),
    codAmount: paymentMode === "COD" ? numOrNull(formData, "cod_amount") : null,
    shipmentValue: num(formData, "customs_value"),
  };

  try {
    const credentials = await resolveCourierCredentials(supabase, employee.currentCompanyId, "delhivery");
    const result = await createDelhiveryShipment(input, credentials);
    // Delhivery's create.json never carries pricing — always rate-card fallback, same as Aramex.
    let bookedAmt: number | null = null;
    let bookedCurrency: string | null = null;
    let bookedSource: "api" | "rate_card_estimate" | null = null;
    if (zoneLabel) {
      const est = await estimateBookedAmountFromRateCard(supabase, employee.currentCompanyId, "Delhivery", zoneLabel, weightKg);
      if (est) {
        bookedAmt = est.amt;
        bookedCurrency = est.currency;
        bookedSource = "rate_card_estimate";
      }
    }

    if (!result.trackingNo) {
      await logAttempt(supabase, { courier: "delhivery", orderId, status: "failed", responsePayload: result.raw, errorMessage: "No waybill in response.", createdBy: employee.id });
      return { ...CREATE_INITIAL, error: "Delhivery accepted the request but returned no waybill — see the attempt log." };
    }

    const shipmentId = await writeOrderShipmentFromBooking(supabase, {
      orderId,
      courierLabel: "Delhivery",
      awbNo: result.trackingNo,
      employeeId: employee.id,
      weightKg,
      dimsCm: dims,
      bookedAmt,
      bookedCurrency,
      bookedAmountSource: bookedSource,
    });

    await logAttempt(supabase, {
      courier: "delhivery",
      orderId,
      orderShipmentId: shipmentId,
      status: "created",
      awbNo: result.trackingNo,
      bookedAmt,
      bookedCurrency,
      bookedAmountSource: bookedSource,
      responsePayload: result.raw,
      createdBy: employee.id,
    });

    revalidatePath("/dashboard/courier-booking");
    revalidatePath("/dashboard/orders");
    return { error: null, success: true, trackingNo: result.trackingNo, bookedAmt, bookedCurrency, bookedAmountSource: bookedSource, labelUrl: result.labelUrl ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAttempt(supabase, { courier: "delhivery", orderId, status: "failed", errorMessage: message, createdBy: employee.id });
    return { ...CREATE_INITIAL, error: message };
  }
}

// -----------------------------------------------------------------------
// Shiprocket — domestic adhoc-order flow only (see shiprocket-ship.ts).
// -----------------------------------------------------------------------
export async function createShiprocketBooking(_prev: CourierBookingCreateState, formData: FormData): Promise<CourierBookingCreateState> {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  const orderId = str(formData, "order_id");
  if (!orderId) return { ...CREATE_INITIAL, error: "Missing order — look it up again." };
  const pickupLocationName = str(formData, "pickup_location_name");
  if (!pickupLocationName) return { ...CREATE_INITIAL, error: "Shiprocket Pickup Location Name is required (must match a location registered on the Shiprocket dashboard)." };

  const weightKg = num(formData, "package_weight_kg");
  const dims = { length: num(formData, "package_length_cm"), width: num(formData, "package_width_cm"), height: num(formData, "package_height_cm") };
  const zoneLabel = strOrNull(formData, "zone_label");
  const subTotal = num(formData, "customs_value");

  const input = {
    orderRefNo: str(formData, "ref_no"),
    orderDate: new Date().toISOString().slice(0, 10),
    pickupLocationName,
    billing: {
      customerName: str(formData, "recipient_name"),
      address: str(formData, "recipient_address1"),
      city: str(formData, "recipient_city"),
      state: str(formData, "recipient_state"),
      pincode: str(formData, "recipient_postcode"),
      country: str(formData, "recipient_country_code") || "India",
      phone: str(formData, "recipient_phone"),
      email: str(formData, "recipient_email") || "no-reply@example.com",
    },
    item: {
      name: str(formData, "goods_description") || "General merchandise",
      sku: str(formData, "item_sku") || str(formData, "ref_no"),
      units: 1,
      sellingPrice: subTotal,
    },
    paymentMethod: (str(formData, "payment_mode") as "Prepaid" | "COD") || "Prepaid",
    subTotal,
    packageWeightKg: weightKg,
    packageDimsCm: dims,
  };

  try {
    const credentials = await resolveCourierCredentials(supabase, employee.currentCompanyId, "shiprocket");
    const result = await createShiprocketShipment(input, credentials);
    let bookedAmt = result.bookedAmt;
    let bookedCurrency = result.bookedCurrency;
    let bookedSource: "api" | "rate_card_estimate" | null = bookedAmt != null ? "api" : null;
    if (bookedAmt == null && zoneLabel) {
      const est = await estimateBookedAmountFromRateCard(supabase, employee.currentCompanyId, "Shiprocket", zoneLabel, weightKg);
      if (est) {
        bookedAmt = est.amt;
        bookedCurrency = est.currency;
        bookedSource = "rate_card_estimate";
      }
    }

    if (!result.trackingNo) {
      await logAttempt(supabase, { courier: "shiprocket", orderId, status: "failed", responsePayload: result.raw, errorMessage: "No AWB in response.", createdBy: employee.id });
      return { ...CREATE_INITIAL, error: "Shiprocket accepted the order but AWB assignment returned no AWB — see the attempt log." };
    }

    const shipmentId = await writeOrderShipmentFromBooking(supabase, {
      orderId,
      courierLabel: "Shiprocket",
      awbNo: result.trackingNo,
      employeeId: employee.id,
      weightKg,
      dimsCm: dims,
      bookedAmt,
      bookedCurrency,
      bookedAmountSource: bookedSource,
    });

    await logAttempt(supabase, {
      courier: "shiprocket",
      orderId,
      orderShipmentId: shipmentId,
      status: "created",
      awbNo: result.trackingNo,
      bookedAmt,
      bookedCurrency,
      bookedAmountSource: bookedSource,
      responsePayload: result.raw,
      createdBy: employee.id,
    });

    revalidatePath("/dashboard/courier-booking");
    revalidatePath("/dashboard/orders");
    return { error: null, success: true, trackingNo: result.trackingNo, bookedAmt, bookedCurrency, bookedAmountSource: bookedSource, labelUrl: result.labelUrl ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAttempt(supabase, { courier: "shiprocket", orderId, status: "failed", errorMessage: message, createdBy: employee.id });
    return { ...CREATE_INITIAL, error: message };
  }
}

// -----------------------------------------------------------------------
// DHL — DHL Express MyDHL API. See dhl-ship.ts header comment: DHL's own
// incoterm field (DAP/DDP) is genuinely different in shape from FedEx's
// paymentType and UPS's TermsOfShipment — mapped inside createDhlShipment,
// not here, same one-place-to-fix convention as the other 4 couriers.
// Booked amount is treated as uncertain (not confirmed-documented like
// FedEx/UPS/Shiprocket) — same always-try-api-then-fallback shape as
// FedEx/UPS/Shiprocket below, since dhl-ship.ts does defensively look for
// a price and returns null when it finds none.
// -----------------------------------------------------------------------
export async function createDhlBooking(_prev: CourierBookingCreateState, formData: FormData): Promise<CourierBookingCreateState> {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  const orderId = str(formData, "order_id");
  if (!orderId) return { ...CREATE_INITIAL, error: "Missing order — look it up again." };
  const accountNumber = str(formData, "dhl_account_number");
  if (!accountNumber) return { ...CREATE_INITIAL, error: "DHL Express Account Number is required." };

  const shipper = await resolveShipperProfile(supabase, employee.currentCompanyId);
  if (!shipper) return { ...CREATE_INITIAL, error: "No shipper profile set up for this company yet — fill in the shipper profile section above first." };

  const weightKg = num(formData, "package_weight_kg");
  const dims = { length: num(formData, "package_length_cm"), width: num(formData, "package_width_cm"), height: num(formData, "package_height_cm") };
  const currencyCode = str(formData, "currency_code") || "USD";
  const zoneLabel = strOrNull(formData, "zone_label");
  const ddpDdu = (str(formData, "ddp_ddu") as DhlDdpDdu) || "DDU";

  const input = {
    productCode: str(formData, "service_code") || "P",
    ddpDdu,
    accountNumber,
    shipper: {
      contactName: shipper.contact_name,
      companyName: shipper.company_name,
      phone: shipper.phone,
      email: shipper.email,
      address1: shipper.address1,
      address2: shipper.address2,
      city: shipper.city,
      stateOrProvince: shipper.state,
      postalCode: shipper.postcode,
      countryCode: shipper.country_code,
    },
    recipient: {
      contactName: str(formData, "recipient_name"),
      companyName: strOrNull(formData, "recipient_company"),
      phone: str(formData, "recipient_phone"),
      email: strOrNull(formData, "recipient_email"),
      address1: str(formData, "recipient_address1"),
      address2: strOrNull(formData, "recipient_address2"),
      city: str(formData, "recipient_city"),
      stateOrProvince: strOrNull(formData, "recipient_state"),
      postalCode: str(formData, "recipient_postcode"),
      countryCode: str(formData, "recipient_country_code"),
    },
    packageWeightKg: weightKg,
    packageDimsCm: dims,
    currencyCode,
    customsValue: numOrNull(formData, "customs_value"),
    goodsDescription: str(formData, "goods_description") || "General merchandise",
    numberOfPieces: num(formData, "number_of_pieces") || 1,
    referenceNo: str(formData, "ref_no"),
  };

  try {
    const credentials = await resolveCourierCredentials(supabase, employee.currentCompanyId, "dhl");
    const result = await createDhlShipment(input, credentials);
    let bookedAmt = result.bookedAmt;
    let bookedCurrency = result.bookedCurrency;
    let bookedSource: "api" | "rate_card_estimate" | null = bookedAmt != null ? "api" : null;
    if (bookedAmt == null && zoneLabel) {
      const est = await estimateBookedAmountFromRateCard(supabase, employee.currentCompanyId, "DHL", zoneLabel, weightKg);
      if (est) {
        bookedAmt = est.amt;
        bookedCurrency = est.currency;
        bookedSource = "rate_card_estimate";
      }
    }

    if (!result.trackingNo) {
      await logAttempt(supabase, { courier: "dhl", orderId, serviceCode: input.productCode, ddpDdu, status: "failed", responsePayload: result.raw, errorMessage: "No tracking number in response.", createdBy: employee.id });
      return { ...CREATE_INITIAL, error: "DHL accepted the request but returned no tracking number — see the attempt log." };
    }

    const shipmentId = await writeOrderShipmentFromBooking(supabase, {
      orderId,
      courierLabel: "DHL",
      awbNo: result.trackingNo,
      employeeId: employee.id,
      weightKg,
      dimsCm: dims,
      bookedAmt,
      bookedCurrency,
      bookedAmountSource: bookedSource,
    });

    await logAttempt(supabase, {
      courier: "dhl",
      orderId,
      orderShipmentId: shipmentId,
      serviceCode: input.productCode,
      ddpDdu,
      status: "created",
      awbNo: result.trackingNo,
      labelUrl: result.labelUrl,
      bookedAmt,
      bookedCurrency,
      bookedAmountSource: bookedSource,
      responsePayload: result.raw,
      createdBy: employee.id,
    });

    revalidatePath("/dashboard/courier-booking");
    revalidatePath("/dashboard/orders");
    return { error: null, success: true, trackingNo: result.trackingNo, bookedAmt, bookedCurrency, bookedAmountSource: bookedSource, labelUrl: result.labelUrl ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAttempt(supabase, { courier: "dhl", orderId, serviceCode: input.productCode, ddpDdu, status: "failed", errorMessage: message, createdBy: employee.id });
    return { ...CREATE_INITIAL, error: message };
  }
}
