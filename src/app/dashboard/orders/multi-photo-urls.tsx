"use client";

// 2026-09-18 — "order me agar ek se jyada photo or dalni pade to kese
// manage hoyegi link se dalegi": ONE shared "+ Add Photo" row group, reused
// by the New Order form's ItemBlock (new/order-form.tsx) and the inline
// edit form (order-edit-form.tsx). Photo #1 stays in the existing
// PhotoUrlField (it feeds the list thumbnail, print sheet, and WhatsApp
// share exactly as before); every EXTRA photo is one plain URL row here.
//
// 2026-09-19 — "isme ek to order ki main photo ka ho baki ke do closeup
// photo ke option ho": the group ALWAYS shows two labeled "Closeup" slots
// (even for a brand-new order with no saved photos), and "+ Add Photo"
// adds row #4 onward on top of those. The two closeup slots are fixed —
// they have no ✕ button; clearing a slot's text is how you "remove" it,
// and blanks are already dropped on save (see the de-dupe/filter in
// orders/actions.ts and new/actions.ts). Extras beyond the two slots that
// came back from the DB also render non-removable (clear instead) so a
// mis-tap can never silently drop a saved photo; freshly ADDED rows (#4+)
// do get a ✕.
//
// Fully uncontrolled by design — this form family reads inputs by name off
// the DOM (see new/order-form.tsx's handleSubmit), and the edit form is
// defaultValue-based. Every row SHARES one name: the edit path collects
// them with formData.getAll(name) in row order (see orders/actions.ts),
// and the new-order path reads the same-name RadioNodeList off form.elements.
//
// Rows are keyed by a stable id (NOT the array index) and carry their own
// starting value: inputs are uncontrolled, so keying by index would let
// React reuse a removed row's DOM node for the next row and show a stale
// link. State only tracks which rows EXIST — the URL text lives in the DOM.
import { useState } from "react";

type Row = { id: number; initial: string };

// Module-level id counter — ids only need to be unique WITHIN one component
// instance, and a plain module variable (bumped only in event handlers / the
// one-time lazy initializer) keeps the react-hooks/refs rule happy. A ref
// would work but its .current must not be read during render.
let nextRowId = 0;

export function MultiPhotoUrls({
  namePrefix,
  inputClass,
  initialUrls = [],
  fixedSlots = 2,
  slotLabel = "Closeup",
}: {
  namePrefix: string; // e.g. "photo_extra_urls" or "photo_extra_url_<itemKey>"
  inputClass: string;
  initialUrls?: string[];
  fixedSlots?: number;
  slotLabel?: string;
}) {
  const [rows, setRows] = useState<Row[]>(() => {
    // Saved extras first, then PAD with empty rows so the fixed slots are
    // always visible — a new order shows two blank Closeup fields, not
    // just the "+ Add Photo" button.
    const base = initialUrls
      .filter(Boolean)
      .map((url) => ({ id: nextRowId++, initial: url }));
    while (base.length < fixedSlots) base.push({ id: nextRowId++, initial: "" });
    return base;
  });
  // Leading rows that are fixed (no ✕): every row that came from the DB
  // (so nothing saved can be dropped by accident) — at least fixedSlots.
  const [baseRows] = useState(() => Math.max(rows.length, fixedSlots));

  function addRow() {
    setRows((prev) => [...prev, { id: nextRowId++, initial: "" }]);
  }
  function removeRow(id: number) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="mt-2 space-y-2">
      {rows.map((row, i) => (
        <div key={row.id} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-slate-400">
            {i < fixedSlots ? `${slotLabel} ${i + 1}` : `#${i + 2}`}
          </span>
          <input
            type="url"
            name={namePrefix}
            defaultValue={row.initial}
            placeholder={
              i < fixedSlots
                ? `https://… (${slotLabel.toLowerCase()} photo ${i + 1} — khali chhod sakte hain)`
                : "https://… (extra photo link)"
            }
            className={inputClass}
          />
          {i >= baseRows && (
            <button
              type="button"
              onClick={() => removeRow(row.id)}
              className="shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-500 hover:border-red-300 hover:text-red-600"
              aria-label="Remove photo link"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:border-amber-400 hover:text-amber-600"
      >
        + Add Photo
      </button>
    </div>
  );
}
