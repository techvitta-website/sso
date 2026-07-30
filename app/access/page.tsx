"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HubShell } from "@/components/HubShell";

type SiteAccess = { siteId: string; name: string; display_name: string; hasAccess: boolean };
type Row = { id: string; email: string; full_name: string | null; role: string; access: SiteAccess[] };
type Matrix = {
  sites: { id: string; name: string; display_name: string }[];
  configured: { name: string; connected: boolean }[];
  users: Row[];
};

export default function AccessControlPage() {
  const [data, setData] = useState<Matrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/access/matrix", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) { setError(body.error || "Failed to load."); return; }
    setData(body);
  }, []);

  useEffect(() => { load(); }, [load]);

  const connected = (name: string) =>
    data?.configured.find((c) => c.name === name)?.connected ?? false;

  const roleOptions = useMemo(
    () => Array.from(new Set((data?.users ?? []).map((u) => u.role).filter(Boolean))).sort(),
    [data]
  );
  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.users.filter((u) => {
      if (q && !(u.email.toLowerCase().includes(q) || (u.full_name ?? "").toLowerCase().includes(q))) return false;
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      return true;
    });
  }, [data, query, roleFilter]);

  async function toggle(user: Row, site: SiteAccess) {
    const action = site.hasAccess ? "revoke" : "provision";
    setBusy(`${user.id}:${site.siteId}`);
    setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/access/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, siteId: site.siteId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed.");
      if (body.tempPassword) {
        setNotice(`Granted ${user.email} access to ${site.display_name}. Temporary password: ${body.tempPassword} — share it and ask them to change it.`);
      } else {
        setNotice(`${action === "revoke" ? "Revoked" : "Granted"} ${user.email} → ${site.display_name}.`);
      }
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <HubShell active="access">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">Access Control</h1>
          <p className="text-sm text-slate-500">Grant or revoke each person&apos;s access to every connected app.</p>
        </div>

        {data && (
          <div className="mb-4 flex flex-wrap gap-2">
            {data.sites.map((s) => (
              <span key={s.id} className={`rounded-full border px-3 py-1 text-xs ${connected(s.name) ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                {s.display_name}: {connected(s.name) ? "connected" : "service key not set"}
              </span>
            ))}
          </div>
        )}

        {data && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or email…"
              className="w-56 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-900"
            />
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
              <option value="all">All roles</option>
              {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {(query || roleFilter !== "all") && (
              <button onClick={() => { setQuery(""); setRoleFilter("all"); }} className="text-xs text-slate-500 hover:text-slate-900">Clear</button>
            )}
            <span className="ml-auto text-xs text-slate-500">{filtered.length} of {data.users.length}</span>
          </div>
        )}

        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
        {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{notice}</div>}

        {!data ? (
          <p className="text-slate-500">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-3">Person</th>
                  {data.sites.map((s) => <th key={s.id} className="px-4 py-3 text-center">{s.display_name}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{u.full_name || u.email}</div>
                      <div className="text-xs text-slate-500">{u.email} · {u.role}</div>
                    </td>
                    {u.access.map((a) => (
                      <td key={a.siteId} className="px-4 py-3 text-center">
                        <button
                          disabled={busy === `${u.id}:${a.siteId}` || !connected(a.name)}
                          onClick={() => toggle(u, a)}
                          title={!connected(a.name) ? "Service key not configured for this app" : a.hasAccess ? "Revoke access" : "Grant access"}
                          className={`rounded-md px-3 py-1 text-xs font-medium transition disabled:opacity-40 ${
                            a.hasAccess
                              ? "bg-emerald-100 text-emerald-800 hover:bg-red-100 hover:text-red-800"
                              : "bg-slate-100 text-slate-600 hover:bg-emerald-100 hover:text-emerald-800"
                          }`}
                        >
                          {busy === `${u.id}:${a.siteId}` ? "…" : a.hasAccess ? "Granted" : "Grant"}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs text-slate-400">
          Granting creates the person&apos;s login inside that app; revoking suspends it (kept, not deleted, so history survives). Every action is written to the audit log.
        </p>
    </HubShell>
  );
}
