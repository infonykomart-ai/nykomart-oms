"use client";

import { useState } from "react";
import { EmployeePhotoField } from "./employee-photo-field";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export type ProfileFieldDefaults = {
  whatsapp_no?: string | null;
  gender?: string | null;
  marital_status?: string | null;
  dob?: string | null;
  anniversary_date?: string | null;
  photo_url?: string | null;
  family_contact_1_name?: string | null;
  family_contact_1_relation?: string | null;
  family_contact_1_number?: string | null;
  family_contact_2_name?: string | null;
  family_contact_2_relation?: string | null;
  family_contact_2_number?: string | null;
  // 2026-09-11 (Payroll Phase 1) — statutory identity + bank details, see
  // db/2026-09-11-payroll-ctc-structure-and-statutory-fields.sql. Optional,
  // shown on a paid employee's payslip when filled in.
  pan_number?: string | null;
  uan_number?: string | null;
  pf_number?: string | null;
  esi_number?: string | null;
  bank_account_holder_name?: string | null;
  bank_account_no?: string | null;
  bank_ifsc?: string | null;
  bank_name?: string | null;
};

/**
 * Shared Employee Master profile fieldset (2026-08-07) — used by both the
 * "Naya Employee" create form and the "Edit Details" form for existing
 * employees, so the two never drift apart. anniversary_date is only shown
 * when Marital Status = Married (controlled locally); the server action
 * also drops it server-side for Unmarried as a second line of defense.
 */
export function ProfileFields({ defaults }: { defaults?: ProfileFieldDefaults }) {
  const [maritalStatus, setMaritalStatus] = useState(defaults?.marital_status ?? "");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="whatsapp_no">WhatsApp No.</label>
          <input id="whatsapp_no" name="whatsapp_no" defaultValue={defaults?.whatsapp_no ?? ""} className={inputClass} />
        </div>
        <div>
          <EmployeePhotoField defaultValue={defaults?.photo_url} />
        </div>
        <div>
          <label className={labelClass} htmlFor="gender">Gender</label>
          <select id="gender" name="gender" defaultValue={defaults?.gender ?? ""} className={inputClass}>
            <option value="">—</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="marital_status">Marital Status</label>
          <select
            id="marital_status"
            name="marital_status"
            value={maritalStatus}
            onChange={(e) => setMaritalStatus(e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            <option value="Married">Married</option>
            <option value="Unmarried">Unmarried</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="dob">Date of Birth</label>
          <input id="dob" name="dob" type="date" defaultValue={defaults?.dob ?? ""} className={inputClass} />
        </div>
        {maritalStatus === "Married" && (
          <div>
            <label className={labelClass} htmlFor="anniversary_date">Anniversary Date</label>
            <input id="anniversary_date" name="anniversary_date" type="date" defaultValue={defaults?.anniversary_date ?? ""} className={inputClass} />
          </div>
        )}
      </div>

      <div>
        <span className={labelClass}>Family Contact 1</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input name="family_contact_1_name" placeholder="Name" defaultValue={defaults?.family_contact_1_name ?? ""} className={inputClass} />
          <input name="family_contact_1_relation" placeholder="Relation (Father/Mother/...)" defaultValue={defaults?.family_contact_1_relation ?? ""} className={inputClass} />
          <input name="family_contact_1_number" placeholder="Contact No." defaultValue={defaults?.family_contact_1_number ?? ""} className={inputClass} />
        </div>
      </div>

      <div>
        <span className={labelClass}>Family Contact 2</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input name="family_contact_2_name" placeholder="Name" defaultValue={defaults?.family_contact_2_name ?? ""} className={inputClass} />
          <input name="family_contact_2_relation" placeholder="Relation (Spouse/Sibling/...)" defaultValue={defaults?.family_contact_2_relation ?? ""} className={inputClass} />
          <input name="family_contact_2_number" placeholder="Contact No." defaultValue={defaults?.family_contact_2_number ?? ""} className={inputClass} />
        </div>
      </div>

      {/* 2026-09-11 (Payroll Phase 1) — statutory identity + bank details,
          needed for a proper payslip (PAN/UAN/bank a/c) and eventually a
          real bank-transfer file (later round). All optional. */}
      <div>
        <span className={labelClass}>Statutory &amp; Bank Details (for payslips)</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
          <input name="pan_number" placeholder="PAN Number" defaultValue={defaults?.pan_number ?? ""} className={inputClass} />
          <input name="uan_number" placeholder="UAN (PF)" defaultValue={defaults?.uan_number ?? ""} className={inputClass} />
          <input name="pf_number" placeholder="PF Account No." defaultValue={defaults?.pf_number ?? ""} className={inputClass} />
          <input name="esi_number" placeholder="ESI Number" defaultValue={defaults?.esi_number ?? ""} className={inputClass} />
          <input name="bank_account_holder_name" placeholder="Bank A/c Holder Name" defaultValue={defaults?.bank_account_holder_name ?? ""} className={inputClass} />
          <input name="bank_account_no" placeholder="Bank Account No." defaultValue={defaults?.bank_account_no ?? ""} className={inputClass} />
          <input name="bank_ifsc" placeholder="IFSC Code" defaultValue={defaults?.bank_ifsc ?? ""} className={inputClass} />
          <input name="bank_name" placeholder="Bank Name" defaultValue={defaults?.bank_name ?? ""} className={inputClass} />
        </div>
      </div>
    </div>
  );
}
