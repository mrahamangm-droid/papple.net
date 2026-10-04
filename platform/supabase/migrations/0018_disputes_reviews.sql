-- 0018 disputes (freeze + staff queue) and blind two-way reviews with a public aggregate view.

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete restrict,
  raised_by_org_id uuid not null references public.organizations (id) on delete restrict,
  reason text not null check (char_length(reason) between 10 and 2000),
  status text not null default 'open' check (status in ('open','resolved')),
  resolution text check (resolution in ('resume','complete','cancel')),
  resolution_note text check (char_length(resolution_note) <= 1000),
  resolved_by uuid references auth.users (id) on delete set null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index disputes_one_open_per_contract on public.disputes (contract_id) where status = 'open';
create index disputes_status_idx on public.disputes (status, opened_at);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete cascade,
  author_org_id uuid not null references public.organizations (id) on delete cascade,
  subject_org_id uuid not null references public.organizations (id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 2000),
  created_at timestamptz not null default now(),
  unique (contract_id, author_org_id),
  check (author_org_id <> subject_org_id)
);
create index reviews_subject_idx on public.reviews (subject_org_id);

-- A review is visible to its subject once the other side has posted, or after the reveal window (a setting).
create function public.review_published(p_contract uuid, p_created timestamptz) returns boolean
language sql stable security definer set search_path = public as
$$ select p_created + make_interval(days => public.setting_int('reviews.reveal_after_days', 14)) <= now()
       or (select count(*) from reviews where contract_id = p_contract) >= 2 $$;

alter table public.disputes enable row level security;
alter table public.reviews enable row level security;
revoke all on public.disputes, public.reviews from anon, public, authenticated;
grant select on public.disputes, public.reviews to authenticated;
create policy disputes_select on public.disputes for select to authenticated
  using (public.is_contract_party(contract_id) or public.is_platform_staff());
create policy reviews_select on public.reviews for select to authenticated
  using (public.is_member(author_org_id) or public.is_platform_staff()
         or (public.is_member(subject_org_id) and public.review_published(contract_id, created_at)));

create view public.public_provider_ratings with (security_barrier = true) as
select p.slug, round(avg(r.rating)::numeric, 2) as rating_avg, count(*)::int as rating_count
from reviews r join provider_profiles p on p.org_id = r.subject_org_id
where p.visibility = 'public' and p.status = 'active' and public.review_published(r.contract_id, r.created_at)
group by p.slug;
revoke all on public.public_provider_ratings from public;
grant select on public.public_provider_ratings to anon, authenticated;

create function public.raise_dispute(p_org uuid, p_contract uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_c contracts%rowtype; v_id uuid; v_reason text := trim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_c from contracts where id = p_contract for update;
  if not found or p_org not in (v_c.client_org_id, v_c.provider_org_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(v_reason) not between 10 and 2000 then raise exception 'please describe the problem' using errcode = '22023'; end if;
  if v_c.status <> 'active' then raise exception 'only an active contract can be disputed' using errcode = '22023'; end if;
  insert into disputes (contract_id, raised_by_org_id, reason) values (p_contract, p_org, v_reason) returning id into v_id;
  update contracts set status = 'disputed' where id = p_contract;
  perform public.notify_org(case when p_org = v_c.client_org_id then v_c.provider_org_id else v_c.client_org_id end,
    'dispute_opened', jsonb_build_object('contract_id', p_contract), auth.uid());
  return v_id;
end $$;

create function public.resolve_dispute(p_dispute uuid, p_outcome text, p_note text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_d disputes%rowtype; v_c contracts%rowtype; v_new text;
begin
  if auth.uid() is null or not public.is_platform_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'second factor required' using errcode = '42501'; end if;
  if p_outcome not in ('resume','complete','cancel') then raise exception 'invalid outcome' using errcode = '22023'; end if;
  select * into v_d from disputes where id = p_dispute for update;
  if not found or v_d.status <> 'open' then raise exception 'dispute is not open' using errcode = '22023'; end if;
  select * into v_c from contracts where id = v_d.contract_id for update;
  v_new := case p_outcome
    when 'cancel' then 'cancelled'
    when 'complete' then 'completed'
    else case when exists (select 1 from milestones where contract_id = v_c.id and status <> 'paid') then 'active' else 'completed' end end;
  update disputes set status = 'resolved', resolution = p_outcome, resolution_note = left(coalesce(p_note, ''), 1000),
    resolved_by = auth.uid(), resolved_at = now() where id = p_dispute;
  update contracts set status = v_new where id = v_c.id;
  insert into audit_log (actor_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), 'dispute.resolve', 'dispute', p_dispute::text, jsonb_build_object('contract_status', v_c.status),
          jsonb_build_object('outcome', p_outcome, 'contract_status', v_new, 'note', left(coalesce(p_note, ''), 500)),
          'success', gen_random_uuid()::text);
  perform public.notify_org(v_c.client_org_id, 'dispute_resolved', jsonb_build_object('contract_id', v_c.id, 'outcome', p_outcome));
  perform public.notify_org(v_c.provider_org_id, 'dispute_resolved', jsonb_build_object('contract_id', v_c.id, 'outcome', p_outcome));
end $$;

create function public.post_review(p_org uuid, p_contract uuid, p_rating int, p_comment text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_c contracts%rowtype; v_id uuid; v_comment text := trim(coalesce(p_comment, ''));
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_c from contracts where id = p_contract;
  if not found or p_org not in (v_c.client_org_id, v_c.provider_org_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  -- someone who sits on both sides of the contract cannot rate it
  if public.is_member(v_c.client_org_id) and public.is_member(v_c.provider_org_id) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if p_rating is null or p_rating not between 1 and 5 or char_length(v_comment) > 2000 then
    raise exception 'invalid review' using errcode = '22023'; end if;
  if v_c.status <> 'completed' then raise exception 'the contract is not completed' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('review:' || p_contract::text, 0));
  -- blind means blind: once the other side's review is visible, writing yours would be a reply, not an independent rating
  if not exists (select 1 from reviews where contract_id = p_contract and author_org_id = p_org)
     and exists (select 1 from reviews r where r.contract_id = p_contract and r.author_org_id <> p_org
                 and public.review_published(r.contract_id, r.created_at)) then
    raise exception 'the review window has closed' using errcode = '22023'; end if;
  begin
    insert into reviews (contract_id, author_org_id, subject_org_id, rating, comment)
    values (p_contract, p_org, case when p_org = v_c.client_org_id then v_c.provider_org_id else v_c.client_org_id end, p_rating, v_comment)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'you already reviewed this contract' using errcode = '23505';
  end;
  return v_id;
end $$;

revoke execute on function public.review_published(uuid, timestamptz), public.raise_dispute(uuid,uuid,text),
  public.resolve_dispute(uuid,text,text), public.post_review(uuid,uuid,int,text) from public, anon, authenticated;
grant execute on function public.review_published(uuid, timestamptz) to anon, authenticated;
grant execute on function public.raise_dispute(uuid,uuid,text), public.resolve_dispute(uuid,text,text),
  public.post_review(uuid,uuid,int,text) to authenticated;
