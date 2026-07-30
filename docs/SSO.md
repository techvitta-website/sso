# TechVitta Identity (SSO) — Architecture & Operations

The central identity hub at **logins.techvitta.in**. One place to see and control
users, roles, access, and sessions across every internal app — Sales CRM, HRMS,
and CMS — without opening any of them directly.

## The two screens

**Overview** — a live health & usage dashboard. Master DB status, and per app:
connection state, database health (reachable), user count, active vs suspended,
**online now** (live sessions), and last activity. Read-only.

**Access & Users** — the single control plane. Lists **every real user across all
apps** (read live from each app's `auth.users`), and for each person × app lets an
admin:

| Action | What it does |
|---|---|
| **+ Grant** | Creates a login in that app (with a default role) if the person has none |
| **Role dropdown** | Sets their role in that app's own model |
| **Suspend / Reactivate** | Bans / restores their login in that app |
| **Reset pw** | Issues a new temporary password in that app |
| **+ Add user** (top) | Creates a person across multiple apps at once |
| **Filters** | Search email, filter by app / role / status |
| **● live now** | Shows who currently has an active session in that app |

The old 2-row "Access" matrix (Master `user_profiles` only) is retired; `/access`
redirects here.

## How it works

The hub holds each app's **service-role key** in Vercel env (`SITE_SERVICE_KEY_<APP>`),
never in the database or the browser. All app reads/writes happen **server-side**
in `lib/directory.ts` / `lib/access-control.ts`, matched **by email**. Every app
keeps its own database; the hub reaches in with the service key (which bypasses
that app's RLS) to make authorization changes take effect immediately.

Per-app user & role models (`lib/directory.ts`):

| App | Supabase ref | Login | Role source |
|---|---|---|---|
| Sales CRM | `uvqlonqtlqypxqatgbih` | `auth.users` | `public.users.role` (owner/manager/salesman) |
| CMS | `qzgzmytmfoozociuhgtp` | `auth.users` | `public.hr_users.role` by email (admin/hr/editor/author/user) |
| HRMS | `snjtkvvmjqizdfyqbyzd` | `auth.users` | `user_roles.role_id → roles.name` by auth id (Admin/HR/Employee/Client) |

Master (identity) DB: `zphwtteknhxrasnmskms` — Supabase Auth for admin sign-in,
plus `app_user_directory` (tracking snapshot) and `audit_logs`.

**Active sessions** are read via a per-app SECURITY DEFINER function
`public.sso_active_sessions()` (reads `auth.sessions`, execute granted to
`service_role` only). Install it per app with `6-ALL-APPS-active-sessions.sql`.

## API (all admin-gated by `requireAdmin()`)

- `GET  /api/overview` — per-app health + usage totals.
- `GET  /api/directory` — the full live directory (+ mirrors a snapshot to Master).
- `POST /api/directory/add-user` — create logins across chosen apps.
- `POST /api/directory/set-role` — change a role in one app.
- `POST /api/directory/suspend` — suspend/reactivate a login.
- `POST /api/directory/reset-password` — new temp password.

## Security model

- Every API route enforces `requireAdmin()` (valid Supabase session + `role ∈
  {admin, owner, super_admin}` in Master `user_profiles`). Middleware gates all
  non-public routes to a signed-in session first.
- Service-role keys live only in Vercel env; nothing sensitive ships to the
  browser. The sign-in page uses only the public anon key.
- Every grant / role / suspend / reset / add is written to `audit_logs`.
- Legacy liabilities removed: Clerk-era `/api/test/*`, the plaintext
  `verify-credentials`, and the ungated `/api/sites/*` CRUD are all deleted;
  `/api/sync/*` + `add-service-key` are admin-gated.
- **App-side DB hardening (run these):** `3-CMS-lockdown.sql` and
  `4-HRMS-lockdown.sql` add RLS so a logged-in app user can't escalate their own
  role from the browser (the hub still manages roles via the service key).

## Setup / ops checklist

1. Vercel (`sso` project) env: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Master), and `SITE_SERVICE_KEY_SALES/_CMS/_HRMS`
   (each app's own `sb_secret_` key). Redeploy after any change.
2. Master DB: `1-MASTER-login-setup.sql` (admin login), `2-MASTER-audit-and-rls.sql`
   (audit + directory RLS), `5-MASTER-user-directory.sql` (tracking table).
3. Each app DB: `6-ALL-APPS-active-sessions.sql` (session visibility), plus
   `3-CMS-lockdown.sql` / `4-HRMS-lockdown.sql` (role-escalation lockdown).
4. HRMS only: deploy the `admin-create-user` edge function to restore in-app
   "Add employee"; then finish the legacy-JWT-secret revoke after swapping the
   HRMS anon key to the new publishable key.

## Known follow-ups

- Rotate the Master secret and Sales service key; enable leaked-password
  protection on Sales.
- Make the HRMS GitHub repo private again (it was made public to deploy on
  Vercel's free plan — no secrets leaked). Deploy via Vercel Pro or `npx vercel`.
- The old dashboard components (`components/dashboard/*`) are no longer routed
  and can be deleted.
