import { createClient } from "@/lib/supabase/server";

// Drop-in replacements for Clerk's auth()/currentUser(), backed by the
// Supabase session. Lets the existing API routes keep their shape while the
// identity now comes from Supabase Auth on the Master project. getUser()
// re-validates the JWT against Supabase on every call — never trust the
// cookie's contents blindly.
export async function auth() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { userId: user?.id ?? null, user };
}

export async function currentUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
