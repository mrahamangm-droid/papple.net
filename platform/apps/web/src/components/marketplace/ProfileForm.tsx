"use client";
import { useRouter } from "next/navigation";
import { polishTextAi } from "@/app/(app)/ai-actions";
import { saveProfile } from "@/app/(app)/marketplace-actions";
import { Button } from "@/components/ui/Button";
import { fromMinor } from "@/lib/marketplace/present";
import { AiAssist } from "./AiAssist";
import { FormError, cur, fieldClass, money, str, useAction } from "./useAction";

export interface ProfileDefaults {
  headline?: string; summary?: string; country?: string; languages?: string[]; hourlyMin?: number | null; hourlyMax?: number | null;
  currency?: string; availability?: string; visibility?: string; skillIds?: string[];
}

export function ProfileForm({ orgId, defaults = {}, skills, aiOn = false }: { orgId: string; defaults?: ProfileDefaults; skills: { id: string; name: string }[]; aiOn?: boolean }) {
  const router = useRouter();
  const { pending, error, run } = useAction(() => router.refresh());
  const major = (v?: number | null) => (v == null ? "" : String(fromMinor(v, defaults.currency ?? "USD")));
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      run(() => saveProfile({
        orgId, headline: str(f, "headline"), summary: str(f, "summary") ?? "", country: str(f, "country"),
        languages: (str(f, "languages") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        hourlyMin: money(f, "hourlyMin", cur(f)), hourlyMax: money(f, "hourlyMax", cur(f)), currency: cur(f),
        availability: str(f, "availability"), visibility: str(f, "visibility"), skillIds: f.getAll("skillIds").map(String),
      }));
    }}>
      <label className="block text-sm">Headline<input name="headline" required minLength={3} maxLength={120} defaultValue={defaults.headline} className={fieldClass} /></label>
      <label className="block text-sm">About you<textarea name="summary" rows={6} maxLength={5000} defaultValue={defaults.summary} className={fieldClass} /></label>
      {aiOn && <AiAssist target="summary" label="Improve with AI" action={polishTextAi} build={(f) => { const text = str(f, "summary"); return text && text.length >= 10 ? { orgId, kind: "profile", text } : null; }} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">Country (2 letters)<input name="country" maxLength={2} defaultValue={defaults.country} className={fieldClass} /></label>
        <label className="block text-sm">Currency<input name="currency" maxLength={3} defaultValue={defaults.currency ?? "USD"} className={fieldClass} /></label>
        <label className="block text-sm">Languages (comma separated)<input name="languages" defaultValue={defaults.languages?.join(", ")} className={fieldClass} /></label>
        <label className="block text-sm">Hourly rate from<input name="hourlyMin" type="number" min={0} step="0.01" defaultValue={major(defaults.hourlyMin)} className={fieldClass} /></label>
        <label className="block text-sm">Hourly rate to<input name="hourlyMax" type="number" min={0} step="0.01" defaultValue={major(defaults.hourlyMax)} className={fieldClass} /></label>
        <label className="block text-sm">Availability
          <select name="availability" defaultValue={defaults.availability ?? "available"} className={fieldClass}>
            <option value="available">Available</option><option value="limited">Limited</option><option value="unavailable">Not available</option>
          </select></label>
      </div>
      <label className="block text-sm">Visibility
        <select name="visibility" defaultValue={defaults.visibility ?? "public"} className={fieldClass}>
          <option value="public">Public — listed in search and on the web</option><option value="private">Private — hidden from the public</option>
        </select></label>
      {skills.length > 0 && (
        <fieldset className="text-sm"><legend>Skills</legend>
          <div className="mt-1 grid max-h-48 gap-1 overflow-auto sm:grid-cols-2">
            {skills.map((s) => (
              <label key={s.id} className="flex items-center gap-2"><input type="checkbox" name="skillIds" value={s.id} defaultChecked={defaults.skillIds?.includes(s.id)} />{s.name}</label>
            ))}
          </div>
        </fieldset>
      )}
      <FormError error={error} />
      <Button disabled={pending}>{pending ? "Saving…" : "Save profile"}</Button>
    </form>
  );
}
