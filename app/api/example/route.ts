import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase";

/**
 * Example API route showing how to use Supabase with Clerk authentication
 * This demonstrates the SSO integration working together
 */
export async function GET() {
  try {
    // Get the authenticated user from Clerk
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get Supabase client with Clerk JWT
    const supabase = await getSupabaseServerClient();

    // Example: Query user data from Supabase
    // Replace 'users' with your actual table name
    // const { data, error } = await supabase
    //   .from("users")
    //   .select("*")
    //   .eq("id", userId)
    //   .single();

    // if (error) {
    //   throw error;
    // }

    return NextResponse.json({
      message: "SSO integration working!",
      clerkUserId: userId,
      // userData: data,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
