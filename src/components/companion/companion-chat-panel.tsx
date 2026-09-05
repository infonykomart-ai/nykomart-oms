"use client";

// 2026-09-05 — "OR CHAT BOT HAI USME BHI YAHI BAAT KARE JESE AI ASSISTENT
// HO CHAHE KUCH BHI PUCH LE OMS SE RELATED YA JESE KOI PERSIONAL BAAT" —
// the chat half of the AI Companion. Scope LOCKED per the user's own
// explicit pick between the options offered: OMS + friendly casual chat
// ONLY — no romantic/flirty content (the system prompt on the server side,
// /api/companion-chat/route.ts, is what actually enforces this; this
// component is just the UI).
import { useEffect, useRef, useState } from "react";

type ChatTurn = { role: "user" | "assistant"; text: string };

export function CompanionChatPanel({ employeeName, onClose }: { employeeName: string; onClose: () => void }) {
  const [turns, setTurns] = useState<ChatTurn[]>([
    { role: "assistant", text: `Hi ${employeeName.split(" ")[0]}! Ask me anything about the OMS, or just say hi 🙂` },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
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
        body: JSON.stringify({ message: text, history: nextTurns.slice(0, -1) }),
      });
      const data: { reply?: string; error?: string } = await res.json();
      setTurns((prev) => [...prev, { role: "assistant", text: data.reply || data.error || "Sorry, something went wrong." }]);
    } catch {
      setTurns((prev) => [...prev, { role: "assistant", text: "Sorry, I couldn't reach the chat service right now." }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="oms-companion-chat-panel" role="dialog" aria-label="AI Companion chat">
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: "1px solid var(--oms-surface-border)" }}
      >
        <p className="text-sm font-semibold text-[var(--oms-text)]">AI Companion</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="rounded-md px-1.5 py-0.5 text-sm text-[var(--oms-text-muted)] hover:bg-[var(--oms-canvas)]"
        >
          ✕
        </button>
      </div>

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
