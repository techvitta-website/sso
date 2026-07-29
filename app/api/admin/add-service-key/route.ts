import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { createClient } from "@supabase/supabase-js";

/**
 * Add service key to HRMS site configuration
 * POST /api/admin/add-service-key
 * Body: { serviceKey: string }
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const { serviceKey } = await request.json();

    if (!serviceKey) {
      return NextResponse.json(
        { error: "Service key is required" },
        { status: 400 }
      );
    }

    // Get central Supabase client
    const centralSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Update HRMS site with service key
    const { data, error } = await centralSupabase
      .from("connected_sites")
      .update({
        supabase_service_key: serviceKey,
        updated_at: new Date().toISOString(),
      })
      .eq("name", "hrms")
      .eq("is_active", true)
      .select()
      .single();

    if (error) {
      console.error("Error updating service key:", error);
      return NextResponse.json(
        { error: `Failed to update service key: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Service key added to HRMS site configuration",
      site: {
        id: data.id,
        name: data.name,
        display_name: data.display_name,
        has_service_key: !!data.supabase_service_key,
      },
    });
  } catch (error: any) {
    console.error("Error adding service key:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
