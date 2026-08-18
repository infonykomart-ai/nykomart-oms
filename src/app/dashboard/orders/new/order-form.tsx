"use client";

import { useActionState, useRef, useEffect, useState, type FormEvent } from "react";
import { createOrder, checkFinishedStockAction, type OrderFormState } from "./actions";
import { PhotoUrlField } from "../photo-url-field";

const initialState: OrderFormState = { error: null, success: null };

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

type ItemCategory = { id: string; name: string };
type Size = { id: string; label: string };
type Currency = { code: string; name: string };

// 2026-08-07: "Add More Item" — ek order me ek se zyada alag-alag item ho
// (jute + cotton, same buyer) to har item ka apna block hai. Single item ho
// to sirf ek block dikhta hai aur koi "1/2, 2/2" suffix nahi lagta — suffix
// sirf tabhi lagta hai jab "+ Add More Item" se doosra block add ho (server
// side ka rule hai, actions.ts me — yahan sirf N blocks banana/serialize
// karna hai).
function ItemBlock({
  itemKey,
  index,
  total,
  onRemove,
  itemCategories,
  sizes,
  currencies,
}: {
  itemKey: number;
  index: number;
  total: number;
  onRemove: () => void;
  itemCategories: ItemCategory[];
  sizes: Size[];
  currencies: Currency[];
}) {
  const id = (field: string) => `${field}_${itemKey}`;

  // Pending item 4 (Inventory) — "stock-check popup at order entry":
  // informational only, never a blocker. Checked on blur of whichever of
  // Category/SKU/Size the employee just finished typing, reading the other
  // two straight off the DOM (this form is otherwise uncontrolled/DOM-read,
  // see handleSubmit below — matching that same pattern rather than lifting
  // everything into state just for this).
  const [stockQty, setStockQty] = useState<number | null>(null);
  async function checkStock() {
    const categoryId = (document.getElementById(id("item_category_id")) as HTMLSelectElement | null)?.value ?? "";
    const sku = (document.getElementById(id("sku_label")) as HTMLInputElement | null)?.value ?? "";
    const size = (document.getElementById(id("size_label")) as HTMLInputElement | null)?.value ?? "";
    if (!categoryId) {
      setStockQty(null);
      return;
    }
    const result = await checkFinishedStockAction(categoryId, sku, size);
    setStockQty(result.qty > 0 ? result.qty : null);
  }

  return (
    <fieldset className="space-y-4 rounded-lg border border-slate-200 p-4">
      <legend className="mb-1 flex w-full items-center justify-between px-1 text-sm font-semibold text-slate-900">
        <span>Item{total > 1 ? ` ${index + 1}` : ""}</span>
        {total > 1 && (
          <button type="button" onClick={onRemove} className="text-xs font-normal text-red-500 underline">
            Remove
          </button>
        )}
      </legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor={id("item_category_id")}>Item Category *</label>
          <select id={id("item_category_id")} name={id("item_category_id")} required className={inputClass} defaultValue="" onBlur={checkStock}>
            <option value="" disabled>Select category</option>
            {itemCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={id("sku_label")}>SKU</label>
          <input id={id("sku_label")} name={id("sku_label")} className={inputClass} placeholder="SKU code" onBlur={checkStock} />
        </div>
        <div>
          <label className={labelClass} htmlFor={id("size_label")}>Size</label>
          <input id={id("size_label")} name={id("size_label")} list={`sizes-list-${itemKey}`} className={inputClass} placeholder="e.g. 5X5 ft" onBlur={checkStock} />
          <datalist id={`sizes-list-${itemKey}`}>
            {sizes.map((s) => (
              <option key={s.id} value={s.label} />
            ))}
          </datalist>
        </div>
        {stockQty !== null && (
          <p className="rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-800 sm:col-span-2">
            ℹ️ {stockQty} unit{stockQty === 1 ? "" : "s"} of this SKU+Size already in Inventory.
          </p>
        )}
        <div>
          <label className={labelClass} htmlFor={id("qty")}>Quantity *</label>
          <input id={id("qty")} name={id("qty")} type="number" min={1} defaultValue={1} required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={id("colour")}>Colour</label>
          <input id={id("colour")} name={id("colour")} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor={id("photo_type")}>Photo Type</label>
          <select id={id("photo_type")} name={id("photo_type")} className={inputClass} defaultValue="">
            <option value="">—</option>
            <option value="Dispatch">Dispatch (single photo)</option>
            <option value="Website">Website (listing photo)</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <PhotoUrlField id={id("photo_url")} name={id("photo_url")} labelClass={labelClass} />
        </div>
        <div className="flex items-center gap-2 pt-6">
          <input id={id("tassel_fringes")} name={id("tassel_fringes")} type="checkbox" className="h-4 w-4 rounded border-slate-300" />
          <label htmlFor={id("tassel_fringes")} className="text-sm text-slate-700">Tassel / Fringes</label>
        </div>
        <div>
          <label className={labelClass} htmlFor={id("order_currency")}>Currency</label>
          <select id={id("order_currency")} name={id("order_currency")} className={inputClass} defaultValue="USD">
            {currencies.length > 0
              ? currencies.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))
              : ["USD", "INR", "EUR"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={id("order_value_original")}>Order Value *</label>
          <input id={id("order_value_original")} name={id("order_value_original")} type="number" step="0.01" min={0} required className={inputClass} />
        </div>
      </div>
    </fieldset>
  );
}

export function OrderForm({
  stores,
  itemCategories,
  sizes,
  currencies,
}: {
  stores: { id: string; name: string }[];
  itemCategories: ItemCategory[];
  sizes: Size[];
  currencies: Currency[];
}) {
  const [state, formAction, pending] = useActionState(createOrder, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const itemsJsonRef = useRef<HTMLInputElement>(null);
  const nextKeyRef = useRef(1);
  const [itemKeys, setItemKeys] = useState<number[]>([0]);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      // Syncing local item-block count back to 1 after a successful
      // server-action save (mirrors the native form.reset() above); there's
      // no render-time equivalent since this only fires once per submit.
      // Uses a FRESH key (not the old 0) so ItemBlock — and PhotoUrlField's
      // internal controlled preview state inside it — actually remounts
      // instead of silently keeping the just-saved order's photo preview
      // visible after a reset (native form.reset() can't touch React state
      // in a controlled input).
      setItemKeys([nextKeyRef.current++]);
    }
  }, [state.success]);

  function addItem() {
    setItemKeys((prev) => [...prev, nextKeyRef.current++]);
  }
  function removeItem(key: number) {
    setItemKeys((prev) => (prev.length > 1 ? prev.filter((k) => k !== key) : prev));
  }

  // Runs before the server action fires (React 19 forms call onSubmit, then
  // — as long as it doesn't preventDefault — proceed to the form's action).
  // Reads each item block's fields straight off the DOM by name and packs
  // them into the hidden items_json field that actions.ts's parseItems()
  // expects.
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const val = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
    const checked = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.checked ?? false;

    const items = itemKeys.map((key) => ({
      itemCategoryId: val(`item_category_id_${key}`),
      skuLabel: val(`sku_label_${key}`),
      sizeLabel: val(`size_label_${key}`),
      qty: Number(val(`qty_${key}`)),
      colour: val(`colour_${key}`),
      photoType: val(`photo_type_${key}`),
      photoUrl: val(`photo_url_${key}`),
      tasselFringes: checked(`tassel_fringes_${key}`),
      orderCurrency: val(`order_currency_${key}`) || "USD",
      orderValueOriginal: Number(val(`order_value_original_${key}`)),
    }));

    if (itemsJsonRef.current) itemsJsonRef.current.value = JSON.stringify(items);
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      {state.success && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          Order saved — <strong>{state.success.refNo}</strong>
        </p>
      )}
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}

      <input type="hidden" name="items_json" ref={itemsJsonRef} />

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
            <input id="marketplace_order_no" name="marketplace_order_no" className={inputClass} placeholder="The order ID from the marketplace/portal" />
          </div>
          <div>
            <label className={labelClass} htmlFor="manual_ref_no">Manual PO/RF/RG No. (optional)</label>
            <input id="manual_ref_no" name="manual_ref_no" className={inputClass} placeholder="Leave blank — will be assigned automatically" />
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

      <div className="space-y-4">
        {itemKeys.map((key, idx) => (
          <ItemBlock
            key={key}
            itemKey={key}
            index={idx}
            total={itemKeys.length}
            onRemove={() => removeItem(key)}
            itemCategories={itemCategories}
            sizes={sizes}
            currencies={currencies}
          />
        ))}
        <button
          type="button"
          onClick={addItem}
          className="rounded-lg border border-dashed border-amber-400 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50"
        >
          + Add More Item
        </button>
        {itemKeys.length > 1 && (
          <p className="text-xs text-slate-400">
            {itemKeys.length} items — all will share one PO/RF/RG number, with a suffix (e.g. -1/{itemKeys.length}, -2/{itemKeys.length}…).
          </p>
        )}
      </div>

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
            <label className={labelClass} htmlFor="address_type">Address Type</label>
            <select id="address_type" name="address_type" className={inputClass} defaultValue="Residential">
              <option value="Residential">Residential</option>
              <option value="Commercial">Commercial</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="destination_country">Destination Country</label>
            <input id="destination_country" name="destination_country" placeholder="USA / United Kingdom / Germany / ..." className={inputClass} />
          </div>
        </div>

        {/* 2026-08-11: "EORI NO, VAT No, IOSS no order entry me pahle se
            mojud hota hai automatic aane chahiye lekin edit mode me rahe" —
            replaces the old single generic "Tax ID (VAT/IOSS)" field with 3
            separate fields, so Invoice generation can auto-pull the right
            one instead of guessing. Usually blank — only applicable for
            UK/EU shipments. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="vat_number">VAT Number (UK/EU, if any)</label>
            <input id="vat_number" name="vat_number" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="eori_number">EORI Number (UK/EU, if any)</label>
            <input id="eori_number" name="eori_number" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="ioss_number">IOSS Number (if any)</label>
            <input id="ioss_number" name="ioss_number" className={inputClass} />
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
