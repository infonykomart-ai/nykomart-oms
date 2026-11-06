"use client";

// 2026-11-06 — interactive half of the biometric dashboard: setup, mapping,
// correction, retry and exports. All writes go through capability-checked
// server actions; this file only collects input and shows the result.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExportBar } from "@/components/export-bar";
import {
  createBiometricDevice,
  resolveBiometricAttendance,
  retryBiometricEvent,
  rotateBiometricToken,
  saveBiometricMapping,
  saveBiometricShift,
  setBiometricDeviceActive,
  setBiometricMappingActive,
} from "./actions";

export type AttendanceRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  department: string | null;
  designation: string | null;
  punchIn: string | null;
  punchOut: string | null;
  workHours: number | null;
  status: string;
  source: string;
  verification: string;
  lateMinutes: number | null;
  earlyDepartureMinutes: number | null;
  overtimeMinutes: number | null;
  missingPunch: "IN" | "OUT" | null;
  omsIn: string | null;
  omsOut: string | null;
  biometricIn: string | null;
  biometricOut: string | null;
  remark: string | null;
  verified: boolean;
};

export type MappingRow = {
  id: string;
  deviceId: string;
  deviceName: string;
  employeeId: string;
  employeeName: string;
  employeeEmail?: string | null;
  employeeCode: string | null;
  department: string | null;
  designation: string | null;
  deviceEmployeeId: string;
  shiftId: string | null;
  shiftName: string | null;
  active: boolean;
};

export type EventRow = {
  id: string;
  deviceName: string;
  deviceEmployeeId: string;
  employeeName: string | null;
  punchAt: string;
  direction: string;
  status: string;
  error: string | null;
  createdAt: string;
};

type DeviceRow = {
  id: string;
  name: string;
  vendor: string | null;
  model: string | null;
  mode: "PUSH" | "PULL";
  device_key: string;
  api_key_last4: string;
  active: boolean;
  last_event_at: string | null;
  last_sync_at: string | null;
};

type ShiftRow = {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  grace_minutes: number;
  half_day_minutes: number;
  overtime_after_minutes: number;
  active: boolean;
};

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-600";

function time(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true });
}

