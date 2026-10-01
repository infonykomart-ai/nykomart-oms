"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { hasOpenPunchToday, punchOutOnLogout } from "@/app/dashboard/attendance/actions";

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
        //
        // 2026-10-01: "SAAM KO ... LOGOUT KARNE KA OPTION AAJE JIS SE PUNCH
        // OUT HO JAYE; AGAR LOGOUT NAHI KARE TO PUNCH OUT NAHI HOYE" —
        // when today's punch is still open, ask FIRST (explicit evening
        // punch-out option); cancelling logs out WITHOUT punching out.
        // No open punch → straight logout, no nagging dialog.
        const openPunch = await hasOpenPunchToday().catch(() => false);
        if (
          openPunch &&
          !window.confirm(
            "Aaj ka Punch In abhi open hai.\nLogout karne par abhi ka Punch Out (time abhi) record ho jayega.\n\nContinue?"
          )
        ) {
          return;
        }
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
