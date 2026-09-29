import { NextResponse } from "next/server";
import { getAuthedEmployee, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { renderMyDataPdf, type MyDataPdfInput } from "@/app/dashboard/profile/my-data-pdf";

// 2026-09-29 — Suggestion #2: "Download my data" — POST /api/profile-pdf
// renders the SIGNED-IN EMPLOYEE'S OWN profile record as an A4 PDF. POST
// (like /api/ledger-pdf) so nothing cacheable ever leaks a profile; the
// employee id comes from the SESSION (getAuthedEmployee), never the body,
// so there is no id-guessing or cross-employee exposure surface at all.
//
// Everything is re-read server-side from the DB — the client sends no data
// — so the PDF can never disagree with the live record.
export async function POST() {
  let employee;
  try {
    employee = await getAuthedEmployee();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const [{ data: me }, { data: role }, { data: company }, { data: activity }] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "name, email, designation, employee_code, date_of_joining, whatsapp_no, gender, marital_status, dob, anniversary_date, photo_url, family_contact_1_name, family_contact_1_relation, family_contact_1_number, family_contact_2_name, family_contact_2_relation, family_contact_2_number, pan_number, uan_number, pf_number, esi_number, bank_account_holder_name, bank_account_no, bank_ifsc, bank_name"
      )
      .eq("id", employee.id)
      .single(),
    supabase.from("roles").select("name").eq("id", employee.roleId).single(),
    supabase.from("companies").select("name").eq("id", employee.homeCompanyId).single(),
    // Same self-scoped security trail the Recent-activity card shows.
    supabase
      .from("audit_log")
      .select("action, created_at")
      .eq("employee_id", employee.id)
      .in("action", ["auth.login", "auth.login_2fa", "auth.password_changed", "auth.2fa_enabled", "auth.2fa_disabled", "profile.updated"])
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  if (!me) {
    return NextResponse.json({ ok: false, error: "Could not load your profile." }, { status: 500 });
  }

  const dash = "—";
  const fmtDate = (v: string | null): string => {
    if (!v) return dash;
    const d = new Date(v.length === 10 ? v + "T00:00:00" : v);
    return isNaN(d.getTime()) ? v : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };
  const fmtWhen = (v: string): string => {
    const d = new Date(v);
    return isNaN(d.getTime())
      ? v
      : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  };
  const ACTION_LABELS: Record<string, string> = {
    "auth.login": "Signed in",
    "auth.login_2fa": "Signed in (two-step verified)",
    "auth.password_changed": "Password changed",
    "auth.2fa_enabled": "Two-factor authentication enabled",
    "auth.2fa_disabled": "Two-factor authentication disabled",
    "profile.updated": "Profile updated",
  };

  const input: MyDataPdfInput = {
    employeeName: me.name ?? dash,
    generatedAtLabel: new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    companyName: company?.name ?? dash,
    roleName: role?.name ?? dash,
    identity: [
      { label: "Employee Code", value: me.employee_code ?? dash },
      { label: "Designation", value: me.designation ?? dash },
      { label: "Date of Joining", value: fmtDate(me.date_of_joining) },
      { label: "Company", value: company?.name ?? dash },
      { label: "Role", value: role?.name ?? dash },
      { label: "Login Email", value: me.email ?? dash },
    ],
    personal: [
      { label: "WhatsApp No.", value: me.whatsapp_no ?? dash },
      { label: "Gender", value: me.gender ?? dash },
      { label: "Marital Status", value: me.marital_status ?? dash },
      { label: "Date of Birth", value: fmtDate(me.dob) },
      ...(me.marital_status === "Married" ? [{ label: "Anniversary", value: fmtDate(me.anniversary_date) }] : []),
    ],
    family: [
      {
        label: "Contact 1",
        value:
          [me.family_contact_1_name, me.family_contact_1_relation, me.family_contact_1_number].filter(Boolean).join(" · ") || dash,
      },
      {
        label: "Contact 2",
        value:
          [me.family_contact_2_name, me.family_contact_2_relation, me.family_contact_2_number].filter(Boolean).join(" · ") || dash,
      },
    ],
    statutory: [
      { label: "PAN Number", value: me.pan_number ?? dash },
      { label: "UAN (PF)", value: me.uan_number ?? dash },
      { label: "PF Account No.", value: me.pf_number ?? dash },
      { label: "ESI Number", value: me.esi_number ?? dash },
      { label: "Bank A/c Holder", value: me.bank_account_holder_name ?? dash },
      { label: "Bank Account No.", value: me.bank_account_no ?? dash },
      { label: "IFSC Code", value: me.bank_ifsc ?? dash },
      { label: "Bank Name", value: me.bank_name ?? dash },
    ],
    activity: (activity ?? []).map((a) => ({
      when: fmtWhen(a.created_at),
      label: ACTION_LABELS[a.action] ?? a.action,
    })),
  };

  const buffer = await renderMyDataPdf(input);
  const filename = `my-profile-${(me.name || "employee").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
