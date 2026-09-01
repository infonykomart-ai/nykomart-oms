"use client";

import { useActionState } from "react";
import { saveCourierShipperProfile, type ShipperProfileState } from "./actions";

const initialState: ShipperProfileState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type ExistingShipperProfile = {
  contact_name: string;
  company_name: string;
  phone: string;
  email: string;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  postcode: string;
  country_code: string;
  tax_id: string | null;
} | null;

// ONE shared "ship from" address per company, reused across FedEx / UPS /
// Aramex / Delhivery / Shiprocket booking (see
// db/2026-09-01-multi-courier-booking-and-freight-recon.sql's header
// comment on why this is a single profile rather than one per courier —
// unlike Shipglobal's own seller-profile-form.tsx, which stays separate
// since its addOrder.php has Shipglobal-specific fields this doesn't).
export function ShipperProfileForm({ existing, companyName }: { existing: ExistingShipperProfile; companyName: string }) {
  const [state, formAction, pending] = useActionState(saveCourierShipperProfile, initialState);

  return (
    <details className="rounded-lg border border-slate-200 bg-white" open={!existing}>
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">
        Shipper Profile (&quot;Ship From&quot; address) — {companyName} {existing ? "(saved ✓)" : "(not set up yet)"}
      </summary>
      <form action={formAction} className="space-y-3 border-t border-slate-100 px-4 py-4">
        <p className="text-xs text-slate-500">
          One shared pickup/ship-from address for this company, used by every courier below (FedEx, UPS, Aramex, Delhivery,
          Shiprocket) — fill in once.
        </p>
        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Saved.</p>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div>
            <label className={labelClass}>Contact Name *</label>
            <input name="contact_name" required defaultValue={existing?.contact_name ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Company Name *</label>
            <input name="company_name" required defaultValue={existing?.company_name ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Phone *</label>
            <input name="phone" required defaultValue={existing?.phone ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Email *</label>
            <input name="email" type="email" required defaultValue={existing?.email ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Address Line 1 *</label>
            <input name="address1" required defaultValue={existing?.address1 ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Address Line 2</label>
            <input name="address2" defaultValue={existing?.address2 ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>City *</label>
            <input name="city" required defaultValue={existing?.city ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>State *</label>
            <input name="state" required defaultValue={existing?.state ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Postcode *</label>
            <input name="postcode" required defaultValue={existing?.postcode ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Country Code (2-letter)</label>
            <input name="country_code" maxLength={2} defaultValue={existing?.country_code ?? "IN"} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Tax ID / GSTIN</label>
            <input name="tax_id" defaultValue={existing?.tax_id ?? ""} className={inputClass} />
          </div>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save Shipper Profile"}
        </button>
      </form>
    </details>
  );
}
