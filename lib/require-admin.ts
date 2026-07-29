import { createClient } from "@/lib/supabase/server";

export type Actor = { id: string; email: string; role: string };

// Resolves the signed-in user and confirms they may administer access.
// Throws (caught by the routes as 401/403) otherwise. The role is read from
// the Master user_profiles table, never trusted from the client.
export async function requireAdmin(): Promise<Actor> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw Object.assign(new Error("Sign in required."), { status: 401 });
  }
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role, email")
    .eq("id", user.id)
    .maybeSingle();

  const role = String(profile?.role ?? "");
  if (!["admin", "owner", "super_admin"].includes(role)) {
    throw Object.assign(new Error("Administrator access required."), { status: 403 });
  }
  return { id: user.id, email: profile?.email ?? user.email ?? "", role };
}
