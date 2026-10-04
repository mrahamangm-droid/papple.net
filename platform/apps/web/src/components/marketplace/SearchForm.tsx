/** Plain GET form: works without JavaScript and keeps every search a shareable URL. */
export function SearchForm({ kind, q, category, country, categories }: {
  kind: "providers" | "services"; q?: string; category?: string; country?: string; categories: { id: string; name: string }[];
}) {
  const field = "mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-600";
  return (
    <form method="get" action="/explore" role="search" aria-label="Search the marketplace" className="grid gap-3 sm:grid-cols-4">
      <label className="block text-sm sm:col-span-2">Search
        <input name="q" type="search" defaultValue={q ?? ""} maxLength={200} placeholder="Skill, trade or keyword" className={field} />
      </label>
      <label className="block text-sm">Looking for
        <select name="kind" defaultValue={kind} className={field}>
          <option value="providers">Professionals</option>
          <option value="services">Services</option>
        </select>
      </label>
      <label className="block text-sm">Country (2-letter code)
        <input name="country" defaultValue={country ?? ""} maxLength={2} className={field} />
      </label>
      {categories.length > 0 && (
        <label className="block text-sm sm:col-span-2">Category
          <select name="category" defaultValue={category ?? ""} className={field}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      <div className="sm:col-span-4"><button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white">Search</button></div>
    </form>
  );
}
