import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { createClient } from "@supabase/supabase-js";

/**
 * Sync a user to a specific site's Supabase database
 * Supports multiple site schemas:
 * - HRMS: employees, user_profiles, auth.users
 * - Sales: users, auth.users
 * - Generic: user_profiles, auth.users
 * 
 * POST /api/sync/user-to-site
 * Body: { userId: string, siteId: string }
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const { userId, siteId } = await request.json();

    console.log(`🔄 Starting sync: userId=${userId}, siteId=${siteId}`);

    if (!userId || !siteId) {
      console.error("❌ Missing userId or siteId:", { userId, siteId });
      return NextResponse.json(
        { error: "User ID and Site ID are required" },
        { status: 400 }
      );
    }

    // Get central Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("❌ Missing Supabase environment variables");
      return NextResponse.json(
        { error: "Supabase configuration missing. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY" },
        { status: 500 }
      );
    }

    const centralSupabase = createClient(supabaseUrl, supabaseAnonKey);

    // Get user data from central database
    console.log(`📋 Fetching user from central database: ${userId}`);
    const { data: user, error: userError } = await centralSupabase
      .from("user_profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      console.error(`❌ User not found in central database:`, userError);
      return NextResponse.json(
        { error: `User not found in central database: ${userError?.message || 'Not found'}` },
        { status: 404 }
      );
    }

    console.log(`✅ User found: ${user.email}`);

    // Get site configuration
    console.log(`🔗 Fetching site configuration: ${siteId}`);
    const { data: site, error: siteError } = await centralSupabase
      .from("connected_sites")
      .select("id, name, url, supabase_url, supabase_anon_key, supabase_service_key, category")
      .eq("id", siteId)
      .eq("is_active", true)
      .single();

    if (siteError || !site) {
      console.error(`❌ Site not found:`, siteError);
      return NextResponse.json(
        { error: `Site not found or not configured: ${siteError?.message || 'Not found'}` },
        { status: 404 }
      );
    }

    console.log(`✅ Site found: ${site.name} (category: ${site.category || 'none'})`);

    if (!site.supabase_url || !site.supabase_anon_key) {
      console.error(`❌ Site Supabase credentials missing for ${site.name}`);
      return NextResponse.json(
        { error: `Site Supabase credentials not configured for ${site.name}. Please configure in dashboard.` },
        { status: 400 }
      );
    }

    // Create Supabase client for the target site
    const supabaseKey = site.supabase_service_key || site.supabase_anon_key;
    const usingServiceKey = !!site.supabase_service_key;
    
    console.log(`🔌 Creating Supabase client for ${site.name}...`);
    console.log(`   Using: ${usingServiceKey ? 'Service Key (bypasses RLS)' : 'Anon Key (subject to RLS)'}`);
    
    const targetSupabase = createClient(
      site.supabase_url,
      supabaseKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Detect site type based on category or name
    const siteType = detectSiteType(site.name, site.category);
    console.log(`📌 Detected site type: ${siteType}`);

    // Sync based on site type
    let syncResult;
    if (siteType === 'hrms') {
      syncResult = await syncToHRMS(targetSupabase, user, usingServiceKey);
    } else if (siteType === 'sales') {
      syncResult = await syncToSales(targetSupabase, user, usingServiceKey);
    } else if (siteType === 'cms') {
      syncResult = await syncToCMS(targetSupabase, user, usingServiceKey);
    } else {
      syncResult = await syncToGeneric(targetSupabase, user, usingServiceKey);
    }

    if (!syncResult.success) {
      return NextResponse.json(
        { error: syncResult.error || "Sync failed" },
        { status: 500 }
      );
    }

    // Update user count for the site
    try {
      const updateCountUrl = new URL(`/api/sites/${siteId}/update-count`, request.url);
      await fetch(updateCountUrl.toString(), { method: 'POST' });
    } catch (countError) {
      console.warn("Failed to update user count:", countError);
      // Don't fail the request if count update fails
    }

    return NextResponse.json({
      success: true,
      message: syncResult.message || `User synced to ${site.name} successfully`,
      site: site.name,
      siteType,
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

/**
 * Detect site type based on name or category
 */
function detectSiteType(siteName: string, category: string | null): 'hrms' | 'sales' | 'cms' | 'garage' | 'generic' {
  const name = siteName.toLowerCase();
  const cat = (category || '').toLowerCase();
  
  if (name.includes('hrms') || cat === 'hrms' || name.includes('hr')) {
    return 'hrms';
  }
  if (name.includes('sales') || cat === 'sales') {
    return 'sales';
  }
  if (name.includes('cms') || cat === 'cms') {
    return 'cms';
  }
  if (name.includes('garage') || cat === 'garage') {
    return 'garage';
  }
  return 'generic';
}

