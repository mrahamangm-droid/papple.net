-- 0022 admin-guarded edits of settings, feature flags and plans. Admin only, second factor (aal2) required, reason 10-1000 chars, audited.
-- Existing rows only: these functions never create or delete settings, flags or plans.
create function public.admin_guard(p_reason text) returns text
language plpgsql stable security definer set search_path = public as
$$ declare v_reason text := trim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'second factor required' using errcode = '42501'; end if;
  if char_length(v_reason) not between 10 and 1000 then raise exception 'please give a reason' using errcode = '22023'; end if;
  return v_reason;
end $$;

create function public.admin_set_setting(p_key text, p_value jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_reason text := public.admin_guard(p_reason); v_old jsonb;
begin
  if p_value is null then raise exception 'value required' using errcode = '22023'; end if;
  select value into v_old from platform_settings where key = p_key for update;
  if not found then raise exception 'unknown setting' using errcode = '22023'; end if;
  if jsonb_typeof(v_old) <> jsonb_typeof(p_value) then raise exception 'value has the wrong type' using errcode = '22023'; end if;
  update platform_settings set value = p_value where key = p_key;
  insert into audit_log (actor_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), 'admin.setting.set', 'setting', p_key, jsonb_build_object('value', v_old),
          jsonb_build_object('value', p_value, 'reason', left(v_reason, 500)), 'success', gen_random_uuid()::text);
end $$;

create function public.admin_set_flag(p_key text, p_enabled boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_reason text := public.admin_guard(p_reason); v_old boolean;
begin
  if p_enabled is null then raise exception 'value required' using errcode = '22023'; end if;
  select enabled into v_old from feature_flags where key = p_key for update;
  if not found then raise exception 'unknown flag' using errcode = '22023'; end if;
  update feature_flags set enabled = p_enabled where key = p_key;
  insert into audit_log (actor_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), 'admin.flag.set', 'feature_flag', p_key, jsonb_build_object('enabled', v_old),
          jsonb_build_object('enabled', p_enabled, 'reason', left(v_reason, 500)), 'success', gen_random_uuid()::text);
end $$;

create function public.admin_update_plan(p_key text, p_name text, p_price_cents int, p_active boolean, p_limits jsonb, p_features jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_reason text := public.admin_guard(p_reason); v_old plans%rowtype; v_name text := trim(coalesce(p_name, ''));
begin
  if char_length(v_name) not between 1 and 80 then raise exception 'invalid name' using errcode = '22023'; end if;
  if p_price_cents is not null and p_price_cents < 0 then raise exception 'invalid price' using errcode = '22023'; end if;
  if p_active is null or jsonb_typeof(p_limits) is distinct from 'object' or jsonb_typeof(p_features) is distinct from 'object' then
    raise exception 'invalid plan data' using errcode = '22023'; end if;
  select * into v_old from plans where key = p_key for update;
  if not found then raise exception 'unknown plan' using errcode = '22023'; end if;
  update plans set name = v_name, price_cents = p_price_cents, active = p_active, limits = p_limits, features = p_features, updated_at = now() where key = p_key;
  insert into audit_log (actor_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), 'admin.plan.update', 'plan', p_key,
          jsonb_build_object('name', v_old.name, 'price_cents', v_old.price_cents, 'active', v_old.active, 'limits', v_old.limits, 'features', v_old.features),
          jsonb_build_object('name', v_name, 'price_cents', p_price_cents, 'active', p_active, 'limits', p_limits, 'features', p_features, 'reason', left(v_reason, 500)),
          'success', gen_random_uuid()::text);
end $$;

revoke execute on function public.admin_guard(text), public.admin_set_setting(text, jsonb, text), public.admin_set_flag(text, boolean, text),
  public.admin_update_plan(text, text, int, boolean, jsonb, jsonb, text) from public, anon;
grant execute on function public.admin_set_setting(text, jsonb, text), public.admin_set_flag(text, boolean, text),
  public.admin_update_plan(text, text, int, boolean, jsonb, jsonb, text) to authenticated;
revoke execute on function public.admin_guard(text) from authenticated;
