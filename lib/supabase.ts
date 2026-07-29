import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

// Server-side Supabase client bound to the caller's Supabase session.
// (Replaces the previous Clerk-JWT-template integration.)
export async function createSupabaseClient() {
  return createSupabaseServerClient();
}

export async function getSupabaseServerClient() {
  return createSupabaseServerClient();
}
