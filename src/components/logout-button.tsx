"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { punchOutOnLogout } from "@/app/dashboard/attendance/actions";

export function LogoutButton() {
  const router = useRouter();
  const supabase = createClient();

  return (
    <button
      onClick={async () => {
        // 2026-08-11: "LOGOUT KARTE HI PUNCH OUT" — while the session is
        // still valid, before signing out. Best-effort: logout proceeds
        // regardless of what this does (see punchOutOnLogout's own
        // comment) — attendance must never trap someone in a signed-in
        // state just because a write failed.
        await punchOutOnLogout().catch(() => {});
        await supabase.auth.signOut();
        router.push("/login");
        router.refresh();
      }}
      className="oms-icon-btn rounded-lg border border-[var(--oms-surface-border)] px-3 py-1.5 text-sm font-medium text-[var(--oms-text-muted)] hover:text-[var(--oms-text)]"
    >
      Logout
    </button>
  );
}
