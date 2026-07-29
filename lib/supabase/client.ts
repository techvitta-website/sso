import { createBrowserClient } from "@supabase/ssr";

// Browser Supabase client. Shares the same cookie-based session the server
// reads, so a sign-in on the client is immediately visible to server code.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
