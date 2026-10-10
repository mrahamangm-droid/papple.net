"use client";
import { useSyncExternalStore } from "react";

const utc = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " UTC";
const local = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZoneName: "short" }).format(new Date(iso));
const noop = () => () => {};

/** A booking time in the viewer's own time zone. The server (and hydration) render UTC; React then re-renders with the
 *  browser snapshot, so the text really switches to local time instead of keeping the server's text. */
export function LocalTime({ iso }: { iso: string }) {
  const inBrowser = useSyncExternalStore(noop, () => true, () => false);
  return <time dateTime={iso}>{inBrowser ? local(iso) : utc(iso)}</time>;
}
