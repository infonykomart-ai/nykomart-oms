"use client";

// 2026-11-03 — per-template legal review + activation controls.
import { useState } from "react";
import { inputClass, labelClass } from "../agreement-fields";
import { setAgreementTemplateStatus } from "../actions";

type Row = {
  slug: string;
  title: string;
  icon: string;
  codeVersion: number;
  status: string;
  reviewedVersion: number | null;
  reviewedBy: string;
  reviewedOn: string;
  activatedAt: string | null;
  notes: string;
  clauseCount: number;
};

const statusOptions: { value: "draft" | "legal_review" | "active" | "retired"; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "legal_review", label: "Under legal review" },
  { value: "active", label: "Active — may be issued" },
  { value: "retired", label: "Retired" },
];

export function TemplateRegistryTable({ rows }: { rows: Row[] }) {
  const [state, setState] = useState<Record<string, Row>>(() => Object.fromEntries(rows.map((row) => [row.slug, row])));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function update(slug: string, patch: Partial<Row>) {
    setState((prev) => ({ ...prev, [slug]: { ...prev[slug], ...patch } }));
  }

  async function save(row: Row, status: "draft" | "legal_review" | "active" | "retired") {
    setBusy(row.slug);
    setError(null);
    setNotice(null);
    const result = await setAgreementTemplateStatus({
      slug: row.slug,
      status,
      reviewedBy: row.reviewedBy,
      reviewedOn: row.reviewedOn,
      notes: row.notes,
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    update(row.slug, { status, reviewedVersion: status === "active" ? row.codeVersion : row.reviewedVersion });
    setNotice(`${row.title} → ${status.replace("_", " ")}.`);
  }

  return (
    <div className="space-y-4">
      {error ? <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}
      {notice ? <p className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p> : null}

      {rows.map((baseRow) => {
        const row = state[baseRow.slug] ?? baseRow;
        const mismatch = row.reviewedVersion !== null && row.reviewedVersion !== row.codeVersion;
        return (
          <div key={row.slug} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {row.icon} {row.title}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Code version v{row.codeVersion} · {row.clauseCount} clauses
                  {row.reviewedVersion !== null ? ` · reviewed version v${row.reviewedVersion}` : " · not reviewed yet"}
                  {row.activatedAt ? ` · activated ${row.activatedAt.slice(0, 10)}` : ""}
                </p>
                {mismatch ? (
                  <p className="mt-1 text-xs font-medium text-rose-700">
                    Wording changed since review — re-review v{row.codeVersion} before issuing from this template.
                  </p>
                ) : null}
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  row.status === "active"
                    ? "bg-emerald-100 text-emerald-700"
                    : row.status === "retired"
                      ? "bg-slate-200 text-slate-600"
                      : row.status === "legal_review"
                        ? "bg-sky-100 text-sky-700"
                        : "bg-amber-100 text-amber-800"
                }`}
              >
                {row.status.replace("_", " ")}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className={labelClass} htmlFor={`${row.slug}-reviewed-by`}>
                  Legally reviewed by
                </label>
                <input
                  id={`${row.slug}-reviewed-by`}
                  className={inputClass}
                  value={row.reviewedBy}
                  placeholder="Name / firm"
                  onChange={(e) => update(row.slug, { reviewedBy: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor={`${row.slug}-reviewed-on`}>
                  Review date
                </label>
                <input
                  id={`${row.slug}-reviewed-on`}
                  type="date"
                  className={inputClass}
                  value={row.reviewedOn ?? ""}
                  onChange={(e) => update(row.slug, { reviewedOn: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor={`${row.slug}-notes`}>
                  Notes
                </label>
                <input
                  id={`${row.slug}-notes`}
                  className={inputClass}
                  value={row.notes}
                  placeholder="e.g. reviewed by counsel, clause 9 amended"
                  onChange={(e) => update(row.slug, { notes: e.target.value })}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {statusOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={busy === row.slug || row.status === option.value}
                  onClick={() => save(row, option.value)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                    option.value === "active"
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {busy === row.slug ? "Saving…" : option.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
