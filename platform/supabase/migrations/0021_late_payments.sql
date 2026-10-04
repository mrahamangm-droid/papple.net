-- 0021 late payments. A paid Checkout session can complete after a refund was queued or the contract was cancelled.
-- Refunded and refund_pending payments are as final as succeeded ones (a second charge must be flagged, and the intent
-- the refund targets must not be overwritten). Money arriving on a cancelled contract is recorded (it is real) and reported.
create or replace function public.record_payment_succeeded(p_payment uuid, p_session text, p_intent text, p_amount int, p_currency text) returns text
language plpgsql security definer set search_path = public as
$$ declare v_mid uuid; v_m milestones%rowtype; v_c contracts%rowtype; v_p payments%rowtype;
begin
  select milestone_id into v_mid from payments where id = p_payment;
  if v_mid is null then return 'unknown'; end if;
  select * into v_m from milestones where id = v_mid for update;
  select * into v_c from contracts where id = v_m.contract_id for update;
  select * into v_p from payments where id = p_payment for update;
  if v_p.status in ('succeeded','refund_pending','refunded') then
    if v_p.payment_intent_id is not distinct from p_intent then return 'duplicate'; end if;
    insert into audit_log (action, entity, entity_id, after, outcome, request_id)
    values ('payment.duplicate_charge', 'payment', p_payment::text,
            jsonb_build_object('payment_intent', p_intent, 'session', p_session, 'amount', p_amount, 'currency', p_currency),
            'error', 'stripe-webhook');
    return 'duplicate_charge';
  end if;
  if p_amount is distinct from v_p.client_total or p_currency is distinct from v_p.currency then return 'mismatch'; end if;
  update payments set status = 'succeeded', payment_intent_id = p_intent, paid_at = now(),
    checkout_session_id = coalesce(p_session, checkout_session_id) where id = p_payment;
  update milestones set status = 'paid' where id = v_mid;
  if v_c.status = 'cancelled' then
    insert into audit_log (action, entity, entity_id, after, outcome, request_id)
    values ('payment.on_cancelled_contract', 'payment', p_payment::text,
            jsonb_build_object('payment_intent', p_intent, 'session', p_session, 'amount', p_amount, 'currency', p_currency, 'contract_id', v_c.id),
            'error', 'stripe-webhook');
    return 'paid_on_cancelled';
  end if;
  perform public.notify_org(v_c.provider_org_id, 'payment_received',
    jsonb_build_object('contract_id', v_c.id, 'milestone_id', v_mid));
  if v_c.status = 'active' and not exists (select 1 from milestones where contract_id = v_c.id and status <> 'paid') then
    update contracts set status = 'completed' where id = v_c.id;
    perform public.notify_org(v_c.provider_org_id, 'contract_completed', jsonb_build_object('contract_id', v_c.id));
    perform public.notify_org(v_c.client_org_id, 'contract_completed', jsonb_build_object('contract_id', v_c.id));
  end if;
  return 'recorded';
end $$;
