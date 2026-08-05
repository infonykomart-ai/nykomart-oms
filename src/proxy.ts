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

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

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
