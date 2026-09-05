"use client";

// 2026-09-05 — "OR CHAT BOT HAI USME BHI YAHI BAAT KARE JESE AI ASSISTENT
// HO CHAHE KUCH BHI PUCH LE OMS SE RELATED YA JESE KOI PERSIONAL BAAT" —
// the chat half of the AI Companion. Scope LOCKED per the user's own
// explicit pick between the options offered: OMS + friendly casual chat
// ONLY — no romantic/flirty content (the system prompt on the server side,
// /api/companion-chat/route.ts, is what actually enforces this; this
// component is just the UI).
//
// 2026-09-05, round 2:
//   - "ISKA NAAM SABHI EMPLOYE APNEHISAB SE DECIDE KAR SAKTE HAI" — the
//     header shows this employee's own chosen name (or a friendly default
//     until they set one), with a small edit control right there to
//     rename it (setCompanionName, src/lib/companion/actions.ts). Renaming
//     is optimistic — the parent (companion-live-provider.tsx) is told
//     immediately via onRename so the dock's aria-label picks it up too,
//     rolled back only if the server call fails.
//   - "JIS BHI LANGUAGE ME BAAT KARE SAMJH JAYE" — no UI change needed for
//     this one, it's entirely a server-side system-prompt instruction (see
//     route.ts) — free-text input already accepts any script/language.
//   - The companion's name is now also sent to the API so the model can
//     refer to itself by it.
import { useEffect, useRef, useState } from "react";
import { setCompanionName } from "@/lib/companion/actions";

type ChatTurn = { role: "user" | "assistant"; text: string };

const DEFAULT_NAME = "AI Companion";

export function CompanionChatPanel({
  employeeName,
  companionName,
  onRename,
  onClose,
}: {
  employeeName: string;
  companionName: string | null;
  onRename: (name: string | null) => void;
  onClose: () => void;
}) {
  const displayName = companionName || DEFAULT_NAME;
  const [turns, setTurns] = useState<ChatTurn[]>([
    { role: "assistant", text: `Hi ${employeeName.split(" ")[0]}! I'm ${displayName}. Ask me anything about the OMS, or just say hi 🙂` },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(companionName ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const nextTurns: ChatTurn[] = [...turns, { role: "user", text }];
    setTurns(nextTurns);
    setInput("");
    setSending(true);
    try {
      const res = await fetch("/api/companion-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: nextTurns.slice(0, -1), companionName }),
      });
      const data: { reply?: string; error?: string } = await res.json();
      setTurns((prev) => [...prev, { role: "assistant", text: data.reply || data.error || "Sorry, something went wrong." }]);
    } catch {
      setTurns((prev) => [...prev, { role: "assistant", text: "Sorry, I couldn't reach the chat service right now." }]);
    } finally {
      setSending(false);
    }
  }

  async function saveName() {
    const next = nameDraft.trim() || null;
    setSavingName(true);
    setNameError(null);
    const prev = companionName;
    onRename(next); // optimistic
    const result = await setCompanionName(next);
    if (result.error) {
      onRename(prev); // roll back
      setNameError(result.error);
    } else {
      setEditingName(false);
    }
    setSavingName(false);
  }

  return (
    <div className="oms-companion-chat-panel" role="dialog" aria-label={`${displayName} chat`}>
      <div
        className="flex items-center justify-between gap-2 px-3 py-2"
        style={{ borderBottom: "1px solid var(--oms-surface-border)" }}
      >
        {editingName ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
            className="flex flex-1 items-center gap-1.5"
          >
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder={DEFAULT_NAME}
              maxLength={24}
              className="w-full min-w-0 rounded-md border px-2 py-1 text-sm outline-none"
              style={{ borderColor: "var(--oms-surface-border)", background: "var(--oms-canvas)", color: "var(--oms-text)" }}
            />
            <button
              type="submit"
              disabled={savingName}
              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50"
              style={{ background: "var(--oms-accent)", color: "var(--oms-accent-contrast)" }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingName(false);
                setNameDraft(companionName ?? "");
                setNameError(null);
              }}
              className="shrink-0 rounded-md px-1.5 py-1 text-xs text-[var(--oms-text-muted)] hover:bg-[var(--oms-canvas)]"
            >
              ✕
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setNameDraft(companionName ?? "");
              setEditingName(true);
            }}
            title="Rename your companion"
            className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-[var(--oms-canvas)]"
          >
            <p className="truncate text-sm font-semibold text-[var(--oms-text)]">{displayName}</p>
            <span className="shrink-0 text-xs text-[var(--oms-text-muted)]" aria-hidden>
              ✏️
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="shrink-0 rounded-md px-1.5 py-0.5 text-sm text-[var(--oms-text-muted)] hover:bg-[var(--oms-canvas)]"
        >
          ✕
        </button>
      </div>
      {nameError ? <p className="px-3 pt-1.5 text-xs text-red-600">{nameError}</p> : null}

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {turns.map((t, i) => (
          <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className="max-w-[85%] rounded-2xl px-3 py-2 text-sm"
              style={
                t.role === "user"
                  ? { background: "var(--oms-accent)", color: "var(--oms-accent-contrast)", borderBottomRightRadius: 4 }
                  : { background: "var(--oms-canvas)", color: "var(--oms-text)", borderBottomLeftRadius: 4 }
              }
            >
              {t.text}
            </div>
          </div>
        ))}
        {sending ? (
          <div className="flex justify-start">
            <div className="rounded-2xl px-3 py-2 text-sm" style={{ background: "var(--oms-canvas)", color: "var(--oms-text-muted)" }}>
              …
            </div>
          </div>
        ) : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-2 p-2"
        style={{ borderTop: "1px solid var(--oms-surface-border)" }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 rounded-full border px-3 py-1.5 text-sm outline-none"
          style={{ borderColor: "var(--oms-surface-border)", background: "var(--oms-surface)", color: "var(--oms-text)" }}
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded-full px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ background: "var(--oms-accent)", color: "var(--oms-accent-contrast)" }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
