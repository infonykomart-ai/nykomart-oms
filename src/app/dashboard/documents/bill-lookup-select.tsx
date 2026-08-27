"use client";

// 2026-08-27 — dropdown-based bill lookup for Debit Note's "raised
// against" link and "apply as adjustment to" target (user's confirmed
// choice via AskUserQuestion: dropdown-based selection, not free-text
// matching). Same debounced-typeahead pattern as the Purchase Bill
// Multi-PO picker (purchase-bill-multi-form.tsx) — see that file's
// handleQueryChange for the original version of this pattern.
import { useRef, useState, useTransition } from "react";
import { searchBillsForNote, type BillSearchHit } from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

export function BillLookupSelect({
  label,
  placeholder = "Type 2+ letters of the vendor/invoice no. — e.g. INV/26-27",
  selected,
  onSelect,
  onClear,
}: {
  label: string;
  placeholder?: string;
  selected: BillSearchHit | null;
  onSelect: (hit: BillSearchHit) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BillSearchHit[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSearching, startSearch] = useTransition();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    searchTimer.current = setTimeout(() => {
      startSearch(async () => {
        const hits = await searchBillsForNote(trimmed);
        setResults(hits);
        setShowDropdown(true);
      });
    }, 300);
  }

  if (selected) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-700">
            <strong className="text-slate-900">{selected.label}</strong>
            {" · Balance ₹"}
            {selected.balanceDue.toFixed(2)}
          </span>
          <button type="button" onClick={onClear} className="shrink-0 text-slate-400 hover:text-red-600">
            ✕ change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {label && <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>}
      <input
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        onFocus={() => results.length > 0 && setShowDropdown(true)}
        onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
        placeholder={placeholder}
        className={inputClass}
      />
      {showDropdown && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {isSearching && <p className="px-3 py-2 text-xs text-slate-400">Searching...</p>}
          {!isSearching && results.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">No matching bills.</p>}
          {!isSearching &&
            results.map((hit) => (
              <button
                key={hit.primaryBillId}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(hit);
                  setQuery("");
                  setResults([]);
                  setShowDropdown(false);
                }}
                className="block w-full border-b border-slate-100 px-3 py-1.5 text-left text-xs last:border-b-0 hover:bg-amber-50"
              >
                <span className="font-semibold text-slate-900">{hit.label}</span>
                <span className="text-slate-400"> — Balance ₹{hit.balanceDue.toFixed(2)}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
