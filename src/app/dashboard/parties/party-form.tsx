"use client";

import { useActionState, useRef, useEffect } from "react";
import { saveParty, type PartyFormState } from "./actions";

const PAYMENT_TYPES = ["ADVANCE", "AGAINST BILL", "CASH", "NO BILL", "SALARY"];
const INVOICE_TYPES = ["DUTY TAX", "Purchase", "FREIGHT INVOICE", "Printing", "Washing", "Disbursement FEE", "Service", "JOB WORK"];

const initialState: PartyFormState = { error: null, success: false };

export type EditableParty = {
  id: string;
  name: string;
  party_type: string | null;
  payment_type: string | null;
  invoice_type: string | null;
  address: string | null;
  contact_no: string | null;
  email: string | null;
  gst: string | null;
  remark: string | null;
  bank_name: string | null;
  account_no: string | null;
  ifsc_code: string | null;
  account_holder_name: string | null;
};

// Used both for "add a new party" (party=null, on the main page's left
// column) and inline editing (party set, opened from PartyList's Edit
// button) — same form, same action, just a hidden party_id when editing.
export function PartyForm({ party, onDone }: { party?: EditableParty; onDone?: () => void }) {
  const [state, formAction, pending] = useActionState(saveParty, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const isEdit = !!party;

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      onDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-700">{isEdit ? `Edit "${party.name}"` : "Add New Party"}</p>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}

      {isEdit && <input type="hidden" name="party_id" value={party.id} />}

      <div>
        <label className="block text-xs font-medium text-slate-600">Party Name *</label>
        <input
          type="text"
          name="name"
          required
          defaultValue={party?.name ?? ""}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">Party Type</label>
        <input
          type="text"
          name="party_type"
          defaultValue={party?.party_type ?? ""}
          placeholder="e.g. Courier / International Shipping"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600">Payment Type</label>
          <select
            name="payment_type"
            defaultValue={party?.payment_type ?? ""}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="">—</option>
            {PAYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">Invoice Type</label>
          <select
            name="invoice_type"
            defaultValue={party?.invoice_type ?? ""}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="">—</option>
            {INVOICE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">Address</label>
        <textarea
          name="address"
          defaultValue={party?.address ?? ""}
          rows={2}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600">Contact No</label>
          <input
            type="text"
            name="contact_no"
            defaultValue={party?.contact_no ?? ""}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">Email</label>
          <input
            type="email"
            name="email"
            defaultValue={party?.email ?? ""}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">GST</label>
        <input
          type="text"
          name="gst"
          defaultValue={party?.gst ?? ""}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">Remark</label>
        <textarea
          name="remark"
          defaultValue={party?.remark ?? ""}
          rows={2}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>

      {/* 2026-08-12 (round 8): bank details, so a Bill Pass Register
          payment can be made without hunting the physical bill for
          account info. */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
        <p className="mb-2 text-xs font-semibold text-slate-500">Bank Details</p>
        <div>
          <label className="block text-xs font-medium text-slate-600">Bank Name</label>
          <input
            type="text"
            name="bank_name"
            defaultValue={party?.bank_name ?? ""}
            placeholder="e.g. HDFC Bank, Malviya Nagar, Jaipur"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600">Account No</label>
            <input
              type="text"
              name="account_no"
              defaultValue={party?.account_no ?? ""}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">IFSC Code</label>
            <input
              type="text"
              name="ifsc_code"
              defaultValue={party?.ifsc_code ?? ""}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
        </div>
        <div className="mt-2">
          <label className="block text-xs font-medium text-slate-600">Account Holder Name</label>
          <input
            type="text"
            name="account_holder_name"
            defaultValue={party?.account_holder_name ?? ""}
            placeholder="Only if different from Party Name"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
        >
          {pending ? "Saving..." : isEdit ? "Save Changes" : "Add Party"}
        </button>
        {isEdit && onDone && (
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
