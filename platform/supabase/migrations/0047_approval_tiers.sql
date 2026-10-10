-- 0047 approval tiers: owners set amount tiers that decide how many different owners must approve a contract (1 to 3).
-- In a tier needing two or more, an owner's own accept is only the first approval. Tiers apply while the 0041 rule is on,
-- in its currency (another currency takes the highest tier). Errcodes: 42501, 22023, 23505 (already approved), 55000.
-- Undo: recreate accept_contract and spend_request_decide from 0045; drop functions spend_tiers_set, spend_required; drop
-- tables spend_approvals, spend_tiers; drop column spend_requests.approvals_required.

create table public.spend_tiers (
  org_id uuid not null references public.organizations (id) on delete cascade,
  min_minor int not null check (min_minor between 0 and 2147483647),
  approvals int not null check (approvals between 1 and 3),
  primary key (org_id, min_minor)
);
create table public.spend_approvals (
  request_id uuid not null references public.spend_requests (id) on delete cascade,
  approver_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, approver_id)
);
alter table public.spend_requests add column approvals_required int not null default 1 check (approvals_required between 1 and 3);

alter table public.spend_tiers enable row level security;
alter table public.spend_approvals enable row level security;
revoke all on public.spend_tiers, public.spend_approvals from public, anon, authenticated;
grant select on public.spend_tiers, public.spend_approvals to authenticated;
-- as spend_policies and spend_requests: the client organization's owners and admins only
create policy spend_tiers_select on public.spend_tiers for select to authenticated using (public.has_org_role(org_id, array['owner','admin']));
create policy spend_approvals_select on public.spend_approvals for select to authenticated
  using (exists (select 1 from spend_requests r where r.id = request_id and public.has_org_role(r.org_id, array['owner','admin'])));

-- How many different owners must approve: 1 when the rule is off or no tier matches; the largest matching tier otherwise;
-- the largest tier of all for a contract in another currency (no conversion, so err on the safe side).
create function public.spend_required(p_org uuid, p_price int, p_currency text) returns int
language sql stable security definer set search_path = public as
$$ select case when p.org_id is null then 1
               when p_currency <> p.currency then coalesce((select max(t.approvals) from spend_tiers t where t.org_id = p_org), 1)
               else coalesce((select max(t.approvals) from spend_tiers t where t.org_id = p_org and t.min_minor <= p_price), 1) end
   from (select 1) one left join spend_policies p on p.org_id = p_org and p.enabled $$;

create function public.spend_tiers_set(p_org uuid, p_tiers jsonb) returns void
language plpgsql security definer set search_path = public as
$$ declare v_owners int; v_before jsonb; t jsonb;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner']) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_tiers is null or jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) > 10 then raise exception 'invalid tiers' using errcode = '22023'; end if;
  select count(*) into v_owners from memberships where org_id = p_org and role = 'owner';
  for t in select value from jsonb_array_elements(p_tiers) loop
    if jsonb_typeof(t->'min') <> 'number' or jsonb_typeof(t->'approvals') <> 'number'
       or (t->>'min')::numeric <> trunc((t->>'min')::numeric) or (t->>'approvals')::numeric <> trunc((t->>'approvals')::numeric)
       or (t->>'min')::numeric not between 0 and 2147483647 or (t->>'approvals')::numeric not between 1 and 3 then
      raise exception 'invalid tiers' using errcode = '22023'; end if;
    if (t->>'approvals')::int > v_owners then raise exception 'more approvals than owners' using errcode = '22023'; end if;
  end loop;
  if (select count(distinct (value->>'min')::int) from jsonb_array_elements(p_tiers)) <> jsonb_array_length(p_tiers) then
    raise exception 'one tier per amount' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('min', min_minor, 'approvals', approvals) order by min_minor), '[]') into v_before from spend_tiers where org_id = p_org;
  delete from spend_tiers where org_id = p_org;
  insert into spend_tiers (org_id, min_minor, approvals)
  select p_org, (value->>'min')::int, (value->>'approvals')::int from jsonb_array_elements(p_tiers);
  insert into audit_log (actor_id, org_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), p_org, 'spend_tiers.set', 'spend_policy', p_org::text, v_before, p_tiers, 'success', gen_random_uuid()::text);
end $$;

