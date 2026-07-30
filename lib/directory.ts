// ─────────────────────────────────────────────────────────────
// Centralized user + role directory.
//
// Every connected app keeps its own users (Supabase Auth) and its own role
// model. This module reaches into each app with that app's service key, reads
// its real logins and roles, and folds them into one directory keyed by email
// so the hub can see "who has a login where, and as what role" in one place.
//
// It also mirrors a snapshot into the Master `app_user_directory` table so the
// picture is tracked/persisted, not just computed on the fly.
//
// Role models per app (confirmed from each app's schema):
//   sales → public.users.role          (owner | manager | salesman)
//   cms   → public.hr_users.role        (admin | hr | editor | author | user), by email
//   hrms  → user_roles.role_id → roles.name (Admin | HR | Employee | Client), by auth id
// ─────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { siteAdminClient, siteServiceKey } from "@/lib/sites";
import { tempPassword } from "@/lib/access-control";

export type DirectoryUser = {
  email: string;
  appUserId: string;
  role: string | null;
  status: "active" | "suspended";
  lastSignIn: string | null;
  createdAt: string | null;
};

function isSuspended(u: any): boolean {
  const b = u?.banned_until;
  if (!b) return false;
  const t = new Date(b).getTime();
  return Number.isFinite(t) && t > Date.now();
}

// Read a role map for one app, keyed by auth-user id and/or email. Tolerant:
// if the role table is missing/renamed, users still list, just role-less.
async function rolesForApp(admin: SupabaseClient, appName: string) {
  const byId = new Map<string, string>();
  const byEmail = new Map<string, string>();
  try {
    if (appName === "sales") {
      const { data } = await admin.from("users").select("id, email, role");
      for (const r of (data ?? []) as any[]) {
        if (r.id) byId.set(r.id, r.role);
        if (r.email) byEmail.set(String(r.email).toLowerCase(), r.role);
      }
    } else if (appName === "cms") {
      const { data } = await admin.from("hr_users").select("email, role");
      for (const r of (data ?? []) as any[]) {
        if (r.email) byEmail.set(String(r.email).toLowerCase(), r.role);
      }
    } else if (appName === "hrms") {
      const { data } = await admin.from("user_roles").select("user_id, roles(name)");
      for (const r of (data ?? []) as any[]) {
        const name = Array.isArray(r.roles) ? r.roles[0]?.name : r.roles?.name;
        if (r.user_id && name) byId.set(r.user_id, name);
      }
    }
  } catch {
    /* role table absent — leave maps empty */
  }
  return { byId, byEmail };
}

async function listAppUsers(admin: SupabaseClient, appName: string): Promise<DirectoryUser[]> {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const authUsers = (data?.users ?? []) as any[];
  const { byId, byEmail } = await rolesForApp(admin, appName);
  return authUsers.map((u) => ({
    email: u.email ?? "",
    appUserId: u.id,
    role: byId.get(u.id) ?? byEmail.get(String(u.email ?? "").toLowerCase()) ?? null,
    status: isSuspended(u) ? "suspended" : "active",
    lastSignIn: u.last_sign_in_at ?? null,
    createdAt: u.created_at ?? null,
  }));
}

export type Person = {
  email: string;
  apps: Record<string, { role: string | null; status: string; lastSignIn: string | null; appUserId: string }>;
};

/** Live-read every connected app's users+roles and fold them by email. */
export async function buildDirectory() {
  const central = createClient();
  const { data: sites } = await central
    .from("connected_sites")
    .select("id, name, display_name, supabase_url")
    .eq("is_active", true)
    .order("name");

  const siteList = (sites ?? []) as any[];
  const configured = siteList.map((s) => ({ name: s.name, connected: Boolean(siteServiceKey(s.name)) }));

  const byEmail = new Map<string, Person>();
  const snapshotRows: any[] = [];
  const stamp = new Date().toISOString();

  for (const site of siteList) {
    const admin = siteAdminClient(site.supabase_url, site.name);
    if (!admin) continue;
    let users: DirectoryUser[] = [];
    try {
      users = await listAppUsers(admin, site.name);
    } catch {
      continue;
    }
    for (const u of users) {
      const key = u.email.toLowerCase();
      if (!key) continue;
      if (!byEmail.has(key)) byEmail.set(key, { email: u.email, apps: {} });
      byEmail.get(key)!.apps[site.name] = {
        role: u.role,
        status: u.status,
        lastSignIn: u.lastSignIn,
        appUserId: u.appUserId,
      };
      snapshotRows.push({
        email: u.email,
        app_name: site.name,
        app_user_id: u.appUserId,
        role: u.role,
        status: u.status,
        last_sign_in: u.lastSignIn,
        synced_at: stamp,
      });
    }
  }

  const people = Array.from(byEmail.values()).sort((a, b) => a.email.localeCompare(b.email));
  return {
    sites: siteList.map((s) => ({ id: s.id, name: s.name, display_name: s.display_name })),
    configured,
    people,
    snapshotRows,
  };
}

/** Best-effort mirror of the live directory into Master for tracking/history. */
export async function persistSnapshot(snapshotRows: any[]) {
  if (!snapshotRows.length) return;
  const central = createClient();
  try {
    await central.from("app_user_directory").upsert(snapshotRows, { onConflict: "email,app_name" });
  } catch {
    /* table not created yet — the live directory still renders */
  }
}

/** Reset a person's password inside one app, using that app's service key. */
export async function resetAppPassword(actorId: string, email: string, appName: string) {
  const central = createClient();
  const { data: site } = await central
    .from("connected_sites")
    .select("name, display_name, supabase_url")
    .eq("name", appName)
    .maybeSingle();
  if (!site) throw Object.assign(new Error("Unknown app."), { status: 404 });

  const admin = siteAdminClient((site as any).supabase_url, (site as any).name);
  if (!admin) {
    throw Object.assign(
      new Error(`${(site as any).display_name} has no service key configured.`),
      { status: 400 }
    );
  }

  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = (list?.users ?? []).find(
    (u: any) => String(u.email ?? "").toLowerCase() === email.toLowerCase()
  );
  if (!user) {
    throw Object.assign(
      new Error(`No login for ${email} in ${(site as any).display_name}.`),
      { status: 404 }
    );
  }

  const temp = tempPassword();
  const { error } = await admin.auth.admin.updateUserById(user.id, { password: temp });
  if (error) throw Object.assign(new Error(`Could not reset password: ${error.message}`), { status: 500 });

  await central.from("audit_logs").insert({
    user_id: null,
    event_type: "password.reset",
    app_name: appName,
    metadata: { email, by: actorId },
  });

  return { ok: true, app: (site as any).display_name, tempPassword: temp };
}
