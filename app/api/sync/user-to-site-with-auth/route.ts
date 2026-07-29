import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { createClient } from "@supabase/supabase-js";

/**
 * Sync user to site AND create auth.users entry for login
 * POST /api/sync/user-to-site-with-auth
 * Body: { userId: string, siteId: string }
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const { userId, siteId } = await request.json();

    if (!userId || !siteId) {
      return NextResponse.json(
        { error: "User ID and Site ID are required" },
        { status: 400 }
      );
    }

    // Get central Supabase client
    const centralSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Get user from central database
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
      .select("id, name, supabase_url, supabase_anon_key, supabase_service_key")
      .eq("id", siteId)
      .eq("is_active", true)
      .single();

    if (siteError || !site) {
      return NextResponse.json(
        { error: "Site not found or not configured" },
        { status: 404 }
      );
    }

    if (!site.supabase_url || !site.supabase_service_key) {
      return NextResponse.json(
        { error: "Site Supabase credentials not configured. Service key required for creating auth.users" },
        { status: 400 }
      );
    }

    // Create Supabase client with SERVICE KEY (required for auth.admin operations)
    const targetSupabase = createClient(
      site.supabase_url,
      site.supabase_service_key,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Step 1: Create/update user_profiles
    const { data: profileData, error: profileError } = await targetSupabase
      .from("user_profiles")
      .upsert({
        id: user.id,
        clerk_user_id: user.clerk_user_id || null,
        email: user.email,
        full_name: user.full_name || null,
        password_hash: (user as any).password_hash || null,
        role: user.role || 'user',
        department: user.department || null,
      }, { onConflict: 'id' })
      .select()
      .single();

    if (profileError) {
      return NextResponse.json(
        { error: `Failed to sync user profile: ${profileError.message}` },
        { status: 500 }
      );
    }

    // Step 2: Create user in auth.users (for Supabase Auth login)
    // Check if user already exists in auth.users
    const { data: existingAuthUser, error: checkAuthError } = await targetSupabase.auth.admin.getUserById(user.id);

    if (checkAuthError && checkAuthError.message !== "User not found") {
      console.warn("Error checking auth user:", checkAuthError);
    }

    if (!existingAuthUser?.user) {
      // Create new auth user
      const { data: authUser, error: authError } = await targetSupabase.auth.admin.createUser({
        id: user.id, // Use same ID
        email: user.email,
        password: (user as any).password_hash || undefined, // Set password for login
        email_confirm: true, // Auto-confirm email
        user_metadata: {
          full_name: user.full_name,
          role: user.role,
        },
      });

      if (authError) {
        console.error("Error creating auth user:", authError);
        // Don't fail - user_profiles is created, just auth.users failed
        return NextResponse.json({
          success: true,
          warning: "User profile synced but auth.users creation failed. Login may not work.",
          error: authError.message,
          site: site.name,
        });
      }

      console.log(`✅ Auth user created in ${site.name}:`, authUser.user.email);
    } else {
      // Update existing auth user password if changed
      if ((user as any).password_hash) {
        const { error: updateError } = await targetSupabase.auth.admin.updateUserById(user.id, {
          password: (user as any).password_hash,
          user_metadata: {
            full_name: user.full_name,
            role: user.role,
          },
        });

        if (updateError) {
          console.warn("Error updating auth user:", updateError);
        } else {
          console.log(`✅ Auth user updated in ${site.name}:`, existingAuthUser.user.email);
        }
      }
    }

    return NextResponse.json({
      success: true,
      site: site.name,
      message: `User synced to ${site.name}. Can now login with Supabase Auth.`,
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
