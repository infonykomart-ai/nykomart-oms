"use client";

// 2026-09-30 — one cell of the Employees table, replacing the WhatsApp
// version (employee-whatsapp-cell.tsx) the same day the punch-notification
// channel switched: shows whether the employee has connected their OWN
// Telegram DM (employees.telegram_chat_id — set via the Attendance page's
// self-serve connect flow), plus a one-click 🧪 Test button that fires a
// REAL Telegram message and renders exactly what happened — the visible
// answer to "kisi ke msg gaya, kisi ke nahi". On failure the error shows
// right here verbatim (not connected yet / Telegram's own rejection), so
// the fix is either "ask the employee to connect" or an edit on this same
// page, not guesswork.
//
// Known limitation, deliberate: a "✓ Connected" badge means a chat id was
// saved — it cannot prove the employee still has that chat open (a user
// who blocked the bot would fail the send). The Test button exists for
// exactly that: it is the only check that goes all the way through
// Telegram.
import { useState, useTransition } from "react";
import { testEmployeeTelegram, type TelegramTestState } from "./actions";

export function EmployeeTelegramCell({
  employeeId,
  raw,
  botUsername,
}: {
  employeeId: string;
  raw: string | null;
  // 2026-10-01 — "Copy connect link": the admin hands each employee THEIR
  // OWN deep link (t.me/<bot>?start=<employee id>) over WhatsApp/SMS so
  // the employee only has to press Start once — no typing, no guessing.
  // null = TELEGRAM_BOT_USERNAME not set on the server → button hidden.
  botUsername?: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<TelegramTestState | null>(null);
  const [copied, setCopied] = useState(false);

  const connected = !!raw && raw.trim().length > 0;
  const connectLink = botUsername ? `https://t.me/${botUsername}?start=${employeeId}` : null;

  function copyLink() {
    if (!connectLink) return;
    void navigator.clipboard
      .writeText(connectLink)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        setCopied(false);
        window.prompt("Copy this connect link:", connectLink);
      });
  }

  function runTest() {
    setResult(null);
    startTransition(async () => {
      const res = await testEmployeeTelegram(employeeId);
      setResult(res);
    });
  }

  return (
    <div className="min-w-[10rem]">
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-slate-700">{connected ? `chat ${raw}` : "—"}</span>
        {connected ? (
          <span
            title="Employee connected their Telegram — punch notifications DM this chat id"
            className="rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700"
          >
            ✓ Connected
          </span>
        ) : (
          <span
            title="Not connected — punch notifications silently skip this employee (Attendance page → Connect Telegram)"
            className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
          >
            Not connected
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runTest}
          disabled={isPending}
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
        >
          {isPending ? "Sending…" : "🧪 Test"}
        </button>
        {connectLink && (
          <button
            type="button"
            onClick={copyLink}
            title="Copy this employee's personal Telegram connect link — WhatsApp it to them; they only need to press Start once"
            className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100"
          >
            {copied ? "✓ Copied" : "🔗 Copy link"}
          </button>
        )}
        {result && result.ok && (
          <span className="text-xs text-green-700">
            ✓ Sent{result.to ? ` to ${result.to}` : ""} — check Telegram
          </span>
        )}
        {result && !result.ok && <span className="text-xs text-red-700">{result.error}</span>}
      </div>
    </div>
  );
}
