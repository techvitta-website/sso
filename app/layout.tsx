import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SSO Dashboard - Centralized Identity Hub",
  description: "Manage your SSO infrastructure across all applications",
};

// Auth turns on automatically once a real Clerk publishable key is present in
// the environment. Without one, the app renders exactly as before (guest
// mode) so a deploy with no keys set can never break the live site.
const clerkEnabled = (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "").startsWith("pk_");

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const tree = (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );

  return clerkEnabled ? <ClerkProvider>{tree}</ClerkProvider> : tree;
}
