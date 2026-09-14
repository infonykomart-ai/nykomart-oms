"use server";

// 2026-09-13 — "JO BLUE COLOUR ME MARK KIYA HAI US INVOICE KI JAGH LINK
// KARO SECOND IMAGE ME JO INVOICE HAI USKO YAHA LINK KARO. PHIR YAHI
// INVOICE FEDEX UPS ARAMEX JISKO BHI JAYEGA YAHI JAYEGA."
//
// The booking page's "Preview Invoice" used to render the OLD simplified
// fedex-invoice-pdf lookalike — a different document from what the
// Invoices module produces. This action instead builds a DRAFT of the REAL
// CSB-V (the exact document /dashboard/invoices prints and the exact PDF
// that uploads to the courier at booking time), by running the same
// value-breakdown + buyer-composition logic generateInvoiceCore runs,
// WITHOUT inserting anything — preview only, zero side effects. The
// uploaded document itself was already switched to this same renderer
// earlier today (uploadCsbVInvoiceToFedex), so what the employee previews
// here is now pixel-identical to what the courier receives.

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { renderCsbVInvoicePdf, type CsbVPdfInvoice, type CsbVPdfItem, type CsbVPdfMeta } from "@/lib/couriers/csb-v-invoice-pdf";
import { computeValueBreakdown } from "@/lib/invoices/value-breakdown";
import { amountInWords } from "@/lib/invoices/number-to-words";
import { originDeclarationFor } from "@/lib/invoices/origin-declaration";
import { dutyPayableByForShipmentTerm } from "@/lib/invoices/duty-payable";
import { composeBuyerNameAndAddress } from "@/lib/compose-buyer-address";
import { safeExternalFetch } from "@/lib/security/safe-external-fetch";
import sharp from "sharp";
import { lookupOrderForCourierBooking } from "./actions";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

function fStr(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function fStrOrNull(formData: FormData, key: string): string | null {
  const v = fStr(formData, key);
  return v || null;
}
function fNum(formData: FormData, key: string): number {
  const v = Number(formData.get(key));
  return Number.isFinite(v) ? v : 0;
}
// Same logo pipeline as booking-time uploadCsbVInvoiceToFedex (raster/
// SVG/data-URI → 144px PNG via sharp; every failure just skips the logo).
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
    // cosmetic only
  }
  return null;
}

export type CsbVPreviewState = { error: string | null; dataUri: string | null };

