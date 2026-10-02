export function Toast({ message }: { message?: string }) {
  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 right-4">
      {message && <p className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white">{message}</p>}
    </div>
  );
}
