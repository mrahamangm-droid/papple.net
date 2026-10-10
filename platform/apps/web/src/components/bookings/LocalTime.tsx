"use client";
/** A booking time in the viewer's own time zone. The server renders UTC; the browser re-renders it locally. */
export function LocalTime({ iso }: { iso: string }) {
  const local = typeof window === "undefined"
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " UTC"
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZoneName: "short" }).format(new Date(iso));
  return <time dateTime={iso} suppressHydrationWarning>{local}</time>;
}
