import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { provisionAccess } from "@/lib/access-control";

export async function POST(req: Request) {
  try {
    const actor = await requireAdmin();
    const { userId, siteId } = await req.json();
    if (!userId || !siteId) {
      return NextResponse.json({ error: "userId and siteId are required." }, { status: 400 });
    }
    const result = await provisionAccess(actor.id, userId, siteId);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
