-- 0039 read-only API access for client-side organizations.
-- Owners create keys; the secret is shown once and only its sha256 is stored. The API reads through service-only RPCs scoped to the
-- organization a key resolves to. Nothing is written through the API.
-- Errcodes: 42501 not allowed, 22023 invalid, 23505 duplicate hash, 54000 limit.

insert into public.platform_settings (key, value, description)
values ('limits.api_keys', '{"default":0,"professional_plus":0,"business":2,"enterprise":10}', 'Max active API keys per organization, by plan (null = unlimited; 0 = no API access)')
on conflict (key) do nothing;

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  prefix text not null check (prefix ~ '^[A-Za-z0-9_-]{8}$'),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null
);
create index api_keys_org_idx on public.api_keys (org_id, created_at desc);
create index projects_org_created_idx on public.projects (org_id, created_at desc, id desc);
alter table public.api_keys enable row level security;
revoke all on public.api_keys from public, anon, authenticated;
-- No client can read the table (the hash stays server-side); the owner RPCs below are the only way in.
create policy api_keys_no_direct_read on public.api_keys for select to authenticated using (false);

create function public.api_key_create(p_org uuid, p_name text, p_prefix text, p_hash text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_name text := btrim(coalesce(p_name, '')); v_id uuid; v_cap int;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not public.pool_eligible(p_org) then raise exception 'this organization has no API access' using errcode = '22023'; end if;
  if char_length(v_name) not between 1 and 60 then raise exception 'invalid name' using errcode = '22023'; end if;
  if p_prefix is null or p_prefix !~ '^[A-Za-z0-9_-]{8}$' then raise exception 'invalid key' using errcode = '22023'; end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid key' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('apikeys:' || p_org::text, 0)); -- serialize the limit check; no org row lock, which would deadlock with hiring
  v_cap := public.org_limit(p_org, 'limits.api_keys');
  if v_cap is not null and (select count(*) from api_keys where org_id = p_org and revoked_at is null) >= v_cap then
    raise exception 'API key limit reached for this plan' using errcode = '54000';
  end if;
  insert into api_keys (org_id, name, prefix, key_hash, created_by) values (p_org, v_name, p_prefix, p_hash, auth.uid()) returning id into v_id;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, after, outcome, request_id)
  values (auth.uid(), p_org, 'api_key.create', 'api_key', v_id::text, jsonb_build_object('name', v_name, 'prefix', p_prefix), 'success', gen_random_uuid()::text);
  return v_id;
end $$;

