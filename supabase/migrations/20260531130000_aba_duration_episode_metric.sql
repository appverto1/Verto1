-- ABA V2: expose duration episodes as the derived frequency/occurrence metric for duration-only behaviors.

alter table public.aba_session_metric_snapshots
  drop constraint if exists aba_session_metric_snapshots_metric_type_check;

alter table public.aba_session_metric_snapshots
  add constraint aba_session_metric_snapshots_metric_type_check
  check (metric_type in (
    'TARGET_ACCURACY',
    'TARGET_INDEPENDENCE',
    'TARGET_TRIAL_COUNT',
    'FUNCTIONAL_COMMUNICATION',
    'ENGAGEMENT',
    'BEHAVIOR_FREQUENCY',
    'BEHAVIOR_DURATION_EPISODES',
    'BEHAVIOR_DURATION_TOTAL',
    'BEHAVIOR_DURATION_AVG',
    'BEHAVIOR_DURATION_MAX',
    'BEHAVIOR_INTERVAL_OCCURRENCE',
    'MASTERY_STATUS',
    'MAINTENANCE_STATUS',
    'REGRESSION_RISK'
  ));
