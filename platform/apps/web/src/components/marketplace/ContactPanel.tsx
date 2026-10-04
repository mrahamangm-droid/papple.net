import { getAuthContext } from "@/lib/auth-context";
import { eligibleOrgs } from "@/lib/marketplace/page-data";
import { ContactForm } from "./ContactForm";
import { ReportButton } from "./ReportButton";

async function viewerOrgs(): Promise<{ id: string; name: string }[] | null> {
  try {
    const ctx = await getAuthContext();
    return ctx ? await eligibleOrgs(ctx, ["owner", "admin", "member"]) : null;
  } catch {
    return null; // any auth hiccup degrades to the sign-in prompt
  }
}

/** Shown on public pages: sign-in prompt for visitors, message + report for signed-in users. Never throws. */
export async function ContactPanel({ kind, refId, path }: { kind: "service" | "profile"; refId: string; path: string }) {
  const orgs = await viewerOrgs();
  if (orgs === null) {
    return <p className="mt-10 text-sm"><a href={`/signin?next=${encodeURIComponent(path)}`} className="underline">Sign in to contact this {kind === "service" ? "provider" : "professional"}</a></p>;
  }
  return (
    <section aria-label="Contact" className="mt-10 space-y-4">
      <h2 className="text-lg font-semibold">Send a message</h2>
      <ContactForm kind={kind} refId={refId} orgs={orgs} />
      <ReportButton kind={kind} id={refId} />
    </section>
  );
}
