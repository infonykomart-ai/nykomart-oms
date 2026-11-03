"use client";

// 2026-11-03 — shared input renderer for the agreement form fields. Used by
// the create screen and the document workspace's edit panel, so a field type
// only has to be understood in one place.
import type { AgreementField } from "@/lib/agreements/templates";

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
export const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: AgreementField;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={field.type === "textarea" ? "sm:col-span-2" : ""}>
      <label className={labelClass} htmlFor={field.key}>
        {field.label}
      </label>
      {field.type === "textarea" ? (
        <textarea
          id={field.key}
          rows={field.key === "custom_clauses" ? 8 : 3}
          className={inputClass}
          value={value}
          placeholder={field.placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === "select" ? (
        <select
          id={field.key}
          className={inputClass}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={field.key}
          type={field.type === "date" ? "date" : "text"}
          className={inputClass}
          value={value}
          placeholder={field.placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.help ? <p className="mt-1 text-xs text-slate-400">{field.help}</p> : null}
    </div>
  );
}
