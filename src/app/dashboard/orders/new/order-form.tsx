"use client";

import { useActionState, useRef, useEffect } from "react";
import { createOrder, type OrderFormState } from "./actions";

const initialState: OrderFormState = { error: null, success: null };

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export function OrderForm({
  stores,
  itemCategories,
  sizes,
  currencies,
}: {
  stores: { id: string; name: string }[];
  itemCategories: { id: string; name: string }[];
  sizes: { id: string; label: string }[];
  currencies: { code: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(createOrder, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      {state.success && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          Order save ho gaya — <strong>{state.success.refNo}</strong>
        </p>
      )}
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-slate-900">Order</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="store_id">Store *</label>
            <select id="store_id" name="store_id" required className={inputClass} defaultValue="">
              <option value="" disabled>Select store</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="order_date">Order Date *</label>
            <input id="order_date" name="order_date" type="date" required className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="marketplace_order_no">Marketplace Order No.</label>
            <input id="marketplace_order_no" name="marketplace_order_no" className={inputClass} placeholder="Portal ka apna order id" />
          </div>
          <div>
            <label className={labelClass} htmlFor="manual_ref_no">Manual PO/RF/RG No. (optional)</label>
            <input id="manual_ref_no" name="manual_ref_no" className={inputClass} placeholder="Khaali chhodo — automatic ban jayega" />
          </div>
          <div>
            <label className={labelClass} htmlFor="po_date">PO Date</label>
            <input id="po_date" name="po_date" type="date" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="delivery_date">Delivery Date</label>
            <input id="delivery_date" name="delivery_date" type="date" className={inputClass} />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-slate-900">Item</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="item_category_id">Item Category *</label>
            <select id="item_category_id" name="item_category_id" required className={inputClass} defaultValue="">
              <option value="" disabled>Select category</option>
              {itemCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="sku_label">SKU</label>
            <input id="sku_label" name="sku_label" className={inputClass} placeholder="SKU code" />
          </div>
          <div>
            <label className={labelClass} htmlFor="size_label">Size</label>
            <input id="size_label" name="size_label" list="sizes-list" className={inputClass} placeholder="e.g. 5X5 ft" />
            <datalist id="sizes-list">
              {sizes.map((s) => (
                <option key={s.id} value={s.label} />
              ))}
            </datalist>
          </div>
          <div>
            <label className={labelClass} htmlFor="qty">Quantity *</label>
            <input id="qty" name="qty" type="number" min={1} defaultValue={1} required className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="colour">Colour</label>
            <input id="colour" name="colour" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="photo_type">Photo Type</label>
            <select id="photo_type" name="photo_type" className={inputClass} defaultValue="">
              <option value="">—</option>
              <option value="Dispatch">Dispatch (single photo)</option>
              <option value="Website">Website (listing photo)</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="photo_url">Photo URL</label>
            <input id="photo_url" name="photo_url" type="url" className={inputClass} placeholder="https://…" />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input id="tassel_fringes" name="tassel_fringes" type="checkbox" className="h-4 w-4 rounded border-slate-300" />
            <label htmlFor="tassel_fringes" className="text-sm text-slate-700">Tassel / Fringes</label>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-slate-900">Buyer</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="buyer_name_address">Buyer Name &amp; Address</label>
            <textarea id="buyer_name_address" name="buyer_name_address" rows={2} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="contact_no">Contact No.</label>
            <input id="contact_no" name="contact_no" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="email_id">Email</label>
            <input id="email_id" name="email_id" type="email" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="tax_id">Tax ID (VAT / IOSS)</label>
            <input id="tax_id" name="tax_id" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="address_type">Address Type</label>
            <select id="address_type" name="address_type" className={inputClass} defaultValue="Residential">
              <option value="Residential">Residential</option>
              <option value="Commercial">Commercial</option>
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-slate-900">Value</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="order_currency">Currency</label>
            <select id="order_currency" name="order_currency" className={inputClass} defaultValue="USD">
              {currencies.length > 0
                ? currencies.map((c) => (
                    <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                  ))
                : ["USD", "INR", "EUR"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="order_value_original">Order Value *</label>
            <input
              id="order_value_original"
              name="order_value_original"
              type="number"
              step="0.01"
              min={0}
              required
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-400">
              USD/INR value auto-calculate hoga (Exchange Rate Master se, ya live estimate se agar nahi mila).
            </p>
          </div>
        </div>
      </fieldset>

      <div>
        <label className={labelClass} htmlFor="remark">Remark</label>
        <textarea id="remark" name="remark" rows={2} className={inputClass} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2.5 font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-50 sm:w-auto"
      >
        {pending ? "Saving…" : "Save Order"}
      </button>
    </form>
  );
}
