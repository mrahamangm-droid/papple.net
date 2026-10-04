-- 0036 PGAN expert credentials. A credential is public as "checked" (Papple staff reviewed the evidence supplied; not a certification)
-- or "declared" (self-declared, nothing checked). Rejected ones are never shown. Identifier and evidence link stay private.
-- Errcodes: 42501 not allowed, 22023 invalid, 54000 limit.

create table public.provider_credentials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.provider_profiles (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('licence','degree','certification','membership','award')),
  title text not null check (char_length(title) between 3 and 160),
  issuer text not null check (char_length(issuer) between 2 and 160),
  identifier text check (identifier is null or char_length(identifier) between 1 and 80),
  issued_on date,
  expires_on date,
  evidence_url text check (evidence_url is null or (evidence_url ~ '^https://' and char_length(evidence_url) <= 500)),
  status text not null default 'declared' check (status in ('declared','pending','checked','rejected','revoked')),
  version int not null default 1,
  request_note text check (request_note is null or char_length(request_note) between 10 and 1000),
  review_note text check (review_note is null or char_length(review_note) between 10 and 1000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (issued_on is null or expires_on is null or expires_on >= issued_on)
);
create index provider_credentials_profile_idx on public.provider_credentials (profile_id);
create index provider_credentials_queue_idx on public.provider_credentials (status, updated_at) where status = 'pending';

alter table public.provider_credentials enable row level security;
revoke all on public.provider_credentials from public, anon, authenticated;
grant select on public.provider_credentials to authenticated;
create policy provider_credentials_select on public.provider_credentials for select to authenticated
  using (public.has_org_role(org_id, array['owner','admin']) or public.is_platform_staff());

insert into public.platform_settings (key, value, description)
values ('limits.credentials', '{"default":10,"professional_plus":30,"business":100,"enterprise":null}', 'Max credentials per provider profile, by plan (null = unlimited)')
on conflict (key) do nothing;

create function public.credential_save(p_org uuid, p_id uuid, p_kind text, p_title text, p_issuer text, p_identifier text,
                                       p_issued date, p_expires date, p_evidence_url text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare
  v_title text := trim(coalesce(p_title, '')); v_issuer text := trim(coalesce(p_issuer, ''));
  v_ident text := nullif(trim(coalesce(p_identifier, '')), ''); v_url text := nullif(trim(coalesce(p_evidence_url, '')), '');
  v_prof provider_profiles%rowtype; v_old provider_credentials%rowtype; v_id uuid; v_cap int; v_changed boolean;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('licence','degree','certification','membership','award') then raise exception 'invalid kind' using errcode = '22023'; end if;
  if char_length(v_title) not between 3 and 160 or char_length(v_issuer) not between 2 and 160 then raise exception 'invalid title or issuer' using errcode = '22023'; end if;
  if v_ident is not null and char_length(v_ident) > 80 then raise exception 'invalid identifier' using errcode = '22023'; end if;
  if v_url is not null and (v_url !~ '^https://' or char_length(v_url) > 500) then raise exception 'evidence link must be https' using errcode = '22023'; end if;
  if p_issued is not null and p_expires is not null and p_expires < p_issued then raise exception 'expiry is before issue' using errcode = '22023'; end if;
  select * into v_prof from provider_profiles where org_id = p_org for update;
  if not found then raise exception 'no provider profile' using errcode = '22023'; end if;
  if p_id is null then
    v_cap := public.org_limit(p_org, 'limits.credentials');
    if v_cap is not null and (select count(*) from provider_credentials where profile_id = v_prof.id) >= v_cap then
      raise exception 'credential limit reached' using errcode = '54000'; end if;
    insert into provider_credentials (profile_id, org_id, kind, title, issuer, identifier, issued_on, expires_on, evidence_url)
      values (v_prof.id, p_org, p_kind, v_title, v_issuer, v_ident, p_issued, p_expires, v_url) returning id into v_id;
    return v_id;
  end if;
  select * into v_old from provider_credentials where id = p_id and org_id = p_org for update;
  if not found then raise exception 'no such credential' using errcode = '22023'; end if;
  -- Any material change returns the credential to self-declared and bumps its version: what was checked is not what is now shown,
  -- and a review made against an older version is refused. A revoked credential stays revoked; only deleting it removes it.
  v_changed := (v_old.kind, v_old.title, v_old.issuer, v_old.identifier, v_old.issued_on, v_old.expires_on, v_old.evidence_url)
               is distinct from (p_kind, v_title, v_issuer, v_ident, p_issued, p_expires, v_url);
  update provider_credentials set kind = p_kind, title = v_title, issuer = v_issuer, identifier = v_ident, issued_on = p_issued,
         expires_on = p_expires, evidence_url = v_url, updated_at = now(),
         status = case when v_old.status = 'revoked' then 'revoked' when v_changed then 'declared' else v_old.status end,
         request_note = case when v_changed and v_old.status <> 'revoked' then null else v_old.request_note end,
         version = v_old.version + case when v_changed then 1 else 0 end
   where id = p_id;
  return p_id;
end $$;

create function public.credential_delete(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from provider_credentials where id = p_id and org_id = p_org;
  if not found then raise exception 'no such credential' using errcode = '22023'; end if;
end $$;

create function public.credential_request_check(p_org uuid, p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_note text := trim(coalesce(p_note, '')); v_c provider_credentials%rowtype;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if char_length(v_note) not between 10 and 1000 then raise exception 'please add a note for the reviewer' using errcode = '22023'; end if;
  select * into v_c from provider_credentials where id = p_id and org_id = p_org for update;
  if not found then raise exception 'no such credential' using errcode = '22023'; end if;
  if v_c.status <> 'declared' then raise exception 'a check cannot be requested now' using errcode = '22023'; end if;
  if v_c.evidence_url is null and v_c.identifier is null then raise exception 'add an evidence link or an identifier first' using errcode = '22023'; end if;
  update provider_credentials set status = 'pending', request_note = v_note, review_note = null, reviewed_by = null, reviewed_at = null, updated_at = now() where id = p_id;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, after, outcome, request_id)
  values (auth.uid(), p_org, 'credential.request', 'credential', p_id::text, jsonb_build_object('kind', v_c.kind), 'success', gen_random_uuid()::text);
end $$;

create function public.credential_review(p_id uuid, p_decision text, p_note text, p_version int) returns void
language plpgsql security definer set search_path = public as
$$ declare v_note text := public.admin_guard(p_note); v_c provider_credentials%rowtype; v_status text;
begin
  if p_decision not in ('approved','rejected') then raise exception 'invalid decision' using errcode = '22023'; end if;
  select * into v_c from provider_credentials where id = p_id for update;
  if not found or v_c.status <> 'pending' then raise exception 'credential is not pending' using errcode = '22023'; end if;
  if p_version is distinct from v_c.version then raise exception 'credential changed since it was opened' using errcode = '22023'; end if;
  if exists (select 1 from memberships where org_id = v_c.org_id and user_id = auth.uid()) then raise exception 'not allowed' using errcode = '42501'; end if;
  v_status := case p_decision when 'approved' then 'checked' else 'rejected' end;
  update provider_credentials set status = v_status, review_note = v_note, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now() where id = p_id;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), v_c.org_id, 'credential.review', 'credential', p_id::text, jsonb_build_object('status', 'pending'),
          jsonb_build_object('status', v_status, 'version', v_c.version, 'title', v_c.title, 'issuer', v_c.issuer, 'reason', left(v_note, 500)), 'success', gen_random_uuid()::text);
  perform public.notify_org(v_c.org_id, case when p_decision = 'approved' then 'credential_checked' else 'credential_rejected' end, jsonb_build_object('credential_id', p_id, 'title', v_c.title));
