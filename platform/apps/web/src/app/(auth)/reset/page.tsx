import { resetAction } from "../actions";

export const metadata = { title: "Reset password" };

export default function Reset() {
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <form action={resetAction} className="mt-6 space-y-4">
        <label className="block text-sm">Email
          <input name="email" type="email" required autoComplete="email" className="block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 mt-1" />
        </label>
        <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-white dark:bg-white dark:text-neutral-900">Send reset link</button>
      </form>
    </main>
  );
}
