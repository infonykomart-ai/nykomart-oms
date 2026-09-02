"use client";

// Messenger-style popup (2026-09-02) — "massaging option jo hai vo right
// corner me bhi nikal ke aaskata hai jese facebook massenger hota hai full
// window or split windo wright me". Mounted once in dashboard/layout.tsx,
// alongside (not instead of) the existing full-page /dashboard/messages
// and its own MessageToastProvider — this is purely additive. Two display
// modes once opened: a compact bottom-right popup window (like Messenger's
// own chat heads) or an expanded panel docked to the right edge of the
// screen, full viewport height ("split windo wright").
//
// Badge counts are seeded from dashboard/layout.tsx's own cheap
// count()/RPC queries (same pattern as MessagesHeaderLink's
// initialUnreadCount) and then kept live by two small real-time
// subscriptions here — see the per-table comments below for why each is
// shaped the way it is. The conversation list itself (previews) is fetched
// lazily, only when the popup is actually opened, matching the "cheap at
// layout level, heavier only on demand" split documented in
// popup-actions.ts.
import { useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { getConversationPreviews, getUnreadCounts, type ConversationPreview } from "@/app/dashboard/messages/popup-actions";
import type { DirectMessage } from "@/app/dashboard/messages/actions";
import type { ConversationMessage } from "@/app/dashboard/messages/group-actions";
import { MessengerThread } from "./messenger-thread";
import { MessengerNewConversation } from "./messenger-new-conversation";
import { Avatar, formatTime } from "./messenger-shared";

type EmployeeInfo = { name: string; photo_url: string | null };
type ActiveThread = { kind: "direct" | "group"; id: string; title: string };
type View = "list" | "thread" | "new";

export function MessengerPopup({
  meId,
  employeesById,
  initialDirectUnread,
  initialGroupUnread,
}: {
  meId: string;
  employeesById: Record<string, EmployeeInfo>;
  initialDirectUnread: number;
  initialGroupUnread: number;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<View>("list");
  const [activeThread, setActiveThread] = useState<ActiveThread | null>(null);
  const [previews, setPreviews] = useState<ConversationPreview[] | null>(null);
  const [loadingPreviews, startLoadingPreviews] = useTransition();
  const [directUnread, setDirectUnread] = useState(initialDirectUnread);
  const [groupUnread, setGroupUnread] = useState(initialGroupUnread);
  // Lazy useState initializer (not useMemo, not a ref read during render) —
  // the supported way to construct a value exactly once per mount. See
  // messages-client.tsx / message-toast-provider.tsx, which both use
  // useMemo(() => createClient(), []) for the same one-time-construction
  // need; useState's lazy form is used here instead since this project's
  // eslint config (react-hooks/refs) additionally flags reading a ref's
  // .current during render, which an earlier draft of this helper did.
  const [supabase] = useState(() => createClient());

  // Refs so the always-mounted real-time subscriptions below can see the
  // CURRENT open/activeThread values inside a callback that was set up
  // once on mount — same ref pattern messages-header-link.tsx already uses
  // for onMessagesPageRef, for the same reason (the subscription itself
  // must not be torn down and rebuilt on every state change).
  const openRef = useRef(open);
  const activeThreadRef = useRef(activeThread);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    activeThreadRef.current = activeThread;
  }, [activeThread]);

  function refreshPreviews() {
    startLoadingPreviews(async () => {
      const data = await getConversationPreviews();
      setPreviews(data);
    });
  }

  function resyncUnreadCounts() {
    getUnreadCounts().then(({ direct, group }) => {
      setDirectUnread(direct);
      setGroupUnread(group);
    });
  }

  function toggleOpen() {
    setOpen((wasOpen) => {
      const nowOpen = !wasOpen;
      if (nowOpen) refreshPreviews();
      return nowOpen;
    });
  }

  function openThread(kind: "direct" | "group", id: string, title: string) {
    setActiveThread({ kind, id, title });
    setView("thread");
    setOpen(true);
  }

  // Badge subscription 1/2 — direct messages. Same single-column filter
  // messages-header-link.tsx already relies on (recipient_employee_id=eq.
  // meId), so this is safe and cheap. Suppressed while that exact thread is
  // the one currently open, since MessengerThread's own subscription is
  // already marking those as read live.
  // Badge subscription 2/2 — group messages. conversation_messages has no
  // single column that identifies "one of MY conversations", so (as noted
  // in db/2026-09-02-group-messaging.sql) this subscribes with NO filter at
  // all and leans entirely on the SELECT RLS policy to only ever deliver
  // rows for conversations this employee is actually a member of.
  useEffect(() => {
    const directChannel = supabase
      .channel(`messenger-badge-direct-${meId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_employee_id=eq.${meId}` },
        ({ new: row }) => {
          const m = row as DirectMessage;
          const at = activeThreadRef.current;
          const isOpenHere = openRef.current && at?.kind === "direct" && at.id === m.sender_employee_id;
          if (!isOpenHere) setDirectUnread((c) => c + 1);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "direct_messages", filter: `recipient_employee_id=eq.${meId}` },
        ({ old: row }) => {
          const wasUnread = (row as { read_at?: string | null }).read_at == null;
          if (wasUnread) setDirectUnread((c) => Math.max(0, c - 1));
        }
      )
      .subscribe();

    const groupChannel = supabase
      .channel(`messenger-badge-group-${meId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversation_messages" }, ({ new: row }) => {
        const m = row as ConversationMessage;
        if (m.sender_employee_id === meId) return;
        const at = activeThreadRef.current;
        const isOpenHere = openRef.current && at?.kind === "group" && at.id === m.conversation_id;
        if (!isOpenHere) setGroupUnread((c) => c + 1);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(directChannel);
      supabase.removeChannel(groupChannel);
    };
  }, [supabase, meId]);

  const combinedUnread = directUnread + groupUnread;

  function handleBack() {
    setActiveThread(null);
    setView("list");
    refreshPreviews();
    resyncUnreadCounts();
  }

  // 2026-09-02 — bottom-24/right-24, NOT right-6: the existing Help Center
  // widget (help-center-provider.tsx) already owns "bottom-24 right-6" for
  // its own panel. Sharing that exact spot meant the two panels would
  // render on top of each other if a person opened both — this keeps the
  // Messenger panel anchored above its own bubble (see the button below,
  // also moved off right-6 for the same reason) instead of colliding.
  const panelSizeClasses = expanded
    ? "fixed inset-y-0 right-0 z-50 w-full max-w-md border-l border-slate-200 shadow-2xl"
    : "fixed bottom-24 right-24 z-50 h-[30rem] w-96 max-w-[calc(100vw-3rem)] rounded-xl border border-slate-200 shadow-2xl";

  return (
    <>
      {open && (
        <div className={`${panelSizeClasses} flex flex-col overflow-hidden bg-white`}>
          <div className="flex items-center justify-between border-b border-slate-100 bg-amber-500 px-3 py-2 text-white">
            <span className="text-sm font-semibold">💬 Messenger</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                title={expanded ? "Collapse" : "Expand to full-height panel"}
                className="rounded p-1 text-white/90 hover:bg-white/20"
              >
                {expanded ? "⤡" : "⤢"}
              </button>
              <button type="button" onClick={() => setOpen(false)} title="Close" className="rounded p-1 text-white/90 hover:bg-white/20">
                ✕
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1">
            {view === "list" && (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                  <span className="text-xs font-medium text-slate-400">{loadingPreviews ? "Loading…" : `${previews?.length ?? 0} conversations`}</span>
                  <button
                    type="button"
                    onClick={() => setView("new")}
                    className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-600 hover:bg-amber-100"
                  >
                    + New
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {(previews ?? []).map((p) => (
                    <button
                      key={`${p.kind}-${p.id}`}
                      type="button"
                      onClick={() => openThread(p.kind, p.id, p.title)}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50"
                    >
                      {p.kind === "direct" ? (
                        <Avatar name={p.title} photoUrl={employeesById[p.id]?.photo_url ?? null} size={9} />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-base">👥</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-slate-800">{p.title}</span>
                          <span className="shrink-0 text-[10px] text-slate-400">{formatTime(p.lastMessageAt)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-slate-400">{p.lastMessagePreview || "No messages yet"}</span>
                          {p.hasUnread && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />}
                        </div>
                      </div>
                    </button>
                  ))}
                  {previews && previews.length === 0 && !loadingPreviews && (
                    <p className="px-3 py-8 text-center text-sm text-slate-400">No conversations yet. Say hi with &ldquo;+ New&rdquo;.</p>
                  )}
                </div>
              </div>
            )}

            {view === "thread" && activeThread && (
              <MessengerThread
                meId={meId}
                kind={activeThread.kind}
                threadId={activeThread.id}
                title={activeThread.title}
                employeesById={employeesById}
                onBack={handleBack}
                onLeft={handleBack}
                onRenamed={(newTitle) => setActiveThread((t) => (t ? { ...t, title: newTitle } : t))}
              />
            )}

            {view === "new" && (
              <MessengerNewConversation
                meId={meId}
                employeesById={employeesById}
                onBack={() => setView("list")}
                onOpenDirect={(employeeId, name) => openThread("direct", employeeId, name)}
                onGroupCreated={(conversationId, name) => openThread("group", conversationId, name)}
              />
            )}
          </div>
        </div>
      )}

      {/* 2026-09-02 fix — right-24, NOT right-6: the pre-existing Help
          Center widget (help-center-provider.tsx) already sits at
          "fixed bottom-6 right-6 z-40" with the exact same size/shape/color
          (bg-amber-500, h-14 w-14). Sharing that spot meant Help Center's
          own button — which renders AFTER this one in the DOM, since
          HelpCenterProvider wraps this component as one of its children —
          painted directly on top of this button and silently ate every
          click. Root cause of "group option/split window not appearing":
          people were actually clicking the OLD Help Center bubble the
          whole time, this one was invisible underneath it. Sitting the two
          buttons side by side instead of stacked fixes that for good. */}
      <button
        type="button"
        onClick={toggleOpen}
        title="Messenger"
        className="fixed bottom-6 right-24 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-2xl text-white shadow-xl transition hover:bg-amber-600"
      >
        {open ? "✕" : "💬"}
        {!open && combinedUnread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-red-500 px-1 text-[11px] font-bold text-white">
            {combinedUnread > 99 ? "99+" : combinedUnread}
          </span>
        )}
      </button>
    </>
  );
}

