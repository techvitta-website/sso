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
  apps: Record<string, { role: string | null; status: string; lastSignIn: string | null; appUserId: string; online: boolean }>;
};

export type AppSummary = {
  name: string;
  display_name: string;
  url: string | null;
  connected: boolean;      // service key configured
  reachable: boolean;      // we successfully listed its users (DB healthy)
  users: number;
  active: number;
  suspended: number;
  activeSessions: number;  // users with a live login session right now
  lastActivity: string | null;
};

/** Live-read every connected app's users+roles and fold them by email. */
export async function buildDirectory() {
  const central = createClient();
  const { data: sites } = await central
    .from("connected_sites")
    .select("id, name, display_name, url, supabase_url")
    .eq("is_active", true)
    .order("name");

  const siteList = (sites ?? []) as any[];
  const configured = siteList.map((s) => ({ name: s.name, connected: Boolean(siteServiceKey(s.name)) }));

  const byEmail = new Map<string, Person>();
  const snapshotRows: any[] = [];
  const appSummaries: AppSummary[] = [];
  const stamp = new Date().toISOString();

  for (const site of siteList) {
    const admin = siteAdminClient(site.supabase_url, site.name);
    const summary: AppSummary = {
      name: site.name,
      display_name: site.display_name,
      url: site.url ?? null,
      connected: Boolean(admin),
      reachable: false,
      users: 0,
      active: 0,
      suspended: 0,
      activeSessions: 0,
      lastActivity: null,
    };

    if (!admin) {
      appSummaries.push(summary);
      continue;
    }

    let users: DirectoryUser[] = [];
    try {
      users = await listAppUsers(admin, site.name);
      summary.reachable = true;
    } catch {
      appSummaries.push(summary);
      continue;
    }

    // Who has a live login session in this app right now (best-effort: needs
    // the sso_active_sessions() function installed in the app DB).
    const onlineEmails = new Set<string>();
    try {
      const { data: sess } = await admin.rpc("sso_active_sessions");
      for (const r of (sess ?? []) as any[]) if (r?.email) onlineEmails.add(String(r.email).toLowerCase());
    } catch { /* function not installed in this app yet */ }
    summary.activeSessions = onlineEmails.size;

    summary.users = users.length;
    for (const u of users) {
      if (u.status === "suspended") summary.suspended++;
      else summary.active++;
      if (u.lastSignIn && (!summary.lastActivity || u.lastSignIn > summary.lastActivity)) {
        summary.lastActivity = u.lastSignIn;
      }

      const key = u.email.toLowerCase();
      if (!key) continue;
      if (!byEmail.has(key)) byEmail.set(key, { email: u.email, apps: {} });
      byEmail.get(key)!.apps[site.name] = {
        role: u.role,
        status: u.status,
        lastSignIn: u.lastSignIn,
        appUserId: u.appUserId,
        online: onlineEmails.has(key),
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
    appSummaries.push(summary);
  }

  const people = Array.from(byEmail.values()).sort((a, b) => a.email.localeCompare(b.email));
  return {
    sites: siteList.map((s) => ({ id: s.id, name: s.name, display_name: s.display_name })),
    configured,
    appSummaries,
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

// Each app's own role vocabulary — what the SSO console can assign.
export const APP_ROLES: Record<string, string[]> = {
  sales: ["owner", "manager", "salesman"],
  cms: ["admin", "hr", "editor", "author", "user"],
  hrms: ["Admin", "HR", "Employee", "Client"],
};

// Resolve site + admin client + the app's auth user for one email. Shared by
// every management action so the "which app / has a login?" checks live once.
async function appContext(appName: string, email: string) {
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
  return { central, site: site as any, admin, user };
}

/**
 * Set a person's password inside one app. If `password` is given (>= 6 chars)
 * it's used verbatim; otherwise a random temporary one is generated and
 * returned so the admin can hand it over.
 */
export async function resetAppPassword(actorId: string, email: string, appName: string, password?: string) {
  const { central, site, admin, user } = await appContext(appName, email);
  const custom = typeof password === "string" && password.trim().length >= 6;
  const pw = custom ? password!.trim() : tempPassword();
  const { error } = await admin.auth.admin.updateUserById(user.id, { password: pw });
  if (error) throw Object.assign(new Error(`Could not set password: ${error.message}`), { status: 500 });
  await central.from("audit_logs").insert({
    user_id: null, event_type: "password.reset", app_name: appName, metadata: { email, custom, by: actorId },
  });
  // Never echo a chosen password back (the admin already has it); only return
  // the generated temp one.
  return { ok: true, app: site.display_name, tempPassword: custom ? null : pw, custom };
}

// Low-level: write a role into an app's OWN authorization model. `authId` is
// the user's id in that app's Supabase Auth. Runs with the app's service key,
// so it hits the app's real database directly (bypasses RLS) — authorization
// changes take effect in that app immediately.
async function writeAppRole(admin: SupabaseClient, appName: string, email: string, authId: string, role: string) {
  if (appName === "sales") {
    const { data: existing } = await admin.from("users").select("id").eq("id", authId).maybeSingle();
    const res = existing
      ? await admin.from("users").update({ role }).eq("id", authId)
      : await admin.from("users").insert({ id: authId, email, role });
    if (res.error) throw new Error(`Sales role write failed: ${res.error.message}`);
  } else if (appName === "cms") {
    const { data: existing } = await admin.from("hr_users").select("id").eq("email", email).maybeSingle();
    const res = existing
      ? await admin.from("hr_users").update({ role }).eq("email", email)
      : await admin.from("hr_users").insert({ id: authId, email, name: email, role, password: "via-supabase-auth" });
    if (res.error) throw new Error(`CMS role write failed: ${res.error.message}`);
  } else if (appName === "hrms") {
    const { data: roleRow } = await admin.from("roles").select("id").eq("name", role).maybeSingle();
    if (!roleRow) throw new Error(`HRMS has no "${role}" role defined.`);
    await admin.from("user_roles").delete().eq("user_id", authId);
    const res = await admin.from("user_roles").insert({ user_id: authId, role_id: (roleRow as any).id });
    if (res.error) throw new Error(`HRMS role write failed: ${res.error.message}`);
  }
}

/** Change a person's role inside one app, written to that app's own role model. */
export async function setAppRole(actorId: string, email: string, appName: string, role: string) {
  const allowed = APP_ROLES[appName];
  if (!allowed) throw Object.assign(new Error(`${appName} has no managed roles.`), { status: 400 });
  if (!allowed.includes(role)) {
    throw Object.assign(new Error(`Invalid role "${role}" for ${appName}. Allowed: ${allowed.join(", ")}.`), { status: 400 });
  }
  const { central, site, admin, user } = await appContext(appName, email);
  try {
    await writeAppRole(admin, appName, email, user.id, role);
  } catch (e: any) {
    throw Object.assign(new Error(e.message), { status: 500 });
  }
  await central.from("audit_logs").insert({
    user_id: null, event_type: "role.changed", app_name: appName, metadata: { email, role, by: actorId },
  });
  return { ok: true, app: site.display_name, role };
}

// Create (or re-enable) a login for one email inside one app and set its role —
// writing to that app's real Auth + role table via its service key.
async function provisionToApp(central: any, actorId: string, email: string, fullName: string | null, appName: string, role: string) {
  const allowed = APP_ROLES[appName];
  if (role && allowed && !allowed.includes(role)) {
    throw Object.assign(new Error(`Invalid role "${role}" for ${appName}.`), { status: 400 });
  }
  const { data: site } = await central
    .from("connected_sites").select("name, display_name, supabase_url").eq("name", appName).maybeSingle();
  if (!site) throw Object.assign(new Error("Unknown app."), { status: 404 });
  const admin = siteAdminClient(site.supabase_url, site.name);
  if (!admin) throw Object.assign(new Error(`${site.display_name} has no service key configured.`), { status: 400 });

  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = (list?.users ?? []).find((u: any) => String(u.email ?? "").toLowerCase() === email.toLowerCase());
  let tempPw: string | null = null;

  if (!user) {
    tempPw = tempPassword();
    const { data: created, error } = await admin.auth.admin.createUser({
      email, password: tempPw, email_confirm: true, user_metadata: { full_name: fullName },
    });
    if (error && !/already/i.test(error.message)) {
      throw Object.assign(new Error(`Could not create login in ${site.display_name}: ${error.message}`), { status: 500 });
    }
    user = created?.user ?? undefined;
    if (!user) {
      const { data: relist } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      user = (relist?.users ?? []).find((u: any) => String(u.email ?? "").toLowerCase() === email.toLowerCase());
    }
  } else {
    await admin.auth.admin.updateUserById(user.id, { ban_duration: "none" });
  }
  if (!user) throw Object.assign(new Error(`Could not resolve the ${site.display_name} login.`), { status: 500 });

  if (role && allowed) await writeAppRole(admin, appName, email, user.id, role);

  await central.from("audit_logs").insert({
    user_id: null, event_type: "user.added", app_name: appName, metadata: { email, role, by: actorId },
  });
  return { app: appName, display_name: site.display_name, role: role || null, tempPassword: tempPw };
}

/** Add a user to one or more apps at once — real logins in each app's database. */
export async function addUser(
  actorId: string,
  email: string,
  fullName: string | null,
  targets: { app: string; role: string }[],
) {
  if (!email) throw Object.assign(new Error("Email is required."), { status: 400 });
  if (!targets?.length) throw Object.assign(new Error("Pick at least one app."), { status: 400 });
  const central = createClient();
  const results: any[] = [];
  for (const t of targets) {
    try {
      results.push(await provisionToApp(central, actorId, email, fullName, t.app, t.role));
    } catch (e: any) {
      results.push({ app: t.app, error: e.message });
    }
  }
  return { email, results };
}

/** Suspend or reactivate a person's login in one app. */
export async function setSuspended(actorId: string, email: string, appName: string, suspend: boolean) {
  const { central, site, admin, user } = await appContext(appName, email);
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    ban_duration: suspend ? "876000h" : "none",
  });
  if (error) throw Object.assign(new Error(`Could not update login: ${error.message}`), { status: 500 });
  await central.from("audit_logs").insert({
    user_id: null,
    event_type: suspend ? "access.suspended" : "access.reactivated",
    app_name: appName,
    metadata: { email, by: actorId },
  });
  return { ok: true, app: site.display_name, suspended: suspend };
}
