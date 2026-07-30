import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { setAppRole } from "@/lib/directory";

export const dynamic = "force-dynamic";

// Change a person's role inside one app, from the hub. Admin only.
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin();
    const { email, app, role } = await request.json();
    if (!email || !app || !role) {
      return NextResponse.json({ error: "email, app and role are required." }, { status: 400 });
    }
    const result = await setAppRole(actor.id, String(email), String(app), String(role));
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
