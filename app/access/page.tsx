import { redirect } from "next/navigation";

// The old 2-row grant matrix (Master user_profiles) is retired. Access control
// now lives on the unified /directory screen, which lists every real user
// across all apps with full grant / role / suspend / password control.
export default function AccessRedirect() {
  redirect("/directory");
}
