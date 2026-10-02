-- 0020 dispute rulings with refunds. refund_cancel cancels the contract and queues a full refund per succeeded payment;
-- the server then calls Stripe and the verified webhook finalizes through record_refund_succeeded.
-- Lock order: dispute, the contract's milestones (by id), contract, payments. Milestone before contract matches the payment RPCs.
create or replace function public.resolve_dispute(p_dispute uuid, p_outcome text, p_note text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_d disputes%rowtype; v_c contracts%rowtype; v_new text; v_note text := trim(coalesce(p_note, '')); v_refunds int := 0;
begin
  if auth.uid() is null or not public.is_platform_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'second factor required' using errcode = '42501'; end if;
  if p_outcome not in ('resume','complete','cancel','refund_cancel') then raise exception 'invalid outcome' using errcode = '22023'; end if;
  if char_length(v_note) not between 10 and 1000 then raise exception 'please explain the ruling' using errcode = '22023'; end if;
  select * into v_d from disputes where id = p_dispute for update;
  if not found or v_d.status <> 'open' then raise exception 'dispute is not open' using errcode = '22023'; end if;
  perform 1 from milestones where contract_id = v_d.contract_id order by id for update;
  select * into v_c from contracts where id = v_d.contract_id for update;
  v_new := case p_outcome
    when 'cancel' then 'cancelled'
    when 'refund_cancel' then 'cancelled'
    when 'complete' then 'completed'
    else case when exists (select 1 from milestones where contract_id = v_c.id and status <> 'paid') then 'active' else 'completed' end end;
  if p_outcome = 'refund_cancel' then
    perform 1 from payments where contract_id = v_c.id and status = 'succeeded' order by id for update;
    with q as (
      update payments set status = 'refund_pending' where contract_id = v_c.id and status = 'succeeded'
      returning id, client_total, currency)
    insert into refunds (payment_id, dispute_id, amount, currency, idempotency_key)
    select id, p_dispute, client_total, currency, 'refund:' || id::text from q;
    get diagnostics v_refunds = row_count;
  end if;
  update disputes set status = 'resolved', resolution = p_outcome, resolution_note = v_note,
    resolved_by = auth.uid(), resolved_at = now() where id = p_dispute;
  update contracts set status = v_new where id = v_c.id;
  insert into audit_log (actor_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), 'dispute.resolve', 'dispute', p_dispute::text, jsonb_build_object('contract_status', v_c.status),
          jsonb_build_object('outcome', p_outcome, 'contract_status', v_new, 'refunds_queued', v_refunds, 'note', left(v_note, 500)),
          'success', gen_random_uuid()::text);
  perform public.notify_org(v_c.client_org_id, 'dispute_resolved', jsonb_build_object('contract_id', v_c.id, 'outcome', p_outcome));
  perform public.notify_org(v_c.provider_org_id, 'dispute_resolved', jsonb_build_object('contract_id', v_c.id, 'outcome', p_outcome));
end $$;

-- Service-only below. Refunds the server still has to send (or confirm) for one dispute.
create function public.list_pending_refunds(p_dispute uuid)
returns table (payment_id uuid, payment_intent_id text, amount int, currency text, idempotency_key text)
language sql stable security definer set search_path = public as
$$ select r.payment_id, p.payment_intent_id, r.amount, r.currency, r.idempotency_key
   from refunds r join payments p on p.id = r.payment_id
   where r.dispute_id = p_dispute and r.status = 'pending' order by r.created_at, r.id $$;

create function public.record_refund_succeeded(p_payment uuid, p_refund text, p_amount int, p_currency text) returns text
language plpgsql security definer set search_path = public as
$$ declare v_mid uuid; v_cid uuid; v_r refunds%rowtype;
begin
  select milestone_id, contract_id into v_mid, v_cid from payments where id = p_payment;
  if v_mid is null then return 'unknown'; end if;
  perform 1 from milestones where id = v_mid for update;
  perform 1 from contracts where id = v_cid for update;
  perform 1 from payments where id = p_payment for update;
  select * into v_r from refunds where payment_id = p_payment for update;
  if not found then return 'unknown'; end if;
  if v_r.status = 'succeeded' then return 'duplicate'; end if;
  if p_amount is distinct from v_r.amount or p_currency is distinct from v_r.currency then
    insert into audit_log (action, entity, entity_id, after, outcome, request_id)
    values ('refund.mismatch', 'payment', p_payment::text,
            jsonb_build_object('refund', p_refund, 'amount', p_amount, 'currency', p_currency), 'error', 'stripe-webhook');
    return 'mismatch';
  end if;
  update refunds set status = 'succeeded', provider_refund_id = p_refund, failure_reason = null where id = v_r.id;
  update payments set status = 'refunded' where id = p_payment;
  return 'recorded';
end $$;

-- A failed Stripe call leaves the refund pending so the admin can retry; only the reason is stored.
create function public.record_refund_failed(p_payment uuid, p_reason text) returns void
language sql security definer set search_path = public as
$$ update refunds set failure_reason = left(coalesce(p_reason, 'unknown error'), 500) where payment_id = p_payment and status = 'pending' $$;

revoke execute on function public.list_pending_refunds(uuid), public.record_refund_succeeded(uuid,text,int,text),
  public.record_refund_failed(uuid,text) from public, anon, authenticated;
grant execute on function public.list_pending_refunds(uuid), public.record_refund_succeeded(uuid,text,int,text),
  public.record_refund_failed(uuid,text) to service_role;
