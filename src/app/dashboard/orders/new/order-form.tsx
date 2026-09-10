"use client";

import { useActionState, useRef, useEffect, useState, type FormEvent } from "react";
import { createOrder, checkFinishedStockAction, type OrderFormState } from "./actions";
import { PhotoUrlField } from "../photo-url-field";
import { lookupPostalCode } from "@/lib/postal-lookup";
import { parseFullAddress, looksLikeFullAddress, type ParsedAddress } from "@/lib/parse-full-address";

const initialState: OrderFormState = { error: null, success: null };

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

type ItemCategory = { id: string; name: string };
type Size = { id: string; label: string };
type Currency = { code: string; name: string };
type Party = { id: string; name: string };

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
  parties,
}: {
  stores: { id: string; name: string }[];
  itemCategories: ItemCategory[];
  sizes: Size[];
  currencies: Currency[];
  parties: Party[];
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

  // 2026-09-08 — Structured Address autofill: on leaving the Postal/Zip
  // Code field, try to fill City/State from it (see src/lib/postal-lookup.ts
  // for the two free lookup services and why this never blocks/errors).
  // Reads Destination Country straight off the DOM, same "uncontrolled,
  // read by id" convention this form already uses elsewhere (see
  // handleSubmit above and ItemBlock's checkStock) — no need to lift these
  // into React state just for this. Only fills City/State when they're
  // still empty, so a value the employee already typed is never overwritten;
  // both stay ordinary editable inputs afterward either way.
  async function handlePostalBlur() {
    const postalCode = (document.getElementById("buyer_postal_code") as HTMLInputElement | null)?.value ?? "";
    const country = (document.getElementById("destination_country") as HTMLInputElement | null)?.value ?? "";
    if (!postalCode.trim()) return;

    const result = await lookupPostalCode(postalCode, country);
    if (!result) return;

    const cityInput = document.getElementById("buyer_city") as HTMLInputElement | null;
    const stateInput = document.getElementById("buyer_state") as HTMLInputElement | null;
    if (cityInput && !cityInput.value.trim()) cityInput.value = result.city;
    if (stateInput && !stateInput.value.trim()) stateInput.value = result.state;
  }

  // 2026-09-10 — "ORDER SE FIRST LINE SECOND LINE SE ADDRESSH UTH KE NAHI
  // AARA": Address Line 1 here has always been one plain box with zero
  // guidance, so an employee pasting the buyer's FULL address (name +
  // street + city + state + zip + country, the way it's usually copied
  // from a marketplace order) naturally pastes the whole thing in here —
  // exactly like the old single free-text field always let them. That left
  // City/State/Postcode blank, which is what caused a real FedEx booking
  // to fail with a confusing "Recipient state and postal code mismatch"
  // (see src/lib/parse-full-address.ts for the full root-cause writeup).
  //
  // Fix: intercept the paste, read the RAW clipboard text (still has real
  // line breaks at this point, before the browser would otherwise collapse
  // them into a single line) and auto-split it into Address Line 1/2,
  // City, State, Postcode, Destination Country — and, if it starts with
  // what looks like a plain name, Buyer Name too. Only intercepts when the
  // pasted text actually looks like a full address (looksLikeFullAddress)
  // — a normal "123 Main St" paste behaves exactly as before. Every field
  // this touches stays an ordinary editable input either way — nothing
  // here is ever silently trusted without a look.
  function applyParsedAddress(parsed: ParsedAddress) {
    const address1Input = document.getElementById("buyer_address1") as HTMLInputElement | null;
    const address2Input = document.getElementById("buyer_address2") as HTMLInputElement | null;
    const cityInput = document.getElementById("buyer_city") as HTMLInputElement | null;
    const stateInput = document.getElementById("buyer_state") as HTMLInputElement | null;
    const postalInput = document.getElementById("buyer_postal_code") as HTMLInputElement | null;
    const countryInput = document.getElementById("destination_country") as HTMLInputElement | null;
    const nameInput = document.getElementById("buyer_name_address") as HTMLInputElement | null;

    let address1 = parsed.address1;
    // Peel a leading plain-looking name (letters only, up to 4 words,
    // followed by a street number) off Address Line 1 into Buyer Name —
    // only when Buyer Name is still empty, so a name already typed is
    // never overwritten.
    if (nameInput && !nameInput.value.trim()) {
      const nameMatch = address1.match(/^([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3})\s+(\d.*)$/);
      if (nameMatch) {
        nameInput.value = nameMatch[1].trim();
        address1 = nameMatch[2].trim();
      }
    }

    if (address1Input) address1Input.value = address1;
    if (address2Input && !address2Input.value.trim() && parsed.address2) address2Input.value = parsed.address2;
    if (cityInput && !cityInput.value.trim() && parsed.city) cityInput.value = parsed.city;
    if (stateInput && !stateInput.value.trim() && parsed.state) stateInput.value = parsed.state;
    if (postalInput && !postalInput.value.trim() && parsed.postalCode) postalInput.value = parsed.postalCode;
    if (countryInput && !countryInput.value.trim() && parsed.country) countryInput.value = parsed.country;
  }

  function handleAddress1Paste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text/plain");
    if (!looksLikeFullAddress(pasted)) return; // plain street paste — behave exactly as before
    e.preventDefault();
    applyParsedAddress(parseFullAddress(pasted));
  }

  // "Split Address" button — same parser, but re-run against whatever is
  // ALREADY sitting in Address Line 1 (handles text typed by hand, pasted
  // before this fix existed, or pasted through a path that couldn't be
  // intercepted, e.g. a phone's "Paste" menu).
  function handleSplitAddressClick() {
    const address1Input = document.getElementById("buyer_address1") as HTMLInputElement | null;
    if (!address1Input || !address1Input.value.trim()) return;
    applyParsedAddress(parseFullAddress(address1Input.value));
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
          <div>
            <label className={labelClass} htmlFor="vendor_party_id">Purchasing From (if known)</label>
            <select id="vendor_party_id" name="vendor_party_id" defaultValue="" className={inputClass}>
              <option value="">Not known yet</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              Usually unknown at this stage — leave blank and set it later from the Orders hub once the vendor is
              confirmed. Purely a planning note, not tied to any Purchase Bill yet.
            </p>
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
          <div>
            {/* 2026-09-08 (follow-up): relabeled from "Buyer Name & Address"
                to plain "Buyer Name" and shrunk from a textarea to a single
                line, per explicit feedback that keeping a combined
                name+address box right next to the new Structured Address
                section below was confusing — two places to type the same
                address. This field is now name-only for any order entered
                from here on; the DB column is still called
                buyer_name_address (unchanged, to avoid a much larger rename
                ripple across ~40 other files that reference it), and every
                place that needs the FULL printable address (packing slip,
                CSB-V invoice auto-pull) now composes it from this name plus
                the Structured Address fields — see
                src/lib/compose-buyer-address.ts. Older orders that still
                have a full multi-line blob here (from before this change)
                are unaffected: composeBuyerNameAndAddress() falls back to
                printing this field's raw content as-is whenever the
                Structured Address fields are empty. */}
            <label className={labelClass} htmlFor="buyer_name_address">Buyer Name</label>
            <input id="buyer_name_address" name="buyer_name_address" className={inputClass} />
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

        {/* 2026-09-08 — Structured Address: buyer_name_address above stays
            the single free-text "paste it all in one box" field (kept for
            packing-slip printing), but courier booking (create-shipment-form
            .tsx) needs address line(s)/city/state/postcode as separate
            fields per courier API norms — this is what lets that screen
            stop asking the employee to re-type the address from scratch at
            booking time. Destination Country above doubles as this
            section's Country field — no separate column for it. */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-3 text-sm font-semibold text-slate-900">Structured Address</p>
          <p className="mb-3 text-xs text-slate-500">
            Used to pre-fill address fields automatically when booking a courier shipment for this order — please
            fill this in accurately. Tip: paste the buyer&apos;s full address (name, street, city, state, zip,
            country) straight into Address Line 1 — it will split itself automatically into the fields below.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between">
                <label className={labelClass} htmlFor="buyer_address1">Address Line 1</label>
                {/* 2026-09-10 — one-click fix for text already pasted in
                    full (typed by hand, pasted before this feature existed,
                    or pasted through a path onPaste couldn't intercept) —
                    re-runs the same auto-split against the current value. */}
                <button
                  type="button"
                  onClick={handleSplitAddressClick}
                  className="mb-1 text-xs font-medium text-amber-700 hover:underline"
                  title="If the full address got pasted into this one box, click to split it into City/State/Postcode below"
                >
                  ✂ Split Address
                </button>
              </div>
              <input id="buyer_address1" name="buyer_address1" onPaste={handleAddress1Paste} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="buyer_address2">Address Line 2</label>
              <input id="buyer_address2" name="buyer_address2" className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="buyer_city">City</label>
              <input id="buyer_city" name="buyer_city" className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="buyer_state">State</label>
              <input id="buyer_state" name="buyer_state" className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="buyer_postal_code">Postal / Zip Code</label>
              <input id="buyer_postal_code" name="buyer_postal_code" className={inputClass} onBlur={handlePostalBlur} />
            </div>
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
