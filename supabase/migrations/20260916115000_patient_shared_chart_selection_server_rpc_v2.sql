-- Issue #171 server-only mutation contract.
-- The server derives actor identity from the authenticated session and passes it explicitly.

create or replace function public.set_patient_shared_chart_selection_v2(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_patient_id uuid,
  p_chart_family text,
  p_chart_key text,
  p_reference_version integer default 1,
  p_chart_reference jsonb default '{}'::jsonb
)
returns public.patient_shared_chart_selections
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_result public.patient_shared_chart_selections;
begin
  if p_actor_id is null or p_clinic_id is null or p_patient_id is null then
    raise exception 'INVALID_SCOPE' using errcode = '22023';
  end if;

  if not public.patient_file_actor_has_patient_access_v1(p_actor_id, p_clinic_id, p_patient_id) then
    raise exception 'PATIENT_ACCESS_DENIED' using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_chart_family, ''))) not between 1 and 64
     or length(btrim(coalesce(p_chart_key, ''))) not between 1 and 256
     or coalesce(p_reference_version, 0) <= 0
     or jsonb_typeof(coalesce(p_chart_reference, '{}'::jsonb)) <> 'object'
     or pg_column_size(coalesce(p_chart_reference, '{}'::jsonb)) > 8192 then
    raise exception 'INVALID_CHART_REFERENCE' using errcode = '22023';
  end if;

  insert into public.patient_shared_chart_selections (
    clinic_id, patient_id, chart_family, chart_key, reference_version,
    chart_reference, created_by, updated_by
  ) values (
    p_clinic_id, p_patient_id, btrim(p_chart_family), btrim(p_chart_key),
    p_reference_version, coalesce(p_chart_reference, '{}'::jsonb), p_actor_id, p_actor_id
  )
  on conflict (clinic_id, patient_id) do update
    set chart_family = excluded.chart_family,
        chart_key = excluded.chart_key,
        reference_version = excluded.reference_version,
        chart_reference = excluded.chart_reference,
        updated_by = p_actor_id,
        updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.clear_patient_shared_chart_selection_v2(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_patient_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_deleted_count integer := 0;
begin
  if p_actor_id is null or p_clinic_id is null or p_patient_id is null then
    raise exception 'INVALID_SCOPE' using errcode = '22023';
  end if;

  if not public.patient_file_actor_has_patient_access_v1(p_actor_id, p_clinic_id, p_patient_id) then
    raise exception 'PATIENT_ACCESS_DENIED' using errcode = '42501';
  end if;

  delete from public.patient_shared_chart_selections
   where clinic_id = p_clinic_id
     and patient_id = p_patient_id;

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count > 0;
end;
$$;

revoke all on function public.set_patient_shared_chart_selection_v1(uuid, uuid, text, text, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.clear_patient_shared_chart_selection_v1(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_patient_shared_chart_selection_v2(uuid, uuid, uuid, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.clear_patient_shared_chart_selection_v2(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_patient_shared_chart_selection_v2(uuid, uuid, uuid, text, text, integer, jsonb) to service_role;
grant execute on function public.clear_patient_shared_chart_selection_v2(uuid, uuid, uuid) to service_role;
