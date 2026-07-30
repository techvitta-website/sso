"use client";

import { useCallback, useEffect, useState } from "react";
import { HubShell } from "@/components/HubShell";

type AppSummary = {
  name: string;
  display_name: string;
  url: string | null;
  connected: boolean;
  reachable: boolean;
  users: number;
  active: number;
  suspended: number;
  activeSessions: number;
  lastActivity: string | null;
};
type Totals = { apps: number; connected: number; healthy: number; people: number; logins: number; suspended: number; online: number };
type Overview = { apps: AppSummary[]; totals: Totals; master: { reachable: boolean } };

function ago(iso: string | null): string {
  if (!iso) return "no activity";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const d = Math.floor((Date.now() - t) / 86400000);
  if (d <= 0) return "active today";
  if (d === 1) return "1 day ago";
  if (d < 30) return `${d} days ago`;
  return `${Math.floor(d / 30)} mo ago`;
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
      <div className={`text-2xl font-semibold ${tone === "warn" ? "text-amber-600" : "text-slate-900"}`}>{value}</div>
      <div className="mt-0.5 text-xs uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/overview", { cache: "no-store" });
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

  return (
    <HubShell active="overview">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Overview</h1>
          <p className="text-sm text-slate-500">Every connected app and its live usage, in one place.</p>
        </div>
        <button onClick={load} disabled={loading} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {!data ? (
        <p className="text-slate-500">Loading usage from every app…</p>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
            <span className={`h-2 w-2 rounded-full ${data.master.reachable ? "bg-emerald-500" : "bg-red-500"}`} />
            Master database: {data.master.reachable ? "healthy" : "unreachable"}
          </div>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Apps healthy" value={`${data.totals.healthy}/${data.totals.apps}`} />
            <Stat label="People" value={data.totals.people} />
            <Stat label="Total logins" value={data.totals.logins} />
            <Stat label="Online now" value={data.totals.online} />
            <Stat label="Suspended" value={data.totals.suspended} tone={data.totals.suspended ? "warn" : undefined} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.apps.map((a) => {
              const state = !a.connected
                ? { dot: "bg-amber-400", label: "service key not set", tone: "text-amber-600" }
                : !a.reachable
                ? { dot: "bg-red-500", label: "unreachable", tone: "text-red-600" }
                : { dot: "bg-emerald-500", label: "connected", tone: "text-emerald-600" };
              return (
                <div key={a.name} className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="mb-3 flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-slate-900">{a.display_name}</div>
                      {a.url && <div className="text-xs text-slate-400">{a.url.replace(/^https?:\/\//, "")}</div>}
                    </div>
                    <span className={`flex items-center gap-1.5 text-xs font-medium ${state.tone}`}>
                      <span className={`h-2 w-2 rounded-full ${state.dot}`} />
                      {state.label}
                    </span>
                  </div>
                  {a.connected && a.reachable ? (
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div><div className="text-lg font-semibold text-slate-900">{a.users}</div><div className="text-[11px] uppercase text-slate-400">users</div></div>
                      <div><div className="text-lg font-semibold text-emerald-600">{a.active}</div><div className="text-[11px] uppercase text-slate-400">active</div></div>
                      <div><div className="text-lg font-semibold text-sky-600">{a.activeSessions}</div><div className="text-[11px] uppercase text-slate-400">online</div></div>
                      <div><div className="text-lg font-semibold text-amber-600">{a.suspended}</div><div className="text-[11px] uppercase text-slate-400">suspended</div></div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">
                      {a.connected ? "Configured but not answering right now." : "Add its service key to the sso project to connect."}
                    </p>
                  )}
                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
                    <span className="text-slate-400">Last activity: {ago(a.lastActivity)}</span>
                    <a href="/directory" className="font-medium text-slate-500 hover:text-slate-900">View users →</a>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <a href="/access" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">Manage access</a>
            <a href="/directory" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Open directory</a>
          </div>
        </>
      )}
    </HubShell>
  );
}
