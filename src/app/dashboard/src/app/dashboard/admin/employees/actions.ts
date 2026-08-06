"use client";

import { useActionState, useRef, useEffect } from "react";
import { createEmployee, type EmployeeFormState } from "./actions";

const initialState: EmployeeFormState = { error: null, success: null };

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

function generatePassword(): string {
  // Simple, readable-enough default so the admin doesn't have to think one
  // up on the spot — always shown in the field so it can be copied to the
  // new employee before submitting; edit-in-place if they'd rather set
  // their own. Kept as an uncontrolled field (ref-driven, not React state)
  // so regenerating/resetting it is a plain DOM write, never a setState
  // call inside an effect.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function EmployeeForm({
  roles,
  companies,
}: {
  roles: { id: string; name: string }[];
  companies: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(createEmployee, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      if (passwordRef.current) passwordRef.current.value = generatePassword();
    }
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Naya Employee / Login Banao</h2>

      {state.success && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          Login ban gaya — <strong>{state.success.email}</strong>. Email/password employee ko de do.
        </p>
      )}
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="name">Naam *</label>
          <input id="name" name="name" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="email">Email (login ke liye) *</label>
          <input id="email" name="email" type="email" required className={inputClass} placeholder="name@company.com" />
        </div>
        <div>
          <label className={labelClass} htmlFor="password">Password *</label>
          <div className="flex gap-2">
            <input
              id="password"
              name="password"
              required
              minLength={8}
              ref={passwordRef}
              defaultValue={generatePassword()}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => {
                if (passwordRef.current) passwordRef.current.value = generatePassword();
              }}
              className="shrink-0 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Naya
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">Kam se kam 8 characters. Save karne se pehle copy kar lo.</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="role_id">Role *</label>
          <select id="role_id" name="role_id" required className={inputClass} defaultValue="">
            <option value="" disabled>Select role</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="home_company_id">Home Company *</label>
          <select id="home_company_id" name="home_company_id" required className={inputClass} defaultValue="">
            <option value="" disabled>Select company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="designation">Designation</label>
          <input id="designation" name="designation" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="employee_code">Employee Code (biometric)</label>
          <input id="employee_code" name="employee_code" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="date_of_joining">Date of Joining</label>
          <input id="date_of_joining" name="date_of_joining" type="date" className={inputClass} />
        </div>
      </div>

      <div>
        <span className={labelClass}>Extra Company Access (home company ke alawa bhi kaam karega)</span>
        <div className="flex flex-wrap gap-3">
          {companies.map((c) => (
            <label key={c.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700">
              <input type="checkbox" name="company_access" value={c.id} className="rounded border-slate-300" />
              {c.name}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Home company ko yahan dobara tick karna zaroori nahi — wo hamesha included hoti hai.
        </p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
      >
        {pending ? "Ban raha hai..." : "Login Banao"}
      </button>
    </form>
  );
}
