-- 0024 provider verification. Papple reviews evidence the provider supplies; it is NOT a licence or credential certification.
alter table public.provider_profiles add column verified_at timestamptz;

create table public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null,
  evidence_note text not null check (char_length(evidence_note) between 10 and 1000),
  evidence_url text check (evidence_url is null or (evidence_url ~ '^https://' and char_length(evidence_url) <= 500)),
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  review_note text check (review_note is null or char_length(review_note) between 10 and 1000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index verification_one_pending on public.verification_requests (org_id) where status = 'pending';
create index verification_requests_status_idx on public.verification_requests (status, created_at);

alter table public.verification_requests enable row level security;
revoke all on public.verification_requests from anon, public, authenticated;
grant select on public.verification_requests to authenticated;
create policy verification_select on public.verification_requests for select to authenticated
  using (public.has_org_role(org_id, array['owner','admin']) or public.is_platform_staff());

create function public.request_verification(p_org uuid, p_note text, p_url text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_note text := trim(coalesce(p_note, '')); v_url text := nullif(trim(coalesce(p_url, '')), ''); v_prof provider_profiles%rowtype; v_id uuid;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(v_note) not between 10 and 1000 then raise exception 'please describe your evidence' using errcode = '22023'; end if;
  if v_url is not null and (v_url !~ '^https://' or char_length(v_url) > 500) then raise exception 'evidence link must be https' using errcode = '22023'; end if;
  select * into v_prof from provider_profiles where org_id = p_org for update;
  if not found or v_prof.status <> 'active' or v_prof.verified_at is not null then raise exception 'cannot request verification' using errcode = '22023'; end if;
  if exists (select 1 from verification_requests where org_id = p_org and status = 'pending') then raise exception 'a request is already pending' using errcode = '22023'; end if;
  insert into verification_requests (org_id, requested_by, evidence_note, evidence_url) values (p_org, auth.uid(), v_note, v_url) returning id into v_id;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, after, outcome, request_id)
  values (auth.uid(), p_org, 'verification.request', 'verification_request', v_id::text, jsonb_build_object('has_url', v_url is not null), 'success', gen_random_uuid()::text);
  return v_id;
end $$;

create function public.review_verification(p_request uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_note text := public.admin_guard(p_note); v_r verification_requests%rowtype; v_status text;
begin
  if p_decision not in ('approved','rejected') then raise exception 'invalid decision' using errcode = '22023'; end if;
  select * into v_r from verification_requests where id = p_request for update;
  if not found or v_r.status <> 'pending' then raise exception 'request is not pending' using errcode = '22023'; end if;
  if p_decision = 'approved' then
    update provider_profiles set verified_at = now() where org_id = v_r.org_id and status = 'active';
    if not found then raise exception 'provider profile is not active' using errcode = '22023'; end if;
  end if;
  update verification_requests set status = p_decision, review_note = v_note, reviewed_by = auth.uid(), reviewed_at = now() where id = p_request;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), v_r.org_id, 'verification.review', 'verification_request', p_request::text, jsonb_build_object('status', 'pending'),
          jsonb_build_object('status', p_decision, 'reason', left(v_note, 500)), 'success', gen_random_uuid()::text);
  perform public.notify_org(v_r.org_id, 'verification_' || p_decision, jsonb_build_object('request_id', p_request));
end $$;

create function public.revoke_verification(p_org uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_reason text := public.admin_guard(p_reason);
begin
  update provider_profiles set verified_at = null where org_id = p_org and verified_at is not null;
  if not found then raise exception 'organization is not verified' using errcode = '22023'; end if;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, after, outcome, request_id)
  values (auth.uid(), p_org, 'verification.revoke', 'organization', p_org::text, jsonb_build_object('reason', left(v_reason, 500)), 'success', gen_random_uuid()::text);
  perform public.notify_org(p_org, 'verification_revoked', '{}'::jsonb);
end $$;

revoke execute on function public.request_verification(uuid, text, text), public.review_verification(uuid, text, text), public.revoke_verification(uuid, text) from public, anon;
grant execute on function public.request_verification(uuid, text, text), public.review_verification(uuid, text, text), public.revoke_verification(uuid, text) to authenticated;

-- Appended column only, so existing consumers keep working.
create or replace view public.public_provider_cards with (security_barrier = true) as
select p.id, p.slug, p.headline, left(p.summary, 400) as summary, o.name as display_name, o.type as entity_type,
       p.country, p.languages, p.hourly_min, p.hourly_max, p.currency, p.availability, p.updated_at,
       coalesce((select array_agg(s.name order by s.name) from provider_skills ps join skills s on s.id = ps.skill_id
                 where ps.profile_id = p.id and s.is_active), '{}') as skills,
       (p.verified_at is not null) as verified
from provider_profiles p join organizations o on o.id = p.org_id
where p.visibility = 'public' and p.status = 'active' and o.status = 'active';
