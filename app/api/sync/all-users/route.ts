import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { createClient } from "@supabase/supabase-js";

// Simple Supabase client for API routes (no auth required for now)
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  
  return createClient(supabaseUrl, supabaseAnonKey);
}

/**
 * API endpoint to sync all users to all connected sites
 * POST /api/sync/all-users
 */
export async function POST() {
  try {
    await requireAdmin();
    const supabase = getSupabaseClient();

    // Get all users
    const { data: users, error: usersError } = await supabase
      .from("user_profiles")
      .select("id, email, full_name, role");

    if (usersError) throw usersError;

    // Get all active sites
    const { data: sites, error: sitesError } = await supabase
      .from("connected_sites")
      .select("id, name, url")
      .eq("is_active", true)
      .eq("status", "active");

    if (sitesError) throw sitesError;

    const results = [];

    // Sync each user to each site
    for (const user of users || []) {
      for (const site of sites || []) {
        try {
          // Check if already synced
          const { data: existing } = await supabase
            .from("user_sync_log")
            .select("id")
            .eq("user_id", user.id)
            .eq("target_site", site.name)
            .eq("sync_status", "success")
            .single();

          if (existing) {
            continue; // Already synced
          }

          // Create sync log
          await supabase.from("user_sync_log").insert({
            user_id: user.id,
            target_site: site.name,
            sync_status: "pending",
            sync_type: "create",
            synced_data: {
              email: user.email,
              full_name: user.full_name,
              role: user.role,
            },
          });

          results.push({
            user: user.email,
            site: site.name,
            status: "queued",
          });
        } catch (error: any) {
          results.push({
            user: user.email,
            site: site.name,
            status: "error",
            error: error.message,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Queued sync for ${results.length} user-site combinations`,
      results,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
