-- Staging verification for CMV3 TASK_ANALYSIS projection GROUP BY hotfix.
-- The empty batch is intentionally safe: it forces PL/pgSQL to prepare/execute
-- every recompute branch without touching any expectation rows.

select public.recompute_clinical_measurement_projection_batch_v3(
  array[]::uuid[],
  'MANUAL_REBUILD'
) = 0 as empty_batch_recompute_compiles;

select
  position(
    'scope.protocol_snapshot_id,scope.phase_version_id,scope.semantic_family'
    in replace(pg_get_functiondef(
      'public.recompute_clinical_measurement_projection_batch_v3(uuid[],text)'::regprocedure
    ), E'\n', '')
  ) > 0 as task_analysis_phase_version_grouped,
  has_function_privilege(
    'service_role',
    'public.recompute_clinical_measurement_projection_batch_v3(uuid[],text)',
    'EXECUTE'
  ) as service_role_execute_preserved,
  not has_function_privilege(
    'authenticated',
    'public.recompute_clinical_measurement_projection_batch_v3(uuid[],text)',
    'EXECUTE'
  ) as authenticated_execute_remains_closed;
