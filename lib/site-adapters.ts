// Beyond the Supabase Auth login, some apps require a row in their own
// authorization table or they behave wrong (sign the user out, or drop them to
// the lowest role). Each app that needs one declares it here, so the
// provisioning engine stays generic and the per-app quirk lives in one place.

import type { SupabaseClient } from "@supabase/supabase-js";

type HubUser = { email: string; full_name: string | null; role: string };

export type AdapterContext = {
  // Admin (service-role) client for THIS app's Supabase project.
  admin: SupabaseClient;
  // The person's user id inside THIS app's Supabase Auth (not the hub id).
  authUserId: string;
  user: HubUser;
};

export type SiteAdapter = {
  // Simple case: one row in `profileTable`, matched/deduped by email.
  profileTable?: string;
  buildRow?: (u: HubUser) => Record<string, unknown>;
  // Complex case: full control. Given the app's admin client and the person's
  // auth id in this app, make whatever authorization records the app needs
  // (multi-table, FK lookups, id-keyed rows). Runs instead of profileTable.
  apply?: (ctx: AdapterContext) => Promise<void>;
};

// Map a hub role onto an app's own role vocabulary.
const isAdmin = (r: string) => ["admin", "owner", "super_admin"].includes(r);

// HRMS speaks a different role vocabulary (the values in its `roles` table).
function hrmsRoleName(r: string): string {
  if (isAdmin(r)) return "Admin";
  if (r === "manager") return "HR";
  return "Employee";
}

export const SITE_ADAPTERS: Record<string, SiteAdapter> = {
  // CMS authenticates with Supabase Auth but then requires an hr_users row
  // (looked up by email) — without it, AuthContext signs the user out.
  cms: {
    profileTable: "hr_users",
    buildRow: (u) => ({
      email: u.email,
      name: u.full_name || u.email,
      role: isAdmin(u.role) ? "admin" : "hr",
      // hr_users has a password column (unused for auth — CMS logs in via
      // Supabase Auth); set a placeholder so a NOT NULL constraint is happy.
      password: "via-supabase-auth",
    }),
  },

  // HRMS reads a user's role from user_roles → roles(name), keyed by the auth
  // user id (NOT email). A user with no row still gets in as "Employee", so
  // this adapter exists to grant the *right* role, not to avoid a sign-out.
  // It looks up the role_id by name, then links it to the auth user id.
  hrms: {
    apply: async ({ admin, authUserId, user }) => {
      if (!authUserId) {
        throw new Error("could not resolve the HRMS auth user id");
      }
      const roleName = hrmsRoleName(user.role);

      const { data: role, error: roleErr } = await admin
        .from("roles")
        .select("id")
        .eq("name", roleName)
        .maybeSingle();
      if (roleErr) throw new Error(`roles lookup failed: ${roleErr.message}`);
      if (!role) throw new Error(`HRMS has no "${roleName}" role defined`);

      // Already linked to this role? Nothing to do. (user_roles is keyed by
      // user_id here, and has a UNIQUE(user_id, role_id)-style shape.)
      const { data: existing } = await admin
        .from("user_roles")
        .select("id")
        .eq("user_id", authUserId)
        .eq("role_id", (role as { id: string }).id)
        .maybeSingle();
      if (existing) return;

      const { error: insErr } = await admin
        .from("user_roles")
        .insert({ user_id: authUserId, role_id: (role as { id: string }).id });
      if (insErr) throw new Error(`user_roles insert failed: ${insErr.message}`);
    },
  },

  // Sales CRM uses pure Supabase Auth — no extra row needed (no entry here).
};
