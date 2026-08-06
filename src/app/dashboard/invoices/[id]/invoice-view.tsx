"use client";

import { useState, useTransition } from "react";
import { updateInvoiceFields } from "../actions";
import { originDeclarationFor } from "@/lib/invoices/origin-declaration";

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
  buyer_name_address: string;
  remark: string | null;
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
  colour: string | null;
};

type Company = { id: string; name: string; logo_url: string | null } | null;
type Profile = {
  address: string | null;
  phone: string | null;
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

export function InvoiceView({
  invoice,
  items,
  company,
  profile,
  storeName,
}: {
  invoice: Invoice;
  items: Item[];
  company: Company;
  profile: Profile;
  storeName: string;
}) {
  const [destinationCountry, setDestinationCountry] = useState(invoice.destination_country ?? "");
  const [originDeclaration, setOriginDeclaration] = useState(invoice.origin_declaration ?? "");
  const [departmentRefNo, setDepartmentRefNo] = useState(invoice.department_reference_no ?? "");
  const [iossNumber, setIossNumber] = useState(invoice.ioss_number ?? "");
  const [buyerNameAddress, setBuyerNameAddress] = useState(invoice.buyer_name_address);
  const [remark, setRemark] = useState(invoice.remark ?? "");
  const [isSaving, startSave] = useTransition();
  const [saved, setSaved] = useState<string | null>(null);

  const totalValue = items.reduce((sum, i) => sum + Number(i.order_value_original || 0), 0);
  const currency = items[0]?.order_currency ?? "";

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
        remark: remark || null,
      });
      setSaved(result.error ? `Error: ${result.error}` : "Save ho gaya.");
    });
  }

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
          <label className={labelClass} htmlFor="buyer">Buyer Name & Address</label>
          <textarea id="buyer" rows={2} className={inputClass} value={buyerNameAddress} onChange={(e) => setBuyerNameAddress(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="dest_country">Destination Country</label>
            <input id="dest_country" className={inputClass} value={destinationCountry} onChange={(e) => setDestinationCountry(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="ioss">IOSS Number</label>
            <input id="ioss" className={inputClass} value={iossNumber} onChange={(e) => setIossNumber(e.target.value)} />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className={labelClass} htmlFor="origin_decl">Origin Declaration</label>
            <button type="button" onClick={handleRefillDeclaration} className="text-xs text-amber-600 underline">
              Country se refill karo
            </button>
          </div>
          <textarea id="origin_decl" rows={4} className={inputClass} value={originDeclaration} onChange={(e) => setOriginDeclaration(e.target.value)} />
        </div>

        <div>
          <label className={labelClass} htmlFor="dept_ref">Department Reference No.</label>
          <input id="dept_ref" className={inputClass} value={departmentRefNo} onChange={(e) => setDepartmentRefNo(e.target.value)} />
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
      </div>

      <div>
        <div id="invoice-print-area" className="mx-auto min-h-[1100px] w-full bg-white p-8 text-xs text-slate-900" style={{ fontFamily: "Arial, sans-serif" }}>
          <div className="mb-4 flex items-center justify-between border-b-2 border-slate-800 pb-3">
            <div className="flex items-center gap-3">
              {company?.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.logo_url} alt={company.name} className="h-12 w-12 object-contain" />
              )}
              <div>
                <div className="text-lg font-bold">{company?.name}</div>
                <div className="text-[11px] text-slate-600">{profile?.address}</div>
                <div className="text-[11px] text-slate-600">
                  {[profile?.phone, profile?.email].filter(Boolean).join(" | ")}
                </div>
              </div>
            </div>
            <div className="text-right text-[11px]">
              <div>GSTIN: {profile?.gstin}</div>
              <div>IEC: {profile?.iec}</div>
              <div>Store: {storeName}</div>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <div className="font-semibold">Invoice No.: {invoice.invoice_no}</div>
              <div>Master Invoice No.: {invoice.master_invoice_no}</div>
              <div>Invoice Date: {invoice.invoice_date}</div>
              <div>Shipment Term: {invoice.shipment_term}</div>
              <div>{invoice.csb_type} · {invoice.courier_company}</div>
              {departmentRefNo && <div>Department Reference No.: {departmentRefNo}</div>}
              {iossNumber && <div>IOSS: {iossNumber}</div>}
            </div>
            <div>
              <div className="font-semibold">Buyer:</div>
              <div className="whitespace-pre-wrap">{buyerNameAddress}</div>
              {destinationCountry && <div className="mt-1">Destination: {destinationCountry}</div>}
            </div>
          </div>

          <table className="mb-4 w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-t border-slate-400 bg-slate-50">
                <th className="border border-slate-300 px-2 py-1 text-left">Refrance No.</th>
                <th className="border border-slate-300 px-2 py-1 text-left">Item</th>
                <th className="border border-slate-300 px-2 py-1 text-left">HSN</th>
                <th className="border border-slate-300 px-2 py-1 text-left">Size</th>
                <th className="border border-slate-300 px-2 py-1 text-right">Qty</th>
                <th className="border border-slate-300 px-2 py-1 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="border border-slate-300 px-2 py-1">{i.ref_no}</td>
                  <td className="border border-slate-300 px-2 py-1">{i.item_category_name}{i.colour ? ` (${i.colour})` : ""}</td>
                  <td className="border border-slate-300 px-2 py-1">{i.hsn_code}</td>
                  <td className="border border-slate-300 px-2 py-1">{i.size_label}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right">{i.qty}</td>
                  <td className="border border-slate-300 px-2 py-1 text-right">{i.order_value_original} {i.order_currency}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="border border-slate-300 px-2 py-1" colSpan={5}>Total</td>
                <td className="border border-slate-300 px-2 py-1 text-right">{totalValue.toFixed(2)} {currency}</td>
              </tr>
            </tfoot>
          </table>

          <div className="mb-4 text-[10px] leading-relaxed text-slate-600">{originDeclaration}</div>

          <div className="text-[10px] text-slate-500">
            Country of Origin of goods: INDIA · Pre-carriage by: By Road · Port of Loading: NEW DELHI
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-300 pt-3 text-[10px] text-slate-600">
            <div>
              <div className="font-semibold text-slate-800">Bank Details</div>
              <div>{profile?.bank_name} — A/C {profile?.account_no}</div>
              <div>IFSC: {profile?.ifsc_code} · AD Code: {profile?.ad_code}</div>
            </div>
            {remark && (
              <div>
                <div className="font-semibold text-slate-800">Remark</div>
                <div>{remark}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
