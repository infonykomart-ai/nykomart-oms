// Refreshes the Supabase auth session on every request and redirects signed-
// out users away from anything under /dashboard — the Next.js equivalent of
// the old system's verifyLogin() gate that ran before every screen loaded.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const response = NextResponse.next();

  // Internal Next.js runtime routes, including Server Action fetches, must
  // bypass this auth proxy so they can preserve the required request shape.
  if (request.nextUrl.pathname.startsWith("/_next")) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
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
    return NextResponse.redirect(loginUrl);
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
      return NextResponse.redirect(new URL("/login", request.url));
    }

    if (request.nextUrl.pathname === "/login") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
