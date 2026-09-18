"use client";

// 2026-09-18 — "order me agar ek se jyada photo or dalni pade to kese
// manage hoyegi link se dalegi": ONE shared "+ Add Photo" row group, reused
// by the New Order form's ItemBlock (new/order-form.tsx) and the inline
// edit form (order-edit-form.tsx). Photo #1 stays in the existing
// PhotoUrlField (it feeds the list thumbnail, print sheet, and WhatsApp
// share exactly as before); every EXTRA photo is one plain URL row here.
//
// Fully uncontrolled by design — this form family reads inputs by name off
// the DOM (see new/order-form.tsx's handleSubmit), and the edit form is
// defaultValue-based. Every row SHARES one name: the edit path collects
// them with formData.getAll(name) in row order (see orders/actions.ts), and
// the new-order path reads the same-name RadioNodeList off form.elements.
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
}: {
  namePrefix: string; // e.g. "photo_extra_urls" or "photo_extra_url_<itemKey>"
  inputClass: string;
  initialUrls?: string[];
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initialUrls.filter(Boolean).map((url) => ({ id: nextRowId++, initial: url })),
  );

  function addRow() {
    setRows((prev) => [...prev, { id: nextRowId++, initial: "" }]);
  }
  function removeRow(id: number) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  if (rows.length === 0) {
    return (
      <button
        type="button"
        onClick={addRow}
        className="mt-2 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:border-amber-400 hover:text-amber-600"
      >
        + Add Photo
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {rows.map((row, i) => (
        <div key={row.id} className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-xs text-slate-400">#{i + 2}</span>
          <input
            type="url"
            name={namePrefix}
            defaultValue={row.initial}
            placeholder="https://… (extra photo link)"
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => removeRow(row.id)}
            className="shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-500 hover:border-red-300 hover:text-red-600"
            aria-label="Remove photo link"
          >
            ✕
          </button>
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
