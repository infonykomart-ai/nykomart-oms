"use client";

/**
 * 2026-09-12 — FedEx-style "My Profile" redesign. The old page was one long
 * always-editable form that read like a data-entry screen; the FedEx
 * reference shows the professional pattern the owner wants instead:
 *
 *   • A card-style identity header (photo, name, role) — not a plain text
 *     dump.
 *   • Section-based blocks (like FedEx's "Login & Security" page), each in
 *     VIEW mode by default with an Edit affordance — data is read, not
 *     implied by empty inputs.
 *   • A left in-page section menu on desktop; sections stack on mobile.
 *   • Profile photo shown large with Change/Remove (self-service upload via
 *     uploadMyPhoto + scope:"photo" save — see actions.ts for why a
 *     non-admin needed their own action).
 *   • A password-change card (new self-service capability) alongside the
 *     existing 2FA toggle, under one "Login & Security" group.
 */
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { updateMyProfile, uploadMyPhoto, type MyProfileFormState, type ProfileScope } from "./actions";
import { TwoFactorSection } from "./two-factor-section";
import { PasswordSection } from "./password-section";
import { ActivitySection } from "./activity-section";
import type { ActivityItem } from "./activity-types";
import type { ProfileFieldDefaults } from "../admin/employees/profile-fields";

const inputClass =
  "w-full rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-canvas)] px-3 py-2 text-sm text-[var(--oms-text)] outline-none focus:border-[var(--oms-accent)] focus:ring-1 focus:ring-[var(--oms-accent)]";
const labelClass = "mb-1 block text-sm font-medium text-[var(--oms-text-muted)]";

export type Me = ProfileFieldDefaults & {
  name: string | null;
  email: string | null;
  designation: string | null;
  employee_code: string | null;
  date_of_joining: string | null;
};

function initials(name: string | null): string {
  return (
    (name ?? "?")
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

// 2026-09-29 hotfix — value must accept undefined, not just null: Me mixes
// ProfileFieldDefaults' OPTIONAL columns (dob?: string | null →
// string | null | undefined) with its own required-nullable ones, so
// callers can legally pass undefined (Vercel build caught this: TS2345 at
// the Date of Birth / Anniversary / Date of Joining rows).
function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? value + "T00:00:00" : value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <span className="shrink-0 text-sm text-[var(--oms-text-muted)]">{label}</span>
      <span className="text-right text-sm font-medium text-[var(--oms-text)]">{value}</span>
    </div>
  );
}

function Section({
  id,
  title,
  description,
  editing,
  onEdit,
  children,
}: {
  id: string;
  title: string;
  description: string;
  editing: boolean;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <section id={id} className="oms-card scroll-mt-6 rounded-2xl border p-5 shadow-sm md:p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--oms-text)]">{title}</h2>
          <p className="mt-0.5 text-xs text-[var(--oms-text-muted)]">{description}</p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 text-sm font-semibold uppercase tracking-wide text-[var(--oms-accent)] transition hover:opacity-80"
        >
          {editing ? "Close" : "Edit"}
        </button>
      </div>
      {children}
    </section>
  );
}

const SECTIONS: [ProfileScope, string][] = [
  ["personal", "Personal Info"],
  ["family", "Family Contacts"],
  ["statutory", "Statutory & Bank"],
];

