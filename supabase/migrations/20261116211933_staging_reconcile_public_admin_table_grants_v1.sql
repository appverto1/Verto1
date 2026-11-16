begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- Revoke DDL-only/administrative grants from browser roles on existing
-- physical public tables. Preserve SELECT/INSERT/UPDATE/DELETE, RLS, all
-- policies, all data, table ownership, and service_role grants.
do $$
declare v_table record;
begin
  for v_table in
    select distinct n.nspname as schema_name, c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join information_schema.role_table_grants g
        on g.table_schema = n.nspname and g.table_name = c.relname
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and g.grantee in ('anon', 'authenticated')
       and g.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
     order by 1, 2
  loop
    execute format(
      'revoke truncate, references, trigger on table %I.%I from anon, authenticated',
      v_table.schema_name, v_table.table_name
    );
  end loop;
end
$$;

commit;
