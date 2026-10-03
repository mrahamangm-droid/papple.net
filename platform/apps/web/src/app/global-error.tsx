"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "6rem 1rem", textAlign: "center" }}>
        <h1>Something went wrong</h1>
        <p>An unexpected error stopped the app. You can try again.</p>
        {error.digest && <p style={{ fontSize: "0.75rem", color: "#666" }}>Reference: {error.digest}</p>}
        <button onClick={() => reset()}>Try again</button>
      </body>
    </html>
  );
}
