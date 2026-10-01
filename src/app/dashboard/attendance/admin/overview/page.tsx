import Link from "next/link";
// 2026-10-01 — TeamOffice's Dashboard screenshot: the stat card row
// (Active / Present / Late / Absent / Week Off / Leave / …), the
// "Employees Daily Status (In Percentage)" pie for TODAY and the
// "Employees Monthly Status" bar (present employees per day of the
// selected month). Every number is derived from the same
// categorizeMonth() classification the Attendance Admin team summary,
// the four report pages and the salary pipeline use — this screen can
// never disagree with them about what a day counted as.
//
// Deliberately its own page (not more panels piled onto the already
// 1100-line Attendance Admin page): this is the glanceable morning
// dashboard, that is the working console.
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { datesInMonth, daysInMonth, istDayOfWeek, todayIST } from "@/lib/attendance/ist-date";
import { categorizeMonth, type DayCategory } from "@/lib/attendance/payroll";
import { BarChart, DonutChart, type BarDatum, type DonutDatum } from "@/components/simple-charts";

type Tone = "blue" | "green" | "amber" | "red" | "sky" | "purple" | "orange" | "slate" | "pink";

const TONE_CLASS: Record<Tone, { chip: string; value: string }> = {
  blue: { chip: "bg-blue-500", value: "text-blue-600" },
  green: { chip: "bg-emerald-500", value: "text-emerald-600" },
  amber: { chip: "bg-amber-500", value: "text-amber-600" },
  red: { chip: "bg-red-500", value: "text-red-600" },
  sky: { chip: "bg-sky-500", value: "text-sky-600" },
  purple: { chip: "bg-purple-500", value: "text-purple-600" },
  orange: { chip: "bg-orange-500", value: "text-orange-600" },
  slate: { chip: "bg-slate-500", value: "text-slate-600" },
  pink: { chip: "bg-pink-500", value: "text-pink-600" },
};

