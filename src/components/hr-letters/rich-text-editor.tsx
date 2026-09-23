"use client";

// 2026-09-23 — "WORD SECTION KE YE OPTION BHI AAYE SABHI LATTER ME": the
// letter body was a plain <textarea> (raw text, \n for line breaks, no
// formatting at all). This adds a small Word-style toolbar (Font group:
// family/size, bold/italic/underline/strikethrough, subscript/superscript,
// text color, highlight color, clear formatting — Paragraph group:
// bullets, numbering, indent/outdent, alignment) over a contentEditable
// area, using the browser's own execCommand — no new editor dependency,
// consistent with the rest of this codebase not using one anywhere else.
// `html` is intentionally stored as real HTML (not the old plain string)
// so bold/bullets/alignment survive into the print/PDF output and into
// the exported Word doc (see letter-export.ts), not just the on-screen
// editor. One component so any other "generate + edit free text" page
// (only HR letters today) can reuse the exact same toolbar.
import { useEffect, useRef, type ReactNode, type RefObject } from "react";

function exec(target: HTMLDivElement | null, command: string, value?: string) {
  target?.focus();
  document.execCommand(command, false, value);
}

function ToolbarButton({
  target,
  cmd,
  value,
  label,
  title,
  bold,
}: {
  target: RefObject<HTMLDivElement | null>;
  cmd: string;
  value?: string;
  label: ReactNode;
  title: string;
  bold?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      // onMouseDown (not onClick) + preventDefault: keeps the current text
      // selection inside the contentEditable area alive. A click would
      // first blur the editor (collapsing/losing the selection) before the
      // handler ever runs, so execCommand would have nothing to act on.
      onMouseDown={(e) => {
        e.preventDefault();
        exec(target.current, cmd, value);
      }}
      className={`flex h-7 min-w-7 items-center justify-center rounded px-1 text-xs text-slate-700 transition hover:bg-slate-200 ${bold ? "font-bold" : ""}`}
    >
      {label}
    </button>
  );
}

export function RichTextEditor({
  html,
  onChange,
  placeholder,
  minHeightClassName = "min-h-[260px]",
}: {
  html: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeightClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Keep the editable DOM in sync with external resets (e.g. clicking
  // "Regenerate text" replaces `html` wholesale) without fighting normal
  // typing — only touch the DOM when it actually differs from the latest
  // value, since our own onInput already keeps `html` current as the user
  // types and re-assigning innerHTML on every keystroke would reset the
  // caret position.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== html) {
      ref.current.innerHTML = html;
    }
  }, [html]);

  function handleInput() {
    if (ref.current) onChange(ref.current.innerHTML);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-300">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
        {/* Font group */}
        <select
          title="Font"
          defaultValue="Georgia"
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => exec(ref.current, "fontName", e.target.value)}
          className="h-7 rounded border border-slate-300 bg-white px-1 text-xs text-slate-700"
        >
          <option value="Georgia">Georgia</option>
          <option value="Calibri">Calibri</option>
          <option value="Arial">Arial</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Verdana">Verdana</option>
        </select>
        <select
          title="Font size"
          defaultValue="3"
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => exec(ref.current, "fontSize", e.target.value)}
          className="h-7 rounded border border-slate-300 bg-white px-1 text-xs text-slate-700"
        >
          <option value="1">8</option>
          <option value="2">10</option>
          <option value="3">12</option>
          <option value="4">14</option>
          <option value="5">18</option>
          <option value="6">24</option>
          <option value="7">36</option>
        </select>

        <span className="mx-1 h-5 w-px bg-slate-300" />

        <ToolbarButton target={ref} cmd="bold" label="B" title="Bold" bold />
        <ToolbarButton target={ref} cmd="italic" label={<span className="italic">I</span>} title="Italic" />
        <ToolbarButton target={ref} cmd="underline" label={<span className="underline">U</span>} title="Underline" />
        <ToolbarButton target={ref} cmd="strikeThrough" label={<span className="line-through">S</span>} title="Strikethrough" />
        <ToolbarButton target={ref} cmd="subscript" label="x₂" title="Subscript" />
        <ToolbarButton target={ref} cmd="superscript" label="x²" title="Superscript" />

        <label title="Text color" className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-xs font-bold text-red-600 hover:bg-slate-200">
          A
          <input
            type="color"
            className="h-0 w-0 opacity-0"
            onInput={(e) => exec(ref.current, "foreColor", (e.target as HTMLInputElement).value)}
          />
        </label>
        <label title="Highlight color" className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-xs hover:bg-slate-200">
          <span className="rounded bg-yellow-200 px-1">H</span>
          <input
            type="color"
            defaultValue="#fff59d"
            className="h-0 w-0 opacity-0"
            onInput={(e) => exec(ref.current, "hiliteColor", (e.target as HTMLInputElement).value)}
          />
        </label>
        <ToolbarButton target={ref} cmd="removeFormat" label="✕" title="Clear formatting" />

        <span className="mx-1 h-5 w-px bg-slate-300" />

        {/* Paragraph group */}
        <ToolbarButton target={ref} cmd="insertUnorderedList" label="•" title="Bullet list" />
        <ToolbarButton target={ref} cmd="insertOrderedList" label="1." title="Numbered list" />
        <ToolbarButton target={ref} cmd="outdent" label="⇤" title="Decrease indent" />
        <ToolbarButton target={ref} cmd="indent" label="⇥" title="Increase indent" />
        <ToolbarButton target={ref} cmd="justifyLeft" label="L" title="Align left" />
        <ToolbarButton target={ref} cmd="justifyCenter" label="C" title="Align center" />
        <ToolbarButton target={ref} cmd="justifyRight" label="R" title="Align right" />
        <ToolbarButton target={ref} cmd="justifyFull" label="J" title="Justify" />
      </div>

      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        className={`${minHeightClassName} overflow-y-auto bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 outline-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)]`}
        style={{ fontFamily: "Georgia, serif" }}
      />
    </div>
  );
}