function stamp(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function BiometricDashboard({
  companyId,
  companies,
  date,
  employees,
  devices,
  shifts,
  mappings,
  attendance,
  events,
}: {
  companyId: string;
  companies: { id: string; name: string }[];
  date: string;
  employees: { id: string; name: string; email?: string | null; employeeCode: string | null }[];
  devices: DeviceRow[];
  shifts: ShiftRow[];
  mappings: MappingRow[];
  attendance: AttendanceRow[];
  events: EventRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"today" | "setup" | "logs">("today");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [editing, setEditing] = useState<AttendanceRow | null>(null);
  const [newDevice, setNewDevice] = useState<{ deviceKey: string; token: string } | null>(null);
  const [rotated, setRotated] = useState<string | null>(null);

  const exportRows = attendance.map((r) => ({
    ...r,
    punchIn: time(r.punchIn),
    punchOut: time(r.punchOut),
    workHours: r.workHours != null ? r.workHours.toFixed(2) : "—",
  }));
  const exportColumns = [
    { key: "employeeName", label: "Employee", value: (r: (typeof exportRows)[number]) => r.employeeName },
    { key: "employeeCode", label: "Code", value: (r: (typeof exportRows)[number]) => r.employeeCode },
    { key: "department", label: "Department", value: (r: (typeof exportRows)[number]) => r.department },
    { key: "punchIn", label: "IN", value: (r: (typeof exportRows)[number]) => r.punchIn },
    { key: "punchOut", label: "OUT", value: (r: (typeof exportRows)[number]) => r.punchOut },
    { key: "workHours", label: "Working Hours", value: (r: (typeof exportRows)[number]) => r.workHours },
    { key: "source", label: "Source", value: (r: (typeof exportRows)[number]) => r.source },
    { key: "verification", label: "Verification", value: (r: (typeof exportRows)[number]) => r.verification },
    { key: "status", label: "Status", value: (r: (typeof exportRows)[number]) => r.status },
    { key: "lateMinutes", label: "Late (min)", value: (r: (typeof exportRows)[number]) => r.lateMinutes },
    { key: "earlyDepartureMinutes", label: "Early (min)", value: (r: (typeof exportRows)[number]) => r.earlyDepartureMinutes },
    { key: "overtimeMinutes", label: "Overtime (min)", value: (r: (typeof exportRows)[number]) => r.overtimeMinutes },
  ];

  const stats = useMemo(() => {
    const present = attendance.filter((r) => r.punchIn || r.punchOut).length;
    const late = attendance.filter((r) => (r.lateMinutes ?? 0) > 0 || r.status === "Late").length;
    const missingIn = attendance.filter((r) => r.verification === "Missing IN" || r.missingPunch === "IN").length;
    const missingOut = attendance.filter((r) => r.verification === "Missing OUT" || r.missingPunch === "OUT").length;
    const omsOnly = attendance.filter((r) => r.source === "Web Punch" || r.source === "Manual Entry").length;
    const omsPending = attendance.filter((r) => r.source === "Web Punch").length;
    const verified = attendance.filter((r) => r.verified).length;
    return { total: attendance.length, present, absent: attendance.length - present, late, missingIn, missingOut, omsOnly, omsPending, verified };
  }, [attendance]);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setNotice(success);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {notice ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p> : null}
      {stats.missingIn + stats.missingOut + stats.omsPending > 0 ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Punch reconciliation alert:</strong> {stats.missingIn} missing IN, {stats.missingOut} missing OUT,{" "}
          {stats.omsPending} OMS-only day(s) awaiting biometric verification on {date}. Review the rows below and correct
          only after verification with the employee/supervisor.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-5 rounded-xl border border-slate-200 bg-white p-4 lg:grid-cols-4">
        {[
          ["Total employees", stats.total, "text-slate-900"],
          ["Present today", stats.present, "text-emerald-700"],
          ["Absent", stats.absent, "text-rose-700"],
          ["Late arrivals", stats.late, "text-amber-700"],
          ["Missing IN", stats.missingIn, "text-red-700"],
          ["Missing OUT", stats.missingOut, "text-orange-700"],
          ["OMS only / unverified", stats.omsOnly, "text-slate-500"],
          ["Biometric verified", stats.verified, "text-teal-700"],
        ].map(([label, value, color]) => (
          <div key={String(label)}>
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
            <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {(
            [
              ["today", "Today"],
              ["setup", "Devices, Mapping & Shifts"],
              ["logs", "Sync Log"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${tab === key ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <form method="get" className="flex items-end gap-2">
            <div>
              <label className={labelClass} htmlFor="bio-date">Date</label>
              <input id="bio-date" type="date" name="date" defaultValue={date} className={inputClass} />
            </div>
            <select name="company" defaultValue={companyId} className={inputClass} aria-label="Company">
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="submit" className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white">Show</button>
          </form>
          {tab === "today" ? <ExportBar title="Biometric attendance" filenameBase={`biometric-attendance-${date}`} columns={exportColumns} rows={exportRows} printAreaId="biometric-print-area" /> : null}
        </div>
      </div>

      {tab === "today" ? (
        <div id="biometric-print-area" className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[1100px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">IN</th>
                <th className="px-3 py-2">OUT</th>
                <th className="px-3 py-2">Working Hours</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Verification</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {attendance.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{row.employeeName}</div>
                    <div className="text-[10px] text-slate-400">{[row.employeeCode, row.department, row.designation].filter(Boolean).join(" · ") || "—"}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{time(row.punchIn)}</td>
                  <td className="px-3 py-2 text-slate-700">{time(row.punchOut)}</td>
                  <td className="px-3 py-2 text-slate-700">{row.workHours != null ? `${row.workHours.toFixed(2)} h` : "—"}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {row.source}
                    {row.biometricIn || row.biometricOut ? (
                      <span className="mt-0.5 block text-[10px] text-teal-600">Device: {time(row.biometricIn)} – {time(row.biometricOut)}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      row.verified ? "bg-emerald-100 text-emerald-700" : row.verification === "Missing IN" || row.verification === "Missing OUT" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"
                    }`}>
                      {row.verification}
                    </span>
                    {row.omsIn || row.omsOut ? (
                      <span className="mt-0.5 block text-[10px] text-slate-400">OMS: {time(row.omsIn)} – {time(row.omsOut)}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{row.status}</td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => setEditing(row)} className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50">
                      Correct
                    </button>
                  </td>
                </tr>
              ))}
              {attendance.length === 0 ? <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">No active employees in this company.</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "setup" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <DeviceSetup
            companyId={companyId}
            devices={devices}
            busy={busy}
            newDevice={newDevice}
            rotated={rotated}
            onCreated={setNewDevice}
            onRotated={setRotated}
            run={run}
          />
          <ShiftSetup companyId={companyId} shifts={shifts} busy={busy} run={run} />
          <div className="xl:col-span-2">
            <MappingSetup devices={devices} shifts={shifts} mappings={mappings} employees={employees} busy={busy} run={run} />
          </div>
        </div>
      ) : null}

      {tab === "logs" ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-2">Received</th><th className="px-3 py-2">Punch time</th><th className="px-3 py-2">Device</th><th className="px-3 py-2">Device employee</th><th className="px-3 py-2">OMS employee</th><th className="px-3 py-2">Direction</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Error</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 text-slate-500">{stamp(e.createdAt)}</td>
                  <td className="px-3 py-2 text-slate-700">{stamp(e.punchAt)}</td>
                  <td className="px-3 py-2 text-slate-600">{e.deviceName}</td>
                  <td className="px-3 py-2 font-mono text-slate-600">{e.deviceEmployeeId}</td>
                  <td className="px-3 py-2 text-slate-600">{e.employeeName ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{e.direction}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${e.status === "Processed" ? "bg-emerald-100 text-emerald-700" : e.status === "Duplicate" ? "bg-slate-100 text-slate-500" : "bg-rose-100 text-rose-700"}`}>{e.status}</span></td>
                  <td className="max-w-72 px-3 py-2 text-rose-600">{e.error ?? "—"}</td>
                  <td className="px-3 py-2">
                    {e.status === "Failed" || e.status === "Unmapped" ? (
                      <button type="button" disabled={busy} onClick={() => run(() => retryBiometricEvent(e.id), "Event reprocessed.")} className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 disabled:opacity-40">Retry</button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {events.length === 0 ? <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">No device punches received yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {editing ? (
        <CorrectionDialog
          row={editing}
          date={date}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(inTime, outTime, reason) => {
            run(async () => {
              const result = await resolveBiometricAttendance({
                employeeId: editing.employeeId,
                attendanceDate: date,
                inTime,
                outTime,
                reason,
              });
              if (result.ok) setEditing(null);
              return result;
            }, "Attendance corrected and audited.");
          }}
        />
      ) : null}
    </div>
  );
}

function DeviceSetup({
  companyId,
  devices,
  busy,
  newDevice,
  rotated,
  onCreated,
  onRotated,
  run,
}: {
  companyId: string;
  devices: DeviceRow[];
  busy: boolean;
  newDevice: { deviceKey: string; token: string } | null;
  rotated: string | null;
  onCreated: (d: { deviceKey: string; token: string }) => void;
  onRotated: (t: string | null) => void;
  run: (action: () => Promise<{ ok: boolean; error?: string }>, success: string) => void;
}) {
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<"PUSH" | "PULL">("PUSH");

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Devices</h2>
      <p className="text-xs text-slate-500">
        Use the HTTP webhook when the device or its middleware supports push. Only a hash of the token is stored; copy it now.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div><label className={labelClass}>Device name *</label><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Main gate biometric" /></div>
        <div><label className={labelClass}>Vendor</label><input className={inputClass} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="eSSL / Matrix / ..." /></div>
        <div><label className={labelClass}>Model</label><input className={inputClass} value={model} onChange={(e) => setModel(e.target.value)} /></div>
        <div>
          <label className={labelClass}>Mode</label>
          <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as "PUSH" | "PULL")}>
            <option value="PUSH">HTTP push / webhook</option>
            <option value="PULL" disabled>Pull (needs a device-specific adapter — not active)</option>
          </select>
        </div>
      </div>
      <button
        type="button"
        disabled={busy || !name.trim()}
        onClick={() =>
          run(async () => {
            const result = await createBiometricDevice({ companyId, name, vendor, model, mode });
            if (result.ok && result.data) onCreated(result.data);
            return result;
          }, "Device created. Copy its one-time token now.")
        }
        className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Saving…" : "Add device"}
      </button>

      {newDevice ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">Copy this token now — it is shown only once.</p>
          <p className="mt-1 font-mono break-all">Device key: {newDevice.deviceKey}</p>
          <p className="font-mono break-all">Token: {newDevice.token}</p>
          <p className="mt-1">
            Endpoint: POST https://&lt;your-oms-domain&gt;/api/biometric/punch with{" "}
            <code>Authorization: Bearer &lt;token&gt;</code>.
          </p>
          <p className="mt-1">Body: <code>{`{ deviceKey, deviceEmployeeId, punchAt: "ISO time with +05:30", eventId, direction: "AUTO" }`}</code></p>
        </div>
      ) : null}
      {rotated ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">New token (shown once)</p>
          <p className="font-mono break-all">{rotated}</p>
        </div>
      ) : null}

      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {devices.map((d) => (
          <div key={d.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-xs">
            <div>
              <p className="font-medium text-slate-800">{d.name} <span className="text-slate-400">({d.mode})</span></p>
              <p className="text-slate-400">{d.vendor ?? "—"} {d.model ? `· ${d.model}` : ""} · key {d.device_key} · token ••••{d.api_key_last4}</p>
              <p className="text-slate-400">Last punch: {stamp(d.last_event_at)} · Last sync: {stamp(d.last_sync_at)}</p>
            </div>
            <div className="flex gap-1">
              <button type="button" disabled={busy} onClick={() => run(() => setBiometricDeviceActive(d.id, !d.active), d.active ? "Device disabled." : "Device enabled.")} className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600">
                {d.active ? "Disable" : "Enable"}
              </button>
              <button type="button" disabled={busy} onClick={() => run(async () => { const r = await rotateBiometricToken(d.id); if (r.ok) onRotated(r.data?.token ?? null); return r; }, "Token rotated. Update the device now.")} className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
                Rotate token
              </button>
            </div>
          </div>
        ))}
        {devices.length === 0 ? <p className="px-3 py-4 text-xs text-slate-400">No device configured.</p> : null}
      </div>
    </div>
  );
}

function ShiftSetup({ companyId, shifts, busy, run }: { companyId: string; shifts: ShiftRow[]; busy: boolean; run: (a: () => Promise<{ ok: boolean; error?: string }>, s: string) => void }) {
  const [name, setName] = useState("General");
  const [startTime, setStartTime] = useState("09:30");
  const [endTime, setEndTime] = useState("18:30");
  const [grace, setGrace] = useState("15");
  const [halfDay, setHalfDay] = useState("240");
  const [overtime, setOvertime] = useState("0");
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Shifts</h2>
      <div className="grid grid-cols-2 gap-2">
        <div><label className={labelClass}>Name</label><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className={labelClass}>Grace (min)</label><input className={inputClass} type="number" value={grace} onChange={(e) => setGrace(e.target.value)} /></div>
        <div><label className={labelClass}>Start</label><input className={inputClass} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
        <div><label className={labelClass}>End</label><input className={inputClass} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
        <div><label className={labelClass}>Half day below (min)</label><input className={inputClass} type="number" value={halfDay} onChange={(e) => setHalfDay(e.target.value)} /></div>
        <div><label className={labelClass}>Overtime after (min)</label><input className={inputClass} type="number" value={overtime} onChange={(e) => setOvertime(e.target.value)} /></div>
      </div>
      <button type="button" disabled={busy} onClick={() => run(() => saveBiometricShift({ companyId, name, startTime, endTime, graceMinutes: Number(grace), halfDayMinutes: Number(halfDay), overtimeAfterMinutes: Number(overtime) }), "Shift saved.")} className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Save shift</button>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs">
        {shifts.map((s) => <div key={s.id} className="flex justify-between gap-2 px-3 py-2"><span className="font-medium text-slate-700">{s.name}</span><span className="text-slate-500">{s.start_time}–{s.end_time} · grace {s.grace_minutes}m · half day &lt;{s.half_day_minutes}m</span></div>)}
        {shifts.length === 0 ? <p className="px-3 py-4 text-xs text-slate-400">No shift yet — the processor uses 09:30–18:30, 15-minute grace.</p> : null}
      </div>
    </div>
  );
}

function MappingSetup({
  devices,
  shifts,
  mappings,
  employees,
  busy,
  run,
}: {
  devices: DeviceRow[];
  shifts: ShiftRow[];
  mappings: MappingRow[];
  employees: { id: string; name: string; email?: string | null; employeeCode: string | null }[];
  busy: boolean;
  run: (a: () => Promise<{ ok: boolean; error?: string }>, s: string) => void;
}) {
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "");
  const [employeeId, setEmployeeId] = useState("");
  const [deviceEmployeeId, setDeviceEmployeeId] = useState("");
  const [shiftId, setShiftId] = useState(shifts[0]?.id ?? "");

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Employee mapping</h2>
      <p className="text-xs text-slate-500">One OMS employee ↔ one biometric ID per device. Duplicate mappings are rejected by the database.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <div><label className={labelClass}>Device</label><select className={inputClass} value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>{devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
        <div><label className={labelClass}>OMS employee</label><select className={inputClass} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}><option value="">Select</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.email ? ` — ${e.email}` : e.employeeCode ? ` (${e.employeeCode})` : ""}</option>)}</select></div>
        <div><label className={labelClass}>Biometric employee ID</label><input className={inputClass} value={deviceEmployeeId} onChange={(e) => setDeviceEmployeeId(e.target.value)} placeholder="EMP001" /></div>
        <div><label className={labelClass}>Shift</label><select className={inputClass} value={shiftId} onChange={(e) => setShiftId(e.target.value)}><option value="">Default</option>{shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      </div>
      <button type="button" disabled={busy || !deviceId || !employeeId || !deviceEmployeeId.trim()} onClick={() => run(() => saveBiometricMapping({ deviceId, employeeId, deviceEmployeeId, shiftId: shiftId || null }), "Mapping saved.")} className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Save mapping</button>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Department / designation</th><th className="px-3 py-2">Device</th><th className="px-3 py-2">Biometric ID</th><th className="px-3 py-2">Shift</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {mappings.map((m) => (
              <tr key={m.id}>
                <td className="px-3 py-2 font-medium text-slate-700">{m.employeeName}{m.employeeEmail ? <span className="block text-[10px] text-slate-400">{m.employeeEmail}</span> : m.employeeCode ? <span className="block text-[10px] text-slate-400">{m.employeeCode}</span> : null}</td>
                <td className="px-3 py-2 text-slate-500">{[m.department, m.designation].filter(Boolean).join(" · ") || "—"}</td>
                <td className="px-3 py-2 text-slate-600">{m.deviceName}</td>
                <td className="px-3 py-2 font-mono text-slate-600">{m.deviceEmployeeId}</td>
                <td className="px-3 py-2 text-slate-500">{m.shiftName ?? "Default"}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{m.active ? "Active" : "Inactive"}</span></td>
                <td className="px-3 py-2"><button type="button" disabled={busy} onClick={() => run(() => setBiometricMappingActive(m.id, !m.active), m.active ? "Mapping disabled." : "Mapping enabled.")} className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600">{m.active ? "Disable" : "Enable"}</button></td>
              </tr>
            ))}
            {mappings.length === 0 ? <tr><td colSpan={7} className="px-3 py-4 text-center text-xs text-slate-400">No mappings yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CorrectionDialog({
  row,
  date,
  busy,
  onClose,
  onSave,
}: {
  row: AttendanceRow;
  date: string;
  busy: boolean;
  onClose: () => void;
  onSave: (inTime: string, outTime: string, reason: string) => void;
}) {
  const [inTime, setInTime] = useState(row.punchIn ? new Date(row.punchIn).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }) : "");
  const [outTime, setOutTime] = useState(row.punchOut ? new Date(row.punchOut).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }) : "");
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className="my-10 w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Correct attendance — {row.employeeName}</h3>
            <p className="text-xs text-slate-500">{date}. The device and OMS timestamps stay visible on the row; this records an audited Manual Override.</p>
          </div>
          <button type="button" onClick={onClose} className="text-xs text-slate-400 underline">Close</button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div><label className={labelClass}>IN (IST)</label><input className={inputClass} type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} /></div>
          <div><label className={labelClass}>OUT (IST)</label><input className={inputClass} type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} /></div>
        </div>
        <div className="mt-2"><label className={labelClass}>Correction reason *</label><textarea rows={2} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Forgot to punch out, device fault, verified with supervisor..." /></div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600">Cancel</button>
          <button type="button" disabled={busy || !reason.trim() || (!inTime && !outTime)} onClick={() => onSave(inTime, outTime, reason)} className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Save correction</button>
        </div>
      </div>
    </div>
  );
}
