import Link from "next/link";
import { signUpAction } from "../actions";

export const metadata = { title: "Create account" };

export default async function SignUp({ searchParams }: PageProps<"/signup">) {
  const error = (await searchParams).error;
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold">Create your Papple account</h1>
      {typeof error === "string" && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
      <form action={signUpAction} className="mt-6 space-y-4">
        <label className="block text-sm">Email
          <input name="email" type="email" required autoComplete="email" className="block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 mt-1" />
        </label>
        <label className="block text-sm">Password (12+ characters)
          <input name="password" type="password" required minLength={12} autoComplete="new-password" className="block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 mt-1" />
        </label>
        <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-white dark:bg-white dark:text-neutral-900">Create account</button>
      </form>
      <p className="mt-6 text-sm">Already registered? <Link className="underline" href="/signin">Sign in</Link></p>
    </main>
  );
}
