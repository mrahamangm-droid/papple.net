-- 0010 proposals. Created and changed only through RPCs; visible to the proposing org and the project's client org.

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  submitted_by uuid references auth.users (id) on delete set null,
  cover_letter text not null check (char_length(cover_letter) between 1 and 5000),
  price int not null check (price > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  delivery_days int not null check (delivery_days between 1 and 3650),
  status text not null default 'submitted' check (status in ('submitted','withdrawn','shortlisted','declined')),
  resubmit_count int not null default 0 check (resubmit_count between 0 and 1),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, org_id)
);
create index proposals_org_month_idx on public.proposals (org_id, submitted_at);
create index proposals_project_idx on public.proposals (project_id);
create trigger proposals_touch before update on public.proposals
  for each row execute function public.touch_updated_at();

create function public.is_project_client_member(p_project uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from projects p where p.id = p_project and public.is_member(p.org_id)) $$;

alter table public.proposals enable row level security;
revoke all on public.proposals from anon, public, authenticated;
grant select (id, project_id, org_id, cover_letter, price, currency, delivery_days, status, submitted_at, created_at, updated_at)
  on public.proposals to authenticated;
create policy proposals_select on public.proposals for select to authenticated
  using (public.is_member(org_id) or public.is_project_client_member(project_id) or public.is_platform_admin());

create function public.submit_proposal(
  p_org uuid, p_project uuid, p_cover_letter text, p_price bigint, p_currency text, p_delivery_days int)
returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_type text; v_proj projects%rowtype; v_id uuid; v_max int; v_used int; v_letter text := trim(coalesce(p_cover_letter, ''));
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin','member']) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  select type into v_type from organizations where id = p_org;
  if v_type is null or v_type not in ('individual','agency') then
    raise exception 'this organization type cannot submit proposals' using errcode = '22023'; end if;
  select * into v_proj from projects where id = p_project for share;
  if not found or v_proj.status <> 'open' then
    raise exception 'project is not open for proposals' using errcode = '22023'; end if;
  -- Own project, or any organization the caller also belongs to: a person controlling both sides could self-deal.
  if v_proj.org_id = p_org or public.is_member(v_proj.org_id) then
    raise exception 'cannot propose on your own project' using errcode = '42501'; end if;
  if char_length(v_letter) not between 1 and 5000 or p_price is null or p_price < 1 or p_price > 2147483647
     or p_delivery_days is null or p_delivery_days not between 1 and 3650 or p_currency is distinct from v_proj.currency then
    raise exception 'invalid proposal' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('proposals:' || p_org::text, 0)); -- serialize the limit check per org
  v_max := public.org_limit(p_org, 'limits.proposals_per_month');
  if v_max is not null then
    select count(*) into v_used from proposals
      where org_id = p_org and submitted_at >= date_trunc('month', now()) and project_id <> p_project;
    if v_used >= v_max then raise exception 'monthly proposal limit reached' using errcode = '54000'; end if;
  end if;

  insert into proposals (project_id, org_id, submitted_by, cover_letter, price, currency, delivery_days)
  values (p_project, p_org, auth.uid(), v_letter, p_price::int, p_currency, p_delivery_days)
  on conflict (project_id, org_id) do nothing returning id into v_id;
  if v_id is null then
    update proposals set cover_letter = v_letter, price = p_price::int, currency = p_currency,
      delivery_days = p_delivery_days, status = 'submitted', resubmit_count = resubmit_count + 1,
      submitted_by = auth.uid(), submitted_at = now()
    where project_id = p_project and org_id = p_org and status = 'withdrawn' and resubmit_count < 1
    returning id into v_id;
    if v_id is null then raise exception 'a proposal already exists for this project' using errcode = '23505'; end if;
  end if;
  return v_id;
end $$;

create function public.withdraw_proposal(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin','member']) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  update proposals set status = 'withdrawn'
    where id = p_id and org_id = p_org and status in ('submitted','shortlisted','declined');
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

create function public.set_proposal_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_project uuid; v_org uuid; v_old text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select pr.project_id, pj.org_id, pr.status into v_project, v_org, v_old
    from proposals pr join projects pj on pj.id = pr.project_id where pr.id = p_id;
  if not found or not public.has_org_role(v_org, array['owner','admin','member']) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status not in ('shortlisted','declined') or v_old = 'withdrawn' then
    raise exception 'invalid status change' using errcode = '22023'; end if;
  update proposals set status = p_status where id = p_id;
end $$;

revoke execute on function public.is_project_client_member(uuid),
  public.submit_proposal(uuid,uuid,text,bigint,text,int), public.withdraw_proposal(uuid,uuid),
  public.set_proposal_status(uuid,text) from public, anon, authenticated;
grant execute on function public.is_project_client_member(uuid),
  public.submit_proposal(uuid,uuid,text,bigint,text,int), public.withdraw_proposal(uuid,uuid),
  public.set_proposal_status(uuid,text) to authenticated;
