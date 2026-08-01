import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { deleteAppUser } from "@/lib/directory";

export const dynamic = "force-dynamic";

// Permanently delete a person's login AND their data inside one app, from the
// hub. Admin only. Blocks deleting your own account so an admin can't lock
// themselves out.
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin();
    const { email, app } = await request.json();
    if (!email || !app) {
      return NextResponse.json({ error: "email and app are required." }, { status: 400 });
    }
    if (String(email).toLowerCase() === String(actor.email).toLowerCase()) {
      return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
    }
    const result = await deleteAppUser(actor.id, String(email), String(app));
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
