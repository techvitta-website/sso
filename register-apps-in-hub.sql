-- ============================================================
-- Register all three apps in the login hub's directory
-- Run this in the MASTER project SQL editor:
--   https://supabase.com/dashboard/project/zphwtteknhxrasnmskms/sql
-- ============================================================
-- This only records each app's identity + database URL. It stores
-- NO service keys — those live in Vercel env (SITE_SERVICE_KEY_*),
-- which is why nothing secret appears in this file or in the DB.
-- Safe to run more than once (upsert by name).
-- ============================================================

-- Make sure the column the hub reads exists.
ALTER TABLE public.connected_sites
  ADD COLUMN IF NOT EXISTS supabase_url TEXT;

-- Sales CRM — pure Supabase Auth, no extra authorization row.
INSERT INTO public.connected_sites
  (name, display_name, url, icon, category, status, is_active, supabase_url, description)
VALUES
  ('sales', 'Sales CRM', 'https://sales.techvitta.in', '💰', 'sales', 'active', true,
   'https://uvqlonqtlqypxqatgbih.supabase.co',
   'Sales / call-leads CRM — logs in with Supabase Auth')
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  url          = EXCLUDED.url,
  icon         = EXCLUDED.icon,
  category     = EXCLUDED.category,
  status       = EXCLUDED.status,
  is_active    = true,
  supabase_url = EXCLUDED.supabase_url,
  updated_at   = NOW();

-- CMS — Supabase Auth + an hr_users row (matched by email).
INSERT INTO public.connected_sites
  (name, display_name, url, icon, category, status, is_active, supabase_url, description)
VALUES
  ('cms', 'CMS / Recruitment', 'https://cms.techvitta.in', '📝', 'cms', 'active', true,
   'https://qzgzmytmfoozociuhgtp.supabase.co',
   'CMS — Supabase Auth, requires an hr_users row or it signs the user out')
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  url          = EXCLUDED.url,
  icon         = EXCLUDED.icon,
  category     = EXCLUDED.category,
  status       = EXCLUDED.status,
  is_active    = true,
  supabase_url = EXCLUDED.supabase_url,
  updated_at   = NOW();

-- HRMS — Supabase Auth + a user_roles row (matched by auth user id).
INSERT INTO public.connected_sites
  (name, display_name, url, icon, category, status, is_active, supabase_url, description)
VALUES
  ('hrms', 'HRMS', 'https://hrms.techvitta.in', '💼', 'hrms', 'active', true,
   'https://snjtkvvmjqizdfyqbyzd.supabase.co',
   'HRMS — Supabase Auth, role assigned via user_roles -> roles(name)')
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  url          = EXCLUDED.url,
  icon         = EXCLUDED.icon,
  category     = EXCLUDED.category,
  status       = EXCLUDED.status,
  is_active    = true,
  supabase_url = EXCLUDED.supabase_url,
  updated_at   = NOW();

-- Old rows sometimes carried a service key in the DB. Scrub it — keys belong
-- in Vercel env now, never in a table. (No-op if the column was never added.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'connected_sites'
      AND column_name = 'supabase_service_key'
  ) THEN
    UPDATE public.connected_sites SET supabase_service_key = NULL;
  END IF;
END $$;

-- Show the result.
SELECT name, display_name, supabase_url, is_active
FROM public.connected_sites
ORDER BY name;
