/** Always posts an explicit orgId. One eligible org is shown and fixed; several require a deliberate choice. */
export function OrgPicker({ orgs, name = "orgId" }: { orgs: { id: string; name: string }[]; name?: string }) {
  if (orgs.length === 0) return <p role="alert" className="text-sm">You are not allowed to do this with any of your organizations.</p>;
  if (orgs.length === 1) {
    return (
      <div className="text-sm">
        <input type="hidden" name={name} value={orgs[0].id} />
        Acting as <strong>{orgs[0].name}</strong>
      </div>
    );
  }
  return (
    <label className="block text-sm">Acting as
      <select name={name} required defaultValue="" className="mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2">
        <option value="" disabled>Choose an organization</option>
        {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}
