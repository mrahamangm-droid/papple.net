-- 0015 contracts, milestones, connected accounts. Rows are written only by RPCs (0016+) and the service role.

alter table public.proposals drop constraint proposals_status_check;
alter table public.proposals add constraint proposals_status_check
  check (status in ('submitted','withdrawn','shortlisted','declined','hired'));

create table public.connected_accounts (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  stripe_account_id text not null unique,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger connected_accounts_touch before update on public.connected_accounts
  for each row execute function public.touch_updated_at();

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  proposal_id uuid not null unique references public.proposals (id) on delete restrict,
  client_org_id uuid not null references public.organizations (id) on delete restrict,
  provider_org_id uuid not null references public.organizations (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 200),
  price int not null check (price > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  commission_pro_bps int not null check (commission_pro_bps between 0 and 10000),
  commission_client_bps int not null check (commission_client_bps between 0 and 10000),
  status text not null default 'draft' check (status in ('draft','active','completed','cancelled','disputed')),
  accepted_by_client boolean not null default false,
  accepted_by_provider boolean not null default false,
  cancelled_reason text check (char_length(cancelled_reason) <= 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (client_org_id <> provider_org_id)
);
-- One live contract per project (a cancelled one frees the project to be hired again). Backstops the lock in create_contract.
create unique index contracts_one_live_per_project on public.contracts (project_id) where status <> 'cancelled';
create index contracts_client_idx on public.contracts (client_org_id, created_at desc);
create index contracts_provider_idx on public.contracts (provider_org_id, created_at desc);
create trigger contracts_touch before update on public.contracts
  for each row execute function public.touch_updated_at();

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete cascade,
  position int not null check (position >= 1),
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  amount int not null check (amount > 0),
  due_date date,
  status text not null default 'pending' check (status in ('pending','submitted','changes_requested','approved','paid')),
  change_note text check (char_length(change_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id, position)
);
create trigger milestones_touch before update on public.milestones
  for each row execute function public.touch_updated_at();

create function public.is_contract_party(p_contract uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from contracts c where c.id = p_contract
     and (public.is_member(c.client_org_id) or public.is_member(c.provider_org_id))) $$;

alter table public.connected_accounts enable row level security;
alter table public.contracts enable row level security;
alter table public.milestones enable row level security;
revoke all on public.connected_accounts, public.contracts, public.milestones from anon, public, authenticated;
-- The Stripe account id is deliberately not granted to anyone but the service role.
grant select (org_id, payouts_enabled, details_submitted, updated_at) on public.connected_accounts to authenticated;
grant select on public.contracts, public.milestones to authenticated;

create policy connected_accounts_select on public.connected_accounts for select to authenticated
  using (public.has_org_role(org_id, array['owner','admin']) or public.is_platform_admin());
create policy contracts_select on public.contracts for select to authenticated
  using (public.is_member(client_org_id) or public.is_member(provider_org_id) or public.is_platform_admin());
create policy milestones_select on public.milestones for select to authenticated
  using (public.is_contract_party(contract_id) or public.is_platform_admin());

revoke execute on function public.is_contract_party(uuid) from public, anon, authenticated;
grant execute on function public.is_contract_party(uuid) to authenticated;
