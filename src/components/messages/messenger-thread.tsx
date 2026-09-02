"use client";

// Messenger popup — reusable thread view + composer, shared by both a 1:1
// direct thread and a group thread inside messenger-popup.tsx. Loads its
// own message history lazily, only once this specific thread is opened
// (see popup-actions.ts's header comment on why the popup avoids the full
// page's "load everything up front" pattern), and keeps its own small
// real-time subscription scoped to just this one conversation — separate
// from the popup shell's badge-only subscription (messenger-popup.tsx) and
// from the full /dashboard/messages page's own subscription
// (messages-client.tsx). Three independent listeners on the same tables is
// normal in this app; RLS is what actually scopes what each one receives.
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { sendMessage, deleteMessage, markConversationRead, type DirectMessage } from "@/app/dashboard/messages/actions";
import {
  sendGroupMessage,
  deleteGroupMessage,
  markGroupConversationRead,
  leaveGroupConversation,
  renameGroupConversation,
  addGroupMembers,
  type ConversationMessage,
} from "@/app/dashboard/messages/group-actions";
import { getDirectThreadMessages, getGroupThreadMessages, getGroupMembers, type GroupMemberInfo } from "@/app/dashboard/messages/popup-actions";
import { Avatar, formatTime, formatBytes } from "./messenger-shared";

type UnifiedMessage = {
  id: string;
  sender_employee_id: string;
  body: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size_bytes: number | null;
  created_at: string;
};

function toUnified(list: (DirectMessage | ConversationMessage)[]): UnifiedMessage[] {
  return list.map((m) => ({
    id: m.id,
    sender_employee_id: m.sender_employee_id,
    body: m.body,
    attachment_name: m.attachment_name,
    attachment_mime: m.attachment_mime,
    attachment_size_bytes: m.attachment_size_bytes,
    created_at: m.created_at,
  }));
}

