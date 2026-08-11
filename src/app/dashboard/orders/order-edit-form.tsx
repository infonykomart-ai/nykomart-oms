"use client";

import { useActionState, useEffect } from "react";
import { updateOrder, type OrderEditState } from "./actions";

const initialState: OrderEditState = { error: null, success: false };

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type EditableOrder = {
  id: string;
  ref_no: string;
  order_date: string;
  status: string;
  dispatch_date: string | null;
  marketplace_order_no: string | null;
  po_date: string | null;
  delivery_date: string | null;
  item_category_id: string;
  sku_label: string | null;
  size_label: string | null;
  qty: number;
  colour: string | null;
  photo_type: string | null;
  photo_url: string | null;
  tassel_fringes: boolean | null;
  buyer_name_address: string | null;
  contact_no: string | null;
  email_id: string | null;
  tax_id: string | null;
  address_type: string;
  remark: string | null;
  order_currency: string;
  order_value_original: number;
  // 2026-08-11 additions — see db/2026-08-11-order-tax-destination-fields.sql
  vat_number: string | null;
  eori_number: string | null;
  ioss_number: string | null;
  destination_country: string | null;
};

// Inline edit panel for one order row (order-list-table.tsx renders this in
// place of the row when "Edit" is clicked). ref_no is shown read-only —
// "order panal me order ko edit modify delet karne ka option" never asked
// to renumber orders, and doing so would tangle with the buyer-batch suffix
// mechanism in ../new/actions.ts.
export function OrderEditForm({
  order,
  itemCategories,
  sizes,
  currencies,
  statuses,
  onDone,
}: {
  order: EditableOrder;
  itemCategories: { id: string; name: string }[];
  sizes: { id: string; label: string }[];
  currencies: { code: string; name: string }[];
  statuses: string[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateOrder, initialState);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-amber-200 bg-amber-50/40 p-4">
      <input type="hidden" name="order_id" value={order.id} />
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">Editing {order.ref_no}</p>
        <button type="button" onClick={onDone} className="text-xs text-slate-400 underline">
          Cancel
        </button>
      </div>

      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className={labelClass} htmlFor={`status-${order.id}`}>Status</label>
          <select id={`status-${order.id}`} name="status" defaultValue={order.status} className={inputClass}>
            {statuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`order_date-${order.id}`}>Order Date</label>
          <input id={`order_date-${order.id}`} name="order_date" type="date" defaultValue={order.order_date} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`dispatch_date-${order.id}`}>Dispatch Date</label>
          <input id={`dispatch_date-${order.id}`} name="dispatch_date" type="date" defaultValue={order.dispatch_date ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`marketplace_order_no-${order.id}`}>Marketplace Order No.</label>
          <input id={`marketplace_order_no-${order.id}`} name="marketplace_order_no" defaultValue={order.marketplace_order_no ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`po_date-${order.id}`}>PO Date</label>
          <input id={`po_date-${order.id}`} name="po_date" type="date" defaultValue={order.po_date ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`delivery_date-${order.id}`}>Delivery Date</label>
          <input id={`delivery_date-${order.id}`} name="delivery_date" type="date" defaultValue={order.delivery_date ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`item_category_id-${order.id}`}>Item Category *</label>
          <select id={`item_category_id-${order.id}`} name="item_category_id" defaultValue={order.item_category_id} required className={inputClass}>
            {itemCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`sku_label-${order.id}`}>SKU</label>
          <input id={`sku_label-${order.id}`} name="sku_label" defaultValue={order.sku_label ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`size_label-${order.id}`}>Size</label>
          <input id={`size_label-${order.id}`} name="size_label" list={`sizes-list-${order.id}`} defaultValue={order.size_label ?? ""} className={inputClass} />
          <datalist id={`sizes-list-${order.id}`}>
            {sizes.map((s) => (
              <option key={s.id} value={s.label} />
            ))}
          </datalist>
        </div>
        <div>
          <label className={labelClass} htmlFor={`qty-${order.id}`}>Quantity *</label>
          <input id={`qty-${order.id}`} name="qty" type="number" min={1} defaultValue={order.qty} required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`colour-${order.id}`}>Colour</label>
          <input id={`colour-${order.id}`} name="colour" defaultValue={order.colour ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`photo_type-${order.id}`}>Photo Type</label>
          <select id={`photo_type-${order.id}`} name="photo_type" defaultValue={order.photo_type ?? ""} className={inputClass}>
            <option value="">—</option>
            <option value="Dispatch">Dispatch</option>
            <option value="Website">Website</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor={`photo_url-${order.id}`}>Photo URL</label>
          <input id={`photo_url-${order.id}`} name="photo_url" type="url" defaultValue={order.photo_url ?? ""} className={inputClass} />
        </div>
        <div className="flex items-center gap-2 pt-5">
          <input id={`tassel_fringes-${order.id}`} name="tassel_fringes" type="checkbox" defaultChecked={!!order.tassel_fringes} className="h-4 w-4 rounded border-slate-300" />
          <label htmlFor={`tassel_fringes-${order.id}`} className="text-xs text-slate-600">Tassel / Fringes</label>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor={`buyer_name_address-${order.id}`}>Buyer Name &amp; Address</label>
          <input id={`buyer_name_address-${order.id}`} name="buyer_name_address" defaultValue={order.buyer_name_address ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`contact_no-${order.id}`}>Contact No.</label>
          <input id={`contact_no-${order.id}`} name="contact_no" defaultValue={order.contact_no ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`email_id-${order.id}`}>Email</label>
          <input id={`email_id-${order.id}`} name="email_id" type="email" defaultValue={order.email_id ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`address_type-${order.id}`}>Address Type</label>
          <select id={`address_type-${order.id}`} name="address_type" defaultValue={order.address_type} className={inputClass}>
            <option value="Residential">Residential</option>
            <option value="Commercial">Commercial</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`destination_country-${order.id}`}>Destination Country</label>
          <input id={`destination_country-${order.id}`} name="destination_country" defaultValue={order.destination_country ?? ""} className={inputClass} />
        </div>
        {/* 2026-08-11: replaces the old single generic Tax ID field (still
            in the DB for old orders, just no longer edited here) with 3
            separate fields so Invoice generation can auto-pull the right
            one — usually blank, only applicable for UK/EU shipments. */}
        <div>
          <label className={labelClass} htmlFor={`vat_number-${order.id}`}>VAT Number</label>
          <input id={`vat_number-${order.id}`} name="vat_number" defaultValue={order.vat_number ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`eori_number-${order.id}`}>EORI Number</label>
          <input id={`eori_number-${order.id}`} name="eori_number" defaultValue={order.eori_number ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`ioss_number-${order.id}`}>IOSS Number</label>
          <input id={`ioss_number-${order.id}`} name="ioss_number" defaultValue={order.ioss_number ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`order_currency-${order.id}`}>Currency</label>
          <select id={`order_currency-${order.id}`} name="order_currency" defaultValue={order.order_currency} className={inputClass}>
            {currencies.length > 0
              ? currencies.map((c) => (
                  <option key={c.code} value={c.code}>{c.code}</option>
                ))
              : ["USD", "INR", "EUR"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`order_value_original-${order.id}`}>Order Value *</label>
          <input
            id={`order_value_original-${order.id}`}
            name="order_value_original"
            type="number"
            step="0.01"
            min={0}
            defaultValue={order.order_value_original}
            required
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-4">
          <label className={labelClass} htmlFor={`remark-${order.id}`}>Remark</label>
          <input id={`remark-${order.id}`} name="remark" defaultValue={order.remark ?? ""} className={inputClass} />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save Changes"}
      </button>
    </form>
  );
}
