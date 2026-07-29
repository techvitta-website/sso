-- ============================================
-- Add HRMS Site with Supabase Credentials
-- ============================================
-- Run this in your CENTRAL dashboard Supabase
-- This adds the HRMS site with its Supabase credentials configured
-- ============================================

-- First, ensure the Supabase columns exist (if update-sites-schema.sql wasn't run)
DO $$ 
BEGIN
    -- Add supabase_url column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'connected_sites' 
        AND column_name = 'supabase_url'
    ) THEN
        ALTER TABLE public.connected_sites 
        ADD COLUMN supabase_url TEXT;
    END IF;

    -- Add supabase_anon_key column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'connected_sites' 
        AND column_name = 'supabase_anon_key'
    ) THEN
        ALTER TABLE public.connected_sites 
        ADD COLUMN supabase_anon_key TEXT;
    END IF;

    -- Add supabase_service_key column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'connected_sites' 
        AND column_name = 'supabase_service_key'
    ) THEN
        ALTER TABLE public.connected_sites 
        ADD COLUMN supabase_service_key TEXT;
    END IF;
END $$;

-- Insert HRMS site with Supabase configuration
INSERT INTO public.connected_sites (
    name,
    display_name,
    url,
    icon,
    category,
    status,
    protocol,
    supabase_url,
    supabase_anon_key,
    supabase_service_key,
    is_active,
    description
) VALUES (
    'hrms',
    'HRMS System',
    'https://hrms.example.com', -- Update with your actual HRMS site URL
    '💼',
    'hrms',
    'active',
    'oauth',
    'https://snjtkvvmjqizdfyqbyzd.supabase.co',
    NULL, -- anon key not stored in the DB anymore
    NULL, -- SERVICE KEY REMOVED — it lives in Vercel env (SITE_SERVICE_KEY_HRMS), never in a table/repo

    true,
    'HRMS (Human Resource Management System) - Connected via SSO Dashboard'
)
ON CONFLICT (name) 
DO UPDATE SET
    display_name = EXCLUDED.display_name,
    url = EXCLUDED.url,
    icon = EXCLUDED.icon,
    category = EXCLUDED.category,
    status = EXCLUDED.status,
    supabase_url = EXCLUDED.supabase_url,
    supabase_anon_key = EXCLUDED.supabase_anon_key,
    supabase_service_key = EXCLUDED.supabase_service_key,
    updated_at = NOW();

-- ============================================
-- ✅ HRMS Site Added!
-- ============================================
-- The HRMS site is now configured with its Supabase credentials
-- You can see it in the dashboard and start syncing users
-- ============================================
