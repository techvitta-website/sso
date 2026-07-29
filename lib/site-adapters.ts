// Beyond the Supabase Auth login, some apps require a row in their own
// authorization table or they sign the user right back out. Each app that
// needs one declares it here, so the provisioning engine stays generic and
// the per-app quirk lives in one place.

type HubUser = { email: string; full_name: string | null; role: string };

export type SiteAdapter = {
  // The app's own authorization table, matched by email.
  profileTable: string;
  // Build the row to write for this person.
  buildRow: (u: HubUser) => Record<string, unknown>;
};

// Map a hub role onto an app's own role vocabulary.
const isAdmin = (r: string) => ["admin", "owner", "super_admin"].includes(r);

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
  // Sales CRM uses pure Supabase Auth — no extra row needed (no entry here).
  // HRMS will get its adapter once we confirm its login model.
};