end $$;

create function public.credential_revoke(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_reason text := public.admin_guard(p_reason); v_c provider_credentials%rowtype;
begin
  select * into v_c from provider_credentials where id = p_id for update;
  if not found then raise exception 'no such credential' using errcode = '22023'; end if;
  if exists (select 1 from memberships where org_id = v_c.org_id and user_id = auth.uid()) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_c.status <> 'checked' then raise exception 'credential is not checked' using errcode = '22023'; end if;
  update provider_credentials set status = 'revoked', review_note = v_reason, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now() where id = p_id;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), v_c.org_id, 'credential.revoke', 'credential', p_id::text, jsonb_build_object('status', 'checked'),
          jsonb_build_object('status', 'revoked', 'title', v_c.title, 'issuer', v_c.issuer, 'reason', left(v_reason, 500)), 'success', gen_random_uuid()::text);
  perform public.notify_org(v_c.org_id, 'credential_revoked', jsonb_build_object('credential_id', p_id, 'title', v_c.title));
end $$;

revoke execute on function public.credential_save(uuid, uuid, text, text, text, text, date, date, text), public.credential_delete(uuid, uuid),
  public.credential_request_check(uuid, uuid, text), public.credential_review(uuid, text, text, int), public.credential_revoke(uuid, text) from public, anon;
grant execute on function public.credential_save(uuid, uuid, text, text, text, text, date, date, text), public.credential_delete(uuid, uuid),
  public.credential_request_check(uuid, uuid, text), public.credential_review(uuid, text, text, int), public.credential_revoke(uuid, text) to authenticated;

-- Only what is safe to show: no identifier, no evidence, no review text. Pending counts as self-declared.
create view public.public_provider_credentials with (security_barrier = true) as
select p.slug, c.kind, c.title, c.issuer, c.issued_on, c.expires_on,
       case when c.status = 'checked' and c.expires_on is not null and c.expires_on < current_date then 'expired'
            when c.status = 'checked' then 'checked' else 'declared' end as status
from provider_credentials c
join provider_profiles p on p.id = c.profile_id
join organizations o on o.id = p.org_id
where c.status not in ('rejected','revoked') and p.visibility = 'public' and p.status = 'active' and o.status = 'active';
revoke all on public.public_provider_credentials from public;
grant select on public.public_provider_credentials to anon, authenticated;
