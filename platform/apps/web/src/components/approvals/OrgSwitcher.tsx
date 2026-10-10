/** Plain GET form so people in several organizations can pick which one a page shows. */
export function OrgSwitcher({ orgId, orgs }: { orgId: string; orgs: { id: string; name: string }[] }) {
  if (orgs.length < 2) return null;
  return (
    <form className="mt-3 flex items-end gap-2 text-sm" method="get">
      <label>Organization
        <select name="org" defaultValue={orgId} className="ml-2 rounded-md border border-neutral-300 bg-transparent px-2 py-1">
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
      <button className="rounded-md border border-neutral-400 px-3 py-1">Switch</button>
    </form>
  );
}