export async function previewCsbVDraftInvoice(formData: FormData): Promise<CsbVPreviewState> {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  // Same lookup the booking form itself uses — the order row (+ combined
  // batch) with every default the form shows. The rendered order context
  // comes back in `lookedUp.order`.
  const lookedUp = await lookupOrderForCourierBooking({ error: null, order: null }, formData);
  const order = lookedUp.order;
  if (!order) return { error: lookedUp.error ?? "Order could not be loaded — check the Ref No.", dataUri: null };

  const { data: primaryRow } = await supabase
    .from("orders")
    .select("id, ref_no, ref_no_base, sku_label, size_label, qty, item_category_id, order_value_original, order_currency, colour, store_id, buyer_name_address, buyer_address1, buyer_address2, buyer_address3, buyer_city, buyer_state, buyer_postal_code, destination_country, email_id, contact_no, vat_number, eori_number, ioss_number")
    .eq("id", order.id)
    .maybeSingle();
  if (!primaryRow) return { error: "Order row could not be loaded.", dataUri: null };

  const batchIds = order.combinedOrderIds.filter((id) => id !== order.id);
  const { data: siblingRows } = batchIds.length
    ? await supabase
        .from("orders")
        .select("id, ref_no, ref_no_base, sku_label, size_label, qty, item_category_id, order_value_original, order_currency, colour")
        .in("id", batchIds)
    : { data: [] };

  const allOrders = [primaryRow, ...(siblingRows ?? [])];

  // Same context queries uploadCsbVInvoiceToFedex performs so the preview
  // is the real document's header/footer exactly (company profile, store).
  const [{ data: company }, { data: profile }, { data: store }] = await Promise.all([
    supabase.from("companies").select("name").eq("id", employee.currentCompanyId).single(),
    supabase
      .from("company_profiles")
      .select("address, phone, whatsapp, email, iec, gstin, ad_code, bank_name, account_no, ifsc_code")
      .eq("company_id", employee.currentCompanyId)
      .maybeSingle(),
    supabase.from("stores").select("name").eq("id", primaryRow.store_id ?? "").maybeSingle(),
  ]);
  if (!store) return { error: "The order's store could not be loaded.", dataUri: null };

  // Same CSB-V value breakdown generateInvoiceCore runs at invoice time —
  // so the preview's totals match the invoice the booking will create.
  const orderValueSum = allOrders.reduce((sum, o) => sum + Number(o.order_value_original || 0), 0);
  const breakdown = computeValueBreakdown(orderValueSum, store.name);
  const invoiceCurrency = primaryRow.order_currency ?? "USD";
  const declaredValueWords = amountInWords(breakdown.invoiceValueUsd, invoiceCurrency);

  const { data: cats } = await supabase.from("item_categories").select("id, name, hsn_code, harmonized_tariff_number");
  const catMap = new Map((cats ?? []).map((c) => [c.id, c]));
  const pdfItems: CsbVPdfItem[] = allOrders.map((o) => ({
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
    order_currency: o.order_currency ?? "USD",
  }));

  const logoDataUri = await loadLogoDataUri(supabase, employee.currentCompanyId);
  const ddpDdu = (fStrOrNull(formData, "ddp_ddu") as "DDP" | "DDU" | null) ?? "DDU";
  const weightKg = fNum(formData, "package_weight_kg");
  const dims = { length: fNum(formData, "package_length_cm"), width: fNum(formData, "package_width_cm"), height: fNum(formData, "package_height_cm") };
  const noOfPackages = Math.max(1, allOrders.length);

  // Buyer block composed the same way generateInvoiceCore composes it (the
  // form's live recipient fields win over the stored order when filled —
  // the preview must reflect what's on the screen right now).
  const recipientName = fStr(formData, "recipient_name") || "";
  const composedBuyer = composeBuyerNameAndAddress(primaryRow);
  const liveAddressBlock = [
    recipientName,
    fStrOrNull(formData, "recipient_address1"),
    fStrOrNull(formData, "recipient_address2"),
    [fStr(formData, "recipient_city"), fStr(formData, "recipient_state"), fStr(formData, "recipient_postcode")].filter(Boolean).join(", "),
    order.buyerDestinationCountry ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  const draftInvoice: CsbVPdfInvoice = {
    csb_type: "CSB-V",
    // DRAFT markers everywhere a real number would go — the real numbers
    // are only assigned when the shipment actually books (reserved BEFORE
    // the courier call for FedEx, see resolveFedexLabelReferences).
    invoice_no: "DRAFT",
    master_invoice_no: "DRAFT",
    invoice_date: new Date().toISOString().slice(0, 10),
    shipment_term: ddpDdu,
    courier_company: "FedEx",
    department_reference_no: null,
    destination_country: order.buyerDestinationCountry ?? primaryRow.destination_country ?? null,
    origin_declaration: originDeclarationFor(order.buyerDestinationCountry ?? primaryRow.destination_country ?? null),
    ioss_number: primaryRow.ioss_number,
    vat_number: primaryRow.vat_number,
    eori_number: primaryRow.eori_number,
    weight_kg: weightKg || null,
    length_cm: dims.length || null,
    width_cm: dims.width || null,
    height_cm: dims.height || null,
    buyer_name_address: liveAddressBlock || composedBuyer || order.buyerNameAddress || "",
    buyer_email: fStrOrNull(formData, "recipient_email") ?? primaryRow.email_id,
    buyer_phone: fStr(formData, "recipient_phone") || primaryRow.contact_no || null,
    other_than_consignee: null,
    no_of_packages: noOfPackages,
    marks_and_nos: null,
    vessel_flight_no: null,
    port_of_discharge: null,
    value_percent: breakdown.valuePercent,
    invoice_value_usd: breakdown.invoiceValueUsd,
    item_cost_total: breakdown.itemCostTotal,
    insurance_total: breakdown.insuranceTotal,
    freight_total: breakdown.freightTotal,
    invoice_currency: invoiceCurrency,
    taxable_value_inr: null,
    declared_value_words: declaredValueWords,
    awb_no: null,
    remark: "DRAFT PREVIEW — generated on the booking screen before booking. Not a final invoice.",
    broker_name: null,
    broker_tel: null,
    broker_contact: null,
    duty_payable_by: dutyPayableByForShipmentTerm(ddpDdu),
    duty_payable_other_specify: null,
  };

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
    storeName: store.name,
  };

  try {
    const pdfBuffer = await renderCsbVInvoicePdf(draftInvoice, pdfItems, pdfMeta);
    return { error: null, dataUri: `data:application/pdf;base64,${pdfBuffer.toString("base64")}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not generate the CSB-V preview.", dataUri: null };
  }
}