export function MessengerThread({
  meId,
  kind,
  threadId,
  title,
  employeesById,
  onBack,
  onLeft,
  onRenamed,
}: {
  meId: string;
  kind: "direct" | "group";
  threadId: string; // other employee id (direct) or conversation id (group)
  title: string;
  employeesById: Record<string, { name: string; photo_url: string | null }>;
  onBack: () => void;
  onLeft?: () => void; // group only — called after leaving, so the popup can drop this thread and go back to the list
  onRenamed?: (newTitle: string) => void; // group only
}) {
  const [messages, setMessages] = useState<UnifiedMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [members, setMembers] = useState<GroupMemberInfo[]>([]);
  const [showMembers, setShowMembers] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(title);
  const [addingMembers, setAddingMembers] = useState(false);
  const [pickedNewMembers, setPickedNewMembers] = useState<Set<string>>(new Set());
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const supabase = useMemo(() => createClient(), []);

  const otherEmployee = kind === "direct" ? employeesById[threadId] : null;

  useEffect(() => {
    let cancelled = false;
    // Resetting to "loading" the moment threadId/kind changes (rather than
    // waiting for the fetch below to resolve) is deliberate — otherwise a
    // fast re-open of a DIFFERENT thread would briefly render the PREVIOUS
    // thread's now-stale messages/mark-read effect. Same accepted pattern
    // as messages-client.tsx's own effect-body setState calls.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoaded(false);
    (async () => {
      const data = kind === "direct" ? await getDirectThreadMessages(threadId) : await getGroupThreadMessages(threadId);
      if (cancelled) return;
      setMessages(toUnified(data));
      setLoaded(true);
      if (kind === "group") {
        const m = await getGroupMembers(threadId);
        if (!cancelled) setMembers(m);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, threadId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Mark read once the thread's history has loaded — mirrors
  // messages-client.tsx's own "opening the thread implies reading it" rule.
  useEffect(() => {
    if (!loaded) return;
    if (kind === "direct") markConversationRead(threadId);
    else markGroupConversationRead(threadId);
  }, [loaded, kind, threadId]);

  useEffect(() => {
    if (kind === "direct") {
      const channel = supabase
        .channel(`messenger-thread-direct-${meId}-${threadId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_employee_id=eq.${meId}` },
          ({ new: row }) => {
            const m = row as DirectMessage;
            if (m.sender_employee_id !== threadId) return; // this channel only cares about this one counterpart
            setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
            markConversationRead(threadId);
          }
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "direct_messages", filter: `recipient_employee_id=eq.${meId}` },
          ({ old: row }) => {
            const id = (row as { id?: string }).id;
            if (id) setMessages((prev) => prev.filter((m) => m.id !== id));
          }
        )
        .subscribe();
      return () => {
        supabase.removeChannel(channel);
      };
    }

    // Group: conversation_id=eq.value is a single-column filter, so — unlike
    // the popup shell's badge subscription, which has to watch every
    // conversation at once with no filter — this one can scope itself to
    // exactly this thread.
    const channel = supabase
      .channel(`messenger-thread-group-${threadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_messages", filter: `conversation_id=eq.${threadId}` },
        ({ new: row }) => {
          const m = row as ConversationMessage;
          if (m.sender_employee_id === meId) return; // own sends are already added optimistically below
          setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
          markGroupConversationRead(threadId);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "conversation_messages", filter: `conversation_id=eq.${threadId}` },
        ({ old: row }) => {
          const id = (row as { id?: string }).id;
          if (id) setMessages((prev) => prev.filter((m) => m.id !== id));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, meId, kind, threadId]);

  function handleDelete(messageId: string) {
    const removed = messages.find((m) => m.id === messageId) ?? null;
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    startTransition(async () => {
      const result = kind === "direct" ? await deleteMessage(messageId) : await deleteGroupMessage(messageId);
      if (result.error) {
        setSendError(result.error);
        if (removed) setMessages((prev) => (prev.some((m) => m.id === removed.id) ? prev : [...prev, removed]));
      }
    });
  }

  function handleSend() {
    if (!body.trim() && !file) return;
    setSendError(null);
    const formData = new FormData();
    if (kind === "direct") formData.set("recipient_employee_id", threadId);
    formData.set("body", body.trim());
    if (file) formData.set("file", file);
    const sentBody = body;
    const sentFile = file;
    setBody("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    startTransition(async () => {
      const result = kind === "direct" ? await sendMessage(formData) : await sendGroupMessage(threadId, formData);
      if (result.error) {
        setSendError(result.error);
        setBody(sentBody);
        setFile(sentFile);
        return;
      }
      if (result.message) setMessages((prev) => [...prev, result.message!]);
    });
  }

  function handleRename() {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === title) {
      setRenaming(false);
      return;
    }
    startTransition(async () => {
      const result = await renameGroupConversation(threadId, trimmed);
      if (result.error) {
        setSendError(result.error);
        return;
      }
      onRenamed?.(trimmed);
      setRenaming(false);
    });
  }

  function handleLeave() {
    startTransition(async () => {
      const result = await leaveGroupConversation(threadId);
      if (result.error) {
        setSendError(result.error);
        return;
      }
      onLeft?.();
    });
  }

  function handleAddMembers() {
    const ids = Array.from(pickedNewMembers);
    if (ids.length === 0) {
      setAddingMembers(false);
      return;
    }
    startTransition(async () => {
      const result = await addGroupMembers(threadId, ids);
      if (result.error) {
        setSendError(result.error);
        return;
      }
      const updated = await getGroupMembers(threadId);
      setMembers(updated);
      setPickedNewMembers(new Set());
      setAddingMembers(false);
    });
  }

  const nonMemberEmployees = useMemo(() => {
    const memberIds = new Set(members.map((m) => m.employeeId));
    return Object.entries(employeesById)
      .filter(([id]) => id !== meId && !memberIds.has(id))
      .map(([id, e]) => ({ id, name: e.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [employeesById, members, meId]);

  const attachmentBase = kind === "direct" ? "/api/message-attachment" : "/api/group-message-attachment";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
        <button type="button" onClick={onBack} className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Back">
          ←
        </button>
        {kind === "direct" ? (
          <Avatar name={otherEmployee?.name ?? "?"} photoUrl={otherEmployee?.photo_url ?? null} size={8} />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm">👥</div>
        )}
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              onBlur={handleRename}
              maxLength={80}
              className="w-full rounded border border-amber-400 px-1.5 py-0.5 text-sm outline-none"
            />
          ) : (
            <div
              className={`truncate text-sm font-semibold text-slate-800 ${kind === "group" ? "cursor-pointer hover:underline" : ""}`}
              onClick={() => kind === "group" && setRenaming(true)}
              title={kind === "group" ? "Click to rename" : undefined}
            >
              {title}
            </div>
          )}
          {kind === "group" && <div className="truncate text-xs text-slate-400">{members.length} member{members.length === 1 ? "" : "s"}</div>}
        </div>
        {kind === "group" && (
          <button
            type="button"
            onClick={() => setShowMembers((v) => !v)}
            className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Group members"
          >
            ⋮
          </button>
        )}
      </div>

      {kind === "group" && showMembers && (
        <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs">
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {members.map((m) => (
              <span key={m.employeeId} className="rounded-full bg-white px-2 py-0.5 text-slate-600 shadow-sm">
                {m.name}
                {m.employeeId === meId ? " (you)" : ""}
              </span>
            ))}
          </div>
          {!addingMembers ? (
            <div className="flex gap-3">
              <button type="button" onClick={() => setAddingMembers(true)} className="font-medium text-amber-600 hover:underline">
                + Add members
              </button>
              <button type="button" onClick={handleLeave} className="font-medium text-red-600 hover:underline">
                Leave group
              </button>
            </div>
          ) : (
            <div className="max-h-32 overflow-y-auto rounded border border-slate-200 bg-white p-1.5">
              {nonMemberEmployees.length === 0 && <p className="px-1 py-1 text-slate-400">Everyone&apos;s already in this group.</p>}
              {nonMemberEmployees.map((e) => (
                <label key={e.id} className="flex items-center gap-1.5 px-1 py-0.5 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={pickedNewMembers.has(e.id)}
                    onChange={(ev) =>
                      setPickedNewMembers((prev) => {
                        const next = new Set(prev);
                        if (ev.target.checked) next.add(e.id);
                        else next.delete(e.id);
                        return next;
                      })
                    }
                  />
                  {e.name}
                </label>
              ))}
              <div className="mt-1 flex gap-2 border-t border-slate-100 pt-1">
                <button type="button" onClick={handleAddMembers} disabled={isPending} className="font-medium text-amber-600 hover:underline disabled:opacity-50">
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddingMembers(false);
                    setPickedNewMembers(new Set());
                  }}
                  className="text-slate-400 hover:underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto bg-slate-50 px-3 py-2.5">
        {loaded && messages.length === 0 && <p className="mt-4 text-center text-sm text-slate-400">No messages yet — say hi 👋</p>}
        <div className="space-y-2">
          {messages.map((m) => {
            const mine = m.sender_employee_id === meId;
            const isImage = (m.attachment_mime ?? "").startsWith("image/");
            const senderName = kind === "group" && !mine ? employeesById[m.sender_employee_id]?.name : null;
            return (
              <div key={m.id} className={`group flex items-center gap-1.5 ${mine ? "justify-end" : "justify-start"}`}>
                {mine && (
                  <button
                    type="button"
                    onClick={() => handleDelete(m.id)}
                    title="Unsend"
                    className="shrink-0 rounded-full p-1 text-xs text-slate-300 opacity-0 transition hover:bg-slate-200 hover:text-red-600 group-hover:opacity-100"
                  >
                    🗑
                  </button>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl px-2.5 py-1.5 text-sm shadow-sm ${
                    mine ? "rounded-br-sm bg-amber-500 text-white" : "rounded-bl-sm border border-slate-200 bg-white text-slate-800"
                  }`}
                >
                  {senderName && <div className="mb-0.5 text-[10px] font-semibold text-amber-600">{senderName}</div>}
                  {m.body && <p className="whitespace-pre-line">{m.body}</p>}
                  {m.attachment_name &&
                    (isImage ? (
                      <a href={`${attachmentBase}/${m.id}`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element -- private gated proxy URL */}
                        <img src={`${attachmentBase}/${m.id}`} alt={m.attachment_name} className="mt-1 max-h-40 rounded-lg" />
                      </a>
                    ) : (
                      <a
                        href={`${attachmentBase}/${m.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className={`mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ${mine ? "bg-amber-600/40" : "bg-slate-100"}`}
                      >
                        📎 <span className="truncate">{m.attachment_name}</span>
                        <span className="opacity-70">({formatBytes(m.attachment_size_bytes)})</span>
                      </a>
                    ))}
                  <div className={`mt-0.5 text-right text-[10px] ${mine ? "text-amber-100" : "text-slate-400"}`}>{formatTime(m.created_at)}</div>
                </div>
              </div>
            );
          })}
          <div ref={threadEndRef} />
        </div>
      </div>

      <div className="border-t border-slate-100 p-2.5">
        {sendError && <p className="mb-1 text-xs text-red-600">{sendError}</p>}
        {file && (
          <div className="mb-1 flex items-center gap-2 rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600">
            📎 {file.name}
            <button type="button" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="text-slate-400 hover:text-red-600">
              ✕
            </button>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach a file/photo"
            className="shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
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
            className="flex-1 resize-none rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={isPending || (!body.trim() && !file)}
            className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