create function public.api_key_revoke(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare v_key api_keys%rowtype;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_key from api_keys where id = p_id and org_id = p_org for update;
  if not found then raise exception 'key not found' using errcode = '22023'; end if;
  if v_key.revoked_at is not null then return; end if;
  update api_keys set revoked_at = now(), revoked_by = auth.uid() where id = p_id;
  insert into audit_log (actor_id, org_id, action, entity, entity_id, before, outcome, request_id)
  values (auth.uid(), p_org, 'api_key.revoke', 'api_key', p_id::text, jsonb_build_object('name', v_key.name, 'prefix', v_key.prefix), 'success', gen_random_uuid()::text);
end $$;

create function public.api_keys_list(p_org uuid)
returns table (id uuid, name text, prefix text, created_at timestamptz, last_used_at timestamptz, revoked_at timestamptz, created_by_name text, creator_active boolean)
language plpgsql stable security definer set search_path = public as
$$ begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner']) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select k.id, k.name, k.prefix, k.created_at, k.last_used_at, k.revoked_at, coalesce(pr.display_name, 'a former member'),
                      exists (select 1 from memberships m where m.user_id = k.created_by and m.org_id = k.org_id and m.role = 'owner')
                 from api_keys k left join profiles pr on pr.id = k.created_by where k.org_id = p_org order by k.created_at desc, k.id;
end $$;

-- Service only: resolves a key hash to its organization, or null. Null for unknown, revoked, malformed keys; when the organization is no
-- longer active and eligible; when the plan no longer allows this key (limit 0, or the key is older than the newest N the plan allows);
-- and when the person who created the key is no longer an owner of the organization (the key pauses, and works again if they are).
create function public.api_key_authenticate(p_hash text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_key api_keys%rowtype; v_cap int;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into v_key from api_keys where key_hash = p_hash and revoked_at is null;
  if not found then return null; end if;
  if not public.pool_eligible(v_key.org_id) then return null; end if;
  if not exists (select 1 from memberships m where m.user_id = v_key.created_by and m.org_id = v_key.org_id and m.role = 'owner') then return null; end if;
  v_cap := public.org_limit(v_key.org_id, 'limits.api_keys');
  if v_cap is not null and not exists (select 1 from (select k.id from api_keys k where k.org_id = v_key.org_id and k.revoked_at is null
                                                       order by k.created_at desc, k.id desc limit v_cap) newest where newest.id = v_key.id) then
    return null;
  end if;
  -- one write per key per minute at most, so a busy integration does not turn every read into a write
  update api_keys set last_used_at = now() where id = v_key.id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return v_key.org_id;
end $$;

-- Keyset pagination, newest first. Returns {"data": [...], "next": null | {"ts": ..., "id": ...}}.
create function public.api_v1_projects(p_org uuid, p_limit int, p_after_ts timestamptz, p_after_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as
$$ declare v_rows jsonb; v_n int;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid limit' using errcode = '22023'; end if;
  if (p_after_ts is null) <> (p_after_id is null) then raise exception 'invalid cursor' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(t.j order by t.created_at desc, t.id desc), '[]'::jsonb), count(*) into v_rows, v_n
    from (select jsonb_build_object('id', pj.id, 'title', pj.title, 'status', pj.status, 'budget_min', pj.budget_min, 'budget_max', pj.budget_max,
                                    'currency', pj.currency, 'deadline', pj.deadline, 'created_at', pj.created_at,
                                    'proposals_count', (select count(*) from proposals pr where pr.project_id = pj.id)) as j, pj.created_at, pj.id
            from projects pj
           where pj.org_id = p_org and (p_after_ts is null or (pj.created_at, pj.id) < (p_after_ts, p_after_id))
           order by pj.created_at desc, pj.id desc limit p_limit + 1) t;
  if v_n > p_limit then
    return jsonb_build_object('data', v_rows - (v_n - 1), 'next', jsonb_build_object('ts', v_rows -> (p_limit - 1) ->> 'created_at', 'id', v_rows -> (p_limit - 1) ->> 'id'));
  end if;
  return jsonb_build_object('data', v_rows, 'next', null);
end $$;

-- No cover letter text and no contact details: a proposal is shown as who, how much, and where it stands.
create function public.api_v1_proposals(p_org uuid, p_limit int, p_after_ts timestamptz, p_after_id uuid, p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = public as
$$ declare v_rows jsonb; v_n int;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid limit' using errcode = '22023'; end if;
  if (p_after_ts is null) <> (p_after_id is null) then raise exception 'invalid cursor' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(t.j order by t.created_at desc, t.id desc), '[]'::jsonb), count(*) into v_rows, v_n
    from (select jsonb_build_object('id', pr.id, 'project_id', pr.project_id, 'provider', o.name, 'status', pr.status, 'price', pr.price,
                                    'currency', pr.currency, 'delivery_days', pr.delivery_days, 'submitted_at', pr.submitted_at, 'created_at', pr.created_at) as j,
                 pr.created_at, pr.id
            from proposals pr
            join projects pj on pj.id = pr.project_id
            join organizations o on o.id = pr.org_id
           where pj.org_id = p_org and (p_project is null or pr.project_id = p_project)
             and (p_after_ts is null or (pr.created_at, pr.id) < (p_after_ts, p_after_id))
           order by pr.created_at desc, pr.id desc limit p_limit + 1) t;
  if v_n > p_limit then
    return jsonb_build_object('data', v_rows - (v_n - 1), 'next', jsonb_build_object('ts', v_rows -> (p_limit - 1) ->> 'created_at', 'id', v_rows -> (p_limit - 1) ->> 'id'));
  end if;
  return jsonb_build_object('data', v_rows, 'next', null);
end $$;

-- Commission rates and cancellation notes stay internal.
create function public.api_v1_contracts(p_org uuid, p_limit int, p_after_ts timestamptz, p_after_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as
$$ declare v_rows jsonb; v_n int;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid limit' using errcode = '22023'; end if;
  if (p_after_ts is null) <> (p_after_id is null) then raise exception 'invalid cursor' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(t.j order by t.created_at desc, t.id desc), '[]'::jsonb), count(*) into v_rows, v_n
    from (select jsonb_build_object('id', c.id, 'project_id', c.project_id, 'proposal_id', c.proposal_id, 'provider', o.name, 'title', c.title,
                                    'status', c.status, 'price', c.price, 'currency', c.currency, 'created_at', c.created_at) as j, c.created_at, c.id
            from contracts c
            join organizations o on o.id = c.provider_org_id
           where c.client_org_id = p_org and (p_after_ts is null or (c.created_at, c.id) < (p_after_ts, p_after_id))
           order by c.created_at desc, c.id desc limit p_limit + 1) t;
  if v_n > p_limit then
    return jsonb_build_object('data', v_rows - (v_n - 1), 'next', jsonb_build_object('ts', v_rows -> (p_limit - 1) ->> 'created_at', 'id', v_rows -> (p_limit - 1) ->> 'id'));
  end if;
  return jsonb_build_object('data', v_rows, 'next', null);
end $$;

-- The analytics computation moves into its own function so the API can call it for a key's organization; org_analytics keeps its
-- checks and its exact result.
create function public.org_analytics_compute(p_org uuid, p_days int) returns jsonb
language plpgsql stable security definer set search_path = public as
$$ declare
  v_cap int; v_days int; v_since timestamptz;
  v_posted int; v_received int; v_hired_projects int; v_sent int; v_from_invited int;
  v_projects jsonb; v_proposals jsonb; v_hiring jsonb; v_contracts jsonb; v_money jsonb; v_top jsonb; v_talent jsonb; v_monthly jsonb;
begin
  if not public.pool_eligible(p_org) then raise exception 'this organization has no hiring analytics' using errcode = '22023'; end if;
  if p_days is null or p_days not between 1 and 3650 then raise exception 'invalid window' using errcode = '22023'; end if;
  v_cap := public.org_limit(p_org, 'limits.analytics_days');
  v_days := least(p_days, coalesce(v_cap, 3650));
  v_since := now() - make_interval(days => v_days);

  select count(*) into v_posted from projects where org_id = p_org and status <> 'draft' and created_at >= v_since;
  v_projects := jsonb_build_object(
    'posted', v_posted,
    'open', (select count(*) from projects where org_id = p_org and status = 'open' and created_at >= v_since),
    'closed', (select count(*) from projects where org_id = p_org and status = 'closed' and created_at >= v_since),
    'cancelled', (select count(*) from projects where org_id = p_org and status = 'cancelled' and created_at >= v_since),
    'other', (select count(*) from projects where org_id = p_org and status not in ('draft','open','closed','cancelled') and created_at >= v_since));

  select count(*) into v_received from proposals pr join projects pj on pj.id = pr.project_id
   where pj.org_id = p_org and pj.status <> 'draft' and pj.created_at >= v_since;
  v_proposals := jsonb_build_object(
    'received', v_received,
    'shortlisted', (select count(*) from proposals pr join projects pj on pj.id = pr.project_id
                     where pj.org_id = p_org and pj.status <> 'draft' and pj.created_at >= v_since and pr.status in ('shortlisted','hired')),
    'avg_per_project', round(v_received::numeric / nullif(v_posted, 0), 1));

  select count(distinct c.project_id) into v_hired_projects from contracts c join projects pj on pj.id = c.project_id
   where c.client_org_id = p_org and c.status in ('active','completed','disputed') and pj.status <> 'draft' and pj.created_at >= v_since;
  v_hiring := jsonb_build_object(
    'hired', (select count(*) from contracts where client_org_id = p_org and status in ('active','completed','disputed') and created_at >= v_since),
    'hire_rate_pct', round(100.0 * v_hired_projects / nullif(v_posted, 0), 1),
    'median_days_to_hire', (select round((percentile_cont(0.5) within group (order by extract(epoch from c.created_at - pj.created_at) / 86400.0))::numeric, 1)
                              from contracts c join projects pj on pj.id = c.project_id
                             where c.client_org_id = p_org and c.status in ('active','completed','disputed') and c.created_at >= v_since));

  v_contracts := jsonb_build_object(
    'draft', (select count(*) from contracts where client_org_id = p_org and created_at >= v_since and status = 'draft'),
    'active', (select count(*) from contracts where client_org_id = p_org and created_at >= v_since and status = 'active'),
    'completed', (select count(*) from contracts where client_org_id = p_org and created_at >= v_since and status = 'completed'),
    'disputed', (select count(*) from contracts where client_org_id = p_org and created_at >= v_since and status = 'disputed'),
    'cancelled', (select count(*) from contracts where client_org_id = p_org and created_at >= v_since and status = 'cancelled'));

  -- One row per currency, never summed across currencies. Paid = payments made in the window that are not refunded (a refund still
  -- pending counts as paid until it completes). Refunded = payments refunded in the window, at what goes back to the client (amount plus fee).
  select coalesce(jsonb_agg(jsonb_build_object(
           'currency', cur.currency,
           'committed', coalesce((select sum(price) from contracts where client_org_id = p_org and status in ('active','completed','disputed') and created_at >= v_since and currency = cur.currency), 0),
           'paid', coalesce((select sum(py.amount) from payments py join contracts c on c.id = py.contract_id
                              where c.client_org_id = p_org and py.status in ('succeeded','refund_pending') and py.paid_at >= v_since and py.currency = cur.currency), 0),
           'client_fees', coalesce((select sum(py.client_fee) from payments py join contracts c on c.id = py.contract_id
                                     where c.client_org_id = p_org and py.status in ('succeeded','refund_pending') and py.paid_at >= v_since and py.currency = cur.currency), 0),
           'refunded', coalesce((select sum(py.client_total) from payments py join contracts c on c.id = py.contract_id
                                  where c.client_org_id = p_org and py.status = 'refunded' and py.updated_at >= v_since and py.currency = cur.currency), 0))
         order by cur.currency), '[]'::jsonb)
    into v_money
    from (select currency from contracts where client_org_id = p_org and status in ('active','completed','disputed') and created_at >= v_since
          union
          select py.currency from payments py join contracts c on c.id = py.contract_id
           where c.client_org_id = p_org and py.status in ('succeeded','refund_pending') and py.paid_at >= v_since
          union
          select py.currency from payments py join contracts c on c.id = py.contract_id
           where c.client_org_id = p_org and py.status = 'refunded' and py.updated_at >= v_since) cur;

  -- Up to 5 providers by accepted contracts; a provider that used two currencies shows one row per currency.
  select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'currency', t.currency, 'contracts', t.n, 'committed', t.committed)
                            order by t.total desc, t.name, t.org_id, t.currency), '[]'::jsonb)
    into v_top
    from (select o.id as org_id, o.name, c.currency, count(*) as n, sum(c.price) as committed, tp.total
            from contracts c
            join organizations o on o.id = c.provider_org_id
            join (select c2.provider_org_id, count(*) as total, o2.name
                    from contracts c2 join organizations o2 on o2.id = c2.provider_org_id
                   where c2.client_org_id = p_org and c2.status in ('active','completed','disputed') and c2.created_at >= v_since
                   group by c2.provider_org_id, o2.name order by count(*) desc, o2.name, c2.provider_org_id limit 5) tp on tp.provider_org_id = c.provider_org_id
           where c.client_org_id = p_org and c.status in ('active','completed','disputed') and c.created_at >= v_since
           group by o.id, o.name, c.currency, tp.total) t;

  select count(*) into v_sent from project_invitations where org_id = p_org and created_at >= v_since;
  select count(*) into v_from_invited from project_invitations i
   where i.org_id = p_org and i.created_at >= v_since
     and exists (select 1 from proposals pr join provider_profiles pp on pp.org_id = pr.org_id
                  where pr.project_id = i.project_id and pp.id = i.profile_id
                    and pr.submitted_at >= i.created_at and pr.status <> 'withdrawn');
  v_talent := jsonb_build_object(
    'pools', (select count(*) from talent_pools where org_id = p_org),
    'pooled', (select count(distinct m.profile_id) from talent_pool_members m where m.org_id = p_org and public.pool_profile_ok(m.profile_id)),
    'invites_sent', v_sent,
    'invites_declined', (select count(*) from project_invitations where org_id = p_org and created_at >= v_since and status = 'declined'),
    'proposals_from_invited', v_from_invited,
    'invite_to_proposal_pct', round(100.0 * v_from_invited / nullif(v_sent, 0), 1));

  -- Calendar months in UTC, empty months included as zeros, at most the latest 13 (the first and the current month are partial).
  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(t.mo, 'YYYY-MM'), 'projects', t.p, 'contracts', t.c) order by t.mo), '[]'::jsonb)
    into v_monthly
    from (select g.mo,
                 (select count(*)::int from projects where org_id = p_org and status <> 'draft' and created_at >= v_since
                     and date_trunc('month', created_at at time zone 'UTC') = g.mo) as p,
                 (select count(*)::int from contracts where client_org_id = p_org and status in ('active','completed','disputed') and created_at >= v_since
                     and date_trunc('month', created_at at time zone 'UTC') = g.mo) as c
            from generate_series(date_trunc('month', v_since at time zone 'UTC'), date_trunc('month', now() at time zone 'UTC'), interval '1 month') as g(mo)
           order by g.mo desc limit 13) t;

  return jsonb_build_object('days', v_days, 'requested_days', p_days, 'capped', v_days < p_days, 'since', v_since,
    'projects', v_projects, 'proposals', v_proposals, 'hiring', v_hiring, 'contracts', v_contracts, 'money', v_money,
    'top_providers', v_top, 'talent', v_talent, 'monthly', v_monthly);
end $$;

create or replace function public.org_analytics(p_org uuid, p_days int) returns jsonb
language plpgsql stable security definer set search_path = public as
$$ begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  return public.org_analytics_compute(p_org, p_days);
end $$;

revoke execute on function public.api_key_create(uuid, text, text, text), public.api_key_revoke(uuid, uuid), public.api_keys_list(uuid) from public, anon;
grant execute on function public.api_key_create(uuid, text, text, text), public.api_key_revoke(uuid, uuid), public.api_keys_list(uuid) to authenticated;
revoke execute on function public.api_key_authenticate(text), public.api_v1_projects(uuid, int, timestamptz, uuid), public.api_v1_proposals(uuid, int, timestamptz, uuid, uuid),
  public.api_v1_contracts(uuid, int, timestamptz, uuid), public.org_analytics_compute(uuid, int) from public, anon, authenticated;
grant execute on function public.api_key_authenticate(text), public.api_v1_projects(uuid, int, timestamptz, uuid), public.api_v1_proposals(uuid, int, timestamptz, uuid, uuid),
  public.api_v1_contracts(uuid, int, timestamptz, uuid), public.org_analytics_compute(uuid, int) to service_role;