/**
 * Sync to HRMS: employees, user_profiles, auth.users
 */
async function syncToHRMS(
  targetSupabase: any,
  user: any,
  usingServiceKey: boolean
): Promise<{ success: boolean; message?: string; error?: string }> {
  console.log(`🏢 Syncing to HRMS schema...`);

  try {
    // Step 1: Create/update auth.users entry (required for login)
    let authUserId: string | null = null;
    
    if (usingServiceKey && (user as any).password_hash) {
      console.log(`🔐 Creating/updating auth.users entry...`);
      
      // Try to find existing auth user by email
      const { data: existingAuthUsers } = await targetSupabase.auth.admin.listUsers();
      const foundUser = existingAuthUsers?.users?.find(
        (u: any) => u.email?.toLowerCase() === user.email.toLowerCase()
      );
      
      if (foundUser) {
        authUserId = foundUser.id;
        console.log(`   Found existing auth user: ${authUserId}`);
        
        // Update password if changed
        const { error: updateError } = await targetSupabase.auth.admin.updateUserById(authUserId, {
          password: (user as any).password_hash,
          user_metadata: {
            full_name: user.full_name,
            role: user.role,
          },
        });
        
        if (updateError) {
          console.warn(`⚠️ Could not update auth user password:`, updateError.message);
        } else {
          console.log(`   ✅ Auth user password updated`);
        }
      } else {
        // Generate UUID for new auth user
        const crypto = await import('crypto');
        authUserId = crypto.randomUUID();
        
        const { data: authUser, error: authError } = await targetSupabase.auth.admin.createUser({
          id: authUserId,
          email: user.email,
          password: (user as any).password_hash,
          email_confirm: true,
          user_metadata: {
            full_name: user.full_name,
            role: user.role,
          },
        });

        if (authError) {
          console.error(`❌ Failed to create auth.users entry:`, authError);
          // Continue - might still work with user_profiles
        } else {
          console.log(`   ✅ Auth user created: ${authUserId}`);
        }
      }
    }

    // Step 2: Sync to employees table (if exists and we have authUserId)
    if (authUserId) {
      console.log(`💼 Syncing to employees table...`);
      const employeeData = {
        id: authUserId, // Must match auth.users.id (UUID)
        email: user.email,
        full_name: user.full_name,
        department: user.department || null,
        employee_status: 'Active',
      };

      const { error: empError } = await targetSupabase
        .from("employees")
        .upsert(employeeData, { onConflict: 'id' });

      if (empError) {
        console.warn(`⚠️ Could not sync to employees table:`, empError.message);
        // Continue - employees might not exist or have different structure
      } else {
        console.log(`   ✅ Employee record synced`);
      }
    }

    // Step 3: Always sync to user_profiles (for password storage and login fallback)
    console.log(`👤 Syncing to user_profiles table...`);
    const profileData = {
      id: user.id, // TEXT ID from central dashboard
      clerk_user_id: user.clerk_user_id || `clerk_${user.id}`,
      email: user.email,
      full_name: user.full_name,
      role: user.role || 'user',
      department: user.department || null,
      team: user.team || null,
      phone: user.phone || null,
      password_hash: (user as any).password_hash || null,
    };

    const { error: profileError } = await targetSupabase
      .from("user_profiles")
      .upsert(profileData, { onConflict: 'id' });

    if (profileError) {
      console.error(`❌ Failed to sync to user_profiles:`, profileError);
      return { success: false, error: `Failed to sync user_profiles: ${profileError.message}` };
    }

    console.log(`   ✅ User profile synced`);

    return {
      success: true,
      message: `User synced to HRMS (employees, user_profiles, auth.users)`,
    };
  } catch (error: any) {
    console.error(`❌ HRMS sync error:`, error);
    return { success: false, error: error.message || "HRMS sync failed" };
  }
}

/**
 * Sync to Sales: users, auth.users
 */
