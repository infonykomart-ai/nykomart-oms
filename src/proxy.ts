// Refreshes the Supabase auth session on every request and redirects signed-
// out users away from anything under /dashboard — the Next.js equivalent of
// the old system's verifyLogin() gate that ran before every screen loaded.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Copies every Set-Cookie collected on `from` onto `to` — needed because a
// redirect response is a NEW NextResponse object; without this, a token
// Supabase just refreshed (or a signOut() clearing) would be silently
// dropped whenever this middleware also redirects, and the browser would
// keep sending the STALE cookie forever.
function withCookies(to: NextResponse, from: NextResponse): NextResponse {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie));
  return to;
}

export async function proxy(request: NextRequest) {
  // Internal Next.js runtime routes, including Server Action fetches, must
  // bypass this auth proxy so they can preserve the required request shape.
  if (request.nextUrl.pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  // 2026-10-19 — "agar dialog box me open ho to sirf page hi open ho, puri
  // ki puri window open nahi ho": a dialog that previews a dashboard page
  // in an <iframe> (the Orders hub's View button, every Print button's A4
  // preview) used to pull in the WHOLE app shell — sidebar, header, module
  // tabs — around the one page it was asked for. ?embed=1 now forwards an
  // x-embed header to the request, and dashboard/layout.tsx skips just the
  // chrome (providers stay mounted, so the page still works identically).
  // Purely a header flip — auth, redirects and cookie refreshes below are
  // byte-for-byte unchanged.
  if (request.nextUrl.searchParams.get("embed") === "1") {
    request.headers.set("x-embed", "1");
  }

  // 2026-10-20 — PUBLIC PAGES DON'T NEED A SESSION RESOLVED ("system thoda
  // slow chl rha hai"). This ran on EVERY matched path, so even the public
  // landing page paid two network round-trips — auth.getUser() (a call to
  // the Auth server, not a local JWT check) plus the employees lookup below —
  // before it could start rendering, usually for a visitor who has no session
  // at all. Only /dashboard (the gate), /login (bounces an employee who is
  // already signed in) and /api/* (whose handlers expect the refreshed auth
  // cookies) actually need the result; everything else returns untouched.
  // No behaviour change on those three: the code below is byte-for-byte the
  // same, it just no longer runs for pages that ignore it.
  const pathname = request.nextUrl.pathname;
  const needsSession =
    pathname.startsWith("/dashboard") || pathname === "/login" || pathname.startsWith("/api");
  if (!needsSession) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // 2026-10-17 — MISSING-CONFIG GUARD. createServerClient() below throws
  // ("Your project's URL and Key are required to create a Supabase client!")
  // when either value is absent, and because this middleware matches every
  // non-asset route, that throw turned EVERY request — including the public
  // landing page and /login itself — into an opaque HTTP 500. There is no
  // session to refresh and no user to resolve without those two values, so
  // the honest behaviour is:
  //   - fail CLOSED on protected routes (a signed-out visitor can never be
  //     waved through to /dashboard by a config gap), and
  //   - let public pages render normally, with a loud server-side error so
  //     the misconfiguration is still impossible to miss in the logs.
  // When both values ARE set (production, and any properly configured
  // environment) this branch is skipped entirely and the session flow below
  // is byte-for-byte the original.
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      "[proxy] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set — " +
        "skipping Supabase session refresh. Protected routes redirect to /login; public pages still render."
    );
    if (request.nextUrl.pathname.startsWith("/dashboard")) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirectTo", request.nextUrl.pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // This is the official @supabase/ssr middleware pattern, not a
  // simplification of it: `response` gets REBUILT from the mutated
  // `request` inside setAll (not just cookies.set() on the original
  // response) so that if getUser() triggers a token refresh mid-request,
  // the rest of this function — and Supabase's own internal re-reads via
  // getAll() — see the NEW cookies immediately. Skipping this rebuild was
  // tried once already (2026-08-05) to fix an unrelated Server Action
  // issue and it silently broke session persistence instead: getUser()'s
  // refresh would write new cookies that never made it back into
  // `request.cookies`, so a subsequent getAll() inside the same call kept
  // handing Supabase the stale token, which it then treated as invalid and
  // cleared — logging every user straight back out right after login.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith("/dashboard")) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", request.nextUrl.pathname);
    return withCookies(NextResponse.redirect(loginUrl), response);
  }

  // A Supabase Auth session existing is NOT the same as "this is a real
  // employee" — a login can be created in Authentication -> Users before
  // (or without) a matching active `employees` row. Bouncing every
  // authenticated user away from /login used to skip this check entirely:
  // that user would then hit /dashboard, dashboard/layout.tsx's
  // getAuthedEmployee() would throw, its catch redirect()s back to /login,
  // and THIS middleware would immediately bounce them back to /dashboard —
  // an infinite ERR_TOO_MANY_REDIRECTS loop. Checking here breaks the loop
  // by signing out a session that can never resolve to a real employee.
  if (user) {
    const { data: employee } = await supabase
      .from("employees")
      .select("id")
      .eq("auth_user_id", user.id)
      .eq("active", true)
      .maybeSingle();

    if (!employee) {
      await supabase.auth.signOut();
      if (request.nextUrl.pathname === "/login") return response;
      return withCookies(NextResponse.redirect(new URL("/login", request.url)), response);
    }

    if (request.nextUrl.pathname === "/login") {
      return withCookies(NextResponse.redirect(new URL("/dashboard", request.url)), response);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
