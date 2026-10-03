-- 0031 plans and billing. Stripe is the source of truth; this mirrors it. Only the verified webhook (service role) writes subscriptions.
create table public.subscriptions (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  plan_key text not null references public.plans (key),
  status text not null check (status in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),
  stripe_customer_id text,
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  past_due_since timestamptz,
  event_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from public, anon, authenticated;
-- Members read the plan state, never the Stripe identifiers.
grant select (org_id, plan_key, status, current_period_end, cancel_at_period_end, past_due_since, updated_at) on public.subscriptions to authenticated;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (public.is_member(org_id) or public.is_platform_admin());

insert into public.platform_settings (key, value, description)
values ('billing.grace_days', '7', 'Days a past-due subscription keeps its plan before the organization returns to free')
on conflict (key) do nothing;

create or replace function public.org_plan_key(p_org uuid) returns text
language sql stable security definer set search_path = public as
$$ select coalesce(
  (select s.plan_key from subscriptions s join plans p on p.key = s.plan_key and p.active
    where s.org_id = p_org
      and (s.status in ('active','trialing')
           or (s.status = 'past_due' and s.past_due_since > now() - make_interval(days => public.setting_int('billing.grace_days', 7))))),
  'free') $$;

create function public.sub_status_rank(p_status text) returns int language sql immutable as
$$ select case p_status when 'incomplete' then 0 when 'incomplete_expired' then 1 when 'paused' then 2 when 'unpaid' then 2 when 'past_due' then 3
  when 'trialing' then 4 when 'active' then 5 when 'canceled' then 6 else -1 end $$;

create function public.apply_subscription_event(p_org uuid, p_customer text, p_sub text, p_price text, p_status text,
  p_period_end timestamptz, p_cancel boolean, p_event_at timestamptz) returns text
language plpgsql security definer set search_path = public as
$$ declare v_plan text; v_old subscriptions%rowtype; v_had boolean;
begin
  if p_status is null or p_status not in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if not exists (select 1 from organizations where id = p_org) then return 'unknown_org'; end if;
  if exists (select 1 from subscriptions where stripe_subscription_id = p_sub and org_id <> p_org) then return 'conflict'; end if;
  perform pg_advisory_xact_lock(hashtext('sub:' || p_org::text));
  select * into v_old from subscriptions where org_id = p_org for update;
  v_had := found;
  select key into v_plan from plans where stripe_price_id = p_price and p_price is not null limit 1;
  if v_plan is null then
    -- A price nobody maps any more (repriced plan) must still be able to END a plan: keep the stored plan for states that grant nothing.
    if v_had and p_status not in ('active','trialing','past_due') then v_plan := v_old.plan_key; else return 'unknown_plan'; end if;
  end if;
  if v_had then
    -- Stripe stamps events to the second, so equal times are ordered by how far along the state is.
    if p_event_at < v_old.event_at
       or (p_event_at = v_old.event_at and public.sub_status_rank(p_status) <= public.sub_status_rank(v_old.status)) then return 'stale'; end if;
    -- While a plan is live, only a state that grants a plan may replace it with another subscription's events.
    if v_old.stripe_subscription_id is distinct from p_sub and v_old.status in ('active','trialing','past_due')
       and p_status not in ('active','trialing') then return 'stale'; end if;
  end if;
  insert into subscriptions (org_id, plan_key, status, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end, past_due_since, event_at, updated_at)
  values (p_org, v_plan, p_status, p_customer, p_sub, p_period_end, coalesce(p_cancel, false), case when p_status = 'past_due' then p_event_at end, p_event_at, now())
  on conflict (org_id) do update set
    plan_key = excluded.plan_key, status = excluded.status,
    stripe_customer_id = coalesce(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
    stripe_subscription_id = excluded.stripe_subscription_id, current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    past_due_since = case when excluded.status = 'past_due' then coalesce(case when subscriptions.status = 'past_due' then subscriptions.past_due_since end, excluded.event_at) end,
    event_at = excluded.event_at, updated_at = now();
  return 'applied';
end $$;

create function public.org_billing_customer(p_org uuid) returns text
language sql stable security definer set search_path = public as
$$ select stripe_customer_id from subscriptions where org_id = p_org $$;

create function public.can_manage_billing(p_org uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select auth.uid() is not null and public.has_org_role(p_org, array['owner']) $$;

create function public.plan_feature(p_org uuid, p_key text) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(public.is_member(p_org)
  and coalesce((select (features ->> p_key) = 'true' from plans where key = public.org_plan_key(p_org)), false), false) $$;

revoke execute on function public.sub_status_rank(text), public.apply_subscription_event(uuid, text, text, text, text, timestamptz, boolean, timestamptz),
  public.org_billing_customer(uuid), public.can_manage_billing(uuid), public.plan_feature(uuid, text) from public, anon, authenticated;
grant execute on function public.sub_status_rank(text), public.apply_subscription_event(uuid, text, text, text, text, timestamptz, boolean, timestamptz),
  public.org_billing_customer(uuid) to service_role;
grant execute on function public.can_manage_billing(uuid), public.plan_feature(uuid, text) to authenticated;
