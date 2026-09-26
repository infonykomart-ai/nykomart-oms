// 2026-09-26 — "UI desgine professional nahi lag raha, high professional
// bano jese fedex ups dhl me chalta hai": shared presentational primitives
// for the Attendance Admin page, so every card/table on the page (Holiday
// Calendar, Weekly Off, Daily Work Planner, Team Attendance Summary,
// Pending Work, Performance & Awards, Store Cost, Manual Correction, Team
// Daily Work Log, Task Completion Rate, Employee Performance, Task
// Reports) reads as ONE coherent dashboard system instead of a stack of
// independently-styled boxes — a dark icon-chip header on every panel, a
// consistent stat-tile shape, a single Pill/badge component instead of
// bare colored text for every status value, and sticky/uppercase table
// headers with tabular numerals, the same visual language a courier
// operations dashboard (FedEx/UPS/DHL back-office tools) uses for dense
// operational data: quiet neutrals, one accent color, status carried by a
// labeled pill (never color alone), numbers that align in a column.
//
// Server-component friendly — nothing here uses client-only APIs, so it
// can be imported directly into page.tsx (an async server component)
// as well as into any "use client" panel that already renders tables.
import type { ReactNode } from "react";

/** Section wrapper: icon chip + title + optional description + optional
 * right-aligned action, over a body — the one shape every panel on this
 * page now shares. `tone="accent"` marks an HR/MD-restricted panel
 * (Performance & Awards, Store Cost) without resorting to a different
 * border color per panel. */
export function Panel({
  icon,
  title,
  description,
  action,
  tone = "default",
  bodyClassName,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  tone?: "default" | "accent";
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-3.5">
        <div className="flex items-start gap-3">
          {icon && (
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm ${
                tone === "accent" ? "bg-amber-500 text-white" : "bg-slate-900 text-white"
              }`}
            >
              {icon}
            </span>
          )}
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-slate-500">{description}</p>}
          </div>
        </div>
        {action}
      </header>
      <div className={bodyClassName ?? "p-5"}>{children}</div>
    </section>
  );
}

/** A row of bordered stat tiles — labeled, tabular-nums value. Replaces
 * bare label/value pairs so every number on the page sits in the same
 * shaped box. */
export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-[8rem] flex-1 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap gap-3">{children}</div>;
}

const PILL_TONES = {
  green: "bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20",
  amber: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20",
  redSolid: "bg-red-600 text-white",
  sky: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20",
  purple: "bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-600/20",
  slate: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/10",
} as const;

/** A single labeled status/priority chip — the one badge component every
 * table on the page uses, instead of ad-hoc colored text or one-off
 * className maps repeated per section. Status is always carried by the
 * label text too, never by color alone. */
export function Pill({ tone = "slate", children }: { tone?: keyof typeof PILL_TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${PILL_TONES[tone]}`}>
      {children}
    </span>
  );
}

export const PRIORITY_TONE: Record<string, keyof typeof PILL_TONES> = {
  Urgent: "red",
  High: "amber",
  Medium: "sky",
  Low: "slate",
};

export const TASK_STATUS_TONE: Record<string, keyof typeof PILL_TONES> = {
  Pending: "amber",
  "In Progress": "sky",
  Done: "green",
};

/** Shared table chrome — sticky, uppercase, tracked header; hover rows;
 * tabular numerals. A plain object of className strings (not a component)
 * so existing <table>/<tr>/<td> markup only needs its classNames swapped,
 * not restructured. */
export const tableWrapClass = "overflow-x-auto rounded-lg border border-slate-100";
export const tableClass = "w-full min-w-max border-collapse text-left text-xs";
export const theadRowClass = "sticky top-0 z-10 bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-500";
export const thClass = "whitespace-nowrap px-3 py-2.5";
export const tbodyRowClass = "border-t border-slate-100 text-slate-700 transition-colors hover:bg-amber-50/40";
export const tdClass = "px-3 py-2.5 align-top";
export const numTdClass = "px-3 py-2.5 align-top tabular-nums";
export const emptyRowClass = "px-3 py-6 text-center text-slate-400";
