import Link from "next/link";
import { signInAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function SignIn({ searchParams }: PageProps<"/signin">) {
  const sp = await searchParams;
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {sp.notice === "check-email" && <p role="status" className="mt-4 text-sm">Check your email to confirm your account, then sign in.</p>}
      {sp.notice === "reset-sent" && <p role="status" className="mt-4 text-sm">If that address has an account, a reset link is on its way.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-4 text-sm text-red-600">{sp.error}</p>}
      <form action={signInAction} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={typeof sp.next === "string" ? sp.next : ""} />
        <label className="block text-sm">Email
          <input name="email" type="email" required autoComplete="email" className="block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 mt-1" />
        </label>
        <label className="block text-sm">Password
          <input name="password" type="password" required autoComplete="current-password" className="block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 mt-1" />
        </label>
        <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-white dark:bg-white dark:text-neutral-900">Sign in</button>
      </form>
      <p className="mt-6 text-sm"><Link className="underline" href="/reset">Forgot password?</Link> · <Link className="underline" href="/signup">Create account</Link></p>
    </main>
  );
}
