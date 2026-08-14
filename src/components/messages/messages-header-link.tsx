"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Header 💬 icon + live unread badge. Initial count is computed
// server-side (dashboard/layout.tsx); bumped in real time via the same
// Postgres Changes subscription pattern as the Messages page itself, and
// cleared while the employee is actually sitting on /dashboard/messages
// (that page marks conversations read as they're opened).
export function MessagesHeaderLink({ meId, initialUnreadCount }: { meId: string; initialUnreadCount: number }) {
  const [count, setCount] = useState(initialUnreadCount);
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);
  const onMessagesPage = pathname === "/dashboard/messages";
  // The Postgres Changes subscription below is set up once (it must not
  // resubscribe on every navigation) — a ref lets its callback always see
  // the CURRENT pathname rather than closing over the value from when the
  // subscription was first created. Refs must only be written inside an
  // effect/event handler, never during render, so this is its own effect.
  const onMessagesPageRef = useRef(onMessagesPage);
  useEffect(() => {
    onMessagesPageRef.current = onMessagesPage;
  }, [onMessagesPage]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (onMessagesPage) setCount(0);
  }, [onMessagesPage]);

  useEffect(() => {
    const channel = supabase
      .channel(`dm-header-badge-${meId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_employee_id=eq.${meId}` },
        () => {
          setCount((c) => (onMessagesPageRef.current ? c : c + 1));
        }
      )
      // If a message gets unsent before it was ever read, don't leave the
      // badge overcounting it forever — REPLICA IDENTITY FULL (see
      // db/2026-08-14n-...sql) means the DELETE payload's old row still has
      // read_at, so this only decrements for messages that were unread.
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "direct_messages", filter: `recipient_employee_id=eq.${meId}` },
        ({ old: row }) => {
          const wasUnread = (row as { read_at?: string | null }).read_at == null;
          if (wasUnread) setCount((c) => Math.max(0, c - 1));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, meId]);

  return (
    <Link href="/dashboard/messages" className="relative flex h-9 w-9 items-center justify-center rounded-full text-lg transition hover:bg-slate-100" title="Messages">
      💬
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
