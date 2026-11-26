// 2026-11-25 — the one place a customer status message is actually sent.
//
// WHY THIS IS A MODULE AND NOT A FETCH INSIDE THE ACTION: the team is on
// Whapi today (a hosted WhatsApp-Web session) and the official Cloud API is
// the compliant long-term route. Everything that knows how to talk to a
// provider lives here, behind `StatusSender`, so switching provider later
// means writing one more implementation — the queue, the log, the retry job
// and the admin page never change.
//
// SECURITY: the token is read from the server environment (WHAPI_TOKEN) on
// every call. It is never sent to the browser, never stored in a row, and
// never logged.

export type SendResult = { ok: true; messageId: string | null } | { ok: false; error: string; retryable: boolean };

export type StatusSender = {
  name: string;
  /** `to` is digits only, international format, no '+'. */
  sendText(to: string, body: string): Promise<SendResult>;
  /** `groupId` is the group's own id (…@g.us, or the bare id stored on the company). */
  sendGroupText(groupId: string, body: string): Promise<SendResult>;
};

const WHAPI_BASE_URL = "https://gate.whapi.cloud";
const REQUEST_TIMEOUT_MS = 20_000;

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** One POST to Whapi's text endpoint; `chatId` is already the full WhatsApp JID. */
async function postText(chatId: string, body: string): Promise<SendResult> {
  const token = (process.env.WHAPI_TOKEN ?? "").trim();
  if (!token) {
    return { ok: false, error: "WHAPI_TOKEN is not configured on this deployment.", retryable: false };
  }
  let res: Response;
  try {
    res = await withTimeout((signal) =>
      fetch(`${WHAPI_BASE_URL}/messages/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: chatId, body }),
        signal,
      })
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      error: timedOut ? "WhatsApp did not answer in time." : "Could not reach WhatsApp — please try again.",
      retryable: true,
    };
  }

  const json = (await res.json().catch(() => null)) as
    | { id?: string; message?: { id?: string }; sent?: boolean; error?: unknown; detail?: string; message_text?: string }
    | null;

  if (res.ok) {
    const id = json?.id ?? json?.message?.id ?? null;
    return { ok: true, messageId: id };
  }

  const raw = json?.error;
  const detail =
    (typeof raw === "string" ? raw : (raw as { message?: string } | undefined)?.message) ||
    json?.detail ||
    (typeof json?.message_text === "string" ? json.message_text : undefined) ||
    res.statusText ||
    `HTTP ${res.status}`;
  // 429 and 5xx are the provider's own temporary problems; 4xx is our
  // request (bad number, rejected content) and retrying it would just fail
  // again forever.
  return { ok: false, error: detail, retryable: res.status === 429 || res.status >= 500 };
}

/**
 * Whapi's text send, 1:1 and group. Order-status messages go to the company's
 * order group; a company without one still falls back to the customer's own
 * number (see order-status-notify.ts).
 */
export const whapiSender: StatusSender = {
  name: "whapi",
  // Whapi addresses 1:1 chats as <digits>@s.whatsapp.net.
  sendText: (to, body) => postText(`${to}@s.whatsapp.net`, body),
  // Groups are <id>@g.us; the stored id may or may not already carry the suffix.
  sendGroupText: (groupId, body) => postText(groupId.includes("@") ? groupId : `${groupId}@g.us`, body),
};

/**
 * The sender this deployment uses. Null when the provider is not configured —
 * the caller records a failed message with that reason instead of pretending
 * something was sent.
 */
export function getStatusSender(): StatusSender | null {
  const provider = (process.env.WHATSAPP_STATUS_PROVIDER ?? "whapi").trim().toLowerCase();
  if (provider === "whapi") {
    return (process.env.WHAPI_TOKEN ?? "").trim() ? whapiSender : null;
  }
  return null;
}

/** Admin "Test connection": does the token answer at all? Never throws. */
export async function checkStatusProvider(): Promise<{ ok: boolean; detail: string }> {
  const token = (process.env.WHAPI_TOKEN ?? "").trim();
  if (!token) return { ok: false, detail: "WHAPI_TOKEN is not set on this deployment." };
  try {
    const res = await withTimeout((signal) =>
      fetch(`${WHAPI_BASE_URL}/health`, { headers: { Authorization: `Bearer ${token}` }, signal })
    );
    if (!res.ok) return { ok: false, detail: `WhatsApp answered HTTP ${res.status}.` };
    const json = (await res.json().catch(() => null)) as { status?: { text?: string }; text?: string } | null;
    const detail = json?.status?.text ?? json?.text ?? "Connected.";
    return { ok: true, detail };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return { ok: false, detail: timedOut ? "Timed out talking to WhatsApp." : "Could not reach WhatsApp." };
  }
}
