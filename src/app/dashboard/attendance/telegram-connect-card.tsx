"use client";

// 2026-09-30 — self-serve "Connect Telegram" card on the Attendance page
// (replaces the WhatsApp punch-notification channel entirely — user's
// choice: "WhatsApp: Band — sirf Telegram"). Two steps, exactly how
// Telegram deep links actually work:
//   1. "Open Telegram & Start" → https://t.me/<bot>?start=<employee id> —
//      pressing Start makes the bot receive "/start <employee id>".
//   2. "Connect" → connectMyTelegram reads that exact payload back out of
//      the bot's getUpdates queue and saves message.from.id to the
//      caller's own employees.telegram_chat_id row.
// Once connected, every punch in/out DMs this employee directly
// (src/lib/attendance/telegram-notify.ts) — plus a 🧪 Test button here,
// the employee's own mirror of the admin-side Test, so "msg aa raha hai
// ya nahi" is checkable in one click.
import { useState, useTransition } from "react";
import { connectMyTelegram, testMyTelegram, type TelegramConnectState, type TelegramTestState } from "./actions";

export function TelegramConnectCard({
  employeeId,
  connected: initialConnected,
  botUsername,
  botTokenSet,
  mode = "dm",
}: {
  employeeId: string;
  connected: boolean;
  botUsername: string | null;
  botTokenSet: boolean;
  // 2026-10-01 — "dm" = personal DM per employee (default), "group" =
  // every punch posted to one shared Telegram group (set via
  // TELEGRAM_ATTENDANCE_MODE=group + TELEGRAM_ATTENDANCE_CHAT_ID). In
  // group mode the personal connect/Start steps are pointless, so this
  // card shows the group status instead of the two-step flow.
  mode?: "dm" | "group";
}) {
  const [connected, setConnected] = useState(initialConnected);
  const [isPending, startTransition] = useTransition();
  const [connectResult, setConnectResult] = useState<TelegramConnectState | null>(null);
  const [testResult, setTestResult] = useState<TelegramTestState | null>(null);

  const deepLink = botUsername ? `https://t.me/${botUsername}?start=${employeeId}` : null;

  function runConnect() {
    setConnectResult(null);
    setTestResult(null);
    startTransition(async () => {
      const res = await connectMyTelegram();
      setConnectResult(res);
      if (res.connected) setConnected(true);
    });
  }

  function runTest() {
    setTestResult(null);
    startTransition(async () => {
      const res = await testMyTelegram();
      setTestResult(res);
    });
  }

  if (!botTokenSet) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">📱 Telegram Punch Notifications</h2>
        <p className="text-xs text-slate-500">
          Not configured yet — ask admin to set <code className="rounded bg-slate-100 px-1">TELEGRAM_BOT_TOKEN</code> (and{" "}
          <code className="rounded bg-slate-100 px-1">TELEGRAM_BOT_USERNAME</code>) on the server, then reload.
        </p>
      </div>
    );
  }

  // 2026-10-01 — GROUP mode: punches go to one shared Telegram group with
  // your name prefixed, so there is no personal chat to connect. The Test
  // button still works (it posts a test message to the group).
  if (mode === "group") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-700">📱 Telegram Punch Notifications</h2>
          <span
            title="Admin enabled group mode: every punch in/out is posted to a shared Telegram group — no personal connect needed"
            className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700"
          >
            📨 Group mode
          </span>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Punch In/Out alerts ab ek shared Telegram group me jaate hain (aapke naam ke saath) — koi personal connect ki zaroorat nahi.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runTest}
            disabled={isPending}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
          >
            {isPending ? "Sending…" : "🧪 Test"}
          </button>
          {testResult?.ok && <span className="text-xs text-green-700">✓ Test sent — check the Telegram group</span>}
          {testResult && !testResult.ok && <span className="text-xs text-red-600">{testResult.error}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-700">📱 Telegram Punch Notifications</h2>
        {connected ? (
          <span
            title="Punch in/out confirmations will be DM'd to your Telegram"
            className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700"
          >
            ✓ Connected
          </span>
        ) : (
          <span
            title="Not connected — punch confirmations are skipped for you"
            className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
          >
            Not connected
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Get a personal Telegram message every time your Punch In / Punch Out is recorded (English confirmation, same as the old WhatsApp
        alert). WhatsApp is off for this — Telegram only.
      </p>

      {!connected ? (
        botUsername ? (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={deepLink ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700"
            >
              1. Open Telegram &amp; Start
            </a>
            <button
              type="button"
              onClick={runConnect}
              disabled={isPending}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
            >
              {isPending ? "Connecting…" : "2. Connect"}
            </button>
            {connectResult?.error && <span className="text-xs text-red-600">{connectResult.error}</span>}
          </div>
        ) : (
          <p className="text-xs text-amber-600">
            <code className="rounded bg-amber-50 px-1">TELEGRAM_BOT_USERNAME</code> is not set on the server — ask admin to set it, then
            reload.
          </p>
        )
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runTest}
            disabled={isPending}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
          >
            {isPending ? "Sending…" : "🧪 Test"}
          </button>
          {testResult?.ok && <span className="text-xs text-green-700">✓ Test sent — check your Telegram</span>}
          {testResult && !testResult.ok && <span className="text-xs text-red-600">{testResult.error}</span>}
        </div>
      )}
    </div>
  );
}
