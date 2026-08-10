"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateInvoiceFields, deleteInvoice } from "../actions";
import { originDeclarationFor } from "@/lib/invoices/origin-declaration";
import { itemCostForOrder } from "@/lib/invoices/value-breakdown";
import { isEuDestination, pidSuffixFor } from "@/lib/invoices/pid";

type Invoice = {
  id: string;
  company_id: string;
  store_id: string;
  invoice_no: string;
  master_invoice_no: string;
  invoice_date: string;
  shipment_term: string;
  csb_type: string;
  courier_company: string;
  department_reference_no: string | null;
  destination_country: string | null;
  origin_declaration: string | null;
  ioss_number: string | null;
  weight_kg: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  buyer_name_address: string;
  remark: string | null;
  // 2026-08-10 additions — see db/2026-08-10-invoice-value-breakdown.sql
  value_percent: number | null;
  invoice_value_usd: number | null;
  item_cost_total: number | null;
  insurance_total: number | null;
  freight_total: number | null;
  taxable_value_inr: number | null;
  declared_value_words: string | null;
  awb_no: string | null;
  vessel_flight_no: string | null;
  port_of_discharge: string | null;
  marks_and_nos: string | null;
  no_of_packages: number | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  other_than_consignee: string | null;
  vat_number: string | null;
  eori_number: string | null;
};

type Item = {
  id: string;
  ref_no: string;
  sku_label: string | null;
  size_label: string | null;
  qty: number;
  item_category_name: string;
  hsn_code: string;
  order_value_original: number;
  order_currency: string;
  order_value_usd: number | null;
  colour: string | null;
};

type Company = { id: string; name: string; logo_url: string | null } | null;
type Profile = {
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  iec: string | null;
  gstin: string | null;
  bank_name: string | null;
  account_no: string | null;
  ifsc_code: string | null;
  ad_code: string | null;
} | null;

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

type RelatedNote = { id: string; no: string; amount: number; refNo: string };

