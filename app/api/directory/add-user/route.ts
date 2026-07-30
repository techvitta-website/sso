import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { addUser } from "@/lib/directory";

export const dynamic = "force-dynamic";

// Create a user in one or more apps at once — real logins in each app's DB.
// Body: { email, fullName?, targets: [{ app, role }] }
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin();
    const { email, fullName, targets } = await request.json();
    if (!email || !Array.isArray(targets) || targets.length === 0) {
      return NextResponse.json({ error: "email and at least one app target are required." }, { status: 400 });
    }
    const result = await addUser(actor.id, String(email).trim(), fullName ? String(fullName) : null, targets);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
