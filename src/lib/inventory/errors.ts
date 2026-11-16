// Pure error-message translation for the Inventory module. Kept separate from
// service.ts so the test suite can import it without loading Next.js
// server-only modules (cookies/headers) through the Supabase client.
export function friendlyDbError(message: string): string {
  const m = message
    .replace(/^.*?INSUFFICIENT_STOCK:\s*/, "Not enough stock — ")
    .replace(/^.*?INSUFFICIENT_READY:\s*/, "Not enough ready stock — ")
    .replace(/^.*?duplicate key value violates unique constraint "[^"]*"/, "This entry already exists")
    .replace(/\s+/g, " ")
    .trim();
  return m || "The database rejected that change.";
}
