"use client";

import { useMemo, useState } from "react";

type Employee = { id: string; name: string; company_id: string; designation: string | null };
type Company = { id: string; name: string; logo_url: string | null };

const OCCASIONS = [
  {
    key: "best_performance",
    certWord: "of Excellence",
    subtitle: "Best Performance Award",
    body:
      "This certificate is presented in recognition of consistent attendance with zero leaves and no late " +
      "arrivals, exemplary discipline, dedicated work ethic, and continuous growth in performance throughout " +
      "the period. Your commitment sets a benchmark for the entire team.",
  },
  {
    key: "employee_of_the_month",
    certWord: "of Achievement",
    subtitle: "Employee of the Month",
    body:
      "Awarded in recognition of outstanding contribution, initiative, and dedication shown during the month. " +
      "Your hard work and positive attitude have made a real difference to the team, and we are proud to " +
      "recognize your achievement.",
  },
  {
    key: "work_anniversary",
    certWord: "of Appreciation",
    subtitle: "Work Anniversary",
    body:
      "Presented with sincere appreciation for your continued dedication and valuable contribution to the " +
      "company. Thank you for your loyalty and hard work over the years — we look forward to many more years " +
      "together.",
  },
  {
    key: "training_completion",
    certWord: "of Achievement",
    subtitle: "Training Completion",
    body:
      "Awarded for successfully completing the assigned training program with dedication and a positive " +
      "learning attitude. This achievement reflects your commitment to growth and to strengthening your " +
      "skills within the company.",
  },
] as const;