const DECLARATION_STATEMENT =
  "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function InvoiceView({
  invoice,
  items,
  company,
  profile,
  storeName,
  relatedNotes,
}: {
  invoice: Invoice;
  items: Item[];
  company: Company;
  profile: Profile;
  storeName: string;
  relatedNotes?: { creditNotes: RelatedNote[]; debitNotes: RelatedNote[] };
}) {
  const [destinationCountry, setDestinationCountry] = useState(invoice.destination_country ?? "");
  const [originDeclaration, setOriginDeclaration] = useState(invoice.origin_declaration ?? "");
  const [departmentRefNo, setDepartmentRefNo] = useState(invoice.department_reference_no ?? "");
  const [iossNumber, setIossNumber] = useState(invoice.ioss_number ?? "");
  const [vatNumber, setVatNumber] = useState(invoice.vat_number ?? "");
  const [eoriNumber, setEoriNumber] = useState(invoice.eori_number ?? "");
  const [weightKg, setWeightKg] = useState(invoice.weight_kg != null ? String(invoice.weight_kg) : "");
  const [lengthCm, setLengthCm] = useState(invoice.length_cm != null ? String(invoice.length_cm) : "");
  const [widthCm, setWidthCm] = useState(invoice.width_cm != null ? String(invoice.width_cm) : "");
  const [heightCm, setHeightCm] = useState(invoice.height_cm != null ? String(invoice.height_cm) : "");
  const [buyerNameAddress, setBuyerNameAddress] = useState(invoice.buyer_name_address);
  const [buyerEmail, setBuyerEmail] = useState(invoice.buyer_email ?? "");
  const [buyerPhone, setBuyerPhone] = useState(invoice.buyer_phone ?? "");
  const [otherThanConsignee, setOtherThanConsignee] = useState(invoice.other_than_consignee ?? "");
  const [awbNo, setAwbNo] = useState(invoice.awb_no ?? "");
  const [vesselFlightNo, setVesselFlightNo] = useState(invoice.vessel_flight_no ?? "");
  const [portOfDischarge, setPortOfDischarge] = useState(invoice.port_of_discharge ?? "");
  const [marksAndNos, setMarksAndNos] = useState(invoice.marks_and_nos ?? "");
  const [noOfPackages, setNoOfPackages] = useState(invoice.no_of_packages != null ? String(invoice.no_of_packages) : "1");
  const [itemCostTotal, setItemCostTotal] = useState(invoice.item_cost_total != null ? String(invoice.item_cost_total) : "");
  const [insuranceTotal, setInsuranceTotal] = useState(invoice.insurance_total != null ? String(invoice.insurance_total) : "");
  const [freightTotal, setFreightTotal] = useState(invoice.freight_total != null ? String(invoice.freight_total) : "");
  const [invoiceValueUsd, setInvoiceValueUsd] = useState(invoice.invoice_value_usd != null ? String(invoice.invoice_value_usd) : "");
  const [taxableValueInr, setTaxableValueInr] = useState(invoice.taxable_value_inr != null ? String(invoice.taxable_value_inr) : "");
  const [declaredValueWords, setDeclaredValueWords] = useState(invoice.declared_value_words ?? "");
  const [remark, setRemark] = useState(invoice.remark ?? "");
  const [isSaving, startSave] = useTransition();
  const [saved, setSaved] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const router = useRouter();

  const isCsbV = invoice.csb_type === "CSB-V";
  // For CSB-V, every item row's displayed Rate/Amount is its OWN
  // order_value_usd's 30% share of the invoice value (see
  // value-breakdown.ts) — always USD, matching the sample's "USD" column
  // headers. For CSB-IV (manual value), keep showing the order's own
  // original declared value/currency, unchanged from before this feature.
  const displayCurrency = isCsbV ? "USD" : (items[0]?.order_currency ?? "");
  // 2026-08-10: "sab chije according to buyer destination add honi hai" —
  // PIDs only apply to EU-destination shipments (see pid.ts's header
  // comment for the full rule + the deliberate simplification of always
  // including them for any EU destination, not just sub-€150 items).
  // Driven by the live destinationCountry state so it updates immediately
  // if the destination is edited before printing.
  const showPid = isEuDestination(destinationCountry);
  const itemDisplayValue = (i: Item): number =>
    isCsbV && invoice.value_percent != null
      ? itemCostForOrder(Number(i.order_value_usd || 0), invoice.value_percent)
      : Number(i.order_value_original || 0);
  const totalValue = items.reduce((sum, i) => sum + itemDisplayValue(i), 0);

  const costNum = Number(itemCostTotal || 0);
  const insuranceNum = Number(insuranceTotal || 0);
  const freightNum = Number(freightTotal || 0);
  const computedTotal = round2(costNum + insuranceNum + freightNum);

  function handleRefillDeclaration() {
    setOriginDeclaration(originDeclarationFor(destinationCountry));
  }

  function handleSave() {
    setSaved(null);
    startSave(async () => {
      const result = await updateInvoiceFields(invoice.id, {
        buyer_name_address: buyerNameAddress,
        destination_country: destinationCountry || null,
        origin_declaration: originDeclaration || null,
        department_reference_no: departmentRefNo || null,
        ioss_number: iossNumber || null,
        vat_number: vatNumber || null,
        eori_number: eoriNumber || null,
        weight_kg: weightKg ? Number(weightKg) : null,
        length_cm: lengthCm ? Number(lengthCm) : null,
        width_cm: widthCm ? Number(widthCm) : null,
        height_cm: heightCm ? Number(heightCm) : null,
        awb_no: awbNo || null,
        vessel_flight_no: vesselFlightNo || null,
        port_of_discharge: portOfDischarge || null,
        marks_and_nos: marksAndNos || null,
        no_of_packages: noOfPackages ? Number(noOfPackages) : null,
        buyer_email: buyerEmail || null,
        buyer_phone: buyerPhone || null,
        other_than_consignee: otherThanConsignee || null,
        item_cost_total: itemCostTotal ? Number(itemCostTotal) : null,
        insurance_total: insuranceTotal ? Number(insuranceTotal) : null,
        freight_total: freightTotal ? Number(freightTotal) : null,
        invoice_value_usd: invoiceValueUsd ? Number(invoiceValueUsd) : null,
        taxable_value_inr: taxableValueInr ? Number(taxableValueInr) : null,
        declared_value_words: declaredValueWords || null,
        remark: remark || null,
      });
      setSaved(result.error ? `Error: ${result.error}` : "Saved successfully.");
    });
  }

  function handleDelete() {
    if (!window.confirm(`Delete invoice "${invoice.invoice_no}"? Its orders will become available to invoice again. This cannot be undone.`)) return;
    setDeleteError(null);
    startDelete(async () => {
      const result = await deleteInvoice(invoice.id);
      if (result.error) setDeleteError(result.error);
      else router.push("/dashboard/invoices");
    });
  }

  const packageLabels = Array.from({ length: Math.max(1, Number(noOfPackages) || 1) }, (_, idx) => `PACK-${idx + 1}`);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #invoice-print-area, #invoice-print-area * { visibility: visible; }
          #invoice-print-area { position: fixed; inset: 0; width: 100%; }
        }
      `}</style>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:hidden">
        <h2 className="text-sm font-semibold text-slate-900">Edit before printing</h2>
        {saved && <p className="text-xs text-slate-500">{saved}</p>}

        <div>
          <label className={labelClass} htmlFor="buyer">Consignee — Buyer Name & Address</label>
          <textarea id="buyer" rows={2} className={inputClass} value={buyerNameAddress} onChange={(e) => setBuyerNameAddress(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="buyer_email">Buyer Email</label>
            <input id="buyer_email" className={inputClass} value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="buyer_phone">Buyer Phone</label>
            <input id="buyer_phone" className={inputClass} value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="other_consignee">Other Than Consignee (usually blank)</label>
          <textarea id="other_consignee" rows={2} className={inputClass} value={otherThanConsignee} onChange={(e) => setOtherThanConsignee(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="dest_country">Destination Country</label>
            <input id="dest_country" className={inputClass} value={destinationCountry} onChange={(e) => setDestinationCountry(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="awb_no">AWB / Tracking No.</label>
            <input id="awb_no" className={inputClass} value={awbNo} onChange={(e) => setAwbNo(e.target.value)} />
          </div>
        </div>

        {/* 2026-08-10: "agar uk & europe ki shipment hai or agar usme
            IOSS, VAT, EORI no vagera aaya hua hai according to destination
            country guideline" — typed in manually, same as IOSS. */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelClass} htmlFor="ioss">IOSS Number</label>
            <input id="ioss" className={inputClass} value={iossNumber} onChange={(e) => setIossNumber(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="vat">VAT Number</label>
            <input id="vat" className={inputClass} value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="eori">EORI Number</label>
            <input id="eori" className={inputClass} value={eoriNumber} onChange={(e) => setEoriNumber(e.target.value)} />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className={labelClass} htmlFor="origin_decl">Origin Declaration</label>
            <button type="button" onClick={handleRefillDeclaration} className="text-xs text-amber-600 underline">
              Refill from Country
            </button>
          </div>
          <textarea id="origin_decl" rows={4} className={inputClass} value={originDeclaration} onChange={(e) => setOriginDeclaration(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="dept_ref">Department Reference No.</label>
            <input id="dept_ref" className={inputClass} value={departmentRefNo} onChange={(e) => setDepartmentRefNo(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="vessel_flight_no">Vessel/Flight No.</label>
            <input id="vessel_flight_no" className={inputClass} value={vesselFlightNo} onChange={(e) => setVesselFlightNo(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="port_of_discharge">Port of Discharge</label>
            <input id="port_of_discharge" className={inputClass} value={portOfDischarge} onChange={(e) => setPortOfDischarge(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="marks_and_nos">Marks & Nos./Container No.</label>
            <input id="marks_and_nos" className={inputClass} value={marksAndNos} onChange={(e) => setMarksAndNos(e.target.value)} />
          </div>
        </div>

        {/* 2026-08-10: value breakdown — Item Cost/Insurance/Freight/Total
            for CSB-V is auto-computed at generation time (currently 60% of
            order value, see value-breakdown.ts) but stays editable here
            like everything else; for CSB-IV it was entered manually on
            the generate form and is likewise editable here. */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-semibold text-slate-700">
            Value Breakdown {invoice.value_percent != null && `(${invoice.value_percent}% of order value — ${invoice.csb_type})`}
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className={labelClass} htmlFor="item_cost_total">Item Cost (USD)</label>
              <input id="item_cost_total" type="number" step="0.01" className={inputClass} value={itemCostTotal} onChange={(e) => setItemCostTotal(e.target.value)} />
            </div>
            <div>
              <label className={labelClass} htmlFor="insurance_total">Insurance (USD)</label>
              <input id="insurance_total" type="number" step="0.01" className={inputClass} value={insuranceTotal} onChange={(e) => setInsuranceTotal(e.target.value)} />
            </div>
            <div>
              <label className={labelClass} htmlFor="freight_total">Freight (USD)</label>
              <input id="freight_total" type="number" step="0.01" className={inputClass} value={freightTotal} onChange={(e) => setFreightTotal(e.target.value)} />
            </div>
            <div>
              <label className={labelClass} htmlFor="invoice_value_usd">Total (USD)</label>
              <input id="invoice_value_usd" type="number" step="0.01" className={inputClass} value={invoiceValueUsd} onChange={(e) => setInvoiceValueUsd(e.target.value)} />
            </div>
          </div>
          {invoiceValueUsd && Math.abs(computedTotal - Number(invoiceValueUsd)) > 0.01 && (
            <p className="mt-2 text-[11px] text-amber-700">
              Note: Item Cost + Insurance + Freight = {computedTotal.toFixed(2)}, which doesn&apos;t match Total ({Number(invoiceValueUsd).toFixed(2)}) — a real
              customs invoice&apos;s line items should sum to the total.
            </p>
          )}
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="taxable_value_inr">Taxable Value (INR)</label>
              <input id="taxable_value_inr" type="number" step="0.01" className={inputClass} value={taxableValueInr} onChange={(e) => setTaxableValueInr(e.target.value)} />
            </div>
            <div>
              <label className={labelClass} htmlFor="no_of_packages">No. of Packages</label>
              <input id="no_of_packages" type="number" min={1} className={inputClass} value={noOfPackages} onChange={(e) => setNoOfPackages(e.target.value)} />
            </div>
          </div>
          <div className="mt-2">
            <label className={labelClass} htmlFor="declared_value_words">Declared Value in Words</label>
            <input id="declared_value_words" className={inputClass} value={declaredValueWords} onChange={(e) => setDeclaredValueWords(e.target.value)} />
          </div>
        </div>

        {/* 2026-08-08: "WEIGHT OR DIMENSION KYU NAHI MANG RAHA" — customs
            declaration fields, typed in here (separate from whatever
            Courier Bill/dispatch_invoices later records for freight
            billing — see actions.ts's comment). */}
        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className={labelClass} htmlFor="weight_kg">Weight (kg)</label>
            <input id="weight_kg" type="number" step="0.001" className={inputClass} value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="length_cm">Length (cm)</label>
            <input id="length_cm" type="number" step="0.01" className={inputClass} value={lengthCm} onChange={(e) => setLengthCm(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="width_cm">Width (cm)</label>
            <input id="width_cm" type="number" step="0.01" className={inputClass} value={widthCm} onChange={(e) => setWidthCm(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="height_cm">Height (cm)</label>
            <input id="height_cm" type="number" step="0.01" className={inputClass} value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="remark">Remark</label>
          <input id="remark" className={inputClass} value={remark} onChange={(e) => setRemark(e.target.value)} />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 rounded-lg border border-amber-500 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
          >
            Print / Save as PDF
          </button>
        </div>

        <div>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50"
          >
            {isDeleting ? "Deleting..." : "Delete Invoice"}
          </button>
          {deleteError && <p className="mt-1 text-xs text-red-600">{deleteError}</p>}
        </div>

        {relatedNotes && (relatedNotes.creditNotes.length > 0 || relatedNotes.debitNotes.length > 0) && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <h3 className="mb-1 text-xs font-semibold text-slate-700">Related Credit/Debit Notes</h3>
            <p className="mb-2 text-[11px] text-slate-400">Documents already created against this invoice&apos;s orders (from Document Entry).</p>
            <div className="space-y-1 text-xs text-slate-600">
              {relatedNotes.creditNotes.map((n) => (
                <p key={n.id}>Credit Note <strong>{n.no}</strong> — ₹{n.amount} ({n.refNo})</p>
              ))}
              {relatedNotes.debitNotes.map((n) => (
                <p key={n.id}>Debit Note <strong>{n.no}</strong> — ₹{n.amount} ({n.refNo})</p>
              ))}
            </div>
          </div>
        )}
      </div>

      <div>
        <div id="invoice-print-area" className="mx-auto min-h-[1100px] w-full bg-white p-8 text-xs text-slate-900" style={{ fontFamily: "Arial, sans-serif" }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold tracking-wide">{invoice.csb_type} - INVOICE</span>
            <span className="rounded border border-slate-400 px-2 py-0.5 text-[10px] font-semibold">E-COM</span>
          </div>

          <div className="mb-4 flex items-start justify-between border-b-2 border-slate-800 pb-3">
            <div className="flex items-start gap-3">
              {company?.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.logo_url} alt={company.name} className="h-12 w-12 object-contain" />
              )}
              <div>
                <div className="text-lg font-bold">{company?.name}</div>
                <div className="text-[11px] text-slate-600">{profile?.address}</div>
                <div className="text-[11px] text-slate-600">
                  {[profile?.phone && `Phone: ${profile.phone}`, profile?.whatsapp && `WhatsApp: ${profile.whatsapp}`].filter(Boolean).join(" | ")}
                </div>
                <div className="text-[11px] text-slate-600">Email: {profile?.email}</div>
              </div>
            </div>
            <div className="text-right text-[10px] leading-relaxed">
              <div>GSTIN: {profile?.gstin}</div>
              <div>I.E.C. No.: {profile?.iec}</div>
              <div>Bank AD Code: {profile?.ad_code}</div>
              <div>Bank A/C No.: {profile?.account_no}</div>
              <div>IFSC Code: {profile?.ifsc_code}</div>
              <div>Bank Name: {profile?.bank_name}</div>
              <div>Store: {storeName}</div>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-4 border-b border-slate-300 pb-3">
            <div>
              <div className="font-semibold">Invoice No. & Date</div>
              <div>{invoice.invoice_no} &middot; {invoice.invoice_date}</div>
              <div className="mt-1 text-[10px] text-slate-500">Master Invoice No.: {invoice.master_invoice_no}</div>
            </div>
            <div>
              <div className="font-semibold">Buyer&apos;s Order No. &amp; Date</div>
              <div>{items[0]?.ref_no ?? "—"} &middot; {invoice.invoice_date}</div>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-4 border-b border-slate-300 pb-3">
            <div>
              <div className="font-semibold">CONSIGNEE —</div>
              <div className="whitespace-pre-wrap">{buyerNameAddress}</div>
              {buyerEmail && <div className="mt-1">Email: {buyerEmail}</div>}
              {buyerPhone && <div>Phone No.: {buyerPhone}</div>}
            </div>
            <div>
              <div className="font-semibold">OTHER THAN CONSIGNEE —</div>
              <div className="whitespace-pre-wrap text-slate-600">{otherThanConsignee || "—"}</div>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-4 border-b border-slate-300 pb-3">
            <div>
              <div className="font-semibold">Country of Origin of Goods</div>
              <div>INDIA</div>
            </div>
            <div>
              <div className="font-semibold">Country of Final Destination</div>
              <div>{destinationCountry || "—"}</div>
            </div>
          </div>

          {awbNo && (
            <div className="mb-3 border-b border-slate-300 pb-2 font-semibold">
              {invoice.courier_company?.toUpperCase()} TRACKING NO.: {awbNo}
            </div>
          )}

          <div className="mb-3 grid grid-cols-2 gap-4 border-b border-slate-300 pb-3">
            <div>
              <div className="font-semibold">Terms of Delivery &amp; Payment</div>
              <div>SHIPMENT TERM: {invoice.shipment_term}</div>
              {departmentRefNo && <div>DEPARTMENT REF. NO.: {departmentRefNo}</div>}
            </div>
            <div>
              <div>Pre-carriage by: By Road</div>
              {vesselFlightNo && <div>Vessel/Flight No.: {vesselFlightNo}</div>}
              <div>Port of Loading: NEW DELHI</div>
              {portOfDischarge && <div>Port of Discharge: {portOfDischarge}</div>}
            </div>
          </div>

          {marksAndNos && <div className="mb-1 text-[10px] text-slate-600">Marks &amp; Nos./Container No.: {marksAndNos}</div>}
          <div className="mb-2 text-[10px] text-slate-600">No. of Packages: {noOfPackages || "1"}</div>

          <table className="mb-2 w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-t border-slate-400 bg-slate-50">
                <th className="border border-slate-300 px-2 py-1 text-left">Reference No.</th>
                <th className="border border-slate-300 px-2 py-1 text-left">Item</th>
                <th className="border border-slate-300 px-2 py-1 text-left">HSN</th>
                <th className="border border-slate-300 px-2 py-1 text-left">Size</th>
                <th className="border border-slate-300 px-2 py-1 text-left">Origin</th>
                <th className="border border-slate-300 px-2 py-1 text-right">Qty</th>
                <th className="border border-slate-300 px-2 py-1 text-right">Rate ({displayCurrency})</th>
                <th className="border border-slate-300 px-2 py-1 text-right">Amount ({displayCurrency})</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const value = itemDisplayValue(i);
                return (
                  <tr key={i.id}>
                    <td className="border border-slate-300 px-2 py-1">{i.ref_no}</td>
                    <td className="border border-slate-300 px-2 py-1">
                      {i.item_category_name}{i.colour ? ` (${i.colour})` : ""}
                      {showPid && <div className="mt-0.5 text-[9px] text-slate-500">{pidSuffixFor(i.sku_label)}</div>}
                    </td>
                    <td className="border border-slate-300 px-2 py-1">{i.hsn_code}</td>
                    <td className="border border-slate-300 px-2 py-1">{i.size_label}</td>
                    <td className="border border-slate-300 px-2 py-1">INDIA</td>
                    <td className="border border-slate-300 px-2 py-1 text-right">{i.qty}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right">{value.toFixed(2)}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right">{value.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="border border-slate-300 px-2 py-1 text-right font-semibold" colSpan={7}>COST</td>
                <td className="border border-slate-300 px-2 py-1 text-right">{itemCostTotal ? Number(itemCostTotal).toFixed(2) : totalValue.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2 py-1 text-right font-semibold" colSpan={7}>INSURANCE</td>
                <td className="border border-slate-300 px-2 py-1 text-right">{insuranceTotal ? Number(insuranceTotal).toFixed(2) : "—"}</td>
              </tr>
              <tr>
                <td className="border border-slate-300 px-2 py-1 text-right font-semibold" colSpan={7}>FREIGHT</td>
                <td className="border border-slate-300 px-2 py-1 text-right">{freightTotal ? Number(freightTotal).toFixed(2) : "—"}</td>
              </tr>
              <tr className="font-semibold">
                <td className="border border-slate-300 px-2 py-1 text-right" colSpan={7}>TOTAL</td>
                <td className="border border-slate-300 px-2 py-1 text-right">
                  {invoiceValueUsd ? Number(invoiceValueUsd).toFixed(2) : totalValue.toFixed(2)} {displayCurrency}
                </td>
              </tr>
            </tfoot>
          </table>

          <table className="mb-3 w-full border-collapse text-[10px]">
            <thead>
              <tr className="border-b border-t border-slate-400 bg-slate-50">
                <th className="border border-slate-300 px-2 py-1 text-left">Package No.</th>
                <th className="border border-slate-300 px-2 py-1 text-right">Package Weight (kg)</th>
                <th className="border border-slate-300 px-2 py-1 text-right">L (cm)</th>
                <th className="border border-slate-300 px-2 py-1 text-right">W (cm)</th>
                <th className="border border-slate-300 px-2 py-1 text-right">H (cm)</th>
                <th className="border border-slate-300 px-2 py-1 text-right">Taxable Value (INR)</th>
              </tr>
            </thead>
            <tbody>
              {packageLabels.map((label, idx) => (
                <tr key={label}>
                  <td className="border border-slate-300 px-2 py-1">{label}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right">{weightKg || "—"}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right">{lengthCm || "—"}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right">{widthCm || "—"}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right">{heightCm || "—"}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right">{idx === 0 ? taxableValueInr || "—" : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="border border-slate-300 px-2 py-1">TOTAL WEIGHT</td>
                <td className="border border-slate-300 px-2 py-1 text-right" colSpan={5}>
                  {weightKg ? `${(Number(weightKg) * packageLabels.length).toFixed(3)} KG` : "—"}
                </td>
              </tr>
            </tfoot>
          </table>

          {(iossNumber || vatNumber || eoriNumber) && (
            <div className="mb-3 text-[10px] text-slate-600">
              {iossNumber && <div>IOSS Number: {iossNumber}</div>}
              {vatNumber && <div>VAT Number: {vatNumber}</div>}
              {eoriNumber && <div>EORI Number: {eoriNumber}</div>}
            </div>
          )}

          {declaredValueWords && (
            <div className="mb-2 font-semibold">Invoice Declared Value: {declaredValueWords}</div>
          )}

          <div className="mb-3 text-[10px] leading-relaxed text-slate-700">
            <div className="font-semibold">Declaration —</div>
            <div>{DECLARATION_STATEMENT}</div>
          </div>

          {originDeclaration && <div className="mb-4 text-[10px] leading-relaxed text-slate-600">{originDeclaration}</div>}

          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-300 pt-3 text-[10px] text-slate-600">
            <div>
              {remark && (
                <>
                  <div className="font-semibold text-slate-800">Remark</div>
                  <div>{remark}</div>
                </>
              )}
            </div>
            <div className="text-right">
              <div className="mt-8 border-t border-slate-400 pt-1">Signature &amp; Date</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
