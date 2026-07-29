import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { accessMatrix } from "@/lib/access-control";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const data = await accessMatrix();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
