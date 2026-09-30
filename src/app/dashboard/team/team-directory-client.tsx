"use client";

// 2026-09-29 — client shell for the Team Directory: FedEx-style identity
// header (roster card with photo strip + count, same tokens as My
// Profile / the new Employees header) over a searchable card grid.
// View-only by design — no edit affordances exist here at all; admins
// edit from the Employees page.
import { useMemo, useState } from "react";
// 2026-09-30 — wa.me links now resolve through the SAME normalizer the
// punch-notification sender uses. Previously the link stripped non-digits
// and shipped the raw result, so a 0-prefixed number produced a broken
// wa.me URL (wa.me/09876543210) even though the directory "looked" fine —
// exactly the shape-mismatch that made notifications partially deliver.
import { normalizeWhatsappNumber } from "@/lib/whatsapp/normalize";

export type DirectoryPerson = {
  id: string;
  name: string;
  photoUrl: string | null;
  designation: string | null;
  employeeCode: string | null;
  email: string | null;
  whatsapp: string | null;
  joined: string | null;
  role: string;
  company: string;
};

function initials(name: string): string {
  return (
    name
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? value + "T00:00:00" : value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function TeamDirectoryClient({ people }: { people: DirectoryPerson[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) =>
      [p.name, p.designation, p.role, p.company, p.email, p.employeeCode]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q))
    );
  }, [people, query]);

  const photoCount = people.filter((p) => p.photoUrl).length;

  return (
    <div className="mx-auto max-w-6xl">
      {/* ── Identity header (roster-level) ──────────────────────────── */}
      <div className="oms-card overflow-hidden rounded-2xl border shadow-sm">
        <div className="h-16 bg-[var(--oms-sidebar-bg)] md:h-20" />
        <div className="px-5 pb-5 md:px-6 md:pb-6">
          <div className="-mt-8 flex flex-wrap items-end justify-between gap-4 md:-mt-10">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-[var(--oms-text)] md:text-2xl">Team Directory</h1>
              <p className="mt-0.5 text-sm text-[var(--oms-text-muted)]">
                {people.length} active team member{people.length === 1 ? "" : "s"} · view-only contact book
              </p>
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, role, designation…"
              className="w-full max-w-xs rounded-lg border border-[var(--oms-surface-border)] bg-[var(--oms-canvas)] px-3 py-2 text-sm text-[var(--oms-text)] outline-none placeholder:text-[var(--oms-text-muted)] focus:border-[var(--oms-accent)] focus:ring-1 focus:ring-[var(--oms-accent)]"
            />
          </div>
          {/* Mini photo strip — quick visual roll-call, first 8 with photos. */}
          {photoCount > 0 && (
            <div className="mt-3 flex items-center gap-1.5">
              {people
                .filter((p) => p.photoUrl)
                .slice(0, 8)
                .map((p) =>
                  p.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- remote Storage URL, not a static asset
                    <img
                      key={p.id}
                      src={p.photoUrl}
                      alt={p.name}
                      title={p.name}
                      className="h-8 w-8 rounded-full border-2 border-[var(--oms-surface)] object-cover shadow-sm"
                    />
                  ) : null
                )}
              {photoCount > 8 && (
                <span className="ml-1 rounded-full bg-[var(--oms-canvas)] px-2 py-0.5 text-[10px] font-semibold text-[var(--oms-text-muted)]">
                  +{photoCount - 8} more
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Card grid ────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <p className="mt-8 rounded-xl border border-[var(--oms-surface-border)] bg-[var(--oms-surface)] px-4 py-8 text-center text-sm text-[var(--oms-text-muted)]">
          {people.length === 0 ? "No active team members yet." : `No matches for “${query}”.`}
        </p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <div key={p.id} className="oms-card flex items-start gap-3 rounded-2xl border p-4 shadow-sm transition hover:shadow-md">
              {p.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- remote Storage URL, not a static asset
                <img
                  src={p.photoUrl}
                  alt={p.name}
                  className="h-12 w-12 shrink-0 rounded-xl border border-[var(--oms-surface-border)] object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--oms-accent)]/20 text-sm font-bold text-[var(--oms-text)]">
                  {initials(p.name)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="truncate text-sm font-semibold text-[var(--oms-text)]">{p.name}</h2>
                  {p.employeeCode && (
                    <span className="shrink-0 rounded-full bg-[var(--oms-canvas)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--oms-text-muted)]">
                      {p.employeeCode}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--oms-text-muted)]">
                  {[p.designation, p.role].filter(Boolean).join(" · ") || "—"}
                </p>
                <dl className="mt-2 space-y-1 text-xs">
                  {p.email && (
                    <div className="flex items-center gap-1.5">
                      <dt className="sr-only">Email</dt>
                      <span aria-hidden>✉️</span>
                      <dd className="truncate text-[var(--oms-text)]">
                        <a href={`mailto:${p.email}`} className="hover:underline">
                          {p.email}
                        </a>
                      </dd>
                    </div>
                  )}
                  {(() => {
                    const waTarget = p.whatsapp ? normalizeWhatsappNumber(p.whatsapp) : null;
                    return waTarget ? (
                      <div className="flex items-center gap-1.5">
                        <dt className="sr-only">WhatsApp</dt>
                        <span aria-hidden>📞</span>
                        <dd className="text-[var(--oms-text)]">
                          <a
                            href={`https://wa.me/${waTarget}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {p.whatsapp}
                          </a>
                        </dd>
                      </div>
                    ) : null;
                  })()}
                  <div className="flex items-center gap-1.5">
                    <dt className="sr-only">Company</dt>
                    <span aria-hidden>🏢</span>
                    <dd className="truncate text-[var(--oms-text-muted)]">{p.company}</dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <dt className="sr-only">Date of joining</dt>
                    <span aria-hidden>📅</span>
                    <dd className="text-[var(--oms-text-muted)]">Joined {fmtDate(p.joined)}</dd>
                  </div>
                </dl>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
