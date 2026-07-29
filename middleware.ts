import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};

// Only enforce auth once real Clerk keys are set in the environment. Until
// then this stays a no-op so the site serves in guest mode and the build
// never breaks on a missing key. The moment pk_/sk_ keys exist in Vercel and
// it rebuilds, the gate below activates automatically.
const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const sk = process.env.CLERK_SECRET_KEY || "";
const clerkConfigured =
  pk.startsWith("pk_") && !pk.includes("...") &&
  sk.startsWith("sk_") && !sk.includes("...");

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
]);

export default clerkConfigured
  ? clerkMiddleware(async (auth, req) => {
      if (!isPublicRoute(req)) {
        const { userId, redirectToSignIn } = await auth();
        if (!userId) {
          return redirectToSignIn();
        }
      }
    })
  : function passthrough() {
      return NextResponse.next();
    };
