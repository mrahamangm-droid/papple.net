"use client";

/** Shows a generic message and the digest only. `error.message` can contain server details and is never rendered. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold">Something went wrong</h1>
      <p className="mt-3 text-neutral-600">An unexpected error stopped this page. You can try again.</p>
      {error.digest && <p className="mt-2 text-xs text-neutral-500">Reference: {error.digest}</p>}
      <button onClick={() => reset()} className="mt-6 rounded-md bg-neutral-900 px-4 py-2 text-white">Try again</button>
    </main>
  );
}
