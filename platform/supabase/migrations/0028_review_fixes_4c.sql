-- 0028 fixes from the slice 2 review.
-- (1) Category rules: lock before checking (a concurrent move can no longer build a third level), keep activity consistent both ways.
create or replace function public.admin_save_category(p_id uuid, p_slug text, p_name text, p_parent uuid, p_position int, p_active boolean, p_reason text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_reason text := public.admin_guard(p_reason); v_name text := trim(coalesce(p_name, '')); v_old categories%rowtype; v_id uuid; v_par categories%rowtype;
begin
  if char_length(v_name) not between 2 and 80 or p_active is null or p_position is null or p_position < 0 or p_position > 10000 then raise exception 'invalid category' using errcode = '22023'; end if;
  if p_id is not null then
    select * into v_old from categories where id = p_id for update;
    if not found then raise exception 'unknown category' using errcode = '22023'; end if;
    if p_slug is not null and p_slug <> v_old.slug then raise exception 'slug cannot change' using errcode = '22023'; end if;
  end if;
  if p_parent is not null then
    select * into v_par from categories where id = p_parent for share;
    if not found or v_par.parent_id is not null or p_parent = p_id then raise exception 'invalid parent' using errcode = '22023'; end if;
    if p_id is not null and exists (select 1 from categories where parent_id = p_id) then raise exception 'a category with children cannot become a child' using errcode = '22023'; end if;
    if p_active and not v_par.is_active then raise exception 'parent is inactive' using errcode = '22023'; end if;
  end if;
  if p_id is not null and not p_active and (exists (select 1 from skills where category_id = p_id and is_active) or exists (select 1 from categories where parent_id = p_id and is_active)) then
    raise exception 'deactivate its skills and subcategories first' using errcode = '22023'; end if;
  if p_id is null then
    if p_slug is null or p_slug !~ '^[a-z0-9-]{2,60}$' then raise exception 'invalid slug' using errcode = '22023'; end if;
    begin
      insert into categories (slug, name, parent_id, position, is_active) values (p_slug, v_name, p_parent, p_position, p_active) returning id into v_id;
    exception when unique_violation then raise exception 'slug already exists' using errcode = '22023'; end;
  else
    update categories set name = v_name, parent_id = p_parent, position = p_position, is_active = p_active where id = p_id;
    v_id := p_id;
  end if;
  insert into audit_log (actor_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), 'admin.category.save', 'category', v_id::text,
          case when p_id is null then null else jsonb_build_object('name', v_old.name, 'parent_id', v_old.parent_id, 'position', v_old.position, 'is_active', v_old.is_active) end,
          jsonb_build_object('name', v_name, 'parent_id', p_parent, 'position', p_position, 'is_active', p_active, 'reason', left(v_reason, 500)), 'success', gen_random_uuid()::text);
  return v_id;
end $$;

-- A skill may only be activated, or moved, under an active category; a plain edit of an already active skill is allowed.
create or replace function public.admin_save_skill(p_id uuid, p_slug text, p_name text, p_category uuid, p_active boolean, p_reason text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_reason text := public.admin_guard(p_reason); v_name text := trim(coalesce(p_name, '')); v_old skills%rowtype; v_id uuid;
begin
  if char_length(v_name) not between 2 and 80 or p_active is null then raise exception 'invalid skill' using errcode = '22023'; end if;
  if p_id is not null then
    select * into v_old from skills where id = p_id for update;
    if not found then raise exception 'unknown skill' using errcode = '22023'; end if;
    if p_slug is not null and p_slug <> v_old.slug then raise exception 'slug cannot change' using errcode = '22023'; end if;
  end if;
  if p_category is not null then
    perform 1 from categories where id = p_category for share;
    if not found then raise exception 'unknown category' using errcode = '22023'; end if;
    if p_active and (p_id is null or not v_old.is_active or v_old.category_id is distinct from p_category)
       and exists (select 1 from categories where id = p_category and not is_active) then raise exception 'category is inactive' using errcode = '22023'; end if;
  end if;
  if p_id is null then
    if p_slug is null or p_slug !~ '^[a-z0-9-]{2,60}$' then raise exception 'invalid slug' using errcode = '22023'; end if;
    begin
      insert into skills (slug, name, category_id, is_active) values (p_slug, v_name, p_category, p_active) returning id into v_id;
    exception when unique_violation then raise exception 'slug already exists' using errcode = '22023'; end;
  else
    update skills set name = v_name, category_id = p_category, is_active = p_active where id = p_id;
    v_id := p_id;
  end if;
  insert into audit_log (actor_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), 'admin.skill.save', 'skill', v_id::text,
          case when p_id is null then null else jsonb_build_object('name', v_old.name, 'category_id', v_old.category_id, 'is_active', v_old.is_active) end,
          jsonb_build_object('name', v_name, 'category_id', p_category, 'is_active', p_active, 'reason', left(v_reason, 500)), 'success', gen_random_uuid()::text);
  return v_id;
end $$;

-- (2) Restore only touches targets that are hidden.
create or replace function public.admin_set_visibility(p_kind text, p_id uuid, p_hidden boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ declare v_reason text := public.staff_reason(p_reason); v_entity text; v_before text; v_after text; v_n int; v_actioned int := 0;
begin
  if p_kind = 'profile' then
    v_entity := 'provider_profile';
    select status into v_before from provider_profiles where id = p_id for update;
    v_after := case when p_hidden then 'hidden_by_admin' else 'active' end;
  elsif p_kind = 'service' then
    v_entity := 'service';
    select status into v_before from services where id = p_id for update;
    v_after := case when p_hidden then 'hidden_by_admin' else 'draft' end;  -- owner republishes after an unhide
  elsif p_kind = 'project' then
    v_entity := 'project';
    select status into v_before from projects where id = p_id for update;
    v_after := case when p_hidden then 'hidden_by_admin' else 'draft' end;
  else raise exception 'unknown target kind' using errcode = '22023'; end if;
  if v_before is null then raise exception 'unknown target' using errcode = '22023'; end if;
  if not p_hidden and v_before <> 'hidden_by_admin' then raise exception 'target is not hidden' using errcode = '22023'; end if;
  if p_kind = 'profile' then update provider_profiles set status = v_after where id = p_id;
  elsif p_kind = 'service' then update services set status = v_after where id = p_id;
  else update projects set status = v_after where id = p_id; end if;
  if p_hidden then
    update content_reports set status = 'actioned' where target_kind = p_kind and target_id = p_id and status = 'open';
    get diagnostics v_actioned = row_count;
  end if;
  insert into audit_log (actor_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), case when p_hidden then 'marketplace.hide' else 'marketplace.unhide' end, v_entity, p_id::text,
          jsonb_build_object('status', v_before), jsonb_build_object('status', v_after, 'reason', left(v_reason, 500), 'reports_actioned', v_actioned),
          'success', gen_random_uuid()::text);
end $$;
