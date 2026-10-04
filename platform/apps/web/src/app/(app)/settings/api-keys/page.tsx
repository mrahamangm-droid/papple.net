import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { CreateApiKeyForm, RevokeApiKeyButton } from "@/components/api/ApiKeyForms";
import { requireCapability } from "@/lib/auth-context";
import { apiKeyFailureMessage } from "@/lib/api/present";
import { isValidUuid } from "@/lib/marketplace/validators";
import { apiKeyService } from "@/lib/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "API keys" };
export const dynamic = "force-dynamic";

const ELIGIBLE = ["client_company", "enterprise", "agency"];
const when = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "Never");
const th = "py-2 pr-4 text-left font-medium";
const td = "py-2 pr-4";
const Code = ({ children }: { children: string }) => <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-900">{children}</code>;

export default async function ApiKeysPage({ searchParams }: PageProps<"/settings/api-keys">) {
  const ctx = await requireCapability("org.read");
  const sp = await searchParams;
  const wanted = (Array.isArray(sp.org) ? sp.org[0] : sp.org) ?? "";
  const owned = ctx.memberships.filter((m) => m.role === "owner").map((m) => m.orgId);
  const db = await createServerSupabase();
  const { data: orgs } = owned.length ? await db.from("organizations").select("id, name, type, status").in("id", owned) : { data: [] };
  const eligible = (orgs ?? []).filter((o) => ELIGIBLE.includes(o.type as string) && o.status === "active");
  const org = eligible.find((o) => o.id === wanted && isValidUuid(wanted)) ?? eligible[0];
  if (!org) {
    return (
      <AppShell ctx={ctx}>
        <h1 className="text-2xl font-semibold">API keys</h1>
        <p className="mt-2 max-w-2xl text-sm">{apiKeyFailureMessage("forbidden")} Client, agency and enterprise organizations can have keys.</p>
      </AppShell>
    );
  }
  const orgId = org.id as string;
  const result = await apiKeyService(() => undefined).list(orgId);
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">API keys</h1>
      <p className="mt-2 max-w-2xl text-sm">Keys give your own systems read-only access to {org.name as string}&apos;s projects, proposals, contracts and hiring analytics. Nothing can be changed, paid or sent through the API. Treat a key like a password and revoke it if it leaks.</p>
      {eligible.length > 1 && (
        <p className="mt-3 text-sm">Organization:{" "}
          {eligible.map((o) => (o.id === org.id ? <strong key={o.id as string} className="mr-3">{o.name as string}</strong> : <Link key={o.id as string} href={`/settings/api-keys?org=${o.id}`} className="mr-3 underline">{o.name as string}</Link>))}
        </p>
      )}
      <h2 className="mt-8 text-lg font-medium">Your keys</h2>
      {!result.ok ? (
        <p role="alert" className="mt-2 text-sm">{apiKeyFailureMessage(result.code)}</p>
      ) : result.keys.length === 0 ? (
        <p className="mt-2 text-sm">No keys yet.</p>
      ) : (
        <table className="mt-2 w-full max-w-3xl text-sm">
          <caption className="sr-only">API keys for {org.name as string}</caption>
          <thead><tr><th scope="col" className={th}>Name</th><th scope="col" className={th}>Starts with</th><th scope="col" className={th}>Created</th><th scope="col" className={th}>Created by</th><th scope="col" className={th}>Last used</th><th scope="col" className={th}>Status</th></tr></thead>
          <tbody>
            {result.keys.map((k) => (
              <tr key={k.id} className="border-t border-neutral-200 dark:border-neutral-800">
                <th scope="row" className={`${td} font-medium`}>{k.name}</th>
                <td className={td}><Code>{`pap_${k.prefix}…`}</Code></td>
                <td className={td}>{when(k.createdAt)}</td>
                <td className={td}>{k.createdByName}</td>
                <td className={td}>{when(k.lastUsedAt)}</td>
                <td className={td}>{k.revokedAt ? `Revoked ${when(k.revokedAt)}` : (
                    <>
                      <span className="mr-2">{k.creatorActive ? "Active" : "Paused: its creator is no longer an owner"}</span>
                      <RevokeApiKeyButton orgId={orgId} id={k.id} name={k.name} />
                    </>
                  )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2 className="mt-8 text-lg font-medium">Create a key</h2>
      <CreateApiKeyForm key={orgId} orgId={orgId} />
      <h2 className="mt-8 text-lg font-medium">Using the API</h2>
      <p className="mt-2 max-w-2xl text-sm">Send the key as a bearer token. Every endpoint answers <Code>GET</Code> with JSON, newest first, up to 60 requests a minute per key. A key stops working if its plan no longer includes API access, and pauses if the person who created it is no longer an owner.</p>
      <pre className="mt-2 max-w-3xl overflow-x-auto rounded-lg bg-neutral-100 p-3 text-xs dark:bg-neutral-900"><code>{`curl -H "Authorization: Bearer pap_YOUR_KEY" \\
  "https://YOUR-DOMAIN/api/v1/projects?limit=50"`}</code></pre>
      <ul className="mt-3 max-w-2xl list-disc space-y-1 pl-5 text-sm">
        <li><Code>/api/v1/projects</Code> your projects and how many proposals each has.</li>
        <li><Code>/api/v1/proposals</Code> proposals on your projects (add <Code>?project_id=</Code> to narrow). Cover letters are not included.</li>
        <li><Code>/api/v1/contracts</Code> your contracts with provider, status and price.</li>
        <li><Code>/api/v1/analytics</Code> the same numbers as the analytics page (<Code>?days=</Code> up to your plan&apos;s window).</li>
      </ul>
      <p className="mt-3 max-w-2xl text-sm">Lists return <Code>{`{ "data": [...], "next": "…" }`}</Code>; pass <Code>next</Code> back as <Code>?after=</Code> for the following page. Amounts are in minor units (cents) with their currency and are never added across currencies.</p>
    </AppShell>
  );
}