async function syncToSales(
  targetSupabase: any,
  user: any,
  usingServiceKey: boolean
): Promise<{ success: boolean; message?: string; error?: string }> {
  console.log(`💰 Syncing to Sales schema...`);

  try {
    // Step 1: Create/update auth.users entry (required for login)
    let authUserId: string | null = null;
    
    if (usingServiceKey && (user as any).password_hash) {
      console.log(`🔐 Creating/updating auth.users entry...`);
      
      // Try to find existing auth user by email
      const { data: existingAuthUsers } = await targetSupabase.auth.admin.listUsers();
      const foundUser = existingAuthUsers?.users?.find(
        (u: any) => u.email?.toLowerCase() === user.email.toLowerCase()
      );
      
      if (foundUser) {
        authUserId = foundUser.id;
        console.log(`   Found existing auth user: ${authUserId}`);
        
        // Update password if changed
        const { error: updateError } = await targetSupabase.auth.admin.updateUserById(authUserId, {
          password: (user as any).password_hash,
          user_metadata: {
            full_name: user.full_name,
            role: user.role,
          },
        });
        
        if (updateError) {
          console.warn(`⚠️ Could not update auth user password:`, updateError.message);
        } else {
          console.log(`   ✅ Auth user password updated`);
        }
      } else {
        // Generate UUID for new auth user
        const crypto = await import('crypto');
        authUserId = crypto.randomUUID();
        
        const { data: authUser, error: authError } = await targetSupabase.auth.admin.createUser({
          id: authUserId,
          email: user.email,
          password: (user as any).password_hash,
          email_confirm: true,
          user_metadata: {
            full_name: user.full_name,
            role: user.role,
          },
        });

        if (authError) {
          console.error(`❌ Failed to create auth.users entry:`, authError);
          // Continue - might still work with users table
        } else {
          console.log(`   ✅ Auth user created: ${authUserId}`);
        }
      }
    }

    // Step 2: Sync to users table (Sales schema)
    if (authUserId) {
      console.log(`👥 Syncing to users table...`);
      const userData = {
        id: authUserId, // Must match auth.users.id (UUID)
        email: user.email,
        full_name: user.full_name,
        role: mapRoleToSales(user.role), // Map to Sales roles: owner, manager, salesman
        phone: user.phone || null,
        department: user.department || null,
        is_active: true,
      };

      const { error: userError } = await targetSupabase
        .from("users")
        .upsert(userData, { onConflict: 'id' });

      if (userError) {
        console.error(`❌ Failed to sync to users table:`, userError);
        return { success: false, error: `Failed to sync users table: ${userError.message}` };
      }

      console.log(`   ✅ User record synced to users table`);
    } else {
      console.warn(`⚠️ No authUserId - cannot sync to users table (requires UUID)`);
    }

    return {
      success: true,
      message: `User synced to Sales (users, auth.users)`,
    };
  } catch (error: any) {
    console.error(`❌ Sales sync error:`, error);
    return { success: false, error: error.message || "Sales sync failed" };
  }
}

/**
 * Sync to CMS: hr_users, auth.users
 * Role mapping: admin → admin, manager/user → hr
 */
async function syncToCMS(
  targetSupabase: any,
  user: any,
  usingServiceKey: boolean
): Promise<{ success: boolean; message?: string; error?: string }> {
  console.log(`📋 Syncing to CMS schema...`);

  try {
    // Map role: admin → admin, manager/user → hr
    let cmsRole = user.role || 'user';
    if (cmsRole.toLowerCase() === 'admin' || cmsRole.toLowerCase() === 'administrator') {
      cmsRole = 'admin';
    } else if (cmsRole.toLowerCase() === 'manager' || cmsRole.toLowerCase() === 'user') {
      cmsRole = 'hr';
    }

    // Step 1: Create/update auth.users entry
    let authUserId: string | null = null;
    
    if (usingServiceKey && (user as any).password_hash) {
      console.log(`🔐 Creating/updating auth.users entry...`);
      
      const { data: existingAuthUsers } = await targetSupabase.auth.admin.listUsers();
      const foundUser = existingAuthUsers?.users?.find(
        (u: any) => u.email?.toLowerCase() === user.email.toLowerCase()
      );
      
      if (foundUser) {
        authUserId = foundUser.id;
        await targetSupabase.auth.admin.updateUserById(foundUser.id, {
          password: (user as any).password_hash,
          user_metadata: {
            full_name: user.full_name,
            role: cmsRole,
          },
        });
        console.log(`   ✅ Auth user updated: ${authUserId}`);
      } else {
        const crypto = await import('crypto');
        authUserId = crypto.randomUUID();
        
        await targetSupabase.auth.admin.createUser({
          id: authUserId,
          email: user.email,
          password: (user as any).password_hash,
          email_confirm: true,
          user_metadata: {
            full_name: user.full_name,
            role: cmsRole,
          },
        });
        console.log(`   ✅ Auth user created: ${authUserId}`);
      }
    }

    // Step 2: Sync to hr_users table (CMS specific)
    if (authUserId) {
      console.log(`📋 Syncing to hr_users table...`);
      const hrUserData = {
        id: authUserId, // Use auth.users.id (UUID)
        email: user.email,
        full_name: user.full_name || null,
        role: cmsRole,
        department: user.department || null,
        phone: user.phone || null,
      };

      const { error: hrError } = await targetSupabase
        .from("hr_users")
        .upsert(hrUserData, { onConflict: 'id' });

      if (hrError) {
        console.warn(`⚠️ Could not sync to hr_users table:`, hrError.message);
        // Continue - hr_users might not exist or have different structure
      } else {
        console.log(`   ✅ HR user record synced`);
      }
    }

    // Step 3: Also sync to user_profiles (fallback)
    console.log(`👤 Syncing to user_profiles table...`);
    const profileData = {
      id: user.id, // TEXT ID from central dashboard
      clerk_user_id: user.clerk_user_id || `clerk_${user.id}`,
      email: user.email,
      full_name: user.full_name,
      role: cmsRole,
      department: user.department || null,
      team: user.team || null,
      phone: user.phone || null,
      password_hash: (user as any).password_hash || null,
    };

    const { error: profileError } = await targetSupabase
      .from("user_profiles")
      .upsert(profileData, { onConflict: 'id' });

    if (profileError) {
      console.warn(`⚠️ Could not sync to user_profiles:`, profileError.message);
      // Continue - user_profiles might not exist
    } else {
      console.log(`   ✅ User profile synced`);
    }

    return {
      success: true,
      message: `User synced to CMS (hr_users, user_profiles, auth.users) with role: ${cmsRole}`,
    };
  } catch (error: any) {
    console.error(`❌ CMS sync error:`, error);
    return { success: false, error: error.message || "CMS sync failed" };
  }
}

