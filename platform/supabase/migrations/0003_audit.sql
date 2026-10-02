-- 0003 append-only audit log. Writes only via service role; reads for platform admins.
create table public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  org_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  outcome text not null check (outcome in ('success','denied','invalid','error')),
  request_id text not null,
  ip_hash text
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_actor_idx on public.audit_log (actor_id);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

create function public.audit_log_immutable() returns trigger
language plpgsql set search_path = public as
$$ begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_log_no_update_delete before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();

revoke all on public.audit_log from anon, public, authenticated;
revoke all on sequence public.audit_log_id_seq from anon, public, authenticated;
grant select on public.audit_log to authenticated;
revoke all on function public.audit_log_immutable() from public, anon, authenticated;
alter table public.audit_log enable row level security;
create policy audit_log_admin_select on public.audit_log for select to authenticated
  using (public.is_platform_admin());
