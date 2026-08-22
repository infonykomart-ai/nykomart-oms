"use client";

import { useCallback, useMemo, useState } from "react";
import type { ExportColumn } from "@/lib/export/export-table";

// Generic column/section picker (2026-08-22) — infrastructure for the
// Reports hub extension: "COLUMNS is a hardcoded array in
// orders-report-table.tsx with no way to show/hide columns... ANY report
// built on this pattern gets it for free". Any report table defines its
// full column list ONCE (as it already does for <ExportBar />) and calls
// this hook to get back the subset currently checked "visible" — used for
// BOTH the on-screen <table> (so hide/show actually changes the rendered
// columns, which the print/PDF area reads straight off the DOM) AND the
// columns handed to <ExportBar /> (so CSV/Excel/Word/Email/WhatsApp all
// respect the same selection, not just the screen).
//
// Deliberately in-memory only (no localStorage) — a lazy useState
// initializer that reads localStorage would run during SSR too (server
// has no window) and again on the client during hydration, and those two
// runs can disagree, producing a hydration mismatch on the very first
// render. Starting every report at "everything visible" on every page
// load avoids that class of bug entirely; a viewer's picks apply for the
// session/tab they're looking at, which is what "show/hide columns while
// I look at this report" actually needs.
export function useColumnVisibility<T>(columns: ExportColumn<T>[]) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const toggleColumn = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const showAll = useCallback(() => setHidden(new Set()), []);

  const visibleColumns = useMemo(() => columns.filter((c) => !hidden.has(c.key)), [columns, hidden]);

  return { visibleColumns, hiddenKeys: hidden, toggleColumn, showAll };
}
