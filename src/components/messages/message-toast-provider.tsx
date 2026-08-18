"use client";

// 2026-08-18 — "jisko msg karte hai to uske pass notification nahi jaata
// to jese instagram facebook par bubble aata hai vese option dikhao": a
// new incoming direct_messages row already bumps the header 💬 badge
// (messages-header-link.tsx) and appears live in the Messages page thread
// (messages-client.tsx) — but neither is a "bubble" that surfaces on
// whatever OTHER page the recipient happens to be on. This adds that: a
// small popup card, bottom-right, on every dashboard page, reusing the
// exact same Realtime Postgres Changes subscription pattern (RLS-scoped
// server-side to this employee's own rows). Suppressed while already
// sitting on /dashboard/messages, since the badge + live thread already
// cover that case and a bubble on top of the person you're actively
// chatting with would just be noise.
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type ToastItem = {
  id: string;
  senderName: string;
  senderPhotoUrl: string | null;
  preview: string;
};

type EmployeeLite = { name: string; photo_url: string | null };

function initialsOf(name: string): string {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

export function MessageToastProvider({
  meId,
  employeesById,
}: {
  meId: string;
  employeesById: Record<string, EmployeeLite>;
}) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const onMessagesPageRef = useRef(pathname === "/dashboard/messages");
  useEffect(() => {
    onMessagesPageRef.current = pathname === "/dashboard/messages";
  }, [pathname]);

  useEffect(() => {
    const channel = supabase
      .channel(`dm-toast-${meId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_employee_id=eq.${meId}` },
        ({ new: row }) => {
          if (onMessagesPageRef.current) return;
          const m = row as { id: string; sender_employee_id: string; body: string | null; attachment_name: string | null };
          const sender = employeesById[m.sender_employee_id];
          const toast: ToastItem = {
            id: m.id,
            senderName: sender?.name ?? "Someone",
            senderPhotoUrl: sender?.photo_url ?? null,
            preview: m.body || (m.attachment_name ? `📎 ${m.attachment_name}` : "New message"),
          };
          setToasts((prev) => [...prev, toast]);
          setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== toast.id));
          }, 6000);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, meId, employeesById]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => {
            setToasts((prev) => prev.filter((x) => x.id !== t.id));
            router.push("/dashboard/messages");
          }}
          className="pointer-events-auto flex w-72 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-lg transition hover:shadow-xl"
        >
          {t.senderPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={t.senderPhotoUrl} alt={t.senderName} className="h-9 w-9 shrink-0 rounded-full object-cover" />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-700">
              {initialsOf(t.senderName)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{t.senderName}</p>
            <p className="truncate text-xs text-slate-500">{t.preview}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
