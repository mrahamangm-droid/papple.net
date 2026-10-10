-- 0042 spend approvals follow-ups.
-- 1. spend_request_decide locks the contract before the request, the same order as accept_contract, so an owner
--    approving while an admin re-accepts changed terms can no longer deadlock.
-- 2. Deciding or withdrawing a request that is no longer pending raises 55000 (object not in prerequisite state)
--    instead of 22023, so the app can say "already decided" rather than "not valid".
-- Errcodes: 42501 not allowed, 22023 invalid, 55000 no longer pending.
-- Undo: recreate spend_request_decide and spend_request_withdraw from 0041.

create or replace function public.spend_request_decide(p_org uuid, p_request uuid, p_approve boolean, p_note text) returns text
language plpgsql security definer set search_path = public as
$$ declare v_req spend_requests; v_c contracts%rowtype; v_sum bigint; v_note text := btrim(coalesce(p_note, '')); v_contract uuid;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select contract_id into v_contract from spend_requests where id = p_request and org_id = p_org;
  if v_contract is null then raise exception 'not allowed' using errcode = '42501'; end if;
  -- contract first, then request: the order accept_contract uses
  select * into v_c from contracts where id = v_contract for update;
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
  update spend_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = p_request;
  update contracts set accepted_by_client = true where id = v_req.contract_id;
  perform public.spend_audit(p_org, 'spend_request.approve', p_request, jsonb_build_object('contract', v_req.contract_id));
  if v_req.requested_by is not null then
    perform public.notify(v_req.requested_by, 'spend_request_approved', jsonb_build_object('contract_id', v_req.contract_id, 'request_id', p_request, 'org_id', p_org));
  end if;
  return 'approved';
end $$;

create or replace function public.spend_request_withdraw(p_org uuid, p_request uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare v_req spend_requests;
begin
  if auth.uid() is null or not public.has_org_role(p_org, array['owner','admin']) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_req from spend_requests where id = p_request for update;
  if not found or v_req.org_id <> p_org then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_req.status <> 'pending' then raise exception 'request is no longer pending' using errcode = '55000'; end if;
  if v_req.requested_by is distinct from auth.uid() and not public.has_org_role(p_org, array['owner']) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  update spend_requests set status = 'withdrawn', decided_by = auth.uid(), decided_at = now() where id = p_request;
  perform public.spend_audit(p_org, 'spend_request.withdraw', p_request, jsonb_build_object('contract', v_req.contract_id));
end $$;
