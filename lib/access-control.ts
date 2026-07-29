import { createClient } from "@/lib/supabase/server";
import { siteAdminClient, siteServiceKey } from "@/lib/sites";
import { SITE_ADAPTERS } from "@/lib/site-adapters";

// Cryptographically strong temporary password, readable enough to hand over.
function tempPassword(): string {
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const a = "abcdefghijkmnpqrstuvwxyz";
  const d = "23456789";
  const s = "!@#$%";
  const pool = A + a + d;
  let out = A[bytes[0] % A.length] + d[bytes[1] % d.length] + s[bytes[2] % s.length];
  for (let i = 3; i < 6; i++) out += pool[bytes[i] % pool.length];
  return out + Math.floor(1000 + (bytes[0] % 9000));
}

async function log(
  eventType: string,
  actorId: string,
  targetUserId: string,
  appName: string,
  metadata: Record<string, unknown>
) {
  const supabase = createClient();
  await supabase.from("audit_logs").insert({
    user_id: targetUserId,
    event_type: eventType,
    app_name: appName,
    metadata: { ...metadata, by: actorId },
  });
}

type Site = { id: string; name: string; display_name: string; supabase_url: string };

async function loadSite(siteId: string): Promise<Site | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("connected_sites")
    .select("id, name, display_name, supabase_url")
    .eq("id", siteId)
    .maybeSingle();
  return (data as Site) ?? null;
}

async function loadUser(userId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("user_profiles")
    .select("id, email, full_name, role")
    .eq("id", userId)
    .maybeSingle();
  return data;
}

/**
 * Grant a hub user access to one app: create (or re-enable) their login in
 * that app's Supabase Auth, mirror their profile, and record it. Returns a
 * temp password when a fresh login was created, so the admin can hand it over.
 */
export async function provisionAccess(actorId: string, userId: string, siteId: string) {
  const [site, user] = await Promise.all([loadSite(siteId), loadUser(userId)]);
  if (!site) throw Object.assign(new Error("Unknown site."), { status: 404 });
  if (!user) throw Object.assign(new Error("Unknown user."), { status: 404 });

  const admin = siteAdminClient(site.supabase_url, site.name);
  if (!admin) {
    throw Object.assign(
      new Error(`${site.display_name} has no service key configured. Add SITE_SERVICE_KEY_${site.name.toUpperCase()} in the hub's environment.`),
      { status: 400 }
    );
  }

  let tempPw: string | null = null;
  // Match on EMAIL, not the hub id: an app may already have this person under
  // its own id (an account created before the hub existed). Forcing the hub id
  // would collide on the unique email and fail. So find by email; only create
  // a fresh login when there genuinely isn't one.
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = (list?.users ?? []).find(
    (u: any) => String(u.email ?? "").toLowerCase() === user.email.toLowerCase()
  );

  if (existing) {
    // Already has a login here — just make sure it isn't suspended.
    await admin.auth.admin.updateUserById(existing.id, { ban_duration: "none" });
  } else {
    tempPw = tempPassword();
    const { error } = await admin.auth.admin.createUser({
      email: user.email,
      password: tempPw,
      email_confirm: true,
      user_metadata: { full_name: user.full_name, role: user.role },
    });
    if (error && !/already/i.test(error.message)) {
      throw Object.assign(new Error(`Could not create login in ${site.display_name}: ${error.message}`), { status: 500 });
    }
  }

  // Some apps need a row in their own authorization table (e.g. CMS's
  // hr_users) or they reject the login. Write it if this app declares one.
  const adapter = SITE_ADAPTERS[site.name];
  if (adapter) {
    const { data: already } = await admin
      .from(adapter.profileTable)
      .select("email")
      .eq("email", user.email)
      .maybeSingle();
    if (!already) {
      const { error: rowErr } = await admin.from(adapter.profileTable).insert(
        adapter.buildRow({ email: user.email, full_name: user.full_name, role: user.role })
      );
      if (rowErr) {
        throw Object.assign(
          new Error(`Login created in ${site.display_name}, but its ${adapter.profileTable} record failed: ${rowErr.message}`),
          { status: 500 }
        );
      }
    }
  }

  // Record the grant centrally.
  const central = createClient();
  await central.from("app_access").upsert(
    {
      user_id: user.id,
      app_name: site.name,
      access_granted: true,
      granted_by: actorId,
      granted_at: new Date().toISOString(),
      revoked_at: null,
    },
    { onConflict: "user_id,app_name" }
  );
  await log("access.provisioned", actorId, user.id, site.name, { email: user.email, created: Boolean(tempPw) });

  return { ok: true, site: site.display_name, tempPassword: tempPw };
}

/**
 * Revoke a hub user's access to one app: disable their login there (kept, not
 * deleted, so history and ownership survive) and record it.
 */
export async function revokeAccess(actorId: string, userId: string, siteId: string) {
  const [site, user] = await Promise.all([loadSite(siteId), loadUser(userId)]);
  if (!site) throw Object.assign(new Error("Unknown site."), { status: 404 });
  if (!user) throw Object.assign(new Error("Unknown user."), { status: 404 });

  const admin = siteAdminClient(site.supabase_url, site.name);
  if (!admin) {
    throw Object.assign(
      new Error(`${site.display_name} has no service key configured.`),
      { status: 400 }
    );
  }

  // Suspend the login rather than delete it — deleting would orphan whatever
  // records in the app point at this user. "banned forever" is a duration.
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = (list?.users ?? []).find(
    (u: any) => String(u.email ?? "").toLowerCase() === user.email.toLowerCase()
  );
  if (existing) {
    await admin.auth.admin.updateUserById(existing.id, { ban_duration: "876000h" });
  }

  const central = createClient();
  await central.from("app_access").upsert(
    {
      user_id: user.id,
      app_name: site.name,
      access_granted: false,
      revoked_at: new Date().toISOString(),
    },
    { onConflict: "user_id,app_name" }
  );
  await log("access.revoked", actorId, user.id, site.name, { email: user.email });

  return { ok: true, site: site.display_name };
}

/** The access matrix: every hub user, and which apps they currently hold. */
export async function accessMatrix() {
  const supabase = createClient();
  const [{ data: users }, { data: sites }, { data: grants }] = await Promise.all([
    supabase.from("user_profiles").select("id, email, full_name, role").order("email"),
    supabase.from("connected_sites").select("id, name, display_name").eq("is_active", true).order("name"),
    supabase.from("app_access").select("user_id, app_name, access_granted, revoked_at"),
  ]);

  const granted = new Set(
    (grants ?? [])
      .filter((g: any) => g.access_granted && !g.revoked_at)
      .map((g: any) => `${g.user_id}:${g.app_name}`)
  );

  return {
    sites: sites ?? [],
    configured: (sites ?? []).map((s: any) => ({ name: s.name, connected: Boolean(siteServiceKey(s.name)) })),
    users: (users ?? []).map((u: any) => ({
      ...u,
      access: (sites ?? []).map((s: any) => ({
        siteId: s.id,
        name: s.name,
        display_name: s.display_name,
        hasAccess: granted.has(`${u.id}:${s.name}`),
      })),
    })),
  };
}
