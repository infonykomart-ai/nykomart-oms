"use client";

// 2026-09-18 — "order me agar ek se jyada photo or dalni pade to kese
// manage hoyegi link se dalegi": ONE shared photo-row group, reused by the
// New Order form's ItemBlock (new/order-form.tsx) and the inline edit form
// (order-edit-form.tsx). Photo #1 stays in the existing PhotoUrlField (it
// feeds the list thumbnail, print sheet, and WhatsApp share exactly as
// before); every EXTRA photo is one row here.
//
// 2026-09-19 — the group ALWAYS shows two labeled "Closeup" slots and
// "+ Add Photo" adds row #4 onward. Saved rows are not removable with ✕
// (clearing the text is how you remove one) so a mis-tap can never silently
// drop a stored photo; freshly ADDED rows (#4+) do get a ✕.
//
// 2026-11-22b — Phase 3: each row now has BOTH options the requirement
// names — paste/keep a **Link** or click **Upload** (same order-photos
// bucket, same 10 MB cap, same order_entry check as PhotoUrlField). An
// upload fills that row's URL and its preview, so a close-up no longer has to
// be hosted somewhere else first. Re-uploading into a row replaces it.
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
// A small Map<rowId, url> mirrors the URL only to render the preview.
import { useRef, useState, type ChangeEvent } from "react";
import { uploadOrderPhoto } from "./actions";

type Row = { id: number; initial: string };

// Module-level id counter — ids only need to be unique WITHIN one component
// instance, and a plain module variable (bumped only in event handlers / the
// one-time lazy initializer) keeps the react-hooks/refs rule happy.
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
  // rowId -> the URL currently shown in that row, for the preview only.
  const [previews, setPreviews] = useState<Record<number, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.id, row.initial]))
  );
  const [broken, setBroken] = useState<Set<number>>(() => new Set());
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  function addRow() {
    setRows((prev) => [...prev, { id: nextRowId++, initial: "" }]);
  }
  function removeRow(id: number) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setPreviews((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    delete inputRefs.current[id];
  }

  async function handleUpload(rowId: number, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusyId(rowId);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadOrderPhoto(formData);
      if (result.error) {
        setError(result.error);
      } else if (result.url) {
        const input = inputRefs.current[rowId];
        if (input) input.value = result.url;
        setPreviews((prev) => ({ ...prev, [rowId]: result.url as string }));
        setBroken((prev) => {
          const next = new Set(prev);
          next.delete(rowId);
          return next;
        });
      }
    } catch {
      setError("Upload failed — try again.");
    } finally {
      setBusyId(null);
      event.target.value = "";
    }
  }

  function handleTyped(rowId: number, value: string) {
    setPreviews((prev) => ({ ...prev, [rowId]: value }));
    setBroken((prev) => {
      if (!prev.has(rowId)) return prev;
      const next = new Set(prev);
      next.delete(rowId);
      return next;
    });
  }

  return (
    <div className="mt-2 space-y-2">
      {rows.map((row, i) => {
        const preview = (previews[row.id] ?? "").trim();
        const showPreview = !!preview && !broken.has(row.id);
        return (
          <div key={row.id} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-slate-400">
              {i < fixedSlots ? `${slotLabel} ${i + 1}` : `#${i + 2}`}
            </span>
            {showPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt=""
                onError={() => setBroken((prev) => new Set(prev).add(row.id))}
                className="h-9 w-9 shrink-0 rounded border border-slate-200 object-cover"
              />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-300">
                —
              </div>
            )}
            <input
              ref={(node) => {
                inputRefs.current[row.id] = node;
              }}
              // 2026-09-19 / 2026-11-22b — type="text", not type="url": a
              // bare URL input silently blocks the WHOLE form's submit via
              // native constraint validation when a pasted link isn't a
              // well-formed absolute URL (same trap documented on
              // photo-url-field.tsx). Broken links already surface through
              // the preview above.
              type="text"
              name={namePrefix}
              defaultValue={row.initial}
              onChange={(event) => handleTyped(row.id, event.target.value)}
              placeholder={
                i < fixedSlots
                  ? `https://… or upload (${slotLabel.toLowerCase()} photo ${i + 1} — optional)`
                  : "https://… or upload (extra photo)"
              }
              className={inputClass}
            />
            <label className="shrink-0 cursor-pointer rounded-lg border border-slate-300 px-2 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">
              {busyId === row.id ? "…" : "📁 Upload"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={busyId !== null}
                onChange={(event) => handleUpload(row.id, event)}
              />
            </label>
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
        );
      })}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={addRow}
          className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:border-amber-400 hover:text-amber-600"
        >
          + Add Photo
        </button>
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </div>
  );
}
