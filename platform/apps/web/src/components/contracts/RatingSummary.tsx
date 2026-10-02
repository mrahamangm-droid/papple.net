/** Aggregate only. Never takes comments or author names. */
export function RatingSummary({ avg, count }: { avg: number | null; count: number }) {
  if (!count || avg === null) return null;
  return <p className="text-sm" aria-label={`Rated ${avg} out of 5 from ${count} ${count === 1 ? "review" : "reviews"}`}>★ {avg} · {count} {count === 1 ? "review" : "reviews"}</p>;
}
