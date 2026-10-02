-- 0002 admin-editable configuration: plans, platform settings (+history), feature flags.
create table public.plans (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  name text not null,
  audience text not null check (audience in ('client','professional','agency','enterprise')),
  price_cents integer check (price_cents is null or price_cents >= 0), -- null = custom pricing
  currency text not null default 'USD' check (char_length(currency) = 3),
  interval text check (interval in ('month','year')),
  limits jsonb not null default '{}',
  features jsonb not null default '{}',
  active boolean not null default true,
  stripe_price_id text,
  sort integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.platform_settings (
  key text primary key check (key ~ '^[a-z0-9_.]+$'),
  value jsonb not null,
  description text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.settings_history (
  id bigserial primary key,
  key text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create table public.feature_flags (
  key text primary key check (key ~ '^[a-z0-9_.]+$'),
  enabled boolean not null default false,
  rollout jsonb not null default '{}',
  description text,
  updated_at timestamptz not null default now()
);

create table public.feature_flag_overrides (
  key text not null references public.feature_flags (key) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  enabled boolean not null,
  primary key (key, org_id)
);

create function public.platform_settings_audit() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  insert into settings_history (key, old_value, new_value, changed_by)
  values (new.key, case when tg_op = 'UPDATE' then old.value end, new.value, auth.uid());
  return new;
end $$;
create trigger platform_settings_audit before insert or update on public.platform_settings
  for each row execute function public.platform_settings_audit();

revoke all on public.plans, public.platform_settings, public.settings_history,
  public.feature_flags, public.feature_flag_overrides from anon, public, authenticated;
grant select on public.plans to anon, authenticated;
grant select on public.platform_settings, public.settings_history, public.feature_flags,
  public.feature_flag_overrides to authenticated;
grant insert, update, delete on public.plans, public.platform_settings, public.feature_flags,
  public.feature_flag_overrides to authenticated;
revoke all on function public.platform_settings_audit() from public, anon, authenticated;

alter table public.plans enable row level security;
alter table public.platform_settings enable row level security;
alter table public.settings_history enable row level security;
alter table public.feature_flags enable row level security;
alter table public.feature_flag_overrides enable row level security;

create policy plans_select_anon on public.plans for select to anon using (active);
create policy plans_select_auth on public.plans for select to authenticated
  using (active or public.is_platform_admin());
create policy plans_admin_write on public.plans for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- NOTE: platform_settings must never hold secrets; it is readable by any signed-in user.
create policy settings_select on public.platform_settings for select to authenticated using (true);
create policy settings_admin_write on public.platform_settings for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy settings_history_admin on public.settings_history for select to authenticated
  using (public.is_platform_admin());

create policy flags_select on public.feature_flags for select to authenticated using (true);
create policy flags_admin_write on public.feature_flags for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy flag_overrides_select on public.feature_flag_overrides for select to authenticated
  using (public.is_member(org_id) or public.is_platform_admin());
create policy flag_overrides_admin_write on public.feature_flag_overrides for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
