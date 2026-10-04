-- 0011 conversations, messages, notifications. Clients can read what their orgs participate in; all writes go through RPCs/triggers.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('project','service','profile','proposal')),
  ref_id uuid not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);
create index conversations_creator_day_idx on public.conversations (created_by, created_at);

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  primary key (conversation_id, org_id)
);
create index conversation_participants_org_idx on public.conversation_participants (org_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_user_id uuid references auth.users (id) on delete set null,
  sender_org_id uuid not null references public.organizations (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create function public.is_conversation_member(p_conv uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from conversation_participants cp where cp.conversation_id = p_conv and public.is_member(cp.org_id)) $$;

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
revoke all on public.conversations, public.conversation_participants, public.messages, public.notifications
  from anon, public, authenticated;
grant select on public.conversations, public.conversation_participants, public.messages, public.notifications to authenticated;

create policy conversations_select on public.conversations for select to authenticated
  using (public.is_conversation_member(id) or public.is_platform_admin());
create policy participants_select on public.conversation_participants for select to authenticated
  using (public.is_conversation_member(conversation_id) or public.is_platform_admin());
create policy messages_select on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id) or public.is_platform_admin());
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());

-- internal helpers (never granted to clients)
create function public.notify(p_user uuid, p_type text, p_payload jsonb) returns void
language sql security definer set search_path = public as
$$ insert into notifications (user_id, type, payload) values (p_user, p_type, coalesce(p_payload, '{}')) $$;

create function public.notify_org(p_org uuid, p_type text, p_payload jsonb, p_except uuid default null) returns void
language plpgsql security definer set search_path = public as
$$ declare m record;
begin
  for m in select user_id from memberships where org_id = p_org and user_id is distinct from p_except loop
    perform public.notify(m.user_id, p_type, p_payload);
  end loop;
end $$;

