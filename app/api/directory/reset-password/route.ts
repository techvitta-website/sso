import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { resetAppPassword } from "@/lib/directory";

export const dynamic = "force-dynamic";

// Reset one person's password inside one app, from the hub. Admin only.
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin();
    const { email, app, password } = await request.json();
    if (!email || !app) {
      return NextResponse.json({ error: "email and app are required." }, { status: 400 });
    }
    if (password !== undefined && String(password).trim().length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
    }
    const result = await resetAppPassword(actor.id, String(email), String(app), password ? String(password) : undefined);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
