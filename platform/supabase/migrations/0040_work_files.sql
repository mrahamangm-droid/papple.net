-- 0040 work and files: tasks, private time records and documents on a contract, private or shared with the other side.
-- Rows are written only by the RPCs below. Errcodes: 42501 not allowed, 22023 invalid, 23505 duplicate, 54000 limit.
-- Undo: drop the functions work_*, task_*, time_*, file_*; drop tables contract_files, time_entries, tasks; delete the three limits.* settings.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  milestone_id uuid references public.milestones (id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  status text not null default 'todo' check (status in ('todo','in_progress','blocked','done')),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  assignee_id uuid references auth.users (id) on delete set null,
  due_date date,
  visibility text not null default 'private' check (visibility in ('private','shared')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_contract_org_idx on public.tasks (contract_id, org_id, created_at);
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  work_date date not null,
  minutes int not null check (minutes between 1 and 1440),
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index time_entries_contract_org_idx on public.time_entries (contract_id, org_id, work_date desc);

create table public.contract_files (
  id uuid primary key,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 255),
  mime text not null check (char_length(mime) between 1 and 200),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  object_key text not null unique,
  visibility text not null default 'private' check (visibility in ('private','shared')),
  status text not null default 'pending' check (status in ('pending','ready')),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index contract_files_contract_org_idx on public.contract_files (contract_id, org_id, created_at);
create index contract_files_org_idx on public.contract_files (org_id);

insert into public.platform_settings (key, value, description) values
  ('limits.tasks_per_contract', '{"default":50,"professional_plus":200,"business":1000,"enterprise":null}', 'Max tasks one organization can have on a contract, by plan (null = unlimited)'),
  ('limits.files_per_contract', '{"default":20,"professional_plus":100,"business":500,"enterprise":null}', 'Max files one organization can have on a contract, by plan (null = unlimited)'),
  ('limits.storage_mb', '{"default":100,"professional_plus":1024,"business":10240,"enterprise":null}', 'Max contract file storage per organization in MB, counting pending and ready files, by plan (null = unlimited)')
on conflict (key) do nothing;

alter table public.tasks enable row level security;
alter table public.time_entries enable row level security;
alter table public.contract_files enable row level security;
revoke all on public.tasks, public.time_entries, public.contract_files from public, anon, authenticated;

-- Helpers (SECURITY DEFINER so policies and RPCs can read contracts without opening that table).
create function public.work_party(p_contract uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from contracts c where c.id = p_contract and (public.is_member(c.client_org_id) or public.is_member(c.provider_org_id))) $$;

create function public.work_can_write(p_org uuid, p_contract uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select auth.uid() is not null
      and public.has_org_role(p_org, array['owner','admin','member'])
      and exists (select 1 from contracts where id = p_contract and p_org in (client_org_id, provider_org_id) and status <> 'cancelled') $$;

-- The creator may change or remove an item; so may an owner or admin of its organization.
create function public.work_can_manage(p_org uuid, p_creator uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select auth.uid() is not null and (p_creator = auth.uid() or public.has_org_role(p_org, array['owner','admin'])) $$;

-- creator and uploader ids stay server-side: the other side sees the organization, not the person.
grant select (id, contract_id, org_id, milestone_id, title, description, status, priority, due_date, visibility, created_at, updated_at) on public.tasks to authenticated;
grant select on public.time_entries to authenticated;
grant select (id, contract_id, org_id, name, mime, size_bytes, visibility, status, created_at, confirmed_at) on public.contract_files to authenticated;

create policy tasks_select on public.tasks for select to authenticated
  using (public.is_member(org_id) or (visibility = 'shared' and public.work_party(contract_id)));
create policy time_entries_select on public.time_entries for select to authenticated using (public.is_member(org_id));
create policy contract_files_select on public.contract_files for select to authenticated
  using (public.is_member(org_id) or (visibility = 'shared' and status = 'ready' and public.work_party(contract_id)));

create function public.task_save(p_org uuid, p_contract uuid, p_id uuid, p_title text, p_description text, p_priority text,
                                 p_assignee uuid, p_due date, p_milestone uuid, p_visibility text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_title text := btrim(coalesce(p_title, '')); v_desc text := btrim(coalesce(p_description, '')); v_id uuid; v_cap int; v_old tasks;
begin
  if not public.work_can_write(p_org, p_contract) then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(v_title) not between 1 and 200 or char_length(v_desc) > 2000 then raise exception 'invalid title or description' using errcode = '22023'; end if;
  if p_priority is null or p_priority not in ('low','normal','high') then raise exception 'invalid priority' using errcode = '22023'; end if;
  if p_visibility is null or p_visibility not in ('private','shared') then raise exception 'invalid visibility' using errcode = '22023'; end if;
  if p_milestone is not null and not exists (select 1 from milestones where id = p_milestone and contract_id = p_contract) then
    raise exception 'no such milestone on this contract' using errcode = '22023'; end if;
  if p_assignee is not null and not exists (select 1 from memberships where user_id = p_assignee and org_id = p_org) then
    raise exception 'the assignee must belong to your organization' using errcode = '22023'; end if;
  if p_id is null then
    perform pg_advisory_xact_lock(hashtextextended('tasks:' || p_contract::text || ':' || p_org::text, 0)); -- serialize the limit check
    v_cap := public.org_limit(p_org, 'limits.tasks_per_contract');
    if v_cap is not null and (select count(*) from tasks where contract_id = p_contract and org_id = p_org) >= v_cap then
      raise exception 'task limit reached' using errcode = '54000'; end if;
    insert into tasks (contract_id, org_id, milestone_id, title, description, priority, assignee_id, due_date, visibility, created_by)
    values (p_contract, p_org, p_milestone, v_title, v_desc, p_priority, p_assignee, p_due, p_visibility, auth.uid()) returning id into v_id;
    insert into audit_log (actor_id, org_id, action, entity, entity_id, after, outcome, request_id)
    values (auth.uid(), p_org, 'task.create', 'task', v_id::text, jsonb_build_object('contract', p_contract, 'visibility', p_visibility), 'success', gen_random_uuid()::text);
    return v_id;
  end if;
  select * into v_old from tasks where id = p_id and org_id = p_org and contract_id = p_contract for update;
  if not found then raise exception 'no such task' using errcode = '22023'; end if;
  if v_old.visibility <> p_visibility and not public.work_can_manage(p_org, v_old.created_by) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  update tasks set title = v_title, description = v_desc, priority = p_priority, assignee_id = p_assignee, due_date = p_due,
                   milestone_id = p_milestone, visibility = p_visibility where id = p_id;
  if v_old.visibility <> p_visibility then
    insert into audit_log (actor_id, org_id, action, entity, entity_id, before, after, outcome, request_id)
    values (auth.uid(), p_org, 'task.update', 'task', p_id::text, jsonb_build_object('visibility', v_old.visibility), jsonb_build_object('visibility', p_visibility), 'success', gen_random_uuid()::text);
  end if;
  return p_id;
end $$;

create function public.task_set_status(p_org uuid, p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_contract uuid;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('todo','in_progress','blocked','done') then raise exception 'invalid status' using errcode = '22023'; end if;
  select contract_id into v_contract from tasks where id = p_id and org_id = p_org;
  if not found then raise exception 'no such task' using errcode = '22023'; end if;
  if not public.work_can_write(p_org, v_contract) then raise exception 'not allowed' using errcode = '42501'; end if;
  update tasks set status = p_status where id = p_id;
end $$;

create function public.task_delete(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare v_creator uuid; v_contract uuid;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select created_by, contract_id into v_creator, v_contract from tasks where id = p_id and org_id = p_org for update;
  if not found then raise exception 'no such task' using errcode = '22023'; end if;
  if not public.work_can_manage(p_org, v_creator) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from tasks where id = p_id;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, before, outcome, request_id)
  values (auth.uid(), p_org, 'task.delete', 'task', p_id::text, jsonb_build_object('contract', v_contract), 'success', gen_random_uuid()::text);
end $$;

create function public.time_log(p_org uuid, p_contract uuid, p_task uuid, p_date date, p_minutes int, p_note text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_note text := btrim(coalesce(p_note, '')); v_id uuid;
begin
  if not public.work_can_write(p_org, p_contract) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_minutes is null or p_minutes not between 1 and 1440 then raise exception 'minutes must be between 1 and 1440' using errcode = '22023'; end if;
  if p_date is null or p_date < current_date - 366 or p_date > current_date + 1 then raise exception 'invalid date' using errcode = '22023'; end if;
  if char_length(v_note) > 300 then raise exception 'note too long' using errcode = '22023'; end if;
  if p_task is not null and not exists (select 1 from tasks where id = p_task and contract_id = p_contract and org_id = p_org) then
    raise exception 'no such task' using errcode = '22023'; end if;
  insert into time_entries (contract_id, org_id, task_id, user_id, work_date, minutes, note)
  values (p_contract, p_org, p_task, auth.uid(), p_date, p_minutes, v_note) returning id into v_id;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, after, outcome, request_id)
  values (auth.uid(), p_org, 'time.log', 'time_entry', v_id::text, jsonb_build_object('contract', p_contract, 'minutes', p_minutes), 'success', gen_random_uuid()::text);
  return v_id;
end $$;

create function public.time_delete(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare v_user uuid;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select user_id into v_user from time_entries where id = p_id and org_id = p_org for update;
  if not found then raise exception 'no such time entry' using errcode = '22023'; end if;
  if not public.work_can_manage(p_org, v_user) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from time_entries where id = p_id;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, outcome, request_id)
  values (auth.uid(), p_org, 'time.delete', 'time_entry', p_id::text, 'success', gen_random_uuid()::text);
end $$;

create function public.file_register(p_org uuid, p_contract uuid, p_id uuid, p_name text, p_mime text, p_size bigint, p_key text, p_visibility text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_name text := btrim(coalesce(p_name, '')); v_cap int; v_mb int;
begin
  if not public.work_can_write(p_org, p_contract) then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 255 or p_mime is null or char_length(p_mime) not between 1 and 200
     or p_size is null or p_size not between 1 and 10485760 then raise exception 'invalid file' using errcode = '22023'; end if;
  if p_visibility is null or p_visibility not in ('private','shared') then raise exception 'invalid visibility' using errcode = '22023'; end if;
  if p_id is null or p_key is null or p_key !~ ('^orgs/' || p_org::text || '/' || p_id::text || '\.[a-z0-9]{2,5}$') then
    raise exception 'invalid file key' using errcode = '22023'; end if;
  -- An id picked by the caller must never alias an object another feature already points at (deleting this file would delete that object).
  if exists (select 1 from portfolio_items where file_key = p_key) then raise exception 'key in use' using errcode = '23505'; end if;
  perform pg_advisory_xact_lock(hashtextextended('files:' || p_org::text, 0)); -- serialize the count and storage checks
  v_cap := public.org_limit(p_org, 'limits.files_per_contract');
  if v_cap is not null and (select count(*) from contract_files where contract_id = p_contract and org_id = p_org) >= v_cap then
    raise exception 'file limit reached' using errcode = '54000'; end if;
  v_mb := public.org_limit(p_org, 'limits.storage_mb');
  if v_mb is not null and (select coalesce(sum(size_bytes), 0) from contract_files where org_id = p_org) + p_size > v_mb::bigint * 1048576 then
    raise exception 'storage limit reached' using errcode = '54000'; end if;
  insert into contract_files (id, contract_id, org_id, name, mime, size_bytes, object_key, visibility, uploaded_by)
  values (p_id, p_contract, p_org, v_name, p_mime, p_size, p_key, p_visibility, auth.uid());
  insert into audit_log (actor_id, org_id, action, entity, entity_id, after, outcome, request_id)
  values (auth.uid(), p_org, 'file.register', 'contract_file', p_id::text, jsonb_build_object('contract', p_contract, 'name', v_name, 'size', p_size, 'visibility', p_visibility), 'success', gen_random_uuid()::text);
end $$;

-- Proof that the server re-read the stored bytes. Written only by the server's service role, so a signed-in user cannot mark an unchecked upload ready.
create table public.file_verifications (
  file_id uuid primary key references public.contract_files (id) on delete cascade,
  size_bytes bigint not null,
  verified_at timestamptz not null default now()
);
alter table public.file_verifications enable row level security;
revoke all on public.file_verifications from public, anon, authenticated;
create policy file_verifications_deny_all on public.file_verifications for all to authenticated using (false) with check (false);

create function public.file_mark_verified(p_file uuid, p_size bigint) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if not exists (select 1 from contract_files where id = p_file and status = 'pending' and size_bytes = p_size) then
    raise exception 'no such pending file of that size' using errcode = '22023'; end if;
  insert into file_verifications (file_id, size_bytes) values (p_file, p_size) on conflict (file_id) do update set verified_at = now();
end $$;

create function public.file_confirm(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare f contract_files;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into f from contract_files where id = p_id and org_id = p_org for update;
  if not found then raise exception 'no such file' using errcode = '22023'; end if;
  if f.status = 'ready' then return; end if;
  if not public.work_can_write(p_org, f.contract_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from file_verifications where file_id = p_id and size_bytes = f.size_bytes) then
    raise exception 'upload not verified' using errcode = '42501'; end if;
  update contract_files set status = 'ready', confirmed_at = now() where id = p_id;
end $$;

create function public.file_set_visibility(p_org uuid, p_id uuid, p_visibility text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_uploader uuid; v_old text;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_visibility is null or p_visibility not in ('private','shared') then raise exception 'invalid visibility' using errcode = '22023'; end if;
  select uploaded_by, visibility into v_uploader, v_old from contract_files where id = p_id and org_id = p_org for update;
  if not found then raise exception 'no such file' using errcode = '22023'; end if;
  if not public.work_can_manage(p_org, v_uploader) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not public.work_can_write(p_org, (select contract_id from contract_files where id = p_id)) then raise exception 'not allowed' using errcode = '42501'; end if;
  update contract_files set visibility = p_visibility where id = p_id;
  if v_old <> p_visibility then
    insert into audit_log (actor_id, org_id, action, entity, entity_id, before, after, outcome, request_id)
    values (auth.uid(), p_org, 'file.visibility', 'contract_file', p_id::text, jsonb_build_object('visibility', v_old), jsonb_build_object('visibility', p_visibility), 'success', gen_random_uuid()::text);
  end if;
end $$;

-- Returns the object key so the server can delete the stored object too.
create function public.file_delete(p_org uuid, p_id uuid) returns text
language plpgsql security definer set search_path = public as
$$ declare v_uploader uuid; v_key text; v_contract uuid;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select uploaded_by, object_key, contract_id into v_uploader, v_key, v_contract from contract_files where id = p_id and org_id = p_org for update;
  if not found then raise exception 'no such file' using errcode = '22023'; end if;
  if not public.work_can_manage(p_org, v_uploader) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from contract_files where id = p_id;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, before, outcome, request_id)
  values (auth.uid(), p_org, 'file.delete', 'contract_file', p_id::text, jsonb_build_object('contract', v_contract), 'success', gen_random_uuid()::text);
  return v_key;
end $$;

-- The only way a client gets an object key: ready files of their own organization, or ready shared files of the other side.
create function public.file_authorize(p_file uuid) returns table (object_key text, name text, mime text)
language plpgsql stable security definer set search_path = public as
$$ declare f contract_files;
begin
  select * into f from contract_files where id = p_file;
  if not found or auth.uid() is null or f.status <> 'ready'
     or not (public.is_member(f.org_id) or (f.visibility = 'shared' and public.work_party(f.contract_id))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query select f.object_key, f.name, f.mime;
end $$;

-- The server needs the stored key of a still-pending upload to check its bytes; only that file's own organization gets it.
create function public.file_pending_key(p_org uuid, p_id uuid) returns table (object_key text, name text, mime text, size_bytes bigint)
language plpgsql stable security definer set search_path = public as
$$ begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select f.object_key, f.name, f.mime, f.size_bytes from contract_files f where f.id = p_id and f.org_id = p_org and f.status = 'pending';
  if not found then raise exception 'no such pending file' using errcode = '22023'; end if;
end $$;

-- Sharing or unsharing a task changes only that field, so it cannot overwrite a concurrent edit.
create function public.task_set_visibility(p_org uuid, p_id uuid, p_visibility text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_contract uuid; v_creator uuid; v_old text;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin','member']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_visibility is null or p_visibility not in ('private','shared') then raise exception 'invalid visibility' using errcode = '22023'; end if;
  select contract_id, created_by, visibility into v_contract, v_creator, v_old from tasks where id = p_id and org_id = p_org for update;
  if not found then raise exception 'no such task' using errcode = '22023'; end if;
  if not public.work_can_write(p_org, v_contract) or not public.work_can_manage(p_org, v_creator) then raise exception 'not allowed' using errcode = '42501'; end if;
  update tasks set visibility = p_visibility where id = p_id;
  if v_old <> p_visibility then
    insert into audit_log (actor_id, org_id, action, entity, entity_id, before, after, outcome, request_id)
    values (auth.uid(), p_org, 'task.update', 'task', p_id::text, jsonb_build_object('visibility', v_old), jsonb_build_object('visibility', p_visibility), 'success', gen_random_uuid()::text);
  end if;
end $$;

revoke execute on function public.work_can_write(uuid, uuid), public.work_can_manage(uuid, uuid) from public, anon, authenticated;
-- work_party is evaluated inside the select policies, so the signed-in role must be able to call it.
revoke execute on function public.work_party(uuid) from public, anon;
grant execute on function public.work_party(uuid) to authenticated;
revoke execute on function public.task_save(uuid, uuid, uuid, text, text, text, uuid, date, uuid, text), public.task_set_status(uuid, uuid, text), public.task_delete(uuid, uuid),
  public.time_log(uuid, uuid, uuid, date, int, text), public.time_delete(uuid, uuid),
  public.file_register(uuid, uuid, uuid, text, text, bigint, text, text), public.file_confirm(uuid, uuid), public.file_set_visibility(uuid, uuid, text),
  public.file_delete(uuid, uuid), public.file_authorize(uuid), public.file_pending_key(uuid, uuid), public.task_set_visibility(uuid, uuid, text) from public, anon;
grant execute on function public.task_save(uuid, uuid, uuid, text, text, text, uuid, date, uuid, text), public.task_set_status(uuid, uuid, text), public.task_delete(uuid, uuid),
  public.time_log(uuid, uuid, uuid, date, int, text), public.time_delete(uuid, uuid),
  public.file_register(uuid, uuid, uuid, text, text, bigint, text, text), public.file_confirm(uuid, uuid), public.file_set_visibility(uuid, uuid, text),
  public.file_delete(uuid, uuid), public.file_authorize(uuid), public.file_pending_key(uuid, uuid), public.task_set_visibility(uuid, uuid, text) to authenticated;

-- Only the server (service role) may record that an upload's bytes were checked.
revoke execute on function public.file_mark_verified(uuid, bigint) from public, anon, authenticated;
grant execute on function public.file_mark_verified(uuid, bigint) to service_role;
