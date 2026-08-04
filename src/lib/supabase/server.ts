// Server-side Supabase client — for use inside Server Components, Server
// Actions, and Route Handlers. Reads/writes the auth cookie via Next.js's
// `cookies()` API so the logged-in session survives across requests.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component (not a Server Action/Route
            // Handler) — cookies() is read-only there. Safe to ignore as
            // long as middleware.ts also refreshes the session (it does).
          }
        },
      },
    }
  );
}

// Service-role client — bypasses Row Level Security entirely. Only ever use
// this in Server Functions/Route Handlers that have ALREADY verified the
// caller's identity and capability (see lib/auth/require-capability.ts) —
// this is the direct equivalent of the old system's requireCapability_()
// re-check on every privileged Code.gs call, and must not be skipped.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createServiceRoleClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
