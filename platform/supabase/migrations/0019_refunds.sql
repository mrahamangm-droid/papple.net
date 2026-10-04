-- 0019 refunds. Admin rulings queue a full refund per succeeded payment; the server calls Stripe and the verified webhook finalizes.
alter table public.payments drop constraint payments_status_check;
alter table public.payments add constraint payments_status_check
  check (status in ('pending','succeeded','failed','refund_pending','refunded'));
alter table public.disputes drop constraint disputes_resolution_check;
alter table public.disputes add constraint disputes_resolution_check
  check (resolution in ('resume','complete','cancel','refund_cancel'));

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.payments (id) on delete restrict,
  dispute_id uuid not null references public.disputes (id) on delete restrict,
  amount int not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending','succeeded','failed')),
  provider_refund_id text,
  idempotency_key text not null unique,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index refunds_dispute_idx on public.refunds (dispute_id);
create trigger refunds_touch before update on public.refunds
  for each row execute function public.touch_updated_at();

alter table public.refunds enable row level security;
revoke all on public.refunds from anon, public, authenticated;
-- failure_reason and provider ids stay server-side
grant select (id, payment_id, dispute_id, amount, currency, status, created_at) on public.refunds to authenticated;
create policy refunds_select on public.refunds for select to authenticated
  using (public.is_platform_staff()
         or exists (select 1 from public.payments p where p.id = payment_id and public.is_contract_party(p.contract_id)));