create function public.post_message(p_conv uuid, p_user uuid, p_org uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_id uuid; v_body text := trim(coalesce(p_body, ''));
begin
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'invalid message' using errcode = '22023'; end if;
  insert into messages (conversation_id, sender_user_id, sender_org_id, body)
    values (p_conv, p_user, p_org, v_body) returning id into v_id;
  update conversations set last_message_at = now() where id = p_conv;
  return v_id;
end $$;

create function public.messages_notify() returns trigger
language plpgsql security definer set search_path = public as
$$ declare o record;
begin
  for o in select org_id from conversation_participants where conversation_id = new.conversation_id and org_id <> new.sender_org_id loop
    perform public.notify_org(o.org_id, 'message_received',
      jsonb_build_object('conversation_id', new.conversation_id, 'preview', left(new.body, 80)), new.sender_user_id);
  end loop;
  return null;
end $$;
create trigger messages_notify after insert on public.messages for each row execute function public.messages_notify();

create function public.proposals_notify() returns trigger
language plpgsql security definer set search_path = public as
$$ declare v_project_org uuid;
begin
  if tg_op = 'INSERT' or (new.status = 'submitted' and old.status = 'withdrawn') then
    select org_id into v_project_org from projects where id = new.project_id;
    perform public.notify_org(v_project_org, 'proposal_received',
      jsonb_build_object('proposal_id', new.id, 'project_id', new.project_id), new.submitted_by);
  elsif new.status in ('shortlisted','declined') and new.status is distinct from old.status then
    perform public.notify_org(new.org_id, 'proposal_status', jsonb_build_object('proposal_id', new.id, 'status', new.status));
  end if;
  return null;
end $$;
create trigger proposals_notify after insert or update of status on public.proposals
  for each row execute function public.proposals_notify();

create function public.projects_closed_notify() returns trigger
language plpgsql security definer set search_path = public as
$$ declare o record;
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    for o in select distinct org_id from proposals where project_id = new.id and status in ('submitted','shortlisted') loop
      perform public.notify_org(o.org_id, 'project_closed', jsonb_build_object('project_id', new.id));
    end loop;
  end if;
  return null;
end $$;
create trigger projects_closed_notify after update of status on public.projects
  for each row execute function public.projects_closed_notify();

create function public.start_conversation(p_from_org uuid, p_kind text, p_ref uuid, p_first_message text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_target uuid; v_from_type text; v_id uuid; v_max int; v_proj uuid; v_prop_org uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_from_org, array['owner','admin','member']) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_first_message, ''))) not between 1 and 4000 then
    raise exception 'invalid message' using errcode = '22023'; end if;
  select type into v_from_type from organizations where id = p_from_org;

  if p_kind = 'service' then
    select s.org_id into v_target from services s join provider_profiles pp on pp.org_id = s.org_id
      where s.id = p_ref and s.status = 'published' and pp.visibility = 'public' and pp.status = 'active';
  elsif p_kind = 'profile' then
    select org_id into v_target from provider_profiles where id = p_ref and visibility = 'public' and status = 'active';
  elsif p_kind = 'project' then
    if v_from_type not in ('individual','agency') then
      raise exception 'only provider organizations can ask about a project' using errcode = '22023'; end if;
    select org_id into v_target from projects where id = p_ref and status = 'open';
  elsif p_kind = 'proposal' then
    select pr.project_id, pr.org_id, pj.org_id into v_proj, v_prop_org, v_target
      from proposals pr join projects pj on pj.id = pr.project_id where pr.id = p_ref;
    if v_target = p_from_org then v_target := v_prop_org;
    elsif v_prop_org = p_from_org then null;
    else v_target := null; end if;
  else
    raise exception 'unknown conversation kind' using errcode = '22023';
  end if;
  if v_target is null then raise exception 'unknown target' using errcode = '22023'; end if;
  if v_target = p_from_org then raise exception 'cannot message your own organization' using errcode = '22023'; end if;

  -- Serialize per caller (daily cap) and per thread (de-duplication) so parallel calls cannot slip past either.
  perform pg_advisory_xact_lock(hashtextextended('convday:' || auth.uid()::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('conv:' || p_kind || ':' || p_ref::text || ':' ||
    least(p_from_org::text, v_target::text) || ':' || greatest(p_from_org::text, v_target::text), 0));
  select c.id into v_id from conversations c
    join conversation_participants a on a.conversation_id = c.id and a.org_id = p_from_org
    join conversation_participants b on b.conversation_id = c.id and b.org_id = v_target
    where c.kind = p_kind and c.ref_id = p_ref limit 1;
  if v_id is null then
    select coalesce((select (value #>> '{}')::int from platform_settings where key = 'limits.new_conversations_per_day'), 20) into v_max;
    if (select count(*) from conversations where created_by = auth.uid() and created_at >= date_trunc('day', now())) >= v_max then
      raise exception 'daily conversation limit reached' using errcode = '54000'; end if;
    insert into conversations (kind, ref_id, created_by) values (p_kind, p_ref, auth.uid()) returning id into v_id;
    insert into conversation_participants (conversation_id, org_id) values (v_id, p_from_org), (v_id, v_target);
  end if;
  perform public.post_message(v_id, auth.uid(), p_from_org, p_first_message);
  return v_id;
end $$;

create function public.send_message(p_conversation uuid, p_org uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as
$$ begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin','member'])
     or not exists (select 1 from conversation_participants where conversation_id = p_conversation and org_id = p_org) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  return public.post_message(p_conversation, auth.uid(), p_org, p_body);
end $$;

create function public.mark_notification_read(p_id uuid) returns void
language plpgsql security definer set search_path = public as
$$ begin
  update notifications set read_at = coalesce(read_at, now()) where id = p_id and user_id = auth.uid();
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.notifications;
  end if;
end $$;

revoke execute on function public.is_conversation_member(uuid), public.notify(uuid,text,jsonb),
  public.notify_org(uuid,text,jsonb,uuid), public.post_message(uuid,uuid,uuid,text), public.messages_notify(),
  public.proposals_notify(), public.projects_closed_notify(), public.start_conversation(uuid,text,uuid,text),
  public.send_message(uuid,uuid,text), public.mark_notification_read(uuid) from public, anon, authenticated;
grant execute on function public.is_conversation_member(uuid), public.start_conversation(uuid,text,uuid,text),
  public.send_message(uuid,uuid,text), public.mark_notification_read(uuid) to authenticated;
