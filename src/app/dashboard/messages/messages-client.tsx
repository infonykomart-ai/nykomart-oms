"use client";

// Direct Messaging UI — two-pane chat (employee list + conversation),
// real-time incoming delivery via a Supabase Realtime Postgres Changes
// subscription on direct_messages (RLS-scoped server-side to this
// employee's own rows, see db/2026-08-14m-...sql — the browser client
// authenticates as the real signed-in user, so this subscription can only
// ever be pushed rows this employee is the sender or recipient of).
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { sendMessage, markConversationRead, type DirectMessage } from "./actions";

type EmployeeOption = { id: string; name: string; photo_url: string | null; role_name: string; company_name: string };

function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatBytes(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function MessagesClient({
  meId,
  employees,
  initialMessages,
}: {
  meId: string;
  employees: EmployeeOption[];
  initialMessages: DirectMessage[];
}) {
  const [messages, setMessages] = useState<DirectMessage[]>(initialMessages);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const supabase = useMemo(() => createClient(), []);

  // Conversation summary per counterpart: last message + unread count.
  const conversationByEmployeeId = useMemo(() => {
    const map = new Map<string, { last: DirectMessage; unread: number }>();
    for (const m of messages) {
      const other = m.sender_employee_id === meId ? m.recipient_employee_id : m.sender_employee_id;
      const existing = map.get(other);
      const unreadBump = m.recipient_employee_id === meId && !m.read_at ? 1 : 0;
      if (!existing || new Date(m.created_at) > new Date(existing.last.created_at)) {
        map.set(other, { last: m, unread: (existing?.unread ?? 0) + unreadBump });
      } else {
        map.set(other, { last: existing.last, unread: existing.unread + unreadBump });
      }
    }
    return map;
  }, [messages, meId]);

  const sortedEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? employees.filter((e) => e.name.toLowerCase().includes(q) || e.role_name.toLowerCase().includes(q) || e.company_name.toLowerCase().includes(q))
      : employees;
    return [...filtered].sort((a, b) => {
      const ca = conversationByEmployeeId.get(a.id)?.last.created_at;
      const cb = conversationByEmployeeId.get(b.id)?.last.created_at;
      if (ca && cb) return new Date(cb).getTime() - new Date(ca).getTime();
      if (ca) return -1;
      if (cb) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [employees, search, conversationByEmployeeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!selectedId && sortedEmployees.length > 0) setSelectedId(sortedEmployees[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedEmployees.length]);

  const selectedEmployee = employees.find((e) => e.id === selectedId) ?? null;
  const thread = useMemo(
    () =>
      selectedId
        ? messages
            .filter((m) => (m.sender_employee_id === selectedId && m.recipient_employee_id === meId) || (m.sender_employee_id === meId && m.recipient_employee_id === selectedId))
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        : [],
    [messages, selectedId, meId]
  );

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread.length, selectedId]);

  // Mark read whenever the open conversation has unread incoming messages.
  useEffect(() => {
    if (!selectedId) return;
    const hasUnread = thread.some((m) => m.recipient_employee_id === meId && !m.read_at);
    if (!hasUnread) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages((prev) =>
      prev.map((m) => (m.sender_employee_id === selectedId && m.recipient_employee_id === meId && !m.read_at ? { ...m, read_at: new Date().toISOString() } : m))
    );
    markConversationRead(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, thread.length]);

  useEffect(() => {
    const channel = supabase
      .channel(`dm-inbox-${meId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_employee_id=eq.${meId}` },
        ({ new: row }) => {
          const m = row as DirectMessage;
          setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, meId]);

  function handleSend() {
    if (!selectedId) return;
    if (!body.trim() && !file) return;
    setSendError(null);
    const formData = new FormData();
    formData.set("recipient_employee_id", selectedId);
    formData.set("body", body.trim());
    if (file) formData.set("file", file);
    const sentBody = body;
    const sentFile = file;
    setBody("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    startTransition(async () => {
      const result = await sendMessage(formData);
      if (result.error) {
        setSendError(result.error);
        setBody(sentBody);
        setFile(sentFile);
        return;
      }
      if (result.message) setMessages((prev) => [...prev, result.message!]);
    });
  }

  return (
    <div className="flex h-full overflow-hidden rounded-xl border border-slate-200 bg-white">
      {/* Employee list */}
      <div className="flex w-72 shrink-0 flex-col border-r border-slate-200">
        <div className="border-b border-slate-100 p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people..."
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {sortedEmployees.map((e) => {
            const conv = conversationByEmployeeId.get(e.id);
            const active = e.id === selectedId;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setSelectedId(e.id)}
                className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition ${active ? "bg-amber-50" : "hover:bg-slate-50"}`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                  {initialsOf(e.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-800">{e.name}</span>
                    {conv && <span className="shrink-0 text-[10px] text-slate-400">{formatTime(conv.last.created_at)}</span>}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-400">
                      {conv ? (conv.last.body ?? (conv.last.attachment_name ? `📎 ${conv.last.attachment_name}` : "")) : `${e.role_name} · ${e.company_name}`}
                    </span>
                    {conv && conv.unread > 0 && (
                      <span className="shrink-0 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">{conv.unread}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
          {sortedEmployees.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-400">No employees found.</p>}
        </div>
      </div>

      {/* Thread */}
      <div className="flex flex-1 flex-col">
        {selectedEmployee ? (
          <>
            <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                {initialsOf(selectedEmployee.name)}
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-800">{selectedEmployee.name}</div>
                <div className="text-xs text-slate-400">
                  {selectedEmployee.role_name} · {selectedEmployee.company_name}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-50 px-4 py-3">
              {thread.length === 0 && <p className="mt-6 text-center text-sm text-slate-400">No messages yet — say hi 👋</p>}
              <div className="space-y-2">
                {thread.map((m) => {
                  const mine = m.sender_employee_id === meId;
                  const isImage = (m.attachment_mime ?? "").startsWith("image/");
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                          mine ? "rounded-br-sm bg-amber-500 text-white" : "rounded-bl-sm border border-slate-200 bg-white text-slate-800"
                        }`}
                      >
                        {m.body && <p className="whitespace-pre-line">{m.body}</p>}
                        {m.attachment_name &&
                          (isImage ? (
                            <a href={`/api/message-attachment/${m.id}`} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element -- attachment is a private, gated proxy URL, not eligible for next/image's remote-domain optimization */}
                              <img src={`/api/message-attachment/${m.id}`} alt={m.attachment_name} className="mt-1 max-h-56 rounded-lg" />
                            </a>
                          ) : (
                            <a
                              href={`/api/message-attachment/${m.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className={`mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs ${mine ? "bg-amber-600/40" : "bg-slate-100"}`}
                            >
                              📎 <span className="truncate">{m.attachment_name}</span>
                              <span className="opacity-70">({formatBytes(m.attachment_size_bytes)})</span>
                            </a>
                          ))}
                        <div className={`mt-1 text-right text-[10px] ${mine ? "text-amber-100" : "text-slate-400"}`}>{formatTime(m.created_at)}</div>
                      </div>
                    </div>
                  );
                })}
                <div ref={threadEndRef} />
              </div>
            </div>

            <div className="border-t border-slate-100 p-3">
              {sendError && <p className="mb-1.5 text-xs text-red-600">{sendError}</p>}
              {file && (
                <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                  📎 {file.name}
                  <button type="button" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="text-slate-400 hover:text-red-600">
                    ✕
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach a file/photo"
                  className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-500 hover:bg-slate-50"
                >
                  📎
                </button>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  rows={1}
                  placeholder="Type a message..."
                  className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={isPending || (!body.trim() && !file)}
                  className="shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Pick someone to message.</div>
        )}
      </div>
    </div>
  );
}
