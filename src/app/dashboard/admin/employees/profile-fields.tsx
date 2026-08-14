"use client";

import { useState } from "react";

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
  // 2026-08-14: "employee ki photo ka preview dikhna chahiye" — a live
  // preview next to the Photo URL field, since this is still a plain-text
  // URL field (no upload widget — same pre-existing limitation as
  // companies.logo_url, noted since 2026-08-07). Controlled only for this
  // one field so the preview updates as you type/paste; every other field
  // here stays uncontrolled (defaultValue), unchanged.
  const [photoUrl, setPhotoUrl] = useState(defaults?.photo_url ?? "");
  const [photoBroken, setPhotoBroken] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="whatsapp_no">WhatsApp No.</label>
          <input id="whatsapp_no" name="whatsapp_no" defaultValue={defaults?.whatsapp_no ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="photo_url">Photo URL</label>
          <div className="flex items-center gap-2">
            {photoUrl && !photoBroken ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt="Preview"
                onError={() => setPhotoBroken(true)}
                onLoad={() => setPhotoBroken(false)}
                className="h-9 w-9 shrink-0 rounded-full border border-slate-200 object-cover"
              />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-xs text-slate-300">
                {photoUrl ? "✕" : "—"}
              </div>
            )}
            <input
              id="photo_url"
              name="photo_url"
              value={photoUrl}
              onChange={(e) => {
                setPhotoUrl(e.target.value);
                setPhotoBroken(false);
              }}
              placeholder="https://..."
              className={inputClass}
            />
          </div>
          {photoUrl && photoBroken && <p className="mt-1 text-xs text-red-500">Couldn&apos;t load an image from this URL.</p>}
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
    </div>
  );
}
