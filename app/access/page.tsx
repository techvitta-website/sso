"use client";

import { useCallback, useEffect, useState } from "react";

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
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Access Control</h1>
            <p className="text-sm text-slate-500">Grant or revoke each person&apos;s access to every connected app.</p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <a href="/directory" className="text-slate-500 hover:text-slate-900">User directory →</a>
            <a href="/" className="text-slate-500 hover:text-slate-900">← Dashboard</a>
          </div>
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
                {data.users.map((u) => (
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
      </div>
    </div>
  );
}
