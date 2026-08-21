-- Read-only attestation for 06802.
with target_scope as (
  select
    t.id,
    t.patient_id,
    t.program_id,
    t.clinic_id,
    lower(coalesce(t.target_type,'')) as target_type,
    lower(coalesce(t.phase,'')) as phase,
    exists (
      select 1
      from public.aba_collection_definition_versions_v3 d
      where d.organization_id = public.aba_try_uuid_v3(coalesce(t.organization_id,t.clinic_id))
        and d.patient_id = t.patient_id
        and d.program_id = t.program_id
        and d.target_id = t.id
        and d.status = 'PUBLISHED'
        and d.deprecated_at is null
        and d.published_at <= clock_timestamp()
    ) as has_published_definition,
    exists (
      select 1
      from public.aba_target_phase_assignments_v3 ph
      where ph.organization_id = public.aba_try_uuid_v3(coalesce(t.organization_id,t.clinic_id))
        and ph.patient_id = t.patient_id
        and ph.program_id = t.program_id
        and ph.target_id = t.id
        and ph.effective_from <= clock_timestamp()
        and (ph.effective_until is null or clock_timestamp() < ph.effective_until)
    ) as has_active_phase
  from public.aba_targets t
  where lower(coalesce(t.target_type,'')) in ('dtt','net','probe','task_analysis','behavior')
), summary as (
  select
    count(*)::integer as supported_target_count,
    count(*) filter (where has_published_definition)::integer as published_definition_count,
    count(*) filter (
      where phase in ('baseline','teaching','mastered','maintenance','generalization','regressed')
        and has_active_phase
    )::integer as collectable_with_active_phase_count,
    count(*) filter (
      where phase in ('baseline','teaching','mastered','maintenance','generalization','regressed')
        and not has_active_phase
    )::integer as collectable_missing_phase_count,
    count(*) filter (
      where phase in ('draft','on_hold','discontinued')
        and has_active_phase
    )::integer as inactive_with_unexpected_active_phase_count
  from target_scope
)
select jsonb_build_object(
  'gate', case
    when summary.collectable_missing_phase_count = 0
     and summary.inactive_with_unexpected_active_phase_count = 0
      then 'ABA_V3_TARGET_PROTOCOL_AUTObootstrap_ATTESTED'
    else 'ABA_V3_TARGET_PROTOCOL_AUTObootstrap_REVIEW_REQUIRED'
  end,
  'trigger_ready', exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.aba_targets'::regclass
      and t.tgname = 'trg_sync_aba_v3_target_protocol_v1'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ),
  'supported_target_count',summary.supported_target_count,
  'published_definition_count',summary.published_definition_count,
  'collectable_with_active_phase_count',summary.collectable_with_active_phase_count,
  'collectable_missing_phase_count',summary.collectable_missing_phase_count,
  'inactive_with_unexpected_active_phase_count',summary.inactive_with_unexpected_active_phase_count,
  'writes',false
) as aba_v3_target_protocol_autobootstrap_attestation
from summary;