function StatCard({ label, value, icon, tone }: { label: string; value: number; icon: string; tone: Tone }) {
  const t = TONE_CLASS[tone];
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg text-white ${t.chip}`}>{icon}</span>
      <div className="min-w-0">
        <div className={`text-2xl font-semibold tabular-nums leading-none ${t.value}`}>{value}</div>
        <div className="mt-1 truncate text-xs font-medium text-slate-500">{label}</div>
      </div>
    </div>
  );
}

const TODAY_COLORS: Record<string, string> = {
  Present: "#22c55e",
  Late: "#f59e0b",
  Absent: "#ef4444",
  "Half Day": "#f97316",
  Leave: "#a855f7",
  "Week Off": "#38bdf8",
  Holiday: "#64748b",
};

export default async function AttendanceOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const authed = await requireCapability("attendance_admin");
  const supabase = await createClient();
  const sp = await searchParams;

  const today = todayIST();
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const [year, monthNum] = month.split("-").map(Number);
  const monthEnd = `${month}-${String(daysInMonth(year, monthNum)).padStart(2, "0")}`;

  const { data: companiesRaw } = await supabase.from("companies").select("id, name, weekly_off_days").in("id", authed.companyIds);
  const companies = companiesRaw ?? [];
  const selectedCompanyId =
    typeof sp.company === "string" && authed.companyIds.includes(sp.company) ? sp.company : authed.currentCompanyId;
  const selectedCompany = companies.find((c) => c.id === selectedCompanyId) ?? companies[0];
  const weeklyOffDays = (selectedCompany?.weekly_off_days as number[] | null) ?? [];

  const [{ data: activeEmp }, { data: inactiveRows }, { data: todayRows }, { data: monthRows }, { data: companyHolidays }, { data: globalHolidays }] =
    await Promise.all([
      supabase.from("employees").select("id, name, date_of_joining").eq("company_id", selectedCompanyId).eq("active", true).order("name"),
      supabase.from("employees").select("id").eq("company_id", selectedCompanyId).eq("active", false),
      supabase.from("attendance").select("employee_id, status").eq("company_id", selectedCompanyId).eq("attendance_date", today),
      supabase
        .from("attendance")
        .select("employee_id, attendance_date, status")
        .eq("company_id", selectedCompanyId)
        .gte("attendance_date", `${month}-01`)
        .lte("attendance_date", monthEnd),
      // Holiday range spans BOTH the selected month and TODAY — the cards
      // always describe today even when the bar chart shows another month.
      supabase
        .from("holidays")
        .select("holiday_date")
        .eq("company_id", selectedCompanyId)
        .gte("holiday_date", `${month}-01` < today ? `${month}-01` : today)
        .lte("holiday_date", monthEnd > today ? monthEnd : today),
      supabase
        .from("holidays")
        .select("holiday_date")
        .is("company_id", null)
        .gte("holiday_date", `${month}-01` < today ? `${month}-01` : today)
        .lte("holiday_date", monthEnd > today ? monthEnd : today),
    ]);

  const employees = activeEmp ?? [];
  const holidayDates = new Set<string>([
    ...(globalHolidays ?? []).map((h) => h.holiday_date),
    ...(companyHolidays ?? []).map((h) => h.holiday_date),
  ]);

  const rowsByEmployee = new Map<string, Map<string, { status: string | null }>>();
  for (const r of monthRows ?? []) {
    let m = rowsByEmployee.get(r.employee_id);
    if (!m) {
      m = new Map();
      rowsByEmployee.set(r.employee_id, m);
    }
    m.set(r.attendance_date, { status: r.status });
  }
  const todayStatusByEmployee = new Map<string, string | null>();
  for (const r of todayRows ?? []) todayStatusByEmployee.set(r.employee_id, r.status);

  // ── Cards + donut: ALWAYS today, classified with the exact same
  // precedence categorizeMonth() uses (explicit status > holiday >
  // weekly off > absent), applied to this one day.
  const todayCounts: Record<string, number> = {};
  for (const emp of employees) {
    if (emp.date_of_joining && emp.date_of_joining > today) continue; // future joiner can't be present today
    let category: DayCategory;
    const status = todayStatusByEmployee.has(emp.id) ? todayStatusByEmployee.get(emp.id) : null;
    if (status) category = status as DayCategory;
    else if (holidayDates.has(today)) category = "Holiday";
    else if (weeklyOffDays.includes(istDayOfWeek(today))) category = "Week Off";
    else category = "Absent";
    todayCounts[category] = (todayCounts[category] ?? 0) + 1;
  }

  // ── Bar chart: present-per-day across the SELECTED month, from the
  // shared full-month classifier.
  const presentPerDate = new Map<string, number>();
  for (const date of datesInMonth(year, monthNum)) presentPerDate.set(date, 0);

  for (const emp of employees) {
    const categorized = categorizeMonth({
      year,
      month: monthNum,
      weeklyOffDays,
      holidayDates,
      attendanceByDate: rowsByEmployee.get(emp.id) ?? new Map<string, { status: string | null }>(),
      todayStr: today,
      joinDate: emp.date_of_joining,
    });
    for (const d of categorized) {
      if ((d.category === "Present" || d.category === "Late") && presentPerDate.has(d.date)) {
        presentPerDate.set(d.date, (presentPerDate.get(d.date) ?? 0) + 1);
      }
    }
  }

  const donutData: DonutDatum[] = Object.entries(TODAY_COLORS)
    .map(([label, color]) => ({ label, value: todayCounts[label] ?? 0, color }))
    .filter((d) => d.value > 0);

  const barData: BarDatum[] = datesInMonth(year, monthNum).map((date) => ({
    label: String(Number(date.slice(8, 10))),
    value: presentPerDate.get(date) ?? 0,
    color: date <= today ? "#22c55e" : "#cbd5e1", // future days of the month stay grey
  }));

  const cardOrder: { key: string; label: string; icon: string; tone: Tone }[] = [
    { key: "Active", label: "Active Emp.", icon: "👥", tone: "blue" },
    { key: "Present", label: "Present Emp.", icon: "✓", tone: "green" },
    { key: "Late", label: "Late Arrival", icon: "😕", tone: "amber" },
    { key: "Absent", label: "Absent Emp.", icon: "✕", tone: "red" },
    { key: "Week Off", label: "Week Off Emp.", icon: "🌤️", tone: "sky" },
    { key: "Leave", label: "Leave Emp.", icon: "🏖️", tone: "purple" },
    { key: "Half Day", label: "Half Day Emp.", icon: "✂️", tone: "orange" },
    { key: "Holiday", label: "Holiday", icon: "🎉", tone: "slate" },
    { key: "Inactive", label: "DeActive Emp.", icon: "🚫", tone: "pink" },
  ];
  const cardValue = (key: string): number => {
    if (key === "Active") return employees.length;
    if (key === "Inactive") return (inactiveRows ?? []).length;
    return todayCounts[key] ?? 0;
  };

  const selectClass =
    "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-5 py-4 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 text-lg">📊</span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Attendance Dashboard</h1>
            <p className="text-xs text-slate-300">
              {selectedCompany?.name ?? "—"} <span className="mx-1 text-slate-500">·</span> Today {today} <span className="mx-1 text-slate-500">·</span> {month}
            </p>
          </div>
        </div>
        <Link
          href="/dashboard/attendance/admin"
          className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
        >
          ← Attendance Admin
        </Link>
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Company</label>
          <select name="company" defaultValue={selectedCompanyId} className={selectClass}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Month (bar chart)</label>
          <input type="month" name="month" defaultValue={month} className={selectClass} />
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600">
          View
        </button>
      </form>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cardOrder.map((c) => (
          <StatCard key={c.key} label={c.label} value={cardValue(c.key)} icon={c.icon} tone={c.tone} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
          <header className="border-b border-slate-100 bg-slate-50/60 px-5 py-3.5">
            <h2 className="text-sm font-semibold tracking-tight text-slate-900">Employees Daily Status (In Percentage)</h2>
            <p className="mt-0.5 text-xs text-slate-500">Aaj {today} ki team distribution</p>
          </header>
          <div className="p-5">
            {donutData.length === 0 ? (
              <p className="text-sm text-slate-400">No attendance data for today yet — punches will show up here live.</p>
            ) : (
              <DonutChart data={donutData} centerLabel={{ title: "TODAY", value: today }} />
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
          <header className="border-b border-slate-100 bg-slate-50/60 px-5 py-3.5">
            <h2 className="text-sm font-semibold tracking-tight text-slate-900">Employees Monthly Status</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Present employees per day — {month} (green = passed day, grey = upcoming)
            </p>
          </header>
          <div className="p-5">
            <BarChart data={barData} height={220} />
          </div>
        </section>
      </div>
    </div>
  );
}