/**
 * Sync to generic site: user_profiles, auth.users
 */
async function syncToGeneric(
  targetSupabase: any,
  user: any,
  usingServiceKey: boolean
): Promise<{ success: boolean; message?: string; error?: string }> {
  console.log(`🌐 Syncing to generic schema...`);

  try {
    // Step 1: Create/update auth.users entry
    if (usingServiceKey && (user as any).password_hash) {
      console.log(`🔐 Creating/updating auth.users entry...`);
      
      const { data: existingAuthUsers } = await targetSupabase.auth.admin.listUsers();
      const foundUser = existingAuthUsers?.users?.find(
        (u: any) => u.email?.toLowerCase() === user.email.toLowerCase()
      );
      
      if (foundUser) {
        await targetSupabase.auth.admin.updateUserById(foundUser.id, {
          password: (user as any).password_hash,
          user_metadata: {
            full_name: user.full_name,
            role: user.role,
          },
        });
        console.log(`   ✅ Auth user updated`);
      } else {
        const crypto = await import('crypto');
        const authUserId = crypto.randomUUID();
        
        await targetSupabase.auth.admin.createUser({
          id: authUserId,
          email: user.email,
          password: (user as any).password_hash,
          email_confirm: true,
          user_metadata: {
            full_name: user.full_name,
            role: user.role,
          },
        });
        console.log(`   ✅ Auth user created`);
      }
    }

    // Step 2: Sync to user_profiles
    console.log(`👤 Syncing to user_profiles table...`);
    const profileData = {
      id: user.id,
      clerk_user_id: user.clerk_user_id || `clerk_${user.id}`,
      email: user.email,
      full_name: user.full_name,
      role: user.role || 'user',
      department: user.department || null,
      team: user.team || null,
      phone: user.phone || null,
      password_hash: (user as any).password_hash || null,
    };

    const { error: profileError } = await targetSupabase
      .from("user_profiles")
      .upsert(profileData, { onConflict: 'id' });

    if (profileError) {
      console.error(`❌ Failed to sync to user_profiles:`, profileError);
      return { success: false, error: `Failed to sync user_profiles: ${profileError.message}` };
    }

    console.log(`   ✅ User profile synced`);

    return {
      success: true,
      message: `User synced successfully`,
    };
  } catch (error: any) {
    console.error(`❌ Generic sync error:`, error);
    return { success: false, error: error.message || "Sync failed" };
  }
}

/**
 * Map central dashboard role to Sales role
 */
function mapRoleToSales(role: string | null): 'owner' | 'manager' | 'salesman' {
  const r = (role || '').toLowerCase();
  if (r === 'admin' || r === 'owner') return 'owner';
  if (r === 'manager') return 'manager';
  return 'salesman'; // Default
}
