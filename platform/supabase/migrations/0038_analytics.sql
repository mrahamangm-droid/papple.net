-- 0038 hiring analytics for client-side organizations. Read-only: one function, no new tables.
-- A hire is an accepted contract (active, completed or disputed); a draft offer is not a hire and is not committed money.
-- Never adds currencies together. Ratios with no denominator are null, not zero.
-- Errcodes: 42501 not allowed, 22023 invalid.

insert into public.platform_settings (key, value, description)
values ('limits.analytics_days', '{"default":30,"professional_plus":90,"business":365,"enterprise":365}', 'Longest analytics window in days, by plan (null = 3650); falls back to the default entry for plans without their own')
on conflict (key) do nothing;

create function public.org_analytics(p_org uuid, p_days int) returns jsonb
language plpgsql stable security definer set search_path = public as
$$ declare
  v_cap int; v_days int; v_since timestamptz;
  v_posted int; v_received int; v_hired_projects int; v_sent int; v_from_invited int;
  v_projects jsonb; v_proposals jsonb; v_hiring jsonb; v_contracts jsonb; v_money jsonb; v_top jsonb; v_talent jsonb; v_monthly jsonb;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
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

revoke execute on function public.org_analytics(uuid, int) from public, anon;
grant execute on function public.org_analytics(uuid, int) to authenticated;
