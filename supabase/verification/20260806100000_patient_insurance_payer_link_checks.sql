-- Read-only checks for 20260806100000_patient_insurance_payer_link.sql.
-- Run manually after applying the migration.

-- 1. Column and foreign key.
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'patients'
  and column_name = 'insurance_payer_id';

select
  constraint_name,
  pg_get_constraintdef(constraint_row.oid) as definition
from pg_constraint constraint_row
join pg_class table_row on table_row.oid = constraint_row.conrelid
join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
where namespace_row.nspname = 'public'
  and table_row.relname = 'patients'
  and constraint_row.contype = 'f'
  and pg_get_constraintdef(constraint_row.oid) ilike '%insurance_payer_id%';

-- 2. Index and scope trigger.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'patients'
  and indexname = 'idx_patients_clinic_insurance_payer';

select
  trigger_row.tgname as trigger_name,
  pg_get_triggerdef(trigger_row.oid) as definition
from pg_trigger trigger_row
where trigger_row.tgrelid = 'public.patients'::regclass
  and not trigger_row.tgisinternal
  and trigger_row.tgname = 'assert_patient_insurance_payer_scope';

-- 3. Canonical links that would violate tenant scope. Expected: zero rows.
select
  patient.id as patient_id,
  patient.clinic_id,
  patient.insurance_payer_id,
  payer.organization_id as payer_clinic_id,
  payer.name as payer_name
from public.patients patient
left join public.clinic_payers payer
  on payer.id = patient.insurance_payer_id
where patient.insurance_payer_id is not null
  and (
    payer.id is null
    or payer.organization_id is distinct from patient.clinic_id
  );

-- 4. Insurance patients still awaiting explicit canonical selection.
select
  patient.clinic_id,
  patient.id as patient_id,
  patient.name as patient_name,
  patient.insurance_name,
  patient.insurance_card_number
from public.patients patient
where patient.deleted_at is null
  and lower(coalesce(patient.insurance_type, '')) in ('convenio', 'insurance')
  and patient.insurance_payer_id is null
order by patient.clinic_id, patient.name;

-- 5. Legacy names with exactly one active payer candidate. This is diagnostic
-- only; no link is written automatically by this SQL.
with active_payers as (
  select
    payer.organization_id,
    payer.id,
    payer.name,
    lower(regexp_replace(trim(payer.name), '\s+', ' ', 'g')) as normalized_name
  from public.clinic_payers payer
  where upper(coalesce(payer.status, 'ACTIVE')) = 'ACTIVE'
), legacy_patients as (
  select
    patient.clinic_id,
    patient.id,
    patient.name,
    patient.insurance_name,
    lower(regexp_replace(trim(patient.insurance_name), '\s+', ' ', 'g')) as normalized_name
  from public.patients patient
  where patient.deleted_at is null
    and patient.insurance_payer_id is null
    and nullif(trim(patient.insurance_name), '') is not null
)
select
  legacy_patient.clinic_id,
  legacy_patient.id as patient_id,
  legacy_patient.name as patient_name,
  legacy_patient.insurance_name,
  min(active_payer.id) as unique_candidate_payer_id,
  min(active_payer.name) as unique_candidate_payer_name,
  count(active_payer.id) as candidate_count
from legacy_patients legacy_patient
left join active_payers active_payer
  on active_payer.organization_id = legacy_patient.clinic_id
 and active_payer.normalized_name = legacy_patient.normalized_name
group by
  legacy_patient.clinic_id,
  legacy_patient.id,
  legacy_patient.name,
  legacy_patient.insurance_name
order by legacy_patient.clinic_id, legacy_patient.name;

-- 6. Direct function privileges. Trigger execution is internal; anon and
-- authenticated should not be able to invoke the function directly.
select
  role_name,
  has_function_privilege(
    role_name,
    'public.assert_patient_insurance_payer_scope_v1()',
    'EXECUTE'
  ) as can_execute
from unnest(array['anon', 'authenticated', 'service_role']) role_name
order by role_name;
