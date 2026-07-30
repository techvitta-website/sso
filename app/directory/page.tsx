"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HubShell } from "@/components/HubShell";

type AppState = { role: string | null; status: string; lastSignIn: string | null; appUserId: string; online: boolean };
type Person = { email: string; apps: Record<string, AppState> };
type Dir = {
  sites: { id: string; name: string; display_name: string }[];
  configured: { name: string; connected: boolean }[];
  appRoles: Record<string, string[]>;
  people: Person[];
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const d = Math.floor((Date.now() - t) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "1d ago";
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export default function DirectoryPage() {
  const [data, setData] = useState<Dir | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [appFilter, setAppFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [targets, setTargets] = useState<Record<string, { include: boolean; role: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/directory", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load.");
      setData(body);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const connected = (name: string) => data?.configured.find((c) => c.name === name)?.connected ?? false;

  const stats = useMemo(() => {
    if (!data) return { people: 0, logins: 0 };
    let logins = 0;
    for (const p of data.people) logins += Object.keys(p.apps).length;
    return { people: data.people.length, logins };
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.people.filter((p) => {
      if (q && !p.email.toLowerCase().includes(q)) return false;
      const names = appFilter === "all" ? Object.keys(p.apps) : (p.apps[appFilter] ? [appFilter] : []);
      if (appFilter !== "all" && names.length === 0) return false;
      if (appFilter !== "all" && roleFilter !== "all" && (p.apps[appFilter]?.role ?? "") !== roleFilter) return false;
      if (statusFilter !== "all" && !names.some((n) => p.apps[n].status === statusFilter)) return false;
      return true;
    });
  }, [data, query, appFilter, roleFilter, statusFilter]);

  async function resetPw(email: string, app: string, display: string) {
    if (!confirm(`Reset ${email}'s password in ${display}? A new temporary password will be generated.`)) return;
    setBusy(`${email}:${app}`);
    setError(null); setNotice(null);
    try {
      const res = await fetch("/api/directory/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, app }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed.");
      setNotice(`Reset ${email} in ${display}. Temporary password: ${body.tempPassword} — share it and ask them to change it.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(email: string, app: string, role: string, display: string) {
    if (!role) return;
    setBusy(`${email}:${app}`); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/directory/set-role", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, app, role }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed.");
      setNotice(`Set ${email} to ${role} in ${display}.`);
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }

  async function toggleSuspend(email: string, app: string, currentlySuspended: boolean, display: string) {
    const suspend = !currentlySuspended;
    if (!confirm(`${suspend ? "Suspend" : "Reactivate"} ${email} in ${display}?`)) return;
    setBusy(`${email}:${app}`); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/directory/suspend", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, app, suspend }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed.");
      setNotice(`${suspend ? "Suspended" : "Reactivated"} ${email} in ${display}.`);
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }

  async function submitAdd() {
    const picks = Object.entries(targets).filter(([, v]) => v.include).map(([app, v]) => ({ app, role: v.role }));
    if (!newEmail.trim() || picks.length === 0) { setError("Enter an email and pick at least one app."); return; }
    setBusy("add"); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/directory/add-user", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim(), fullName: newName.trim() || null, targets: picks }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed.");
      const lines = (body.results || []).map((r: any) =>
        r.error
          ? `${r.app}: ${r.error}`
          : `${r.display_name}: ${r.role || "no role"}${r.tempPassword ? ` (temp password ${r.tempPassword})` : " (existing login re-enabled)"}`
      );
      setNotice(`Added ${body.email} → ${lines.join(" · ")}`);
      setShowAdd(false); setNewEmail(""); setNewName(""); setTargets({});
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }

  async function grantApp(email: string, app: string, display: string) {
    const roles = data?.appRoles[app] || [];
    const role = roles[roles.length - 1] || "";
    if (!confirm(`Give ${email} a login in ${display}${role ? ` as ${role}` : ""}?`)) return;
    setBusy(`${email}:${app}`); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/directory/add-user", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, fullName: null, targets: [{ app, role }] }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed.");
      const r = (body.results || [])[0] || {};
      setNotice(r.error ? `${display}: ${r.error}` : `Granted ${email} → ${display}${r.tempPassword ? ` (temp password ${r.tempPassword})` : ""}.`);
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }

  return (
    <HubShell active="access">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Access &amp; Users</h1>
            <p className="text-sm text-slate-500">Every user across all connected apps — grant access, set roles, suspend, and reset passwords, all from here.</p>
          </div>
          <button onClick={() => setShowAdd((v) => !v)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            + Add user
          </button>
        </div>

        {showAdd && data && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 text-sm font-medium text-slate-700">Create a user in the apps you pick</div>
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email" type="email"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-slate-900" />
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name (optional)"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-slate-900" />
            </div>
            <div className="space-y-2">
              {data.sites.map((s) => {
                const roles = data.appRoles[s.name] || [];
                const t = targets[s.name] || { include: false, role: roles[roles.length - 1] || "" };
                return (
                  <div key={s.id} className="flex items-center gap-3 text-sm">
                    <label className="flex w-44 items-center gap-2">
                      <input type="checkbox" checked={t.include}
                        onChange={(e) => setTargets((p) => ({ ...p, [s.name]: { ...t, include: e.target.checked } }))} />
                      {s.display_name}
                    </label>
                    {roles.length > 0 && (
                      <select disabled={!t.include} value={t.role}
                        onChange={(e) => setTargets((p) => ({ ...p, [s.name]: { ...t, role: e.target.value } }))}
                        className="rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-40">
                        {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={submitAdd} disabled={busy === "add"}
                className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                {busy === "add" ? "Creating…" : "Create user"}
              </button>
              <button onClick={() => setShowAdd(false)} className="rounded-lg border border-slate-200 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
            </div>
          </div>
        )}

        {data && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {data.sites.map((s) => (
              <span key={s.id} className={`rounded-full border px-3 py-1 text-xs ${connected(s.name) ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                {s.display_name}: {connected(s.name) ? "connected" : "service key not set"}
              </span>
            ))}
            <span className="ml-auto text-xs text-slate-500">{stats.people} people · {stats.logins} logins</span>
            <button onClick={load} disabled={loading} className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        )}

        {data && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search email…"
              className="w-56 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-900"
            />
            <select value={appFilter} onChange={(e) => { setAppFilter(e.target.value); setRoleFilter("all"); }}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
              <option value="all">All apps</option>
              {data.sites.map((s) => <option key={s.id} value={s.name}>{s.display_name}</option>)}
            </select>
            {appFilter !== "all" && (data.appRoles[appFilter]?.length ?? 0) > 0 && (
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
                <option value="all">All roles</option>
                {data.appRoles[appFilter].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            )}
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
              <option value="all">Any status</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
            {(query || appFilter !== "all" || roleFilter !== "all" || statusFilter !== "all") && (
              <button onClick={() => { setQuery(""); setAppFilter("all"); setRoleFilter("all"); setStatusFilter("all"); }}
                className="text-xs text-slate-500 hover:text-slate-900">Clear</button>
            )}
            <span className="ml-auto text-xs text-slate-500">{filtered.length} of {stats.people}</span>
          </div>
        )}

        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
        {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{notice}</div>}

        {!data ? (
          <p className="text-slate-500">Loading the directory from every app…</p>
        ) : filtered.length === 0 ? (
          <p className="text-slate-500">No users match your filters.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-3">Person</th>
                  {data.sites.map((s) => <th key={s.id} className="px-4 py-3 text-left">{s.display_name}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.email} className="border-b border-slate-100 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{p.email}</div>
                      <div className="text-xs text-slate-400">{Object.keys(p.apps).length} app{Object.keys(p.apps).length === 1 ? "" : "s"}</div>
                    </td>
                    {data.sites.map((s) => {
                      const a = p.apps[s.name];
                      if (!a) {
                        const canGrant = connected(s.name);
                        return (
                          <td key={s.id} className="px-4 py-3">
                            <button
                              disabled={!canGrant || busy === `${p.email}:${s.name}`}
                              onClick={() => grantApp(p.email, s.name, s.display_name)}
                              title={canGrant ? "Create a login in this app" : "Service key not set for this app"}
                              className="rounded px-2 py-0.5 text-[11px] font-medium text-slate-400 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40"
                            >
                              {busy === `${p.email}:${s.name}` ? "…" : "+ Grant"}
                            </button>
                          </td>
                        );
                      }
                      const suspended = a.status === "suspended";
                      const key = `${p.email}:${s.name}`;
                      const roles = data.appRoles[s.name] || [];
                      const working = busy === key;
                      return (
                        <td key={s.id} className="px-4 py-3">
                          <div className="flex flex-col gap-1.5">
                            {roles.length ? (
                              <select
                                value={a.role ?? ""}
                                disabled={working}
                                onChange={(e) => changeRole(p.email, s.name, e.target.value, s.display_name)}
                                className="w-fit rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-700 disabled:opacity-50"
                              >
                                {!a.role && <option value="">no role</option>}
                                {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                              </select>
                            ) : (
                              <span className="text-xs text-slate-600">{a.role || "no role"}</span>
                            )}
                            {suspended && (
                              <span className="w-fit rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">suspended</span>
                            )}
                            <span className="text-[11px]">
                              {a.online
                                ? <span className="font-medium text-sky-600">● live now</span>
                                : <span className="text-slate-400">seen {ago(a.lastSignIn)}</span>}
                            </span>
                            <div className="flex gap-1.5">
                              <button disabled={working} onClick={() => toggleSuspend(p.email, s.name, suspended, s.display_name)}
                                className={`rounded px-1 py-0.5 text-[11px] font-medium disabled:opacity-40 ${suspended ? "text-emerald-600 hover:bg-emerald-50" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"}`}>
                                {suspended ? "Reactivate" : "Suspend"}
                              </button>
                              <button disabled={working} onClick={() => resetPw(p.email, s.name, s.display_name)}
                                className="rounded px-1 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40">
                                {working ? "…" : "Reset pw"}
                              </button>
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs text-slate-400">
          Read live from each app&apos;s database via its service key, and mirrored into the Master directory for tracking. Resetting a password sets a new temporary one in that app and is written to the audit log.
        </p>
    </HubShell>
  );
}
