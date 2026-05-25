-- ABA V2 Epic 12: summary-driven clinical charts, session change snapshots and graph annotations.
-- Additive only. Charts read frozen summaries/snapshots instead of raw clinical event streams.

create extension if not exists pgcrypto;

create table if not exists public.aba_session_metric_snapshots (
  id text primary key default gen_random_uuid()::text,
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  session_id text not null,
  target_id text,
  behavior_id text,
  metric_type text not null
    check (metric_type in (
      'TARGET_ACCURACY',
      'TARGET_INDEPENDENCE',
      'TARGET_TRIAL_COUNT',
      'BEHAVIOR_FREQUENCY',
      'BEHAVIOR_DURATION_TOTAL',
      'BEHAVIOR_DURATION_AVG',
      'BEHAVIOR_DURATION_MAX',
      'BEHAVIOR_INTERVAL_OCCURRENCE',
      'MASTERY_STATUS',
      'MAINTENANCE_STATUS',
      'REGRESSION_RISK'
    )),
  metric_label text not null,
  metric_value numeric(12,4) not null,
  previous_value numeric(12,4),
  delta_value numeric(12,4),
  delta_percent numeric(12,4),
  trend_direction text not null
    check (trend_direction in ('IMPROVED', 'WORSENED', 'STABLE', 'INSUFFICIENT_DATA')),
  change_status text not null
    check (change_status in (
      'FIRST_MEASUREMENT',
      'CHANGED',
      'NO_CHANGE',
      'CLINICALLY_SIGNIFICANT_CHANGE',
      'REGRESSION_SIGNAL'
    )),
  status_label text not null,
  metric_direction text not null
    check (metric_direction in ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER', 'STATUS_BASED')),
  changed_at timestamptz not null,
  source_summary_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_aba_session_metric_snapshots_unique_metric
  on public.aba_session_metric_snapshots (
    organization_id,
    patient_id,
    session_id,
    metric_type,
    coalesce(target_id, ''),
    coalesce(behavior_id, ''),
    metric_label
  );

create index if not exists idx_aba_session_metric_snapshots_org_patient_changed
  on public.aba_session_metric_snapshots (organization_id, patient_id, changed_at desc);
create index if not exists idx_aba_session_metric_snapshots_clinic_patient_changed
  on public.aba_session_metric_snapshots (clinic_id, patient_id, changed_at desc);
create index if not exists idx_aba_session_metric_snapshots_target
  on public.aba_session_metric_snapshots (organization_id, patient_id, target_id, metric_type, changed_at desc);
create index if not exists idx_aba_session_metric_snapshots_behavior
  on public.aba_session_metric_snapshots (organization_id, patient_id, behavior_id, metric_type, changed_at desc);
create index if not exists idx_aba_session_metric_snapshots_significant
  on public.aba_session_metric_snapshots (organization_id, patient_id, change_status, changed_at desc);

create table if not exists public.aba_graph_annotations (
  id text primary key default gen_random_uuid()::text,
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  session_id text,
  target_id text,
  behavior_id text,
  chart_type text not null,
  annotation_type text not null
    check (annotation_type in ('GOAL_LINE', 'CONDITION_LINE', 'NOTE')),
  date timestamptz not null,
  value numeric(12,4),
  label text not null,
  description text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_aba_graph_annotations_org_patient_date
  on public.aba_graph_annotations (organization_id, patient_id, date desc);
create index if not exists idx_aba_graph_annotations_target
  on public.aba_graph_annotations (organization_id, patient_id, target_id, chart_type, date desc);
create index if not exists idx_aba_graph_annotations_behavior
  on public.aba_graph_annotations (organization_id, patient_id, behavior_id, chart_type, date desc);

alter table public.aba_session_metric_snapshots enable row level security;
alter table public.aba_graph_annotations enable row level security;

drop policy if exists aba_session_metric_snapshots_patient_scope_rw on public.aba_session_metric_snapshots;
create policy aba_session_metric_snapshots_patient_scope_rw
on public.aba_session_metric_snapshots
for all
to authenticated
using (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_session_metric_snapshots.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_session_metric_snapshots.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_session_metric_snapshots.clinic_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_session_metric_snapshots.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_session_metric_snapshots.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_session_metric_snapshots.clinic_id)
      )
  )
);

drop policy if exists aba_graph_annotations_patient_scope_rw on public.aba_graph_annotations;
create policy aba_graph_annotations_patient_scope_rw
on public.aba_graph_annotations
for all
to authenticated
using (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_graph_annotations.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_graph_annotations.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_graph_annotations.clinic_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_graph_annotations.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_graph_annotations.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_graph_annotations.clinic_id)
      )
  )
);
