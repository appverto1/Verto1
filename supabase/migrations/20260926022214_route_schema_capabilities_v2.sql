-- Extend the existing server-only route schema capability catalog so shared
-- backend reads can build a valid first SELECT instead of discovering absent
-- legacy columns through repeated PostgREST 400 responses.

create or replace function public.get_verto_route_schema_capabilities()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with expected_tasks(column_name) as (
    values
      ('patient_email'::text),
      ('title'),
      ('description'),
      ('type'),
      ('icon'),
      ('color'),
      ('completed'),
      ('is_daily_reminder'),
      ('linked_task'),
      ('scheduled_at'),
      ('therapist_id'),
      ('pro_score'),
      ('max_score'),
      ('created_at'),
      ('updated_at'),
      ('is_active'),
      ('deleted_at')
  ), task_columns as (
    select
      expected_tasks.column_name,
      exists (
        select 1
          from information_schema.columns as actual
         where actual.table_schema = 'public'
           and actual.table_name = 'tasks'
           and actual.column_name = expected_tasks.column_name
      ) as is_available
      from expected_tasks
  )
  select jsonb_build_object(
    'schemaVersion', 2,
    'tasks', jsonb_build_object(
      'available', to_regclass('public.tasks') is not null,
      'columns', coalesce(
        (select jsonb_object_agg(column_name, is_available order by column_name) from task_columns),
        '{}'::jsonb
      )
    ),
    'patients', jsonb_build_object(
      'available', to_regclass('public.patients') is not null,
      'columns', coalesce((
        select jsonb_object_agg(actual.column_name, true order by actual.column_name)
          from information_schema.columns as actual
         where actual.table_schema = 'public'
           and actual.table_name = 'patients'
      ), '{}'::jsonb)
    ),
    'users', jsonb_build_object(
      'available', to_regclass('public.users') is not null,
      'columns', coalesce((
        select jsonb_object_agg(actual.column_name, true order by actual.column_name)
          from information_schema.columns as actual
         where actual.table_schema = 'public'
           and actual.table_name = 'users'
      ), '{}'::jsonb)
    ),
    'clinics', jsonb_build_object(
      'available', to_regclass('public.clinics') is not null,
      'columns', coalesce((
        select jsonb_object_agg(actual.column_name, true order by actual.column_name)
          from information_schema.columns as actual
         where actual.table_schema = 'public'
           and actual.table_name = 'clinics'
      ), '{}'::jsonb)
    ),
    'appointments', jsonb_build_object(
      'available', to_regclass('public.appointments') is not null,
      'columns', coalesce((
        select jsonb_object_agg(actual.column_name, true order by actual.column_name)
          from information_schema.columns as actual
         where actual.table_schema = 'public'
           and actual.table_name = 'appointments'
      ), '{}'::jsonb)
    )
  );
$$;

revoke all on function public.get_verto_route_schema_capabilities()
  from public, anon, authenticated;
grant execute on function public.get_verto_route_schema_capabilities()
  to service_role;

comment on function public.get_verto_route_schema_capabilities() is
  'Server-only route schema capability catalog used to build compatible SELECTs without error-driven retries.';

notify pgrst, 'reload schema';
