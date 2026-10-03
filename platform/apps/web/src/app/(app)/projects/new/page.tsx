import { AppShell } from "@/components/shell/AppShell";
import { ProjectForm } from "@/components/marketplace/ProjectForm";
import { requireCapability } from "@/lib/auth-context";
import { eligibleOrgs, skillOptions } from "@/lib/marketplace/page-data";
import { aiEnabledFor, publicCategories } from "@/lib/server";

export const metadata = { title: "Post a project" };
export const dynamic = "force-dynamic";

export default async function NewProject() {
  const ctx = await requireCapability("org.read");
  const [orgs, categories, skills] = await Promise.all([eligibleOrgs(ctx, ["owner", "admin", "member"]), publicCategories(), skillOptions()]);
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Post a project</h1>
      <div className="mt-6 max-w-2xl"><ProjectForm orgs={orgs} categories={categories} skills={skills} aiOn={await aiEnabledFor()} /></div>
    </AppShell>
  );
}
