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
//
// 2026-10-03 — "telegram ka setup karna thoda tough ho raha hai": the old
// flow made people click "Open Telegram & Start", come BACK to this page,
// then click "Connect" again — three actions across two tabs, and nobody
// remembered step 2. Now ONE button does it: it opens the deep link in a
// new tab AND starts auto-polling connectMyTelegram right here (every
// ~2.5s for up to 30s), so the employee just presses Start in Telegram —
// when they return, the card has already flipped to ✓ Connected. The
// manual retry button stays as a fallback for the slow/absent case.
import { useRef, useState } from "react";
import { connectMyTelegram, testMyTelegram, type TelegramConnectState, type TelegramTestState } from "./actions";

const POLL_INTERVAL_MS = 2_500;
const POLL_MAX_ATTEMPTS = 12; // 12 × 2.5s ≈ 30s of automatic checking

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const [polling, setPolling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pollNote, setPollNote] = useState<string | null>(null);
  const [connectResult, setConnectResult] = useState<TelegramConnectState | null>(null);
  const [testResult, setTestResult] = useState<TelegramTestState | null>(null);
  const pollingRef = useRef(false);

  const deepLink = botUsername ? `https://t.me/${botUsername}?start=${employeeId}` : null;

  // Auto-connect loop — called from click handlers ONLY (never from an
  // effect, per the repo's react-hooks/set-state-in-effect rule), because
  // the polling only makes sense once the employee has been sent to
  // Telegram. Each attempt reads the bot's getUpdates queue for THIS
  // employee's "/start <employee id>" payload (strict match, own row only
  // — see connectEmployeeTelegram).
  async function runAutoConnect() {
    if (pollingRef.current) return;
    pollingRef.current = true;
    setPolling(true);
    setConnectResult(null);
    setPollNote("Telegram kholein aur bot chat me START dabayein — hum yahin connect kar rahe hain…");
    try {
      for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
        const res = await connectMyTelegram();
        if (res.connected) {
          setConnected(true);
          setConnectResult(res);
          setPollNote(null);
          return;
        }
        setPollNote(`Start ka wait kar rahe hain… (${attempt}/${POLL_MAX_ATTEMPTS}) — Telegram me bot ko START zaroor dabayein.`);
        if (attempt < POLL_MAX_ATTEMPTS) await wait(POLL_INTERVAL_MS);
      }
      setPollNote(null);
      setConnectResult({
        connected: false,
        error:
          "Abhi tak Start message nahi mila — neeche wala 'Connect (retry)' button dabakar dobara try karein (Telegram me bot chat zaroor khol kar START dabana hai).",
      });
    } finally {
      pollingRef.current = false;
      setPolling(false);
    }
  }

  // 1. Opens the deep link (new tab — this page keeps polling right here)
  //    and starts the auto-connect loop in the same click.
  function openTelegram() {
    runAutoConnect();
  }

  async function runTest() {
    setTestResult(null);
    setTesting(true);
    try {
      setTestResult(await testMyTelegram());
    } finally {
      setTesting(false);
    }
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
            disabled={testing}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
          >
            {testing ? "Sending…" : "🧪 Test"}
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
        Get a personal Telegram message every time your Punch In / Punch Out is recorded — <strong>Hello + your name</strong>, date,
        time and status. WhatsApp is off for this — Telegram only.
      </p>

      {!connected ? (
        botUsername ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-600">
              Bas <strong>1 click</strong>: neeche button se Telegram khulega → bot chat me <strong>START</strong> dabayein →
              wapas yahan aate hi connect ho jayega.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={deepLink ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                onClick={openTelegram}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700"
              >
                🔗 Open Telegram &amp; Start
              </a>
              <button
                type="button"
                onClick={runAutoConnect}
                disabled={polling}
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
              >
                {polling ? "Connecting…" : "🔄 Connect (retry)"}
              </button>
            </div>
            {pollNote && (
              <p className="flex items-center gap-1.5 text-xs text-sky-700">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-500" aria-hidden="true" />
                {pollNote}
              </p>
            )}
            {connectResult?.error && <p className="text-xs text-red-600">{connectResult.error}</p>}
          </div>
        ) : (
          <p className="text-xs text-amber-600">
            Bot ka deep link abhi auto-resolve nahi ho paya — server pe{" "}
            <code className="rounded bg-amber-50 px-1">TELEGRAM_BOT_USERNAME</code> set karwayein (ya{" "}
            <code className="rounded bg-amber-50 px-1">TELEGRAM_BOT_TOKEN</code> check karein), phir reload karein.
          </p>
        )
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runTest}
            disabled={testing}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
          >
            {testing ? "Sending…" : "🧪 Test"}
          </button>
          {testResult?.ok && <span className="text-xs text-green-700">✓ Test sent — check your Telegram</span>}
          {testResult && !testResult.ok && <span className="text-xs text-red-600">{testResult.error}</span>}
        </div>
      )}
    </div>
  );
}
