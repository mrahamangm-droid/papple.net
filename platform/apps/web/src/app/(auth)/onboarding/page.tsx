import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase/server";
import { PERSONAS } from "@/lib/onboarding";
import { onboardAction } from "../actions";

export const metadata = { title: "Set up your account" };
export const dynamic = "force-dynamic"; // reads the session; never prerender
const LABEL: Record<(typeof PERSONAS)[number], string> = {
  client: "Client — I hire professionals",
  professional: "Professional — I offer services",
  agency: "Agency — a team offering services",
  enterprise: "Enterprise — a large organisation",
  pgan_expert: "PGAN Expert — apply as a verified expert (reviewed before listing)",
};

export default async function Onboarding({ searchParams }: PageProps<"/onboarding">) {
  if (!(await getSessionUser())) redirect("/signin");
  const error = (await searchParams).error;
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold">Tell us how you will use Papple</h1>
      {typeof error === "string" && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
      <form action={onboardAction} className="mt-6 space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Account type</legend>
          {PERSONAS.map((p, i) => (
            <label key={p} className="flex items-start gap-2 text-sm">
              <input type="radio" name="persona" value={p} required defaultChecked={i === 0} className="mt-1" /> {LABEL[p]}
            </label>
          ))}
        </fieldset>
        <label className="block text-sm">Name (yours or your organisation&apos;s)
          <input name="orgName" required minLength={2} maxLength={120} className="block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 mt-1" />
        </label>
        <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-white dark:bg-white dark:text-neutral-900">Continue</button>
      </form>
    </main>
  );
}
