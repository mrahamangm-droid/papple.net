-- 0029 AI assistant metering. Usage is reserved before a model call and finished after it; prompts and answers are never stored.
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  feature text not null check (feature in ('proposal_draft','polish_profile','polish_service','improve_brief')),
  tokens_in int not null default 0 check (tokens_in between 0 and 1000000),
  tokens_out int not null default 0 check (tokens_out between 0 and 1000000),
  outcome text not null default 'reserved' check (outcome in ('reserved','ok','error')),
  created_at timestamptz not null default now()
);
create index ai_usage_org_idx on public.ai_usage (org_id, created_at desc);
create index ai_usage_day_idx on public.ai_usage (created_at desc);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from public, anon, authenticated;
-- No direct access for anyone: every read and write goes through the security definer functions below.
create policy ai_usage_no_direct_access on public.ai_usage for all to authenticated using (false) with check (false);

insert into public.platform_settings (key, value, description)
values ('ai.daily_request_cap', '2000', 'Global cap on AI requests per day (0 = off, null = unlimited)')
on conflict (key) do nothing;
insert into public.feature_flags (key, enabled, description)
values ('ai.assistant', false, 'AI assistant surfaces')
on conflict (key) do nothing;

-- Per-organization override wins over the global flag; a missing flag is off.
create function public.ai_flag_on(p_org uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(
  (select enabled from feature_flag_overrides where key = 'ai.assistant' and org_id = p_org),
  (select enabled from feature_flags where key = 'ai.assistant'),
  false) $$;

create function public.ai_reserve(p_org uuid, p_feature text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_id uuid; v_month_limit int; v_cap_json jsonb; v_cap int; v_used int; v_today int;
begin
  if auth.uid() is null or not public.is_member(p_org) or not public.ai_flag_on(p_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_feature is null or p_feature not in ('proposal_draft','polish_profile','polish_service','improve_brief') then
    raise exception 'unknown feature' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('ai_reserve'));
  v_month_limit := public.org_limit(p_org, 'ai.monthly_message_limits');
  select count(*) into v_used from ai_usage
    where org_id = p_org and outcome in ('reserved','ok') and created_at >= date_trunc('month', now());
  if v_month_limit is not null and v_used >= v_month_limit then
    raise exception 'monthly AI allowance used' using errcode = '54000';
  end if;
  select value into v_cap_json from platform_settings where key = 'ai.daily_request_cap';
  if v_cap_json is not null and jsonb_typeof(v_cap_json) = 'number' then
    v_cap := (v_cap_json #>> '{}')::int;
    select count(*) into v_today from ai_usage
      where outcome in ('reserved','ok') and created_at >= date_trunc('day', now());
    if v_today >= v_cap then raise exception 'daily AI cap reached' using errcode = '54000'; end if;
  end if;
  insert into ai_usage (user_id, org_id, feature) values (auth.uid(), p_org, p_feature) returning id into v_id;
  return v_id;
end $$;

create function public.ai_finish(p_id uuid, p_in int, p_out int, p_outcome text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_user uuid; v_outcome text;
begin
  if auth.uid() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_outcome is null or p_outcome not in ('ok','error') then raise exception 'invalid outcome' using errcode = '22023'; end if;
  select user_id, outcome into v_user, v_outcome from ai_usage where id = p_id for update;
  if not found or v_user <> auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_outcome <> 'reserved' then raise exception 'already finished' using errcode = '22023'; end if;
  update ai_usage set outcome = p_outcome,
    tokens_in = least(greatest(coalesce(p_in, 0), 0), 1000000),
    tokens_out = least(greatest(coalesce(p_out, 0), 0), 1000000)
  where id = p_id;
end $$;

-- Admin only (not support), second factor required. Counts finished ok calls and errors separately.
create function public.ai_usage_summary(p_days int default 30)
returns table (kind text, label text, calls bigint, errors bigint, tokens_in bigint, tokens_out bigint)
language plpgsql stable security definer set search_path = public as
$$ declare v_days int := least(greatest(coalesce(p_days, 30), 1), 90); v_since timestamptz;
begin
  if auth.uid() is null or not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'second factor required' using errcode = '42501'; end if;
  v_since := now() - make_interval(days => v_days);
  return query
    select 'feature'::text, u.feature, count(*) filter (where u.outcome = 'ok'), count(*) filter (where u.outcome = 'error'),
           coalesce(sum(u.tokens_in), 0)::bigint, coalesce(sum(u.tokens_out), 0)::bigint
      from ai_usage u where u.created_at >= v_since group by u.feature
    union all
    select 'org'::text, o.name, count(*) filter (where u.outcome = 'ok'), count(*) filter (where u.outcome = 'error'),
           coalesce(sum(u.tokens_in), 0)::bigint, coalesce(sum(u.tokens_out), 0)::bigint
      from ai_usage u join organizations o on o.id = u.org_id where u.created_at >= v_since group by o.name
    order by 1, 3 desc;
end $$;

revoke execute on function public.ai_flag_on(uuid), public.ai_reserve(uuid, text), public.ai_finish(uuid, int, int, text),
  public.ai_usage_summary(int) from public, anon, authenticated;
grant execute on function public.ai_reserve(uuid, text), public.ai_finish(uuid, int, int, text), public.ai_usage_summary(int) to authenticated;
