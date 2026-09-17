"use client";

// 2026-09-15 — "kisi company ka account setup kar diya to shiper profile
// save karne ke baad VIEW EDIT or MODIFY UPDATE karne ka option hona
// chahiye — ye jab bhi jate hai ye NEW FORM show ho jata hai jis se pata
// nahi chalta ki setup hai k nahi": the old markup collapsed the saved
// profile into just "(saved ✓)" in the heading, so reopening this tab
// always LOOKED like an empty new form and there was no way to actually
// see what was saved without expanding and reading input defaultValues.
//
// Now:
//   • No profile saved  → the form opens directly (exactly as before),
//     heading says "(not set up yet)".
//   • Profile saved     → a green ✓ VIEW card shows the full saved address
//     at a glance (contact/company/phone/email/address/city/state/
//     postcode/country/GSTIN), with a "✏️ Edit Profile" button that swaps
//     the card for the pre-filled form (heading "(saved ✓ — editing)") and
//     a Cancel to go back. After a successful save the server re-renders
//     this server component tree (revalidatePath in the action), so the
//     card returns showing the NEW values automatically.
//   • The summary line now carries a live status chip — setup state is
//     obvious without opening anything.
import { useActionState, useEffect, useRef, useState } from "react";
import { deleteCourierShipperProfile, saveCourierShipperProfile, type ShipperProfileState } from "./actions";

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
  // "view" = saved-profile card; "edit" = the form. Only reachable when a
  // profile exists — without one there is nothing to view, so the form is
  // the only state (matching the old behavior for first-time setup).
  const [mode, setMode] = useState<"view" | "edit">(existing ? "view" : "edit");
  // 2026-09-17 — "save karne ke baad bhi yahi aara (new form)": `mode` is
  // mount-time state, so after a FIRST successful save the server re-render
  // brought the new `existing` prop but the component stayed stuck in
  // "edit" — exactly the "is it saved or not?" confusion this file was
  // rebuilt to kill. Flip to the view card as soon as a save succeeds.
  const prevSuccess = useRef(initialState.success);
  useEffect(() => {
    if (state.success && !prevSuccess.current && existing) setMode("view");
    prevSuccess.current = state.success;
  }, [state.success, existing]);
  // Delete (2026-09-17 — "delete ka option"): clears the company's profile
  // entirely (e.g. typed for the wrong company). Server action re-checks
  // everything; window.confirm keeps it a deliberate two-step.
  const [deleteState, deleteAction, deletePending] = useActionState(deleteCourierShipperProfile, initialState);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const summary = (
    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">
      Shipper Profile (&quot;Ship From&quot; address) — {companyName}{" "}
      {existing ? (
        <span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">✓ Setup done</span>
      ) : (
        <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Not set up yet</span>
      )}
    </summary>
  );

  // ── Saved profile VIEW card ────────────────────────────────────────────
  if (existing && mode === "view") {
    return (
      <details className="rounded-lg border border-slate-200 bg-white" open>
        {summary}
        <div className="space-y-3 border-t border-slate-100 px-4 py-4">
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            ✓ This company&apos;s pickup/ship-from address is saved — every courier (FedEx, UPS, Aramex, Delhivery, Shiprocket)
            booking uses it. Use ✏️ Edit below to modify it any time.
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-slate-400">Contact Name</dt>
              <dd className="font-medium text-slate-800">{existing.contact_name}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-400">Company Name</dt>
              <dd className="font-medium text-slate-800">{existing.company_name}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-400">Phone</dt>
              <dd className="font-medium text-slate-800">{existing.phone}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-400">Email</dt>
              <dd className="font-medium text-slate-800">{existing.email}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-slate-400">Address</dt>
              <dd className="font-medium text-slate-800">
                {existing.address1}
                {existing.address2 ? `, ${existing.address2}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-400">City / State / Postcode</dt>
              <dd className="font-medium text-slate-800">
                {existing.city}, {existing.state} {existing.postcode}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-400">Country</dt>
              <dd className="font-medium text-slate-800">{existing.country_code}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-400">Tax ID / GSTIN</dt>
              <dd className="font-medium text-slate-800">{existing.tax_id || "—"}</dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={() => setMode("edit")}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 transition hover:bg-amber-100"
          >
            ✏️ Edit Profile
          </button>
          {confirmingDelete ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-xs text-slate-500">Delete this profile for {companyName}?</span>
              <form action={deleteAction} className="inline">
                <button
                  type="submit"
                  disabled={deletePending}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                >
                  {deletePending ? "Deleting..." : "Yes, delete"}
                </button>
              </form>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Keep it
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50"
            >
              🗑 Delete Profile
            </button>
          )}
          {deleteState.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{deleteState.error}</p>}
        </div>
      </details>
    );
  }

  // ── Form (first-time setup, or Edit mode) ──────────────────────────────
  return (
    <details className="rounded-lg border border-slate-200 bg-white" open>
      {summary}
      <form action={formAction} className="space-y-3 border-t border-slate-100 px-4 py-4">
        <p className="text-xs text-slate-500">
          One shared pickup/ship-from address for this company, used by every courier below (FedEx, UPS, Aramex, Delhivery,
          Shiprocket) — fill in once.
        </p>
        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Saved.</p>}
        {existing && (
          <div className="flex items-center justify-between rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
            <span>Editing the saved profile — change any field and save to update.</span>
            <button
              type="button"
              onClick={() => setMode("view")}
              className="rounded border border-sky-300 bg-white px-2 py-0.5 font-medium text-sky-700 transition hover:bg-sky-50"
            >
              Cancel
            </button>
          </div>
        )}
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
          {pending ? "Saving..." : existing ? "Update Shipper Profile" : "Save Shipper Profile"}
        </button>
      </form>
    </details>
  );
}
