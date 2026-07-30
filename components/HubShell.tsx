"use client";

import { createClient } from "@/lib/supabase/client";

type Tab = "overview" | "access" | "directory";

const TABS: { key: Tab; label: string; href: string }[] = [
  { key: "overview", label: "Overview", href: "/" },
  { key: "access", label: "Access & Users", href: "/directory" },
];

// Quick links to each live app, so an admin can jump over and check logins.
const APPS: { name: string; url: string }[] = [
  { name: "Sales CRM", url: "https://sales.techvitta.in" },
  { name: "HRMS", url: "https://hrms.techvitta.in" },
  { name: "CMS", url: "https://cms.techvitta.in" },
  { name: "BRMS", url: "https://brms.techvitta.in" },
  { name: "Garage", url: "https://garage.techvitta.in" },
  { name: "Teamsync", url: "https://teamsync.techvitta.in" },
];

// One shell for the whole hub so every page shares the same identity + nav.
export function HubShell({ active, children }: { active: Tab; children: React.ReactNode }) {
  async function signOut() {
    try {
      await createClient().auth.signOut();
    } finally {
      window.location.assign("/sign-in");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <a href="/" className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-white">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 6c.9 1.3 2.4 2 4.4 2 1.5 0 2.9-.4 4.1-1-1.2 2.6-3.4 4-5.7 4.2l3.2 5.3-4.2-2.7L12 21l-1.8-7.2L6 16.5l3.2-5.3C6.9 11 4.7 9.6 3.5 7c1.2.6 2.6 1 4.1 1 2 0 3.5-.7 4.4-2z" />
                </svg>
              </span>
              <span className="text-sm font-semibold text-slate-900">TechVitta Identity</span>
            </a>
            <nav className="flex items-center gap-1">
              {TABS.map((t) => (
                <a
                  key={t.key}
                  href={t.href}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    active === t.key
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {t.label}
                </a>
              ))}
            </nav>
          </div>
          <button onClick={signOut} className="text-sm text-slate-500 hover:text-slate-900">
            Sign out
          </button>
        </div>
      </header>
      <div className="border-b border-slate-100 bg-slate-50">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-6 py-1.5 text-xs">
          <span className="text-slate-400">Open app:</span>
          {APPS.map((a) => (
            <a key={a.name} href={a.url} target="_blank" rel="noreferrer"
              className="font-medium text-slate-500 hover:text-slate-900">
              {a.name} ↗
            </a>
          ))}
        </div>
      </div>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
