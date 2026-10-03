-- 0027 guarded taxonomy edits. Admin + aal2 + reason, audited; never deletes. Direct admin writes are removed so edits cannot skip the guard.
drop policy categories_admin_write on public.categories;
drop policy skills_admin_write on public.skills;
revoke insert, update, delete on public.categories, public.skills from authenticated;

create function public.admin_save_category(p_id uuid, p_slug text, p_name text, p_parent uuid, p_position int, p_active boolean, p_reason text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_reason text := public.admin_guard(p_reason); v_name text := trim(coalesce(p_name, '')); v_old categories%rowtype; v_id uuid;
begin
  if char_length(v_name) not between 2 and 80 or p_active is null or p_position is null or p_position < 0 then raise exception 'invalid category' using errcode = '22023'; end if;
  if p_parent is not null then
    if p_parent = p_id or not exists (select 1 from categories where id = p_parent and parent_id is null) then raise exception 'invalid parent' using errcode = '22023'; end if;
    if p_id is not null and exists (select 1 from categories where parent_id = p_id) then raise exception 'a category with children cannot become a child' using errcode = '22023'; end if;
  end if;
  if p_id is null then
    if p_slug is null or p_slug !~ '^[a-z0-9-]{2,60}$' then raise exception 'invalid slug' using errcode = '22023'; end if;
    begin
      insert into categories (slug, name, parent_id, position, is_active) values (p_slug, v_name, p_parent, p_position, p_active) returning id into v_id;
    exception when unique_violation then raise exception 'slug already exists' using errcode = '22023'; end;
  else
    select * into v_old from categories where id = p_id for update;
    if not found then raise exception 'unknown category' using errcode = '22023'; end if;
    if p_slug is not null and p_slug <> v_old.slug then raise exception 'slug cannot change' using errcode = '22023'; end if;
    update categories set name = v_name, parent_id = p_parent, position = p_position, is_active = p_active where id = p_id;
    v_id := p_id;
  end if;
  insert into audit_log (actor_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), 'admin.category.save', 'category', v_id::text,
          case when p_id is null then null else jsonb_build_object('name', v_old.name, 'parent_id', v_old.parent_id, 'position', v_old.position, 'is_active', v_old.is_active) end,
          jsonb_build_object('name', v_name, 'parent_id', p_parent, 'position', p_position, 'is_active', p_active, 'reason', left(v_reason, 500)), 'success', gen_random_uuid()::text);
  return v_id;
end $$;

create function public.admin_save_skill(p_id uuid, p_slug text, p_name text, p_category uuid, p_active boolean, p_reason text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare v_reason text := public.admin_guard(p_reason); v_name text := trim(coalesce(p_name, '')); v_old skills%rowtype; v_id uuid;
begin
  if char_length(v_name) not between 2 and 80 or p_active is null then raise exception 'invalid skill' using errcode = '22023'; end if;
  if p_category is not null then
    if not exists (select 1 from categories where id = p_category) then raise exception 'unknown category' using errcode = '22023'; end if;
    if p_active and exists (select 1 from categories where id = p_category and not is_active) then raise exception 'category is inactive' using errcode = '22023'; end if;
  end if;
  if p_id is null then
    if p_slug is null or p_slug !~ '^[a-z0-9-]{2,60}$' then raise exception 'invalid slug' using errcode = '22023'; end if;
    begin
      insert into skills (slug, name, category_id, is_active) values (p_slug, v_name, p_category, p_active) returning id into v_id;
    exception when unique_violation then raise exception 'slug already exists' using errcode = '22023'; end;
  else
    select * into v_old from skills where id = p_id for update;
    if not found then raise exception 'unknown skill' using errcode = '22023'; end if;
    if p_slug is not null and p_slug <> v_old.slug then raise exception 'slug cannot change' using errcode = '22023'; end if;
    update skills set name = v_name, category_id = p_category, is_active = p_active where id = p_id;
    v_id := p_id;
  end if;
  insert into audit_log (actor_id, action, entity, entity_id, before, after, outcome, request_id)
  values (auth.uid(), 'admin.skill.save', 'skill', v_id::text,
          case when p_id is null then null else jsonb_build_object('name', v_old.name, 'category_id', v_old.category_id, 'is_active', v_old.is_active) end,
          jsonb_build_object('name', v_name, 'category_id', p_category, 'is_active', p_active, 'reason', left(v_reason, 500)), 'success', gen_random_uuid()::text);
  return v_id;
end $$;

revoke execute on function public.admin_save_category(uuid, text, text, uuid, int, boolean, text), public.admin_save_skill(uuid, text, text, uuid, boolean, text) from public, anon;
grant execute on function public.admin_save_category(uuid, text, text, uuid, int, boolean, text), public.admin_save_skill(uuid, text, text, uuid, boolean, text) to authenticated;
