import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedEmployee } from "@/lib/auth/require-capability";

// 2026-09-13 — tiny session probe for the dashboard error boundary (see
// dashboard/error.tsx). When a dashboard page render fails with the auth
// boundary's friendly screen, the boundary needs to know WHICH failure it
// was: a real "session expired" (→ auto-redirect to /login instead of a
// dead-end "Try again" that can never succeed) or a transient Supabase
// blip while still signed in (→ the Try again screen is correct as-is).
//
// Deliberately CHEAP and session-only by default: it checks
// supabase.auth.getUser() and nothing else — no employee lookup, no
// capabilities (getAuthedEmployee's full query fan-out is irrelevant for
// "is there a live login at all", and this endpoint may be hit right after
// an error, so it must not be able to fail for the same reasons the page
// did). The auth/expired-vs-blip distinction itself is made by the
// boundary's redirect:"manual" fetch — see error.tsx.
//
// 2026-10-03 — "id logout vala issue start ho jata hai": every page whose
// role lacks its capability throws ForbiddenError, which fell through to
// the same boundary and read as "session expired / Sign in" — a silent
// logout that wasn't one. The boundary now also asks WHICH capabilities
// this path needs (?capability=a,b,c — resolved client-side from
// CAPABILITY_INFO, see error.tsx) and this endpoint answers 403 when the
// signed-in employee has NONE of them, so the boundary can render a real
// "Access Denied" card instead of the misleading sign-in screen. Any
// failure while resolving the employee here degrades to the plain
// session-only answer (never a false denial).
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const capabilityParam = req.nextUrl.searchParams.get("capability");
  if (!capabilityParam || !capabilityParam.trim()) {
    return NextResponse.json({ ok: true });
  }
  const wanted = capabilityParam
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (wanted.length === 0) return NextResponse.json({ ok: true });

  try {
    const employee = await getAuthedEmployee();
    const hasAny = wanted.some((c) => employee.capabilities.includes(c));
    if (!hasAny) {
      return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ ok: true, roleName: employee.roleName });
  } catch {
    // Signed in (getUser passed) but the full employee fan-out failed or
    // redirected (MFA edge) — never report a denial we couldn't actually
    // establish; the boundary falls back to its generic Try-again screen.
    return NextResponse.json({ ok: true });
  }
}
