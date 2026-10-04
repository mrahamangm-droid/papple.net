import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { AddMemberButton, DeletePoolButton, InviteForm, MemberNoteForm, RemoveMemberButton } from "@/components/talent/TalentForms";
import { requireCapability } from "@/lib/auth-context";
import { isValidUuid } from "@/lib/marketplace/validators";
import { createServerSupabase } from "@/lib/supabase/server";
import { availabilityLabel } from "@/lib/talent/present";
import { notFound } from "next/navigation";

export const metadata = { title: "Talent pool" };
export const dynamic = "force-dynamic";

interface Member { profile_id: string; slug: string; headline: string; country: string | null; availability: string; note: string | null; tags: string[]; checked_credentials: number; invited_projects: number }
/** Keep only characters that are safe inside a PostgREST filter value. */
const safeTerm = (q: string) => q.replace(/[^\p{L}\p{N}.\- ]/gu, "").trim().slice(0, 60);

export default async function PoolPage({ params, searchParams }: PageProps<"/talent/[id]">) {
  const ctx = await requireCapability("org.read");
  const { id } = await params;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  if (!isValidUuid(id)) notFound();
  const db = await createServerSupabase();
  const { data: pool } = await db.from("talent_pools").select("id, org_id, name, description").eq("id", id).maybeSingle();
  if (!pool) notFound();
  const orgId = pool.org_id as string;
  const role = ctx.memberships.find((m) => m.orgId === orgId)?.role;
  if (!role) notFound();
  const canWrite = role === "owner" || role === "admin" || role === "member";
  const canManage = role === "owner" || role === "admin";
  const q = safeTerm(one(sp.find));
  const [{ data: members, error }, { data: projects, error: projectsError }, found] = await Promise.all([
    db.rpc("pool_members", { p_org: orgId, p_pool: id }),
    db.from("projects").select("id, title").eq("org_id", orgId).eq("status", "open").order("created_at", { ascending: false }).limit(50),
    canWrite && q
      ? db.from("public_provider_cards").select("id, slug, headline, display_name").or(`headline.ilike.%${q}%,display_name.ilike.%${q}%`).limit(10)
      : Promise.resolve({ data: [] as { id: string; slug: string; headline: string; display_name: string }[] }),
  ]);
  const searchFailed = Boolean(q) && "error" in found && Boolean(found.error);
  const have = new Set(((members ?? []) as Member[]).map((m) => m.profile_id));
  return (
    <AppShell ctx={ctx}>
      <p className="text-sm"><Link href={`/talent?org=${orgId}`} className="underline">All pools</Link></p>
      <h1 className="mt-2 text-2xl font-semibold">{pool.name as string}</h1>
      {pool.description && <p className="mt-1 text-sm">{pool.description as string}</p>}
      {error && <p role="alert" className="mt-4 text-sm">Members could not be loaded. Please refresh.</p>}
      {projectsError && <p role="alert" className="mt-4 text-sm">Your open projects could not be loaded, so invitations are unavailable. Please refresh.</p>}
      <ul className="mt-6 space-y-6">
        {((members ?? []) as Member[]).map((m) => (
          <li key={m.profile_id} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <p className="font-medium"><Link href={`/p/${m.slug}`} className="underline">{m.headline}</Link></p>
            <p className="mt-1 text-sm opacity-80">
              {availabilityLabel(m.availability)}{m.country ? ` · ${m.country}` : ""}
              {Number(m.checked_credentials) > 0 ? ` · ${Number(m.checked_credentials)} credential${Number(m.checked_credentials) === 1 ? "" : "s"} checked by PAPple` : ""}
              {Number(m.invited_projects) > 0 ? ` · invited to ${Number(m.invited_projects)} of your projects` : ""}
            </p>
            {m.tags.length > 0 && <p className="mt-1 text-sm">{m.tags.map((t) => `#${t}`).join(" ")}</p>}
            {m.note && <p className="mt-1 whitespace-pre-line text-sm">{m.note}</p>}
            {canWrite && (
              <>
                <details className="mt-2"><summary className="cursor-pointer text-sm underline">Edit note and tags</summary>
                  <MemberNoteForm orgId={orgId} poolId={id} profileId={m.profile_id} name={m.headline} note={m.note ?? ""} tags={m.tags} />
                </details>
                <details className="mt-2"><summary className="cursor-pointer text-sm underline">Invite to a project</summary>
                  <InviteForm orgId={orgId} profileId={m.profile_id} name={m.headline} projects={(projects ?? []) as { id: string; title: string }[]} />
                </details>
                <div className="mt-2"><RemoveMemberButton orgId={orgId} poolId={id} profileId={m.profile_id} name={m.headline} /></div>
              </>
            )}
          </li>
        ))}
        {(members ?? []).length === 0 && !error && <li className="text-sm">Nobody here yet. Find professionals below.</li>}
      </ul>
      {canWrite && (
        <section className="mt-8">
          <h2 className="font-medium">Find professionals to add</h2>
          <form action={`/talent/${id}`} className="mt-2 flex max-w-xl gap-2">
            <label className="flex-1 text-sm">Search by name or headline
              <input name="find" defaultValue={q} maxLength={60} className="mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2" />
            </label>
            <button className="self-end rounded-md border border-neutral-400 px-3 py-2 text-sm">Search</button>
          </form>
          {q && (
            <ul className="mt-3 divide-y divide-neutral-200 dark:divide-neutral-800">
              {((found.data ?? []) as { id: string; slug: string; headline: string; display_name: string }[]).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>{c.display_name} <span className="opacity-70">{c.headline}</span></span>
                  {have.has(c.id) ? <span>Already in this pool</span> : <AddMemberButton orgId={orgId} poolId={id} profileId={c.id} name={c.display_name} />}
                </li>
              ))}
              {searchFailed && <li role="alert" className="py-2 text-sm">The search failed. Please try again.</li>}
              {!searchFailed && (found.data ?? []).length === 0 && <li className="py-2 text-sm">No public professionals match that search.</li>}
            </ul>
          )}
        </section>
      )}
      {canManage && <div className="mt-8"><DeletePoolButton orgId={orgId} id={id} name={pool.name as string} /></div>}
    </AppShell>
  );
}
