-- Returns one row per public table that has RLS disabled or no policy. CI fails if any row is returned.
select c.relname as table_name,
       case when not c.relrowsecurity then 'RLS disabled' else 'no policies' end as problem
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and (not c.relrowsecurity
       or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
