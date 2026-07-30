import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { buildDirectory, persistSnapshot, APP_ROLES } from "@/lib/directory";

export const dynamic = "force-dynamic";

// The centralized directory: every connected app's real users + roles, folded
// by email. Also mirrors a snapshot into Master for tracking (best effort).
export async function GET() {
  try {
    await requireAdmin();
    const dir = await buildDirectory();
    await persistSnapshot(dir.snapshotRows);
    const { snapshotRows: _drop, ...out } = dir;
    void _drop;
    return NextResponse.json({ ...out, appRoles: APP_ROLES });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
