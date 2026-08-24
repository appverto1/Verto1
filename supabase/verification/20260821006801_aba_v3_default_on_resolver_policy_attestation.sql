-- ABA V3 default-on resolver policy — READ ONLY attestation.
with targets as (
  select
    t.clinic_id::uuid as organization_id,
    t.patient_id,
    t.program_id,
    t.id as target_id,
    t.name as target_name,
    lower(coalesce(t.target_type,'')) as target_type,
    public.resolve_aba_measurement_rollout_snapshot_v3(
      t.clinic_id::uuid,
      t.patient_id,
      t.program_id,
      t.id,
      clock_timestamp()
    ) as snapshot
  from public.aba_targets t
), summary as (
  select
    count(*)::integer as total,
    count(*) filter (where snapshot->>'policy_mode'='V3_DEFAULT_ON')::integer as default_policy_seen,
    count(*) filter (where coalesce((snapshot->>'allow_new_v3_sessions')::boolean,false))::integer as effective_v3,
    count(*) filter (where coalesce((snapshot->>'explicit_allow_kill_switch')::boolean,false))::integer as killed,
    count(*) filter (where snapshot->>'policy_reason'='READINESS_OR_SEMANTICS_FALLBACK')::integer as fallback
  from targets
)
select jsonb_build_object(
  'gate',case
    when summary.total <> summary.default_policy_seen then 'BLOCKED_POLICY_NOT_EFFECTIVE_FOR_ALL_TARGETS'
    when coalesce(pg_catalog.has_function_privilege('anon',pg_catalog.to_regprocedure('public.resolve_aba_measurement_rollout_snapshot_v3(uuid,uuid,text,text,timestamptz)'),'EXECUTE'),true) then 'BLOCKED_BROWSER_EXECUTE'
    when coalesce(pg_catalog.has_function_privilege('authenticated',pg_catalog.to_regprocedure('public.resolve_aba_measurement_rollout_snapshot_v3(uuid,uuid,text,text,timestamptz)'),'EXECUTE'),true) then 'BLOCKED_BROWSER_EXECUTE'
    else 'DEFAULT_ON_POLICY_READY'
  end,
  'writes',false,
  'targets',jsonb_build_object(
    'total',summary.total,
    'policy_seen',summary.default_policy_seen,
    'effective_v3_now',summary.effective_v3,
    'explicit_kill_switch',summary.killed,
    'readiness_fallback',summary.fallback
  ),
  'examples',coalesce((
    select jsonb_agg(jsonb_build_object(
      'target_id',target_id,
      'target_name',target_name,
      'target_type',target_type,
      'policy_reason',snapshot->>'policy_reason',
      'allow_new_v3_sessions',snapshot->>'allow_new_v3_sessions',
      'blockers',snapshot->'blockers'
    ) order by target_name)
    from targets
  ),'[]'::jsonb)
) as aba_v3_default_on_policy_attestation
from summary;