-- As 0045, plus: an owner in a tier needing two or more owners creates or joins the request with their approval
-- (lock order unchanged: contract, budget lock, request), and admin requests carry approvals_required.
create or replace function public.accept_contract(p_org uuid, p_contract uuid) returns text
language plpgsql security definer set search_path = public as
$$ declare v_c contracts%rowtype; v_sum bigint; v_pol spend_policies; v_req spend_requests; v_hash text; v_id uuid; m record;
  v_bud budgets; v_r tstzrange; v_s record; v_reasons text[] := '{}'; v_need int; v_rid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_c from contracts where id = p_contract for update; -- also serializes parallel requests for this contract
  if not found or p_org not in (v_c.client_org_id, v_c.provider_org_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_c.status <> 'draft' then raise exception 'contract is not editable' using errcode = '22023'; end if;
  select coalesce(sum(amount), 0) into v_sum from milestones where contract_id = p_contract;
  if v_sum <> v_c.price then raise exception 'milestones must add up to the contract price' using errcode = '22023'; end if;
  -- already accepted by this side: nothing to do (counting it again, or moving its acceptance time, would distort the budget)
  if (p_org = v_c.client_org_id and v_c.accepted_by_client) or (p_org = v_c.provider_org_id and v_c.accepted_by_provider) then return 'accepted'; end if;
  if p_org = v_c.client_org_id then
    select * into v_bud from budgets where org_id = p_org and enabled;
    -- every client acceptance under a budget queues here (owners too), so an admin's count includes them
    if v_bud.org_id is not null then perform pg_advisory_xact_lock(hashtextextended('budget:' || p_org::text, 0)); end if;
  end if;
  -- an owner in a tier that needs two or more owners: this accept is only the first approval
  if p_org = v_c.client_org_id and public.has_org_role(p_org, array['owner']) then
    select * into v_pol from spend_policies where org_id = p_org and enabled;
    if v_pol.org_id is not null and (v_c.currency <> v_pol.currency or v_c.price >= v_pol.threshold_minor) then
      v_need := public.spend_required(p_org, v_c.price, v_c.currency);
      if v_need >= 2 then
        v_hash := public.spend_terms_hash(p_contract);
        select * into v_req from spend_requests where org_id = p_org and contract_id = p_contract and status = 'pending' for update;
        v_rid := v_req.id;
        if v_rid is not null and not (v_req.price = v_c.price and v_req.currency = v_c.currency and v_req.terms_hash = v_hash and v_req.approvals_required = v_need) then
          update spend_requests set status = 'lapsed', decided_at = now() where id = v_rid;
          perform public.spend_audit(p_org, 'spend_request.lapse', v_rid, jsonb_build_object('contract', p_contract));
          v_rid := null;
        end if;
        if v_rid is null then
          insert into spend_requests (org_id, contract_id, requested_by, price, currency, terms_hash, reasons, approvals_required)
          values (p_org, p_contract, auth.uid(), v_c.price, v_c.currency, v_hash, '{threshold}', v_need) returning id into v_rid;
          perform public.spend_audit(p_org, 'spend_request.create', v_rid, jsonb_build_object('contract', p_contract, 'price', v_c.price, 'currency', v_c.currency, 'approvals_required', v_need));
          for m in select user_id from memberships where org_id = p_org and role = 'owner' and user_id <> auth.uid() loop
            perform public.notify(m.user_id, 'spend_approval_requested', jsonb_build_object('contract_id', p_contract, 'request_id', v_rid, 'org_id', p_org));
          end loop;
        end if;
        insert into spend_approvals (request_id, approver_id) values (v_rid, auth.uid()) on conflict do nothing;
        if (select count(*) from spend_approvals where request_id = v_rid) < v_need then return 'approval_requested'; end if;
        update spend_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = v_rid;
        update contracts set accepted_by_client = true, client_accepted_at = now() where id = p_contract;
        perform public.spend_audit(p_org, 'spend_request.approve', v_rid, jsonb_build_object('contract', p_contract));
        return 'accepted';
      end if;
    end if;
  end if;
  if p_org = v_c.client_org_id and not public.has_org_role(p_org, array['owner']) then
    select * into v_pol from spend_policies where org_id = p_org and enabled;
    -- no currency conversion: a contract in another currency always needs approval
    if v_pol.org_id is not null and (v_c.currency <> v_pol.currency or v_c.price >= v_pol.threshold_minor) then
      v_reasons := v_reasons || 'threshold'::text; end if;
    if v_bud.org_id is not null then
      if v_c.currency <> v_bud.currency then v_reasons := v_reasons || 'budget'::text;
      else
        v_r := public.budget_period(v_bud.period, now());
        select * into v_s from public.budget_spent(p_org, lower(v_r), upper(v_r), v_bud.currency); -- new statement: sees acceptances committed while we queued
        if v_s.contracts + v_s.bookings + v_c.price > v_bud.amount_minor then v_reasons := v_reasons || 'budget'::text; end if;
      end if;
    end if;
    if cardinality(v_reasons) > 0 then
      v_hash := public.spend_terms_hash(p_contract);
      v_need := public.spend_required(p_org, v_c.price, v_c.currency);
      select * into v_req from spend_requests where org_id = p_org and contract_id = p_contract and status = 'pending' for update;
      if v_req.id is not null then
        if v_req.price = v_c.price and v_req.currency = v_c.currency and v_req.terms_hash = v_hash and v_req.reasons = v_reasons
           and v_req.approvals_required = v_need then return 'approval_pending'; end if;
        update spend_requests set status = 'lapsed', decided_at = now() where id = v_req.id;
        perform public.spend_audit(p_org, 'spend_request.lapse', v_req.id, jsonb_build_object('contract', p_contract));
      end if;
      insert into spend_requests (org_id, contract_id, requested_by, price, currency, terms_hash, reasons, approvals_required)
      values (p_org, p_contract, auth.uid(), v_c.price, v_c.currency, v_hash, v_reasons, v_need) returning id into v_id;
      perform public.spend_audit(p_org, 'spend_request.create', v_id, jsonb_build_object('contract', p_contract, 'price', v_c.price, 'currency', v_c.currency, 'reasons', v_reasons));
      for m in select user_id from memberships where org_id = p_org and role = 'owner' loop
        perform public.notify(m.user_id, 'spend_approval_requested', jsonb_build_object('contract_id', p_contract, 'request_id', v_id, 'org_id', p_org));
      end loop;
      return 'approval_requested';
    end if;
  end if;
  if p_org = v_c.client_org_id then
    update contracts set accepted_by_client = true, client_accepted_at = now() where id = p_contract;
    -- accepted another way (an owner, or the rule changed): a pending request is no longer needed
    perform public.spend_lapse_pending(p_contract);
  else update contracts set accepted_by_provider = true where id = p_contract; end if;
  return 'accepted';
end $$;

-- As 0045, plus counting approvals: approving adds this owner's approval (23505 if already given); the request is approved
-- and the contract accepted only when approvals_required is reached, otherwise 'partial'.
create or replace function public.spend_request_decide(p_org uuid, p_request uuid, p_approve boolean, p_note text) returns text
language plpgsql security definer set search_path = public as
$$ declare v_req spend_requests; v_c contracts%rowtype; v_sum bigint; v_note text := btrim(coalesce(p_note, '')); v_contract uuid; v_n int;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select contract_id into v_contract from spend_requests where id = p_request and org_id = p_org;
  if v_contract is null then raise exception 'not allowed' using errcode = '42501'; end if;
  -- contract first, then request: the order accept_contract uses
  select * into v_c from contracts where id = v_contract for update;
  if p_approve and exists (select 1 from budgets where org_id = p_org and enabled) then
    perform pg_advisory_xact_lock(hashtextextended('budget:' || p_org::text, 0)); end if;
  select * into v_req from spend_requests where id = p_request for update;
  -- nobody decides their own request, including an admin who was promoted to owner since
  if v_req.requested_by = auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_approve is null then raise exception 'invalid decision' using errcode = '22023'; end if;
  if v_req.status <> 'pending' then raise exception 'request is no longer pending' using errcode = '55000'; end if;
  if not p_approve then
    if char_length(v_note) not between 1 and 500 then raise exception 'a note is required' using errcode = '22023'; end if;
    update spend_requests set status = 'rejected', note = v_note, decided_by = auth.uid(), decided_at = now() where id = p_request;
    perform public.spend_audit(p_org, 'spend_request.reject', p_request, jsonb_build_object('contract', v_req.contract_id));
    if v_req.requested_by is not null then
      perform public.notify(v_req.requested_by, 'spend_request_rejected', jsonb_build_object('contract_id', v_req.contract_id, 'request_id', p_request, 'org_id', p_org));
    end if;
    return 'rejected';
  end if;
  select coalesce(sum(amount), 0) into v_sum from milestones where contract_id = v_req.contract_id;
  if v_c.status <> 'draft' or v_c.price <> v_req.price or v_c.currency <> v_req.currency or v_sum <> v_c.price
     or public.spend_terms_hash(v_req.contract_id) <> v_req.terms_hash then
    update spend_requests set status = 'lapsed', decided_by = auth.uid(), decided_at = now() where id = p_request;
    perform public.spend_audit(p_org, 'spend_request.lapse', p_request, jsonb_build_object('contract', v_req.contract_id));
    return 'lapsed';
  end if;
  if exists (select 1 from spend_approvals where request_id = p_request and approver_id = auth.uid()) then
    raise exception 'you already approved this' using errcode = '23505'; end if;
  insert into spend_approvals (request_id, approver_id) values (p_request, auth.uid());
  select count(*) into v_n from spend_approvals where request_id = p_request;
  if v_n < v_req.approvals_required then
    perform public.spend_audit(p_org, 'spend_request.approve_step', p_request, jsonb_build_object('contract', v_req.contract_id, 'approvals', v_n, 'required', v_req.approvals_required));
    if v_req.requested_by is not null then
      perform public.notify(v_req.requested_by, 'spend_request_progress', jsonb_build_object('contract_id', v_req.contract_id, 'request_id', p_request, 'org_id', p_org));
    end if;
    return 'partial';
  end if;
  update spend_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = p_request;
  update contracts set accepted_by_client = true, client_accepted_at = now() where id = v_req.contract_id;
  perform public.spend_audit(p_org, 'spend_request.approve', p_request, jsonb_build_object('contract', v_req.contract_id));
  if v_req.requested_by is not null then
    perform public.notify(v_req.requested_by, 'spend_request_approved', jsonb_build_object('contract_id', v_req.contract_id, 'request_id', p_request, 'org_id', p_org));
  end if;
  return 'approved';
end $$;

revoke execute on function public.spend_required(uuid, int, text) from public, anon, authenticated;
revoke execute on function public.spend_tiers_set(uuid, jsonb) from public, anon;
grant execute on function public.spend_tiers_set(uuid, jsonb) to authenticated;
