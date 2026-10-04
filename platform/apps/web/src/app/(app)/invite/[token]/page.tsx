import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { AcceptInviteButton } from "@/components/team/TeamForms";
import { getAuthContext } from "@/lib/auth-context";
import { teamService } from "@/lib/server";
import { isInviteToken } from "@/lib/team/token";
import { roleLabel } from "@/lib/team/present";

// The link carries a secret: keep it out of Referer headers and out of search results.
export const metadata = { title: "Join a team", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  if (!isInviteToken(token)) notFound();
  const ctx = await getAuthContext();
  if (!ctx) redirect(`/signin?next=${encodeURIComponent(`/invite/${token}`)}`);
  const r = await teamService(() => undefined).preview(token);
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Join a team</h1>
      {r.ok ? (
        <>
          <p className="mt-2 max-w-xl text-sm">You have been invited to join <strong>{r.orgName}</strong> as {roleLabel(r.role).toLowerCase()}, using {r.email}.</p>
          <AcceptInviteButton token={token} />
        </>
      ) : (
        <p role="alert" className="mt-2 max-w-xl text-sm">
          This invitation cannot be used with the account you are signed in to. It may have expired, been used or cancelled, or been sent to a different email address. Sign in with the address it was sent to, or ask the person who invited you for a new one. If you have no account yet, create one with that address, confirm it, then open the link again.
        </p>
      )}
    </AppShell>
  );
}