function todayFormatted() {
  return new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

export function CertificateForm({ employees, companies }: { employees: Employee[]; companies: Company[] }) {
  const [employeeId, setEmployeeId] = useState("");
  const [occasionKey, setOccasionKey] = useState<(typeof OCCASIONS)[number]["key"]>(OCCASIONS[0].key);
  const occasion = OCCASIONS.find((o) => o.key === occasionKey) ?? OCCASIONS[0];

  const [employeeName, setEmployeeName] = useState("");
  const [bodyText, setBodyText] = useState(occasion.body);
  const [hrName, setHrName] = useState("");
  const [directorName, setDirectorName] = useState("RD Lohra");
  const [dateIssued, setDateIssued] = useState(todayFormatted());
  const [companyId, setCompanyId] = useState("");

  const companyMap = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const company = companyMap.get(companyId);

  // Company is a SEPARATE, directly-editable dropdown — not derived from
  // the employee's `company_id` (their fixed "home company" in the DB).
  // Real staff work across all 3 companies from one login (see
  // employee_company_access), so an employee's home company often has
  // nothing to do with which company's certificate is actually being
  // issued. Picking an employee just pre-fills a sensible default; picking
  // a company on its own (before/without an employee) also works.
  function handleEmployeeChange(id: string) {
    setEmployeeId(id);
    const emp = employees.find((e) => e.id === id);
    if (emp) {
      setEmployeeName(emp.name);
      if (!companyId) setCompanyId(emp.company_id);
    }
  }

  function handleOccasionChange(key: (typeof OCCASIONS)[number]["key"]) {
    setOccasionKey(key);
    const next = OCCASIONS.find((o) => o.key === key) ?? OCCASIONS[0];
    setBodyText(next.body);
  }

  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
  const labelClass = "mb-1 block text-sm font-medium text-slate-700";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #certificate-print-area, #certificate-print-area * { visibility: visible; }
          #certificate-print-area { position: fixed; inset: 0; width: 100%; height: 100%; }
        }
      `}</style>

      <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:hidden">
        <h2 className="text-sm font-semibold text-slate-900">Certificate Details</h2>

        <div>
          <label className={labelClass} htmlFor="employee">Employee *</label>
          <select
            id="employee"
            className={inputClass}
            value={employeeId}
            onChange={(e) => handleEmployeeChange(e.target.value)}
          >
            <option value="">Select employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.designation ? ` — ${e.designation}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="company">Company (letterhead) *</label>
          <select id="company" className={inputClass} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">Select company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-400">
            Employee select karte hi ek default company aa jayegi — chaho to yahan se khud badal bhi sakte ho.
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="occasion">Occasion *</label>
          <select
            id="occasion"
            className={inputClass}
            value={occasionKey}
            onChange={(e) => handleOccasionChange(e.target.value as (typeof OCCASIONS)[number]["key"])}
          >
            <option value="best_performance">Certificate of Excellence — Best Performance Award</option>
            <option value="employee_of_the_month">Certificate of Achievement — Employee of the Month</option>
            <option value="work_anniversary">Certificate of Appreciation — Work Anniversary</option>
            <option value="training_completion">Certificate of Achievement — Training Completion</option>
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="employee_name">Naam (certificate par jaisa chhape)</label>
          <input id="employee_name" className={inputClass} value={employeeName} onChange={(e) => setEmployeeName(e.target.value)} />
        </div>

        <div>
          <label className={labelClass} htmlFor="body_text">Certificate ka text</label>
          <textarea id="body_text" rows={5} className={inputClass} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass} htmlFor="hr_name">HR Manager (signature)</label>
            <input id="hr_name" className={inputClass} value={hrName} onChange={(e) => setHrName(e.target.value)} placeholder="Naam likho" />
          </div>
          <div>
            <label className={labelClass} htmlFor="director_name">Director / CEO</label>
            <input id="director_name" className={inputClass} value={directorName} onChange={(e) => setDirectorName(e.target.value)} />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="date_issued">Date</label>
          <input id="date_issued" className={inputClass} value={dateIssued} onChange={(e) => setDateIssued(e.target.value)} />
        </div>

        <button
          type="button"
          onClick={() => window.print()}
          disabled={!employeeId || !companyId}
          className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-40"
        >
          Print / Save as PDF
        </button>
        {(!employeeId || !companyId) && <p className="text-xs text-slate-400">Pehle employee aur company select karo.</p>}
      </div>

      <div>
        <div
          id="certificate-print-area"
          className="relative mx-auto aspect-[1200/850] w-full overflow-hidden rounded-lg"
          style={{ background: "#0a0a1a", fontFamily: "Georgia, 'Times New Roman', serif" }}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(circle at 50% 0%, rgba(217,164,65,0.15), transparent 60%)" }}
          />
          <div className="absolute" style={{ inset: "5%", border: "1px solid #d9a441" }} />
          <div className="absolute" style={{ inset: "6.5%", border: "1px solid rgba(217,164,65,0.5)" }} />

          <div className="relative flex h-full flex-col items-center pt-[4%] text-center">
            <div
              className="flex items-center justify-center overflow-hidden rounded-full bg-white"
              style={{ width: "10%", aspectRatio: "1/1", boxShadow: "0 0 0 3px #d9a441, 0 4px 18px rgba(0,0,0,0.5)" }}
            >
              {company?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.logo_url} alt={company.name} className="h-full w-full object-contain" />
              ) : (
                <span className="text-xs text-slate-400">Logo</span>
              )}
            </div>
            <div className="mt-[1.5%] text-[1.6vw] font-bold uppercase tracking-[0.3em]" style={{ color: "#f2d99b" }}>
              {company?.name ?? "Select company"}
            </div>
            <div className="mt-[2%] text-[3.6vw]" style={{ color: "#ffffff" }}>
              Certificate <span style={{ color: "#d9a441" }}>{occasion.certWord}</span>
            </div>
            <div className="mt-[0.5%] text-[1.3vw] font-bold uppercase tracking-[0.35em]" style={{ color: "#d9a441" }}>
              {occasion.subtitle}
            </div>
            <div className="mt-[2.5%] text-[1vw] uppercase tracking-[0.25em]" style={{ color: "#8b8fa3" }}>
              This certificate is proudly presented to
            </div>
            <div
              className="mt-[1%] border-b px-8 pb-2 text-[4vw]"
              style={{ fontFamily: "'Brush Script MT', cursive", color: "#ffffff", borderColor: "#d9a441", minWidth: "45%" }}
            >
              {employeeName || "Employee Name"}
            </div>
            <div className="mx-auto mt-[2%] max-w-[65%] px-[2%] text-[1vw] leading-relaxed" style={{ color: "#c7cad6" }}>
              {bodyText}
            </div>
          </div>

          <div className="absolute bottom-[11%] left-0 right-0 flex justify-between px-[11%] text-center">
            <div style={{ width: "18%" }}>
              <div className="border-t pt-1 text-[1vw]" style={{ borderColor: "#8b8fa3", color: "#ffffff", fontFamily: "'Brush Script MT', cursive", minHeight: "1.5em" }}>
                {hrName}
              </div>
              <div className="text-[0.8vw] uppercase tracking-widest" style={{ color: "#8b8fa3" }}>HR Manager</div>
            </div>
            <div style={{ width: "18%" }}>
              <div className="text-[1vw]" style={{ color: "#ffffff" }}>{dateIssued}</div>
              <div className="text-[0.8vw] uppercase tracking-widest" style={{ color: "#8b8fa3" }}>Date Issued</div>
            </div>
            <div style={{ width: "18%" }}>
              <div className="border-t pt-1 text-[1vw]" style={{ borderColor: "#8b8fa3", color: "#ffffff", fontFamily: "'Brush Script MT', cursive" }}>
                {directorName}
              </div>
              <div className="text-[0.8vw] uppercase tracking-widest" style={{ color: "#8b8fa3" }}>Director / CEO</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
