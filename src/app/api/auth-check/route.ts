import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 2026-09-13 — tiny session probe for the dashboard error boundary (see
// dashboard/error.tsx). When a dashboard page render fails with the auth
// boundary's friendly screen, the boundary needs to know WHICH failure it
// was: a real "session expired" (→ auto-redirect to /login instead of a
// dead-end "Try again" that can never succeed) or a transient Supabase
// blip while still signed in (→ the Try again screen is correct as-is).
//
// Deliberately CHEAP and deliberately session-only: it checks
// supabase.auth.getUser() and nothing else — no employee lookup, no
// capabilities (getAuthedEmployee's full query fan-out is irrelevant for
// "is there a live login at all", and this endpoint may be hit right after
// an error, so it must not be able to fail for the same reasons the page
// did). The auth/expired-vs-blip distinction itself is made by the
// boundary's redirect:"manual" fetch — see error.tsx.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
