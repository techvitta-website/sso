import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { createClient } from "@supabase/supabase-js";

/**
 * Sync a user to multiple specific sites
 * POST /api/sync/user-to-sites
 * Body: { userId: string, siteIds: string[] }
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const { userId, siteIds } = await request.json();

    if (!userId || !siteIds || !Array.isArray(siteIds) || siteIds.length === 0) {
      return NextResponse.json(
        { error: "User ID and Site IDs array are required" },
        { status: 400 }
      );
    }

    const baseUrl = request.url.split('/api')[0];
    const syncResults = [];

    // Sync to each site
    for (const siteId of siteIds) {
      try {
        const syncResponse = await fetch(`${baseUrl}/api/sync/user-to-site`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, siteId }),
        });

        const syncResult = await syncResponse.json();
        
        syncResults.push({
          siteId,
          status: syncResponse.ok && syncResult.success ? "success" : "failed",
          message: syncResult.message || syncResult.error,
          error: syncResult.error || null,
        });
      } catch (error: any) {
        syncResults.push({
          siteId,
          status: "failed",
          error: error.message || "Sync failed",
        });
      }
    }

    const successCount = syncResults.filter(r => r.status === "success").length;
    const failCount = syncResults.filter(r => r.status === "failed").length;

    return NextResponse.json({
      success: true,
      userId,
      total: siteIds.length,
      successCount,
      failCount,
      results: syncResults,
    });
  } catch (error: any) {
    console.error("Multi-site sync error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
