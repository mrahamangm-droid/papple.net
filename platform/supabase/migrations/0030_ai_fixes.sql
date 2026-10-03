-- 0030 review fixes for AI metering: abandoned reservations expire, direct calls are rate limited, a missing allowance fails closed.
insert into public.platform_settings (key, value, description)
values ('ai.monthly_message_limits', '{"free":20,"professional_plus":200,"business":1000,"enterprise":null}', 'Per-plan monthly AI message caps (null = by contract)')
on conflict (key) do nothing;

create or replace function public.ai_reserve(p_org uuid, p_feature text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_id uuid; v_month_limit int; v_cap_json jsonb; v_cap int; v_used int; v_today int; v_recent int;
begin
  if auth.uid() is null or not public.is_member(p_org) or not public.ai_flag_on(p_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_feature is null or p_feature not in ('proposal_draft','polish_profile','polish_service','improve_brief') then
    raise exception 'unknown feature' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('ai_reserve'));
  -- A reservation never finished (crash, timeout) stops counting after two minutes.
  select count(*) into v_recent from ai_usage where user_id = auth.uid() and created_at > now() - interval '1 minute';
  if v_recent >= 10 then raise exception 'too many requests' using errcode = '54000'; end if;
  if not exists (select 1 from platform_settings where key = 'ai.monthly_message_limits') then
    raise exception 'allowance not configured' using errcode = '54000';
  end if;
  v_month_limit := public.org_limit(p_org, 'ai.monthly_message_limits');
  select count(*) into v_used from ai_usage
    where org_id = p_org and created_at >= date_trunc('month', now())
      and (outcome = 'ok' or (outcome = 'reserved' and created_at > now() - interval '2 minutes'));
  if v_month_limit is not null and v_used >= v_month_limit then
    raise exception 'monthly AI allowance used' using errcode = '54000';
  end if;
  select value into v_cap_json from platform_settings where key = 'ai.daily_request_cap';
  if v_cap_json is not null and jsonb_typeof(v_cap_json) = 'number' then
    v_cap := (v_cap_json #>> '{}')::int;
    select count(*) into v_today from ai_usage
      where created_at >= date_trunc('day', now())
        and (outcome = 'ok' or (outcome = 'reserved' and created_at > now() - interval '2 minutes'));
    if v_today >= v_cap then raise exception 'daily AI cap reached' using errcode = '54000'; end if;
  end if;
  insert into ai_usage (user_id, org_id, feature) values (auth.uid(), p_org, p_feature) returning id into v_id;
  return v_id;
end $$;

create or replace function public.ai_usage_summary(p_days int default 30)
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
      from ai_usage u join organizations o on o.id = u.org_id where u.created_at >= v_since group by o.id, o.name
    order by 1, 3 desc;
end $$;
