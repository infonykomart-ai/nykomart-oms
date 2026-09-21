// 2026-09-19 — shared read-only DOC STATEMENT document, one component
// covering all 4 types (Credit Note / CSB Filing / Refund / Order Refund).
// Mirrors bill-statement-document.tsx's structure exactly (same PrintArea
// wrapper, same letterhead/section/table conventions) so the "A4 dialog
// box" look is consistent across every printable statement in the app —
// only the per-kind BODY differs, via a small switch at the bottom, same
// split already used in doc-statement-pdf.tsx's PDF version. Pure
// presentational component — all data comes from loadDocStatement()
// (../lib/doc-statement.ts) via /api/doc-statement/[type]/[id]; actions
// live in doc-statement-actions.tsx.
import { PrintArea } from "@/components/print-view";
import type { DocStatementData } from "@/lib/doc-statement";

const dash = (v: string | number | null | undefined) => (v != null && `${v}`.trim() ? `${v}` : "—");
const money = (n: number | null | undefined, ccy = "") =>
  n == null ? "—" : `${ccy ? ccy + " " : ""}${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-1">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{dash(value)}</span>
    </div>
  );
}

function CreditNoteBody({ data }: { data: Extract<DocStatementData, { kind: "credit_note" }> }) {
  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-4 border-b border-slate-300 pb-3">
        <div>
          <div className="font-semibold">{data.party ? "VENDOR" : "BUYER"}</div>
          <div className="font-bold">{data.party?.name ?? data.buyerName ?? "—"}</div>
          {data.party?.address && <div className="whitespace-pre-wrap text-slate-600">{data.party.address}</div>}
          {data.party?.contact_no && <div>Phone: {data.party.contact_no}</div>}
          {data.party?.email && <div>Email: {data.party.email}</div>}
          {data.party?.gst && <div>GST: {data.party.gst}</div>}
        </div>
        <div>
          <div className="font-semibold">CREDIT NOTE DETAILS</div>
          <div>CN No.: <strong>{dash(data.cnNo)}</strong></div>
          <div>Party&apos;s CN No.: {dash(data.vendorCnNo)}</div>
          <div>Kind: {dash(data.cnKind)}</div>
          <div>Date: {dash(data.creditNoteDate)}</div>
          <div>Status: {dash(data.creditNoteStatus)}</div>
        </div>
      </div>
      <div className="mb-3 border-b border-slate-300 pb-3">
        <div className="mb-1 font-semibold">AMOUNT</div>
        <Field label="Against Invoice" value={data.invoiceNo} />
        {data.itemName && <Field label="Item" value={data.itemName} />}
        {data.qty != null && <Field label="Qty" value={data.qty} />}
        {data.poRate != null && <Field label="PO Rate" value={money(data.poRate)} />}
        {data.billedRate != null && <Field label="Billed Rate" value={money(data.billedRate)} />}
        {data.gstRatePct != null && <Field label="GST (total)" value={`${data.gstRatePct * 2}%`} />}
        {data.awbNo && <Field label="AWB No." value={data.awbNo} />}
        <Field label="Refund Type" value={data.refundType} />
        {(data.invoiceValueUsd != null || data.invoiceValueInr != null) && (
          <Field label="Invoice Value" value={`${money(data.invoiceValueUsd, "USD")} / ${money(data.invoiceValueInr, "INR")}`} />
        )}
        <div className="mt-1 flex justify-between border-t border-slate-800 pt-1 text-sm font-bold">
          <span>Credit Note Amount</span>
          <span>{money(data.refundAmount)}</span>
        </div>
        {(data.refundAmtUsd != null || data.refundAmtInr != null) && (
          <div className="text-right text-[10px] text-slate-500">
            ({money(data.refundAmtUsd, "USD")} / {money(data.refundAmtInr, "INR")})
          </div>
        )}
      </div>
      <div className="pt-1 text-[10px] text-slate-500">Remark: {dash(data.remark)}</div>
    </>
  );
}

function CsbFilingBody({ data }: { data: Extract<DocStatementData, { kind: "csb_filing" }> }) {
  return (
    <div className="mb-3 border-b border-slate-300 pb-3">
      <div className="mb-1 font-semibold">CSB-V FILING</div>
      <Field label="CSB Number" value={data.csbNumber} />
      <Field label="Filing Date" value={data.filingDate} />
      <Field label="HAWB Number" value={data.hawbNumber} />
      <Field label="Invoice No." value={data.invoiceNo} />
      <Field label="Invoice Date" value={data.invoiceDate} />
      <Field label="EGM Number" value={data.egmNumber} />
      <Field label="EGM Date" value={data.egmDate} />
      <Field label="Exchange Rate" value={data.exchangeRate} />
      <Field label="Taxable Value Currency" value={data.taxableValueCurrency} />
      <div className="mt-1 flex justify-between border-t border-slate-800 pt-1 text-sm font-bold">
        <span>Total Taxable Value</span>
        <span>{money(data.totalTaxableValue, data.taxableValueCurrency ?? "")}</span>
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-600">
        <span>FOB Value (INR)</span>
        <span>{money(data.fobValueInr, "INR")}</span>
      </div>
    </div>
  );
}

function RefundBody({ data }: { data: Extract<DocStatementData, { kind: "refund" }> }) {
  return (
    <>
      <div className="mb-3 border-b border-slate-300 pb-3">
        <div className="mb-1 font-semibold">HISTORICAL MARKETPLACE REFUND</div>
        <Field label="Store" value={data.storeName} />
        <Field label="Source" value={data.source} />
        <Field label="Marketplace Order No." value={data.marketplaceOrderNo} />
        <Field label="Buyer" value={data.buyerName} />
        <Field label="Invoice No." value={data.invoiceNo} />
        <Field label="Status" value={data.status} />
        <Field label="Refund Type" value={data.refundType} />
        <Field label="Refund Date" value={data.refundDate} />
        <Field label="Order Amount" value={money(data.orderAmtUsd, "USD")} />
        {data.refundAmtPct != null && <Field label="Refund %" value={`${(data.refundAmtPct * 100).toFixed(1)}%`} />}
        <div className="mt-1 flex justify-between border-t border-slate-800 pt-1 text-sm font-bold">
          <span>Refund Amount</span>
          <span>{money(data.refundAmtUsd, "USD")}</span>
        </div>
      </div>
      <div className="pt-1 text-[10px] text-slate-500">Remark: {dash(data.reason || data.remark)}</div>
    </>
  );
}

function OrderRefundBody({ data }: { data: Extract<DocStatementData, { kind: "order_refund" }> }) {
  return (
    <>
      <div className="mb-3 border-b border-slate-300 pb-3">
        <div className="mb-1 font-semibold">ORDER REFUND</div>
        <Field label="Order Ref" value={data.orderRefNo} />
        <Field label="Buyer" value={data.buyerName} />
        <Field label="Order Status" value={data.orderStatus} />
        <Field label="Refund Date" value={data.refundDate} />
        <Field label="Linked Credit Note" value={data.creditNoteNo} />
        {data.refundBasisPercent != null && <Field label="Refund Basis %" value={`${data.refundBasisPercent}%`} />}
        {data.orderValueRefundAmount != null && <Field label="Order Value Refund" value={money(data.orderValueRefundAmount)} />}
        {data.shippingRefundAmount != null && <Field label="Shipping Refund" value={money(data.shippingRefundAmount)} />}
        {data.dutyRefundAmount != null && <Field label="Duty & Tax Refund" value={money(data.dutyRefundAmount)} />}
        <div className="mt-1 flex justify-between border-t border-slate-800 pt-1 text-sm font-bold">
          <span>Refund Amount</span>
          <span>{money(data.refundAmount, data.refundCurrency)}</span>
        </div>
        {(data.refundAmountUsd != null || data.refundAmountInr != null) && (
          <div className="text-right text-[10px] text-slate-500">
            ({money(data.refundAmountUsd, "USD")} / {money(data.refundAmountInr, "INR")})
          </div>
        )}
      </div>
      <div className="pt-1 text-[10px] text-slate-500">Remark: {dash(data.reason)}</div>
    </>
  );
}

export function DocStatementDocument({ data }: { data: DocStatementData }) {
  const { company, profile, companyName } = data;

  return (
    <PrintArea id="doc-statement-print" companyName={companyName} companyLogoUrl={company?.logo_url}>
      <div className="mx-auto min-h-[600px] w-full bg-white p-8 text-xs text-slate-900" style={{ fontFamily: "Arial, sans-serif" }}>
        <div className="mb-1 text-right text-sm font-bold tracking-wide">{data.docTitle}</div>
        <div className="mb-4 flex items-start justify-between border-b-2 border-slate-800 pb-3">
          <div className="flex items-start gap-3">
            {company?.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logo_url} alt={companyName} className="h-12 w-12 object-contain" />
            )}
            <div>
              <div className="text-lg font-bold">{companyName}</div>
              {profile?.address && <div className="text-[11px] text-slate-600">{profile.address}</div>}
              <div className="text-[11px] text-slate-600">
                {[profile?.phone && `Phone: ${profile.phone}`, profile?.whatsapp && `WhatsApp: ${profile.whatsapp}`]
                  .filter(Boolean)
                  .join(" | ")}
              </div>
              {profile?.email && <div className="text-[11px] text-slate-600">Email: {profile.email}</div>}
            </div>
          </div>
          <div className="text-right text-[10px] leading-relaxed">
            <div>GSTIN: {dash(profile?.gstin)}</div>
            <div>Doc No.: {data.invoiceRef}</div>
          </div>
        </div>

        {data.kind === "credit_note" && <CreditNoteBody data={data} />}
        {data.kind === "csb_filing" && <CsbFilingBody data={data} />}
        {data.kind === "refund" && <RefundBody data={data} />}
        {data.kind === "order_refund" && <OrderRefundBody data={data} />}

        <div className="pt-2 text-[10px] text-slate-500">
          <div className="italic">
            This is a computer-generated document from the Nyko Mart Order Management System — no signature required.
          </div>
        </div>
      </div>
    </PrintArea>
  );
}
