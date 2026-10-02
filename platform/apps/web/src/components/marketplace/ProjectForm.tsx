"use client";
import { useRouter } from "next/navigation";
import { saveProject } from "@/app/(app)/marketplace-actions";
import { Button } from "@/components/ui/Button";
import { OrgPicker } from "./OrgPicker";
import { FormError, cur, fieldClass, money, str, useAction } from "./useAction";

export function ProjectForm({ orgs, categories, skills }: { orgs: { id: string; name: string }[]; categories: { id: string; name: string }[]; skills: { id: string; name: string }[] }) {
  const router = useRouter();
  const { pending, error, run } = useAction((r) => router.push(r.id ? `/projects/${r.id}` : "/projects"));
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run(() => saveProject({
        orgId: str(f, "orgId"), title: str(f, "title"), description: str(f, "description"), categoryId: str(f, "categoryId"),
        budgetMin: money(f, "budgetMin", cur(f)), budgetMax: money(f, "budgetMax", cur(f)), currency: cur(f),
        deadline: str(f, "deadline"), visibility: str(f, "visibility"), skillIds: f.getAll("skillIds").map(String),
      }));
    }}>
      <OrgPicker orgs={orgs} />
      <label className="block text-sm">Project title<input name="title" required minLength={5} maxLength={150} className={fieldClass} /></label>
      <label className="block text-sm">What do you need done?<textarea name="description" required minLength={5} maxLength={10000} rows={7} className={fieldClass} /></label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">Budget from<input name="budgetMin" type="number" min={0} step="0.01" className={fieldClass} /></label>
        <label className="block text-sm">Budget to<input name="budgetMax" type="number" min={0} step="0.01" className={fieldClass} /></label>
        <label className="block text-sm">Currency<input name="currency" maxLength={3} defaultValue="USD" className={fieldClass} /></label>
        <label className="block text-sm">Deadline<input name="deadline" type="date" className={fieldClass} /></label>
        {categories.length > 0 && (
          <label className="block text-sm">Category
            <select name="categoryId" defaultValue="" className={fieldClass}><option value="">None</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        )}
        <label className="block text-sm">Visibility
          <select name="visibility" defaultValue="members_only" className={fieldClass}>
            <option value="members_only">Signed-in professionals only</option><option value="public">Public teaser allowed</option>
          </select></label>
      </div>
      {skills.length > 0 && (
        <fieldset className="text-sm"><legend>Skills needed</legend>
          <div className="mt-1 grid max-h-40 gap-1 overflow-auto sm:grid-cols-2">
            {skills.map((s) => <label key={s.id} className="flex items-center gap-2"><input type="checkbox" name="skillIds" value={s.id} />{s.name}</label>)}
          </div>
        </fieldset>
      )}
      <p className="text-xs opacity-70">Saved as a draft first. Publish it from the project page when you are ready.</p>
      <FormError error={error} />
      <Button disabled={pending}>{pending ? "Saving…" : "Save draft"}</Button>
    </form>
  );
}
