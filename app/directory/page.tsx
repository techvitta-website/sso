"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HubShell } from "@/components/HubShell";

type AppState = { role: string | null; status: string; lastSignIn: string | null; appUserId: string };
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

  return (
    <HubShell active="directory">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">User Directory</h1>
          <p className="text-sm text-slate-500">Every person&apos;s logins and roles across all connected apps, in one place.</p>
        </div>

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

        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
        {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{notice}</div>}

        {!data ? (
          <p className="text-slate-500">Loading the directory from every app…</p>
        ) : data.people.length === 0 ? (
          <p className="text-slate-500">No users found in any connected app.</p>
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
                {data.people.map((p) => (
                  <tr key={p.email} className="border-b border-slate-100 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{p.email}</div>
                      <div className="text-xs text-slate-400">{Object.keys(p.apps).length} app{Object.keys(p.apps).length === 1 ? "" : "s"}</div>
                    </td>
                    {data.sites.map((s) => {
                      const a = p.apps[s.name];
                      if (!a) return <td key={s.id} className="px-4 py-3 text-slate-300">—</td>;
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
                            <span className="text-[11px] text-slate-400">seen {ago(a.lastSignIn)}</span>
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