/** Shared Cancel/Save row for every section's edit form. */
function EditActions({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg border border-[var(--oms-surface-border)] px-4 py-2 text-sm font-medium text-[var(--oms-text)] transition hover:bg-[var(--oms-canvas)]"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-[var(--oms-accent)] px-4 py-2 text-sm font-semibold text-[var(--oms-accent-contrast)] transition hover:opacity-90 disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

export function MyProfileClient({
  me,
  roleName,
  companyName,
  twoFactorStatus,
  activity,
}: {
  me: Me;
  roleName: string;
  companyName: string;
  twoFactorStatus: { enrolled: boolean; factorId: string | null };
  activity: ActivityItem[];
}) {
  const [state, setState] = useState<MyProfileFormState>({ error: null, success: false });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ProfileScope | null>(null);
  // Live marital-status selection inside the Personal edit form — the
  // Anniversary field appears the moment Married is picked (same behaviour
  // as the shared ProfileFields), without waiting for a save.
  const [maritalStatus, setMaritalStatus] = useState(me.marital_status ?? "");

  const photoUrl = me.photo_url ?? "";
  const [photoBroken, setPhotoBroken] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function saveScope(fd: FormData): Promise<boolean> {
    setSaving(true);
    const res = await updateMyProfile({ error: null, success: false }, fd);
    setSaving(false);
    setState(res);
    if (!res.error) setEditing(null);
    return !res.error;
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void saveScope(new FormData(e.currentTarget));
  }

  /** Header camera button: upload to Storage, then save photo_url directly. */
  async function handlePhotoUpload(file: File) {
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await uploadMyPhoto(fd);
      if (r.error || !r.url) {
        setState({ error: r.error ?? "Upload failed.", success: false });
        return;
      }
      const saveFd = new FormData();
      saveFd.append("scope", "photo");
      saveFd.append("photo_url", r.url);
      await saveScope(saveFd);
      setPhotoBroken(false);
    } catch {
      setState({ error: "Upload failed — try again.", success: false });
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* ── Identity header ──────────────────────────────────────────── */}
      <div className="oms-card overflow-hidden rounded-2xl border shadow-sm">
        <div className="h-20 bg-[var(--oms-sidebar-bg)] md:h-24" />
        <div className="px-5 pb-5 md:px-6 md:pb-6">
          <div className="-mt-10 flex flex-wrap items-end gap-4 md:-mt-12">
            <div className="relative shrink-0">
              {photoUrl && !photoBroken ? (
                // eslint-disable-next-line @next/next/no-img-element -- remote Storage URL, not a static asset
                <img
                  src={photoUrl}
                  alt={me.name ?? "Profile photo"}
                  onError={() => setPhotoBroken(true)}
                  className="h-24 w-24 rounded-2xl border-4 border-[var(--oms-surface)] object-cover shadow-md md:h-28 md:w-28"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-2xl border-4 border-[var(--oms-surface)] bg-[var(--oms-accent)]/20 text-2xl font-bold text-[var(--oms-text)] shadow-md md:h-28 md:w-28">
                  {initials(me.name)}
                </div>
              )}
              <label
                className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-[var(--oms-accent)] text-sm text-[var(--oms-accent-contrast)] shadow transition hover:opacity-90"
                title={uploadingPhoto ? "Uploading…" : "Change photo"}
              >
                {uploadingPhoto ? "…" : "📷"}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploadingPhoto}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handlePhotoUpload(f);
                  }}
                />
              </label>
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <h1 className="truncate text-xl font-bold text-[var(--oms-text)] md:text-2xl">{me.name ?? "—"}</h1>
              <p className="mt-0.5 text-sm text-[var(--oms-text-muted)]">
                {[me.designation || null, roleName || null, companyName || null].filter(Boolean).join(" · ")}
              </p>
              {me.email && <p className="mt-0.5 truncate text-xs text-[var(--oms-text-muted)]">{me.email}</p>}
            </div>
          </div>
        </div>
      </div>

      {state.error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-800">{state.error}</p>}
      {state.success && !state.error && (
        <p className="mt-4 rounded-xl bg-green-50 px-4 py-2.5 text-sm text-green-800">✓ Profile updated.</p>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[220px_1fr]">
        {/* ── In-page section menu (desktop) ────────────────────────── */}
        <nav className="hidden lg:block">
          <div className="sticky top-6 space-y-1">
            {SECTIONS.map(([key, label]) => (
              <a
                key={key}
                href={`#sec-${key}`}
                className="block rounded-lg px-3 py-2 text-sm text-[var(--oms-text-muted)] transition hover:bg-[var(--oms-canvas)] hover:text-[var(--oms-text)]"
              >
                {label}
              </a>
            ))}
            <a
              href="#sec-security"
              className="block rounded-lg px-3 py-2 text-sm text-[var(--oms-text-muted)] transition hover:bg-[var(--oms-canvas)] hover:text-[var(--oms-text)]"
            >
              Login &amp; Security
            </a>
          </div>
        </nav>

        {/* ── Sections ──────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-5">
          {/* Personal Info — view + edit */}
          <Section
            id="sec-personal"
            title="Personal Info"
            description="Contact details and personal information."
            editing={editing === "personal"}
            onEdit={() => setEditing(editing === "personal" ? null : "personal")}
          >
            {editing === "personal" ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <input type="hidden" name="scope" value="personal" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass} htmlFor="whatsapp_no">WhatsApp No.</label>
                    <input id="whatsapp_no" name="whatsapp_no" defaultValue={me.whatsapp_no ?? ""} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="gender">Gender</label>
                    <select id="gender" name="gender" defaultValue={me.gender ?? ""} className={inputClass}>
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
                    <input id="dob" name="dob" type="date" defaultValue={me.dob ?? ""} className={inputClass} />
                  </div>
                  {maritalStatus === "Married" && (
                    <div>
                      <label className={labelClass} htmlFor="anniversary_date">Anniversary Date</label>
                      <input id="anniversary_date" name="anniversary_date" type="date" defaultValue={me.anniversary_date ?? ""} className={inputClass} />
                    </div>
                  )}
                </div>
                <p className="text-xs text-[var(--oms-text-muted)]">
                  Role, company, login, employee code, designation and joining date can only be changed by an Admin/MD —
                  contact them if any of that needs updating.
                </p>
                <EditActions saving={saving} onCancel={() => setEditing(null)} />
              </form>
            ) : (
              <div className="divide-y divide-[var(--oms-surface-border)]">
                <Row label="WhatsApp No." value={me.whatsapp_no ?? "—"} />
                <Row label="Email" value={me.email ?? "—"} />
                <Row label="Gender" value={me.gender ?? "—"} />
                <Row label="Marital Status" value={me.marital_status ?? "—"} />
                <Row label="Date of Birth" value={formatDate(me.dob)} />
                {me.marital_status === "Married" && <Row label="Anniversary" value={formatDate(me.anniversary_date)} />}
                <Row label="Employee Code" value={me.employee_code ?? "—"} />
                <Row label="Date of Joining" value={formatDate(me.date_of_joining)} />
                <Row label="Company" value={companyName} />
                <Row label="Role" value={roleName} />
              </div>
            )}
          </Section>

          {/* Family Contacts — view + edit */}
          <Section
            id="sec-family"
            title="Family Contacts"
            description="Emergency contacts on record."
            editing={editing === "family"}
            onEdit={() => setEditing(editing === "family" ? null : "family")}
          >
            {editing === "family" ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <input type="hidden" name="scope" value="family" />
                {[1, 2].map((n) => (
                  <div key={n}>
                    <span className={labelClass}>Family Contact {n}</span>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <input
                        name={`family_contact_${n}_name`}
                        placeholder="Name"
                        defaultValue={(me[`family_contact_${n}_name` as keyof Me] as string | null) ?? ""}
                        className={inputClass}
                      />
                      <input
                        name={`family_contact_${n}_relation`}
                        placeholder="Relation (Father/Mother/...)"
                        defaultValue={(me[`family_contact_${n}_relation` as keyof Me] as string | null) ?? ""}
                        className={inputClass}
                      />
                      <input
                        name={`family_contact_${n}_number`}
                        placeholder="Contact No."
                        defaultValue={(me[`family_contact_${n}_number` as keyof Me] as string | null) ?? ""}
                        className={inputClass}
                      />
                    </div>
                  </div>
                ))}
                <EditActions saving={saving} onCancel={() => setEditing(null)} />
              </form>
            ) : (
              <div className="divide-y divide-[var(--oms-surface-border)]">
                <Row
                  label="Contact 1"
                  value={
                    [me.family_contact_1_name, me.family_contact_1_relation, me.family_contact_1_number]
                      .filter(Boolean)
                      .join(" · ") || "—"
                  }
                />
                <Row
                  label="Contact 2"
                  value={
                    [me.family_contact_2_name, me.family_contact_2_relation, me.family_contact_2_number]
                      .filter(Boolean)
                      .join(" · ") || "—"
                  }
                />
              </div>
            )}
          </Section>

          {/* Statutory & Bank — view + edit */}
          <Section
            id="sec-statutory"
            title="Statutory & Bank"
            description="Used on payslips and salary disbursement — keep accurate."
            editing={editing === "statutory"}
            onEdit={() => setEditing(editing === "statutory" ? null : "statutory")}
          >
            {editing === "statutory" ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <input type="hidden" name="scope" value="statutory" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass} htmlFor="pan_number">PAN Number</label>
                    <input id="pan_number" name="pan_number" defaultValue={me.pan_number ?? ""} placeholder="ABCDE1234F" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="uan_number">UAN (PF)</label>
                    <input id="uan_number" name="uan_number" defaultValue={me.uan_number ?? ""} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="pf_number">PF Account No.</label>
                    <input id="pf_number" name="pf_number" defaultValue={me.pf_number ?? ""} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="esi_number">ESI Number</label>
                    <input id="esi_number" name="esi_number" defaultValue={me.esi_number ?? ""} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="bank_account_holder_name">Bank A/c Holder Name</label>
                    <input id="bank_account_holder_name" name="bank_account_holder_name" defaultValue={me.bank_account_holder_name ?? ""} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="bank_account_no">Bank Account No.</label>
                    <input id="bank_account_no" name="bank_account_no" defaultValue={me.bank_account_no ?? ""} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="bank_ifsc">IFSC Code</label>
                    <input id="bank_ifsc" name="bank_ifsc" defaultValue={me.bank_ifsc ?? ""} placeholder="SBIN0001234" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="bank_name">Bank Name</label>
                    <input id="bank_name" name="bank_name" defaultValue={me.bank_name ?? ""} className={inputClass} />
                  </div>
                </div>
                <EditActions saving={saving} onCancel={() => setEditing(null)} />
              </form>
            ) : (
              <div className="divide-y divide-[var(--oms-surface-border)]">
                <Row label="PAN Number" value={me.pan_number ?? "—"} />
                <Row label="UAN (PF)" value={me.uan_number ?? "—"} />
                <Row label="PF Account No." value={me.pf_number ?? "—"} />
                <Row label="ESI Number" value={me.esi_number ?? "—"} />
                <Row label="Bank A/c Holder" value={me.bank_account_holder_name ?? "—"} />
                <Row label="Bank Account No." value={me.bank_account_no ?? "—"} />
                <Row label="IFSC Code" value={me.bank_ifsc ?? "—"} />
                <Row label="Bank Name" value={me.bank_name ?? "—"} />
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* ── Login & Security (advanced tools) ─────────────────────────── */}
      <div className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-[var(--oms-text)]">Login &amp; Security</h2>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <PasswordSection />
          <TwoFactorSection initialStatus={twoFactorStatus} />
          <div className="md:col-span-2">
            <ActivitySection items={activity} />
          </div>
        </div>
      </div>
    </div>
  );
}
