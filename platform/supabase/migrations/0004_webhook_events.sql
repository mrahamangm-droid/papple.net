-- 0004 webhook idempotency ledger. Service role only (RLS bypassed); everyone else denied.
create table public.webhook_events (
  provider text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  payload jsonb not null default '{}',
  primary key (provider, event_id)
);
revoke all on public.webhook_events from anon, public, authenticated;
alter table public.webhook_events enable row level security;
-- explicit deny-all so the RLS coverage check sees a policy, and intent is documented
create policy webhook_events_deny_all on public.webhook_events for all to authenticated using (false) with check (false);
