import type { ReactNode } from "react";
import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { InvoiceGenerateForm } from "@/app/dashboard/invoices/invoice-generate-form";
import { composeBuyerNameAndAddress } from "@/lib/compose-buyer-address";

// 2026-11-23 — "ORDER PAGE ME HI KAR DO NA ADD KI SELECT GENRATE INVOICE, JO
// INVOICE KA SECTION HAI USKO VAHA SE REMOVE KAR KE SARE SYSTEM IDHR HI KAR DO":
// invoice generation moved onto the Orders hub. Tick order rows there, press
// "Generate Invoice", and land here with ?ids=… — this page is the old
// Invoices screen's generate form, scoped to exactly what was selected.
//
// The generation itself is unchanged: this renders the same
// InvoiceGenerateForm, which calls the same generateInvoice() →
// generateInvoiceCore() (numbering, value breakdown, auto-Dispatch marking).
// Nothing is re-implemented here.
//
// It refuses (with a reason, never silently) what generation already refuses
// server-side: orders from a company this login cannot access, a mix of
// stores, and rows that are already invoiced / Hold / Cancelled. Those rows
// are listed separately and left out of the form, so a selection that mixes
// "already invoiced" rows with pending ones still produces one clean invoice.
const MAX_ORDERS = 200;

export default async function OrderInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("invoicing");
  const supabase = await createClient();
  const sp = await searchParams;
  const rawIds = typeof sp.ids === "string" ? sp.ids : Array.isArray(sp.ids) ? sp.ids.join(",") : "";
  const ids = Array.from(new Set(rawIds.split(",").map((v) => v.trim()).filter(Boolean))).slice(0, MAX_ORDERS);

  const backLink = (
    <Link
      href="/dashboard/orders"
      className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
    >
      ← Back to Orders
    </Link>
  );

  const shell = (body: ReactNode) => (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">🧾 Generate Invoice</h1>
        {backLink}
      </div>
      {body}
    </div>
  );

  if (ids.length === 0) {
    return shell(
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Tick one or more order rows on the Orders page first, then press <strong>Generate Invoice</strong>.
      </p>
    );
  }

  const { data: orders } = await supabase
    .from("orders")
    .select(
      "id, ref_no, ref_no_base, company_id, store_id, status, invoice_id, order_currency, order_value_original, qty, size_label, item_category_id, buyer_name_address, buyer_address1, buyer_address2, buyer_address3, buyer_city, buyer_state, buyer_postal_code, destination_country, ioss_number, vat_number, eori_number, email_id, contact_no"
    )
    .in("id", ids);

  const byId = new Map((orders ?? []).map((o) => [o.id, o]));
  const selected = ids.map((id) => byId.get(id)).filter((o): o is NonNullable<typeof o> => !!o);
  const missing = ids.length - selected.length;

  if (selected.length === 0) {
    return shell(
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        None of the selected orders could be found — they may have been deleted. Go back and select them again.
      </p>
    );
  }

  const forbidden = selected.filter((o) => !employee.companyIds.includes(o.company_id));
  if (forbidden.length > 0) {
    return shell(
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        {forbidden.length} of the selected orders belong to a company this login cannot access — remove
        {" "}
        {forbidden.map((o) => o.ref_no).join(", ")} from the selection.
      </p>
    );
  }

  const invoiced = selected.filter((o) => o.invoice_id);
  const blocked = selected.filter((o) => !o.invoice_id && (o.status === "Hold" || o.status === "Cancelled"));
  const ready = selected.filter((o) => !o.invoice_id && o.status !== "Hold" && o.status !== "Cancelled");

  const stores = new Set(ready.map((o) => o.store_id));
  const storeMix = stores.size > 1;
  const currencies = new Set(ready.map((o) => o.order_currency));
  // AWB lives on the dispatch row, not the order — pre-fill it when a dispatch
  // entry already exists so the form is not blank on an already-shipped PO.
  const { data: dispatchRows } = ready.length
    ? await supabase
        .from("dispatch_invoices")
        .select("order_id, awb_no")
        .in("order_id", ready.map((o) => o.id))
        .not("awb_no", "is", null)
    : { data: [] };
  const awbByOrder = new Map((dispatchRows ?? []).map((row) => [row.order_id, row.awb_no]));

  const categoryIds = Array.from(new Set(ready.map((o) => o.item_category_id)));
  const { data: categories } = categoryIds.length
    ? await supabase.from("item_categories").select("id, name").in("id", categoryIds)
    : { data: [] };
  const categoryName = new Map((categories ?? []).map((c) => [c.id, c.name]));

  return shell(
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-500">
          {ready.length} item{ready.length === 1 ? "" : "s"} will go on this invoice
          {blocked.length + invoiced.length > 0 && ` — ${blocked.length + invoiced.length} skipped`}
          {missing > 0 && ` · ${missing} selected order(s) no longer exist`}.
        </p>
      </div>

      {(invoiced.length > 0 || blocked.length > 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-medium">Left out of this invoice:</p>
          <ul className="mt-1 space-y-0.5">
            {invoiced.map((o) => (
              <li key={o.id}>
                {o.ref_no} — already invoiced.{" "}
                <Link href={`/dashboard/invoices/${o.invoice_id}`} className="underline">
                  Open that invoice →
                </Link>
              </li>
            ))}
            {blocked.map((o) => (
              <li key={o.id}>
                {o.ref_no} — status {o.status}; take it off {o.status} on the Orders page first.
              </li>
            ))}
          </ul>
        </div>
      )}

      {selected.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold text-slate-600">Selected items</p>
          <div className="space-y-1">
            {ready.map((o) => (
              <div
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1.5 text-xs text-slate-600"
              >
                <span>
                  <span className="font-medium text-slate-800">{o.ref_no}</span>
                  <span className="ml-2 text-slate-400">
                    {categoryName.get(o.item_category_id) ?? ""}
                    {o.size_label ? ` · ${o.size_label}` : ""} · Qty {o.qty}
                  </span>
                </span>
                <span className="text-slate-500">
                  {o.order_value_original} {o.order_currency}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {storeMix && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          These rows are from different stores — one invoice can only cover one store. Deselect the rows from the
          other store.
        </p>
      )}
      {!storeMix && currencies.size > 1 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          These rows are in different currencies. A CSB-V invoice needs one currency for its value breakdown — use a
          CSB-IV invoice, or invoice these separately.
        </p>
      )}

      {ready.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Nothing in this selection is ready to invoice. Go back to the Orders page and pick rows that are not
          already invoiced, on Hold or Cancelled.
        </p>
      ) : storeMix ? null : (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <InvoiceGenerateForm
            orderIds={ready.map((o) => o.id)}
            defaultBuyerNameAddress={composeBuyerNameAndAddress(ready[0])}
            defaults={{
              destinationCountry: ready[0].destination_country,
              iossNumber: ready[0].ioss_number,
              vatNumber: ready[0].vat_number,
              eoriNumber: ready[0].eori_number,
              buyerEmail: ready[0].email_id,
              buyerPhone: ready[0].contact_no,
              awbNo: awbByOrder.get(ready[0].id) ?? null,
            }}
          />
        </div>
      )}
    </div>
  );
}
