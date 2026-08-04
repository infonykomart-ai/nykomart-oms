// Browser-side Supabase client — for use inside Client Components ("use client").
// Uses the public anon key only; Row Level Security policies (see db/schema.sql,
// to be added once auth strategy is finalized) are what keep this safe to expose.
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
