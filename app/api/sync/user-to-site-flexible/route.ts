import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { createClient } from "@supabase/supabase-js";

/**
 * Flexible sync that works with existing HRMS schema
 * POST /api/sync/user-to-site-flexible
 * Body: { userId: string, siteId: string, tableMapping?: {...} }
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const { userId, siteId, tableMapping } = await request.json();

    if (!userId || !siteId) {
      return NextResponse.json(
        { error: "User ID and Site ID are required" },
        { status: 400 }
      );
    }

    // Get central Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables" },
        { status: 500 }
      );
    }

    const centralSupabase = createClient(supabaseUrl, supabaseAnonKey);

    // Get user data from central database
    const { data: user, error: userError } = await centralSupabase
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: "User not found in central database" },
        { status: 404 }
      );
    }

    // Get site configuration
    const { data: site, error: siteError } = await centralSupabase
      .from("connected_sites")
      .select("id, name, url, supabase_url, supabase_anon_key, settings")
      .eq("id", siteId)
      .eq("is_active", true)
      .single();

    if (siteError || !site) {
      return NextResponse.json(
        { error: "Site not found or not configured" },
        { status: 404 }
      );
    }

    if (!site.supabase_url || !site.supabase_anon_key) {
      return NextResponse.json(
        { error: "Site Supabase credentials not configured" },
        { status: 400 }
      );
    }

    // Get table mapping from site settings or use defaults
    const mapping = tableMapping || site.settings?.tableMapping || {
      tableName: "user_profiles", // Default, but can be 'users', 'employees', etc.
      emailColumn: "email",
      nameColumn: "full_name",
      passwordColumn: "password_hash",
      idColumn: "id",
    };

    // Create Supabase client for target site
    const targetSupabase = createClient(
      site.supabase_url,
      site.supabase_anon_key
    );

    // Find existing user by email (works with any table structure)
    const tableName = mapping.tableName as string;
    const emailColumn = mapping.emailColumn as string;
    const { data: existingUser, error: findError } = await targetSupabase
      .from(tableName)
      .select("*")
      .eq(emailColumn, user.email.toLowerCase().trim())
      .maybeSingle();

    if (findError && findError.code !== "PGRST116") {
      console.error("Error finding user:", findError);
      // Continue anyway - might be new user
    }

    let syncResult;
    const userData: any = {
      [mapping.emailColumn]: user.email,
      [mapping.nameColumn]: user.full_name || null,
    };

    // Add password if column exists and we have password
    if (mapping.passwordColumn && (user as any).password_hash) {
      userData[mapping.passwordColumn] = (user as any).password_hash;
    }

    // Add ID if column exists
    if (mapping.idColumn && mapping.idColumn !== mapping.emailColumn) {
      userData[mapping.idColumn] = user.id;
    }

    if (existingUser) {
      // Update existing user
      const { data, error } = await targetSupabase
        .from(tableName)
        .update(userData)
        .eq(emailColumn, user.email.toLowerCase().trim())
        .select()
        .single();

      if (error) {
        console.error(`Error updating user in ${site.name}:`, error);
        throw new Error(`Failed to update user in ${site.name}: ${error.message}`);
      }
      
      syncResult = { action: "updated", data };
    } else {
      // Create new user
      const { data, error } = await targetSupabase
        .from(tableName)
        .insert(userData)
        .select()
        .single();

      if (error) {
        console.error(`Error creating user in ${site.name}:`, error);
        throw new Error(`Failed to create user in ${site.name}: ${error.message}`);
      }
      
      syncResult = { action: "created", data };
    }

    return NextResponse.json({
      success: true,
      site: site.name,
      action: syncResult.action,
      message: `User ${syncResult.action} in ${site.name}`,
      userEmail: user.email,
    });
  } catch (error: any) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
