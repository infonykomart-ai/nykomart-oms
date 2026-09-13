"use server";

// 2026-09-13 — "vaha par mujhe system vala invoice hi chahiye": until now
// the FedEx ETD upload happened exactly once, inside the booking flow
// (uploadCsbVInvoiceToFedex from courier-booking/actions.ts). But the real
// CSB-V invoice stays EDITABLE on /dashboard/invoices/[id] long after
// booking — consignee address, weight/dims, IOSS/VAT/EORI, broker, freight
// values — and every one of those edits previously never reached FedEx.
// This action re-renders the invoice AS IT STANDS RIGHT NOW (same
// renderer, same company logo pipeline as booking time) and re-uploads it
// to FedEx against the SAME AWB — so "jo system me invoice hai, wahi
// FedEx par jaye" stays true at every point in its life, not just at
// booking. Idempotent: ETDPostshipment is an upsert-by-tracking workflow,
// so re-uploading replaces the previously uploaded document rather than
// duplicating it.

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { uploadFedexPostShipmentInvoice } from "@/lib/couriers/fedex-documents";
import { resolveCourierCredentials } from "@/lib/couriers/credentials";
import { renderCsbVInvoicePdf, type CsbVPdfInvoice, type CsbVPdfItem, type CsbVPdfMeta } from "@/lib/couriers/csb-v-invoice-pdf";
import { safeExternalFetch } from "@/lib/security/safe-external-fetch";
import { parseCountryFromAddress } from "@/lib/geo/parse-country";
import { logEntryError } from "@/lib/error-log/log-entry-error";
import sharp from "sharp";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

// Same ISO2 mapping the booking flow uses (fedex-ship.ts) — the handful of
// countries this business actually ships to, plus the parse-country
// canonical names it produces.
const ISO2_BY_COUNTRY: Record<string, string> = {
  "united states": "US",
  "united kingdom": "GB",
  canada: "CA",
  australia: "AU",
  germany: "DE",
  france: "FR",
  netherlands: "NL",
  switzerland: "CH",
  spain: "ES",
  ireland: "IE",
  italy: "IT",
  sweden: "SE",
  norway: "NO",
  denmark: "DK",
  belgium: "BE",
  poland: "PL",
  portugal: "PT",
  "new zealand": "NZ",
  singapore: "SG",
  japan: "JP",
  "united arab emirates": "AE",
  "saudi arabia": "SA",
  israel: "IL",
  mexico: "MX",
  india: "IN",
};

function iso2ForDestination(country: string | null, fallbackAddress: string | null): string | null {
  const source = (country ?? "").trim() || parseCountryFromAddress(fallbackAddress) || "";
  return ISO2_BY_COUNTRY[source.toLowerCase()] ?? null;
}

