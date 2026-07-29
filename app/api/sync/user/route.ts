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
 * API endpoint to sync a user to all connected sites
 * POST /api/sync/user
 * Body: { userId: string }
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Get user profile
    const { data: user, error: userError } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Get all active connected sites
    console.log(`🔍 Fetching active connected sites...`);
    const { data: sites, error: sitesError } = await supabase
      .from("connected_sites")
      .select("id, name, url, protocol, client_id, redirect_uri, supabase_url, supabase_anon_key")
      .eq("is_active", true);

    if (sitesError) {
      console.error("❌ Error fetching sites:", sitesError);
      throw sitesError;
    }

    if (!sites || sites.length === 0) {
      console.warn("⚠️ No active connected sites found");
      return NextResponse.json({
        success: false,
        error: "No active connected sites found. Please add and configure sites in the dashboard.",
        results: [],
      });
    }

    console.log(`✅ Found ${sites.length} active site(s):`, sites.map(s => s.name));

    const syncResults = [];

    // Sync user to each site
    for (const site of sites || []) {
      try {
        console.log(`\n🔄 Syncing to site: ${site.name} (${site.id})`);
        
        // Check if site has Supabase credentials
        if (!site.supabase_url || !site.supabase_anon_key) {
          console.warn(`⚠️ Site ${site.name} missing Supabase credentials - skipping`);
          syncResults.push({
            site: site.name,
            status: "failed",
            error: "Supabase credentials not configured. Please configure in dashboard.",
          });
          continue;
        }

        // Create sync log entry
        const { data: syncLog, error: logError } = await supabase
          .from("user_sync_log")
          .insert({
            user_id: userId,
            target_site: site.name,
            sync_status: "in_progress",
            sync_type: "create",
            synced_data: {
              email: user.email,
              full_name: user.full_name,
              role: user.role,
            },
          })
          .select()
          .single();

        if (logError) {
          console.warn(`⚠️ Could not create sync log:`, logError);
          // Continue anyway - log is not critical
        }

        // Sync user to the site's Supabase database
        const baseUrl = request.url.split('/api')[0];
        const syncUrl = `${baseUrl}/api/sync/user-to-site`;
        console.log(`📡 Calling sync API: ${syncUrl}`);
        
        const syncResponse = await fetch(syncUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            siteId: site.id,
          }),
        });

        const syncResult = await syncResponse.json();
        console.log(`📥 Sync response for ${site.name}:`, syncResult);

        if (!syncResponse.ok) {
          throw new Error(syncResult.error || "Sync failed");
        }

        // Update sync log (if it was created)
        if (syncLog && syncLog.id) {
          await supabase
            .from("user_sync_log")
            .update({
              sync_status: syncResult.success ? "success" : "failed",
              error_message: syncResult.error || null,
              completed_at: new Date().toISOString(),
            })
            .eq("id", syncLog.id);
        }

        syncResults.push({
          site: site.name,
          status: syncResult.success ? "success" : "failed",
          message: syncResult.message || (syncResult.success ? "Synced successfully" : "Sync failed"),
          error: syncResult.error || null,
        });
      } catch (error: any) {
        syncResults.push({
          site: site.name,
          status: "failed",
          error: error.message,
        });
      }
    }

    return NextResponse.json({
      success: true,
      userId,
      results: syncResults,
    });
  } catch (error: any) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sync/user - Get sync status for a user
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Get sync status
    const { data, error } = await supabase
      .from("user_sync_status")
      .select("*")
      .eq("user_id", userId);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      syncStatus: data,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
