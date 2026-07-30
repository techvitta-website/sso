"use client";

import { createClient } from "@/lib/supabase/client";

type Tab = "overview" | "access" | "directory";

const TABS: { key: Tab; label: string; href: string }[] = [
  { key: "overview", label: "Overview", href: "/" },
  { key: "access", label: "Access", href: "/access" },
  { key: "directory", label: "Directory", href: "/directory" },
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
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
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
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