// Mirror of booking-time uploadCsbVInvoiceToFedex's logo pipeline (kept as
// a copy rather than shared so the two flows can never break each other):
// any raster/SVG/data-URI source → 144px PNG data: URI via sharp, every
// failure silently skipping the logo.
async function loadLogoDataUri(supabase: ServiceClient, companyId: string): Promise<string | null> {
  const { data: logoCompany } = await supabase.from("companies").select("logo_url").eq("id", companyId).single();
  const logoUrl = logoCompany?.logo_url?.trim() || null;
  if (!logoUrl) return null;
  try {
    let raw: Buffer | null = null;
    if (logoUrl.startsWith("data:image/")) {
      raw = Buffer.from(logoUrl.slice(logoUrl.indexOf(",") + 1), "base64");
    } else {
      let currentUrl = logoUrl;
      for (let hop = 0; hop < 3; hop++) {
        const fetched = await safeExternalFetch(currentUrl);
        if (fetched.ok) {
          raw = Buffer.from(await fetched.response.arrayBuffer());
          break;
        }
        if (fetched.location) {
          currentUrl = new URL(fetched.location, currentUrl).toString();
          continue;
        }
        break;
      }
    }
    if (raw && raw.length > 0 && raw.length <= 5 * 1024 * 1024) {
      const png = await sharp(raw).resize(144, 144, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
      return `data:image/png;base64,${png.toString("base64")}`;
    }
  } catch {
    // Logo is cosmetic — never fail the upload over it.
  }
  return null;
}

export type UploadInvoiceResult = { error: string | null };

export async function uploadInvoiceToFedex(invoiceId: string): Promise<UploadInvoiceResult> {
  const employee = await requireCapability("invoicing");
  const supabase = createServiceRoleClient();

  const [{ data: inv, error: invErr }, { data: invOrders }, { data: invCats }] = await Promise.all([
    supabase.from("sales_invoices").select("*").eq("id", invoiceId).single(),
    supabase
      .from("orders")
      .select("id, ref_no, ref_no_base, sku_label, size_label, qty, item_category_id, order_value_original, order_currency, colour, buyer_name_address")
      .eq("invoice_id", invoiceId),
    supabase.from("item_categories").select("id, name, hsn_code, harmonized_tariff_number"),
  ]);
  if (invErr || !inv) return { error: "Invoice could not be loaded." };

  // Company scoping — same pattern as this file's sibling invoice actions
  // (updateInvoiceFields/deleteInvoice): the caller may only upload an
  // invoice belonging to a company they can act as.
  if (!employee.companyIds.includes(inv.company_id)) return { error: "This invoice belongs to another company." };

  // The AWB + shipment date come from the invoice's own order shipment —
  // the same (order, AWB) pair the booking flow uploaded against.
  const firstOrderId = (invOrders ?? [])[0]?.id ?? null;
  let awbNo = inv.awb_no ?? null;
  let shipmentDate: string | null = null;
  const originCountryCode = "IN";
  let destinationCountryCode: string | null = null;
  if (firstOrderId) {
    const { data: shipment } = await supabase
      .from("order_shipments")
      .select("awb_no, courier_name, created_at")
      .eq("order_id", firstOrderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (shipment?.awb_no) {
      awbNo = shipment.awb_no;
      shipmentDate = shipment.created_at?.slice(0, 10) ?? null;
    }
  }
  if (!awbNo) return { error: "No AWB/tracking number is linked to this invoice yet — book the shipment first." };

  const [{ data: company }, { data: profile }, { data: store }] = await Promise.all([
    supabase.from("companies").select("name, logo_url").eq("id", inv.company_id).single(),
    supabase
      .from("company_profiles")
      .select("address, phone, whatsapp, email, iec, gstin, ad_code, bank_name, account_no, ifsc_code")
      .eq("company_id", inv.company_id)
      .maybeSingle(),
    supabase.from("stores").select("name").eq("id", inv.store_id).single(),
  ]);
  const catMap = new Map((invCats ?? []).map((c) => [c.id, c]));
  const pdfItems: CsbVPdfItem[] = (invOrders ?? []).map((o) => ({
    ref_no: o.ref_no,
    ref_no_base: o.ref_no_base,
    sku_label: o.sku_label,
    size_label: o.size_label,
    qty: o.qty,
    colour: o.colour,
    category_name: catMap.get(o.item_category_id)?.name ?? "",
    hsn_code: catMap.get(o.item_category_id)?.hsn_code ?? "",
    harmonized_tariff_number: catMap.get(o.item_category_id)?.harmonized_tariff_number ?? "",
    order_value_original: o.order_value_original,
    order_currency: o.order_currency,
  }));
  const logoDataUri = await loadLogoDataUri(supabase, inv.company_id);
  const pdfMeta: CsbVPdfMeta = {
    logoDataUri,
    companyName: company?.name ?? "",
    companyAddress: profile?.address ?? null,
    companyPhone: profile?.phone ?? null,
    companyWhatsapp: profile?.whatsapp ?? null,
    companyEmail: profile?.email ?? null,
    gstin: profile?.gstin ?? null,
    iec: profile?.iec ?? null,
    adCode: profile?.ad_code ?? null,
    bankName: profile?.bank_name ?? null,
    accountNo: profile?.account_no ?? null,
    ifscCode: profile?.ifsc_code ?? null,
    storeName: store?.name ?? "",
  };
  // Destination country: the invoice's own declaration field first, then
  // the first order's typed address (same parseCountryFromAddress the rest
  // of the app trusts at 99.7% on real data).
  const fallbackAddress = (invOrders ?? [])[0]?.buyer_name_address ?? null;
  destinationCountryCode = iso2ForDestination(inv.destination_country, fallbackAddress);
  if (!destinationCountryCode) return { error: `Destination country "${inv.destination_country ?? "(unknown)"}" could not be mapped for FedEx — set Destination Country on the invoice first.` };

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderCsbVInvoicePdf(inv as unknown as CsbVPdfInvoice, pdfItems, pdfMeta);
  } catch (err) {
    return { error: `PDF could not be rendered: ${err instanceof Error ? err.message : String(err)}` };
  }

  const credentials = await resolveCourierCredentials(supabase, inv.company_id, "fedex");
  const uploadResult = await uploadFedexPostShipmentInvoice(
    {
      trackingNumber: awbNo,
      // ETDPostshipment wants the actual shipment date; created_at of the
      // shipment is the booking moment — the honest value. When unknown
      // (never linked), fall back to today rather than blocking.
      shipmentDate: shipmentDate ?? new Date().toISOString().slice(0, 10),
      originCountryCode,
      destinationCountryCode,
      pdfBuffer,
      fileName: `csb-v-invoice-${awbNo}.pdf`,
    },
    credentials
  );
  if (!uploadResult.ok) {
    const reason = uploadResult.error;
    await logEntryError(supabase, {
      companyId: inv.company_id,
      source: "courier_api",
      reason: `Manual CSB-V invoice upload failed (AWB ${awbNo}): ${reason}`,
      referenceType: "order",
      referenceId: firstOrderId,
      raisedByEmployeeId: employee.id,
      raisedByName: employee.name,
    });
    return { error: reason };
  }
  return { error: null };
}
