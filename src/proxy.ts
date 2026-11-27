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

// 2026-11-27 — CONTENT SECURITY POLICY, REPORT-ONLY FIRST (audit 3.11).
//
// The app shipped every other baseline security header (see next.config.ts) but
// no CSP at all, because App Router injects inline bootstrap scripts and a blind
// enforce would break the UI. So this ships the policy as
// `Content-Security-Policy-Report-Only`: nothing is blocked, the browser reports
// what WOULD have been blocked to /api/csp-report, and once the reports are clean
// the same value can be sent as the enforcing `Content-Security-Policy` header.
//
// The nonce is what makes an enforcing policy possible later: Next reads it from
// the request's CSP header (either the enforcing or the report-only one) and
// stamps it on its own scripts and inline styles automatically — no per-tag work
// here. `x-nonce` is exposed too for any Server Component that needs it.
//
// Vercel hosts this app behind HSTS, so `upgrade-insecure-requests` is left out;
// `style-src 'unsafe-inline'` stays because React inline style props and the
// Tailwind runtime are not nonce-aware — that is one of the things the
// report-only phase measures.
const CSP_REPORT_URI = "/api/csp-report";

function cspHeaderValue(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic' lets the nonce-carrying bootstrap load its own chunks.
    // React needs eval for its enhanced dev stack traces; production does not.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // Order photos and generated PDF/image previews come from marketplace hosts
    // and blobs, so https:/blob:/data: are allowed here (images only).
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "media-src 'self' blob: https:",
    // Dashboard pages are previewed in same-origin iframes (?embed=1).
    "frame-src 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `report-uri ${CSP_REPORT_URI}`,
  ];
  return directives.join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = cspHeaderValue(nonce);
  // Set on the REQUEST too: that is what Next parses to stamp the nonce on its
  // scripts, and what NextResponse.next({ request }) forwards to the render.
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy-Report-Only", policy);

  const response = await handleRequest(request);
  response.headers.set("Content-Security-Policy-Report-Only", policy);
  return response;
}

async function handleRequest(request: NextRequest) {
  // Internal Next.js runtime routes, including Server Action fetches, must
  // bypass this auth proxy so they can preserve the required request shape.
  if (request.nextUrl.pathname.startsWith("/_next")) {
    return NextResponse.next({ request });
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
    pathname.startsWith("/dashboard") ||
    pathname === "/login" ||
    // The CSP report endpoint is posted by the BROWSER, often with no session —
    // resolving auth for it only adds two round-trips to every violation.
    (pathname.startsWith("/api") && pathname !== CSP_REPORT_URI);
  if (!needsSession) {
    return NextResponse.next({ request });
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
    return NextResponse.next({ request });
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
