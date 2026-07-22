-- Exposes only server-side route column capabilities so rolling deploys can
-- build one compatible SELECT instead of discovering optional columns through
-- repeated failing requests. This function reads PostgreSQL catalogs only.

create or replace function public.get_verto_route_schema_capabilities()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'patients', jsonb_build_object(
      'columns', (
        select jsonb_object_agg(candidate.column_name, candidate.present order by candidate.column_name)
          from (
            select name as column_name,
                   exists (
                     select 1
                       from information_schema.columns c
                      where c.table_schema = 'public'
                        and c.table_name = 'patients'
                        and c.column_name = name
                   ) as present
              from unnest(array[
                'cpf', 'phone', 'type', 'social_name', 'birth_date', 'gender',
                'patient_profile_type', 'panel_type', 'profile_type',
                'profile_picture', 'profile_picture_path', 'insurance_type',
                'insurance_name', 'insurance_card_number', 'patient_group',
                'lead_source', 'notes', 'rg', 'cep', 'responsible_name',
                'responsible_birth_date', 'responsible_cpf', 'responsible_phone',
                'responsible_email', 'responsible_relationship', 'metadata',
                'onboarding_status', 'anamnesis_required',
                'anamnesis_requested_at', 'anamnesis_submitted_at',
                'anamnesis_reviewed_at', 'relationship_status',
                'professional_id', 'is_active', 'deleted_at'
              ]::text[]) as name
          ) candidate
      )
    )
  );
$$;

revoke all on function public.get_verto_route_schema_capabilities() from public, anon, authenticated;
grant execute on function public.get_verto_route_schema_capabilities() to service_role;

comment on function public.get_verto_route_schema_capabilities() is
  'Server-only catalog capabilities used to build compatible route SELECTs without error-driven retries.';

notify pgrst, 'reload schema';
