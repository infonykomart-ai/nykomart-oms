"use client";

import { useActionState } from "react";
import { saveShipglobalSellerProfile, type SellerProfileState } from "./actions";

const initialState: SellerProfileState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type ExistingSellerProfile = {
  seller_nickname: string;
  seller_firstname: string;
  seller_lastname: string;
  seller_mobile: string;
  seller_email: string;
  seller_company: string;
  seller_address1: string;
  seller_address2: string;
  seller_address3: string | null;
  seller_city: string;
  seller_postcode: string;
  seller_country_code: string;
  seller_state: string;
  seller_tax_id_type: string | null;
  seller_tax_id: string | null;
} | null;

// One-time-per-company setup form — Shipglobal's addOrder.php requires a
// full structured "who is shipping this" declaration on every call (see
// db/2026-08-10-shipglobal.sql's header comment for why this can't reuse
// company_profiles). Filled in once here, then every shipment created for
// this company reuses it automatically.
export function SellerProfileForm({ existing, companyName }: { existing: ExistingSellerProfile; companyName: string }) {
  const [state, formAction, pending] = useActionState(saveShipglobalSellerProfile, initialState);

  return (
    <details className="rounded-lg border border-slate-200 bg-white" open={!existing}>
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">
        Shipglobal Seller Profile — {companyName} {existing ? "(saved ✓)" : "(not set up yet)"}
      </summary>
      <form action={formAction} className="space-y-3 border-t border-slate-100 px-4 py-4">
        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Saved.</p>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div>
            <label className={labelClass}>Nickname *</label>
            <input name="seller_nickname" required defaultValue={existing?.seller_nickname ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>First Name *</label>
            <input name="seller_firstname" required defaultValue={existing?.seller_firstname ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Last Name *</label>
            <input name="seller_lastname" required defaultValue={existing?.seller_lastname ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Mobile *</label>
            <input name="seller_mobile" required defaultValue={existing?.seller_mobile ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Email *</label>
            <input name="seller_email" type="email" required defaultValue={existing?.seller_email ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Company Name *</label>
            <input name="seller_company" required defaultValue={existing?.seller_company ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Address Line 1 *</label>
            <input name="seller_address1" required defaultValue={existing?.seller_address1 ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Address Line 2 *</label>
            <input name="seller_address2" required defaultValue={existing?.seller_address2 ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Address Line 3</label>
            <input name="seller_address3" defaultValue={existing?.seller_address3 ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>City *</label>
            <input name="seller_city" required defaultValue={existing?.seller_city ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Postcode *</label>
            <input name="seller_postcode" required defaultValue={existing?.seller_postcode ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Country Code * (2-letter, e.g. IN)</label>
            <input name="seller_country_code" required maxLength={2} defaultValue={existing?.seller_country_code ?? "IN"} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>State *</label>
            <input name="seller_state" required defaultValue={existing?.seller_state ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Tax ID Type</label>
            <input name="seller_tax_id_type" placeholder="e.g. GSTIN" defaultValue={existing?.seller_tax_id_type ?? "GSTIN"} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Tax ID</label>
            <input name="seller_tax_id" defaultValue={existing?.seller_tax_id ?? ""} className={inputClass} />
          </div>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save Seller Profile"}
        </button>
      </form>
    </details>
  );
}
