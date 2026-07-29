import Link from "next/link";

// Public self-registration is intentionally disabled. This is an internal
// identity hub — accounts are created by an administrator, not self-served.
export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">By invitation only</h1>
        <p className="mt-2 text-sm text-slate-500">
          Accounts on the TechVitta identity hub are created by an administrator.
          Ask your admin to set one up for you.
        </p>
        <Link
          href="/sign-in"
          className="mt-6 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
