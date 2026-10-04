-- From the whole-branch review: (a) premoderated projects need a way out of pending_review;
-- (b) signed-in users need match candidates and proposer labels, which member-only RLS on base tables hides.

-- (a) Staff review of a premoderated project. Mirrors admin_set_visibility: staff + second factor, audited.
create function public.admin_review_project(p_id uuid, p_approve boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_after text;
begin
  if auth.uid() is null or not public.is_platform_staff() then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'second factor required' using errcode = '42501'; end if;
  v_after := case when p_approve then 'open' else 'draft' end;
  update projects set status = v_after where id = p_id and status = 'pending_review';
  if not found then raise exception 'project is not awaiting review' using errcode = '22023'; end if;
  insert into audit_log (actor_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), case when p_approve then 'marketplace.approve' else 'marketplace.reject' end, 'project', p_id::text,
          jsonb_build_object('status', 'pending_review'), jsonb_build_object('status', v_after, 'reason', left(coalesce(p_reason, ''), 500)),
          'success', gen_random_uuid()::text);
end $$;
revoke execute on function public.admin_review_project(uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.admin_review_project(uuid,boolean,text) to authenticated;

-- (b1) Match candidates for signed-in users: public, active providers only, never the viewer's own organizations,
-- no organization ids. Carries skill and category ids so the matcher can work.
create view public.provider_match_candidates with (security_barrier = true) as
select p.id, p.slug, p.headline, p.hourly_min, p.hourly_max, p.availability, p.languages,
       coalesce((select array_agg(ps.skill_id) from provider_skills ps join skills s on s.id = ps.skill_id
                 where ps.profile_id = p.id and s.is_active), '{}'::uuid[]) as skill_ids,
       coalesce((select array_agg(distinct sv.category_id) from services sv
                 where sv.org_id = p.org_id and sv.status = 'published' and sv.category_id is not null), '{}'::uuid[]) as category_ids
from provider_profiles p join organizations o on o.id = p.org_id
where p.visibility = 'public' and p.status = 'active' and o.status = 'active' and not public.is_member(p.org_id);
revoke all on public.provider_match_candidates from public, anon;
grant select on public.provider_match_candidates to authenticated;

-- (b2) Who sent each proposal, for the project's client and for the proposer only. Slug only when the profile is public.
create view public.proposal_providers with (security_barrier = true) as
select pr.id as proposal_id, pr.project_id, p.headline,
       case when p.visibility = 'public' and p.status = 'active' then p.slug end as slug
from proposals pr join provider_profiles p on p.org_id = pr.org_id
where public.is_project_client_member(pr.project_id) or public.is_member(pr.org_id);
revoke all on public.proposal_providers from public, anon;
grant select on public.proposal_providers to authenticated;
