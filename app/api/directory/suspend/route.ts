import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { setSuspended } from "@/lib/directory";

export const dynamic = "force-dynamic";

// Suspend or reactivate a person's login in one app, from the hub. Admin only.
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin();
    const { email, app, suspend } = await request.json();
    if (!email || !app || typeof suspend !== "boolean") {
      return NextResponse.json({ error: "email, app and suspend(boolean) are required." }, { status: 400 });
    }
    const result = await setSuspended(actor.id, String(email), String(app), suspend);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
