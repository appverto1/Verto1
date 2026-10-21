-- Issue #171 — canonical selection for one patient-visible clinical chart.
-- Selection stores only a stable reference to the clinical source, never copied series data.

create table if not exists public.patient_shared_chart_selections (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  chart_family text not null,
  chart_key text not null,
  reference_version integer not null default 1,
  chart_reference jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  primary key (clinic_id, patient_id),
  constraint patient_shared_chart_family_nonempty check (length(btrim(chart_family)) between 1 and 64),
  constraint patient_shared_chart_key_nonempty check (length(btrim(chart_key)) between 1 and 256),
  constraint patient_shared_chart_reference_version_positive check (reference_version > 0),
  constraint patient_shared_chart_reference_object check (jsonb_typeof(chart_reference) = 'object'),
  constraint patient_shared_chart_reference_size check (pg_column_size(chart_reference) <= 8192)
);

create index if not exists idx_patient_shared_chart_selections_patient
  on public.patient_shared_chart_selections (patient_id, clinic_id);

alter table public.patient_shared_chart_selections enable row level security;

revoke all on table public.patient_shared_chart_selections from anon, authenticated;
grant select on table public.patient_shared_chart_selections to authenticated;
grant all on table public.patient_shared_chart_selections to service_role;

drop policy if exists patient_shared_chart_selection_professional_read_v1
  on public.patient_shared_chart_selections;
create policy patient_shared_chart_selection_professional_read_v1
  on public.patient_shared_chart_selections
  for select
  to authenticated
  using (
    public.patient_file_actor_has_patient_access_v1(
      auth.uid(),
      clinic_id,
      patient_id
    )
  );

create or replace function public.set_patient_shared_chart_selection_v1(
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
  v_actor uuid := auth.uid();
  v_result public.patient_shared_chart_selections;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_clinic_id is null or p_patient_id is null then
    raise exception 'INVALID_SCOPE' using errcode = '22023';
  end if;

  if not public.patient_file_actor_has_patient_access_v1(v_actor, p_clinic_id, p_patient_id) then
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
    clinic_id,
    patient_id,
    chart_family,
    chart_key,
    reference_version,
    chart_reference,
    created_by,
    updated_by
  ) values (
    p_clinic_id,
    p_patient_id,
    btrim(p_chart_family),
    btrim(p_chart_key),
    p_reference_version,
    coalesce(p_chart_reference, '{}'::jsonb),
    v_actor,
    v_actor
  )
  on conflict (clinic_id, patient_id) do update
    set chart_family = excluded.chart_family,
        chart_key = excluded.chart_key,
        reference_version = excluded.reference_version,
        chart_reference = excluded.chart_reference,
        updated_by = v_actor,
        updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.clear_patient_shared_chart_selection_v1(
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
  v_actor uuid := auth.uid();
  v_deleted_count integer := 0;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_clinic_id is null or p_patient_id is null then
    raise exception 'INVALID_SCOPE' using errcode = '22023';
  end if;

  if not public.patient_file_actor_has_patient_access_v1(v_actor, p_clinic_id, p_patient_id) then
    raise exception 'PATIENT_ACCESS_DENIED' using errcode = '42501';
  end if;

  delete from public.patient_shared_chart_selections
   where clinic_id = p_clinic_id
     and patient_id = p_patient_id;

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count > 0;
end;
$$;

revoke all on function public.set_patient_shared_chart_selection_v1(uuid, uuid, text, text, integer, jsonb) from public, anon;
revoke all on function public.clear_patient_shared_chart_selection_v1(uuid, uuid) from public, anon;
grant execute on function public.set_patient_shared_chart_selection_v1(uuid, uuid, text, text, integer, jsonb) to authenticated, service_role;
grant execute on function public.clear_patient_shared_chart_selection_v1(uuid, uuid) to authenticated, service_role;

comment on table public.patient_shared_chart_selections is
  'Canonical single chart reference shared to a patient portal; clinical series remains in its source model.';
comment on column public.patient_shared_chart_selections.chart_reference is
  'Bounded stable source identifiers/config only; must never contain copied clinical series points.';
