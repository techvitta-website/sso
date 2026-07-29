import { createClient } from "@supabase/supabase-js";

// The hub provisions logins into each app using that app's service_role key.
// Those keys are read from environment variables — one per site — so the
// most powerful secrets never sit in the shared connected_sites table where
// a single DB read would expose every app. Set in Vercel as:
//   SITE_SERVICE_KEY_SALES, SITE_SERVICE_KEY_HRMS, SITE_SERVICE_KEY_CMS, ...
export function siteServiceKey(siteName: string): string | null {
  const key = process.env[`SITE_SERVICE_KEY_${siteName.toUpperCase()}`];
  return key && key.length > 20 ? key : null;
}

// An admin client for a target app, or null if that app has no service key
// configured yet (so the UI can show "not connected" rather than crash).
export function siteAdminClient(siteUrl: string, siteName: string) {
  const key = siteServiceKey(siteName);
  if (!key || !siteUrl) return null;
  return createClient(siteUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
