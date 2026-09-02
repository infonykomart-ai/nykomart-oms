"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { globalSearch, type SearchHit } from "@/app/dashboard/search/actions";

// 2026-09-02: Global Search button — "pure OMS ke liye ek global search
// button do jisme kuch bhi search kare to us se related jo bhi data ho
// dikh jaye". Open to every signed-in employee (no capability gate on the
// button itself, same as Messages/Theme/My Profile) — per-hit
// authorization is handled by the server action (see actions.ts), never
// here: this component only ever renders whatever the server already
// decided was safe to show, it never re-derives access on the client.
const DEBOUNCE_MS = 300;

export function GlobalSearchButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Focus after the modal has actually mounted.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      // Clearing stale results when the query drops back below the
      // minimum length — same deliberate synchronous-clear pattern as
      // MessagesHeaderLink's unread-badge reset, not a cascading loop.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const hits = await globalSearch(query);
        setResults(hits);
      });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
      // "/" opens search from anywhere, same convenience as most apps —
      // only when not already typing into another field.
      if (e.key === "/" && !isOpen) {
        const active = document.activeElement;
        const isTyping = active instanceof HTMLElement && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
        if (!isTyping) {
          e.preventDefault();
          setIsOpen(true);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  function close() {
    setIsOpen(false);
    setQuery("");
    setResults([]);
  }

  const grouped = new Map<string, SearchHit[]>();
  for (const hit of results) {
    if (!grouped.has(hit.typeLabel)) grouped.set(hit.typeLabel, []);
    grouped.get(hit.typeLabel)!.push(hit);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="oms-icon-btn flex h-9 w-9 items-center justify-center rounded-lg text-lg"
        title="Search everything (/)"
      >
        🔍
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[10vh]" onClick={close}>
          <div className="w-full max-w-xl rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
              <span className="text-lg">🔍</span>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search orders, bills, parties, invoices..."
                className="flex-1 border-none text-sm outline-none placeholder:text-slate-400"
              />
              <button type="button" onClick={close} className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100">
                Esc
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-2">
              {query.trim().length < 2 && (
                <p className="px-3 py-6 text-center text-xs text-slate-400">Type at least 2 characters — searches Orders, Purchase/Courier/Duty Bills, Parties, and Sales Invoices.</p>
              )}
              {query.trim().length >= 2 && isPending && <p className="px-3 py-6 text-center text-xs text-slate-400">Searching…</p>}
              {query.trim().length >= 2 && !isPending && results.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-slate-400">No matches for &quot;{query}&quot;.</p>
              )}
              {Array.from(grouped.entries()).map(([typeLabel, hits]) => (
                <div key={typeLabel} className="mb-2">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{typeLabel}</div>
                  {hits.map((hit) =>
                    hit.authorized && hit.href ? (
                      <Link
                        key={`${hit.type}-${hit.id}`}
                        href={hit.href}
                        onClick={close}
                        className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-800">{hit.title}</span>
                          {hit.subtitle && <span className="block truncate text-xs text-slate-500">{hit.subtitle}</span>}
                        </span>
                        {hit.amount && <span className="flex-none text-xs font-medium text-slate-600">{hit.amount}</span>}
                      </Link>
                    ) : (
                      <div
                        key={`${hit.type}-${hit.id}`}
                        title="You don't have access to view this record. Contact your Admin."
                        className="flex cursor-not-allowed items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm opacity-60"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-500">{hit.title}</span>
                          {hit.subtitle && <span className="block truncate text-xs text-slate-400">{hit.subtitle}</span>}
                        </span>
                        <span className="flex-none text-xs text-slate-400">🔒 No access</span>
                      </div>
                    )
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
