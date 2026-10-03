import { AppShell } from "@/components/shell/AppShell";
import { TaxonomyForm } from "@/components/admin/ConsoleForms";
import { requireCapability } from "@/lib/auth-context";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "Taxonomy" };
export const dynamic = "force-dynamic";

export default async function TaxonomyPage() {
  const ctx = await requireCapability("platform.admin");
  const db = await createServerSupabase();
  const [{ data: cats }, { data: skills }] = await Promise.all([
    db.from("categories").select("id, slug, name, parent_id, position, is_active").order("position").order("name"),
    db.from("skills").select("id, slug, name, category_id, is_active").order("name").limit(500),
  ]);
  const topLevel = (cats ?? []).filter((c) => c.parent_id === null).map((c) => ({ id: c.id as string, name: c.name as string }));
  const allCats = (cats ?? []).map((c) => ({ id: c.id as string, name: c.name as string }));
  return (
    <AppShell ctx={ctx}>
      <h1 className="text-2xl font-semibold">Taxonomy</h1>
      <p className="mt-1 max-w-2xl text-sm opacity-80">Categories (two levels at most) and skills. Items are never deleted: deactivating one hides it from new use while existing profiles, services and projects keep it. Slugs cannot change.</p>
      <h2 className="mt-8 text-xl font-semibold">Categories</h2>
      <ul className="mt-3 space-y-4">
        {(cats ?? []).map((c) => (
          <li key={c.id as string} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <p className="font-medium">{c.name as string} <span className="text-xs opacity-70">{c.slug as string} · {c.is_active ? "active" : "inactive"}</span></p>
            <TaxonomyForm kind="category" parents={topLevel} item={{ id: c.id as string, slug: c.slug as string, name: c.name as string, parentId: c.parent_id as string | null, position: c.position as number, active: c.is_active as boolean }} />
          </li>
        ))}
      </ul>
      <h3 className="mt-6 font-medium">Add a category</h3>
      <div className="mt-2 max-w-md"><TaxonomyForm kind="category" parents={topLevel} /></div>
      <h2 className="mt-10 text-xl font-semibold">Skills</h2>
      <ul className="mt-3 space-y-4">
        {(skills ?? []).map((s) => (
          <li key={s.id as string} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <p className="font-medium">{s.name as string} <span className="text-xs opacity-70">{s.slug as string} · {s.is_active ? "active" : "inactive"}</span></p>
            <TaxonomyForm kind="skill" parents={allCats} item={{ id: s.id as string, slug: s.slug as string, name: s.name as string, parentId: s.category_id as string | null, position: 0, active: s.is_active as boolean }} />
          </li>
        ))}
      </ul>
      <h3 className="mt-6 font-medium">Add a skill</h3>
      <div className="mt-2 max-w-md"><TaxonomyForm kind="skill" parents={allCats} /></div>
    </AppShell>
  );
}
