import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { buildDirectory } from "@/lib/directory";

export const dynamic = "force-dynamic";

// Landing overview: every connected app's connection + usage status, plus
// headline totals. Reuses the live directory read.
export async function GET() {
  try {
    await requireAdmin();
    const dir = await buildDirectory();
    const totals = {
      apps: dir.appSummaries.length,
      connected: dir.appSummaries.filter((a) => a.connected).length,
      people: dir.people.length,
      logins: dir.appSummaries.reduce((n, a) => n + a.users, 0),
      suspended: dir.appSummaries.reduce((n, a) => n + a.suspended, 0),
    };
    return NextResponse.json({ apps: dir.appSummaries, totals });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
