"use client";

import { useActionState, useEffect } from "react";
import { updateOrder, type OrderEditState } from "./actions";
import { PhotoUrlField } from "./photo-url-field";
import { lookupPostalCode } from "@/lib/postal-lookup";
import { parseFullAddress, looksLikeFullAddress, type ParsedAddress } from "@/lib/parse-full-address";

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
  // 2026-09-08 additions — see
  // db/2026-09-08-order-address-fields-and-vendor-assignments.sql. Country
  // is NOT duplicated here — destination_country above is reused as this
  // structured address's Country field.
  buyer_address1: string | null;
  buyer_address2: string | null;
  buyer_address3: string | null;
  buyer_city: string | null;
  buyer_state: string | null;
  buyer_postal_code: string | null;
  // 2026-08-20 — Gap 2 of the 5-gaps plan. See order-list-table.tsx's
  // "Planned vendor" badge and new/order-form.tsx's own field for the
  // full note — this is the primary place it gets set/corrected, since
  // the real vendor is usually only known after order entry.
  vendor_party_id: string | null;
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
  parties,
  statuses,
  onDone,
}: {
  order: EditableOrder;
  itemCategories: { id: string; name: string }[];
  sizes: { id: string; label: string }[];
  currencies: { code: string; name: string }[];
  parties: { id: string; name: string }[];
  statuses: string[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateOrder, initialState);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  // 2026-09-08 — Structured Address autofill (see src/lib/postal-lookup.ts
  // and new/order-form.tsx's matching handler): on leaving the Postal/Zip
  // Code field, try to fill City/State from it. Reads Destination Country
  // straight off the DOM by this row's id suffix — this form is otherwise
  // uncontrolled/defaultValue-based, so no need to lift these into React
  // state just for this. Only fills City/State when still empty, and both
  // stay ordinary editable inputs either way.
  async function handlePostalBlur() {
    const postalCode = (document.getElementById(`buyer_postal_code-${order.id}`) as HTMLInputElement | null)?.value ?? "";
    const country = (document.getElementById(`destination_country-${order.id}`) as HTMLInputElement | null)?.value ?? "";
    if (!postalCode.trim()) return;

    const result = await lookupPostalCode(postalCode, country);
    if (!result) return;

    const cityInput = document.getElementById(`buyer_city-${order.id}`) as HTMLInputElement | null;
    const stateInput = document.getElementById(`buyer_state-${order.id}`) as HTMLInputElement | null;
    if (cityInput && !cityInput.value.trim()) cityInput.value = result.city;
    if (stateInput && !stateInput.value.trim()) stateInput.value = result.state;
  }

  // 2026-09-10 — same auto-split as new/order-form.tsx (see
  // src/lib/parse-full-address.ts for the full root-cause writeup: this is
  // exactly the screen that fixes an already-broken order like the one in
  // the bug report — a paste-in-full-address habit left City/State/Postcode
  // blank, which is what made a real FedEx booking fail with "Recipient
  // state and postal code mismatch"). Only fills a field when it's still
  // empty (except Address Line 1 itself, the field being split, and Buyer
  // Name only when it too is empty) — nothing already typed is overwritten.
  function applyParsedAddress(parsed: ParsedAddress) {
    const address1Input = document.getElementById(`buyer_address1-${order.id}`) as HTMLInputElement | null;
    const address2Input = document.getElementById(`buyer_address2-${order.id}`) as HTMLInputElement | null;
    const cityInput = document.getElementById(`buyer_city-${order.id}`) as HTMLInputElement | null;
    const stateInput = document.getElementById(`buyer_state-${order.id}`) as HTMLInputElement | null;
    const postalInput = document.getElementById(`buyer_postal_code-${order.id}`) as HTMLInputElement | null;
    const countryInput = document.getElementById(`destination_country-${order.id}`) as HTMLInputElement | null;
    const nameInput = document.getElementById(`buyer_name_address-${order.id}`) as HTMLInputElement | null;

    let address1 = parsed.address1;
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
    if (!looksLikeFullAddress(pasted)) return;
    e.preventDefault();
    applyParsedAddress(parseFullAddress(pasted));
  }

  // "Split Address" — re-parses whatever is ALREADY in Address Line 1.
  // This is the one-click fix for an order that already has the whole
  // address jammed into Address Line 1 from before this feature existed.
  function handleSplitAddressClick() {
    const address1Input = document.getElementById(`buyer_address1-${order.id}`) as HTMLInputElement | null;
    if (!address1Input || !address1Input.value.trim()) return;
    applyParsedAddress(parseFullAddress(address1Input.value));
  }

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
          <PhotoUrlField
            id={`photo_url-${order.id}`}
            name="photo_url"
            defaultValue={order.photo_url}
            labelClass={labelClass}
          />
        </div>
        <div className="flex items-center gap-2 pt-5">
          <input id={`tassel_fringes-${order.id}`} name="tassel_fringes" type="checkbox" defaultChecked={!!order.tassel_fringes} className="h-4 w-4 rounded border-slate-300" />
          <label htmlFor={`tassel_fringes-${order.id}`} className="text-xs text-slate-600">Tassel / Fringes</label>
        </div>
        <div>
          {/* 2026-09-08 (follow-up): relabeled to plain "Buyer Name" — see
              the matching comment in order-form.tsx for the full reasoning.
              Name-only going forward; composeBuyerNameAndAddress() in
              src/lib/compose-buyer-address.ts builds the full printable
              address from this plus the Structured Address fields wherever
              one is needed (packing slip, CSB-V invoice), falling back to
              this field's raw content unchanged for older orders that still
              have the old combined name+address blob here. */}
          <label className={labelClass} htmlFor={`buyer_name_address-${order.id}`}>Buyer Name</label>
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
        {/* 2026-09-08 — Structured Address: buyer_name_address above stays
            the single free-text field (kept for packing-slip printing);
            these separate address1/2/3/city/state/postcode fields are what
            courier booking (create-shipment-form.tsx) needs per courier API
            norms. Destination Country above doubles as this section's
            Country field — no separate column. */}
        <div className="sm:col-span-4 rounded-lg border border-slate-200 bg-white p-3">
          <p className="mb-2 text-xs font-semibold text-slate-700">Structured Address</p>
          <p className="mb-2 text-[11px] text-slate-400">
            Used to pre-fill address fields automatically when booking a courier shipment for this order — please
            fill this in accurately. If the full address ever ends up jammed into Address Line 1 (e.g. pasted in one
            go), click &quot;Split Address&quot; to auto-fill City/State/Postcode from it.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between">
                <label className={labelClass} htmlFor={`buyer_address1-${order.id}`}>Address Line 1</label>
                <button
                  type="button"
                  onClick={handleSplitAddressClick}
                  className="mb-1 text-[11px] font-medium text-amber-700 hover:underline"
                  title="If the full address got pasted into this one box, click to split it into City/State/Postcode below"
                >
                  ✂ Split Address
                </button>
              </div>
              <input
                id={`buyer_address1-${order.id}`}
                name="buyer_address1"
                defaultValue={order.buyer_address1 ?? ""}
                onPaste={handleAddress1Paste}
                className={inputClass}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor={`buyer_address2-${order.id}`}>Address Line 2</label>
              <input id={`buyer_address2-${order.id}`} name="buyer_address2" defaultValue={order.buyer_address2 ?? ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor={`buyer_city-${order.id}`}>City</label>
              <input id={`buyer_city-${order.id}`} name="buyer_city" defaultValue={order.buyer_city ?? ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor={`buyer_state-${order.id}`}>State</label>
              <input id={`buyer_state-${order.id}`} name="buyer_state" defaultValue={order.buyer_state ?? ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor={`buyer_postal_code-${order.id}`}>Postal / Zip Code</label>
              <input
                id={`buyer_postal_code-${order.id}`}
                name="buyer_postal_code"
                defaultValue={order.buyer_postal_code ?? ""}
                className={inputClass}
                onBlur={handlePostalBlur}
              />
            </div>
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor={`vendor_party_id-${order.id}`}>Purchasing From (if known)</label>
          <select id={`vendor_party_id-${order.id}`} name="vendor_party_id" defaultValue={order.vendor_party_id ?? ""} className={inputClass}>
            <option value="">Not known yet</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
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
