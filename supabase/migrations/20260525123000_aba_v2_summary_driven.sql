-- ABA V2 summary-driven persistence.
-- Additive only: raw clinical events stay as source of truth; summaries are denormalized read models.

create extension if not exists pgcrypto;

alter table public.aba_prompt_levels
  add column if not exists organization_id text;

alter table public.aba_programs
  add column if not exists organization_id text;

alter table public.aba_targets
  add column if not exists organization_id text;

alter table public.aba_behavior_definitions
  add column if not exists organization_id text;

alter table public.aba_sessions
  add column if not exists organization_id text;

alter table public.aba_trials
  add column if not exists organization_id text;

alter table public.aba_behavior_events
  add column if not exists organization_id text;

alter table public.aba_interval_records
  add column if not exists organization_id text;

alter table public.aba_interval_summaries
  add column if not exists organization_id text;

alter table public.aba_abc_events
  add column if not exists organization_id text;

alter table public.aba_audit_events
  add column if not exists organization_id text;

alter table public.aba_mastery_evaluations
  add column if not exists organization_id text;

alter table public.aba_session_summaries
  add column if not exists organization_id text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_event_label text,
  add column if not exists last_event_at timestamptz;

update public.aba_prompt_levels set organization_id = clinic_id where organization_id is null and clinic_id is not null;
update public.aba_programs set organization_id = clinic_id where organization_id is null and clinic_id is not null;
update public.aba_targets set organization_id = clinic_id where organization_id is null and clinic_id is not null;
update public.aba_behavior_definitions set organization_id = clinic_id where organization_id is null and clinic_id is not null;
update public.aba_sessions set organization_id = clinic_id where organization_id is null and clinic_id is not null;
update public.aba_trials set organization_id = clinic_id where organization_id is null and clinic_id is not null;
update public.aba_behavior_events set organization_id = clinic_id where organization_id is null and clinic_id is not null;
update public.aba_interval_records set organization_id = clinic_id where organization_id is null and clinic_id is not null;
update public.aba_interval_summaries set organization_id = clinic_id where organization_id is null and clinic_id is not null;
update public.aba_abc_events set organization_id = clinic_id where organization_id is null and clinic_id is not null;
update public.aba_audit_events set organization_id = clinic_id where organization_id is null and clinic_id is not null;
update public.aba_mastery_evaluations set organization_id = clinic_id where organization_id is null and clinic_id is not null;
update public.aba_session_summaries set organization_id = clinic_id where organization_id is null and clinic_id is not null;

create table if not exists public.aba_session_live_summaries (
  id text primary key,
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  session_id text not null,
  therapist_id text,
  total_trials integer not null default 0,
  independent_trials integer not null default 0,
  prompted_trials integer not null default 0,
  error_trials integer not null default 0,
  accuracy_percent numeric(6,2) not null default 0,
  independence_percent numeric(6,2) not null default 0,
  total_behavior_events integer not null default 0,
  frequency_event_count integer not null default 0,
  duration_event_count integer not null default 0,
  interval_collection_count integer not null default 0,
  open_duration_count integer not null default 0,
  active_interval_collection_count integer not null default 0,
  last_event_label text,
  last_event_at timestamptz,
  sync_status text not null default 'synced'
    check (sync_status in ('local', 'local_only', 'queued', 'syncing', 'synced', 'error', 'failed', 'conflict')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aba_patient_aba_summaries (
  id text primary key,
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  total_sessions integer not null default 0,
  total_trials integer not null default 0,
  total_behavior_events integer not null default 0,
  active_targets_count integer not null default 0,
  mastered_targets_count integer not null default 0,
  last_session_at timestamptz,
  last_behavior_event_label text,
  last_behavior_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aba_target_live_summaries (
  id text primary key,
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  target_id text,
  target_key text not null,
  target_name text,
  session_id text not null,
  attempts_today integer not null default 0,
  correct_today integer not null default 0,
  independent_today integer not null default 0,
  prompted_today integer not null default 0,
  errors_today integer not null default 0,
  accuracy_percent numeric(6,2) not null default 0,
  independence_percent numeric(6,2) not null default 0,
  mastery_progress_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aba_behavior_daily_summaries (
  id text primary key,
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  behavior_id text,
  behavior_key text not null,
  behavior_name text,
  date date not null,
  frequency_count integer not null default 0,
  duration_episode_count integer not null default 0,
  duration_total_seconds integer not null default 0,
  duration_avg_seconds integer not null default 0,
  duration_max_seconds integer not null default 0,
  interval_collections_count integer not null default 0,
  interval_total_count integer not null default 0,
  interval_yes_count integer not null default 0,
  interval_no_count integer not null default 0,
  interval_occurrence_percent numeric(6,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_aba_session_live_summaries_session_unique
  on public.aba_session_live_summaries (session_id);
create unique index if not exists idx_aba_patient_aba_summaries_patient_unique
  on public.aba_patient_aba_summaries (patient_id);
create unique index if not exists idx_aba_target_live_summaries_target_session_unique
  on public.aba_target_live_summaries (session_id, target_key);
create unique index if not exists idx_aba_behavior_daily_summaries_behavior_day_unique
  on public.aba_behavior_daily_summaries (patient_id, behavior_key, date);

create index if not exists idx_aba_trials_session_occurred
  on public.aba_trials (session_id, occurred_at desc);
create index if not exists idx_aba_trials_patient_target_occurred
  on public.aba_trials (patient_id, target_id, occurred_at desc);
create index if not exists idx_aba_behavior_events_session_occurred
  on public.aba_behavior_events (session_id, occurred_at desc);
create index if not exists idx_aba_behavior_events_patient_behavior_occurred
  on public.aba_behavior_events (patient_id, behavior_id, occurred_at desc);
create index if not exists idx_aba_interval_records_session_behavior_number
  on public.aba_interval_records (session_id, behavior_id, interval_number);
create index if not exists idx_aba_interval_summaries_session_behavior
  on public.aba_interval_summaries (session_id, behavior_id);
create index if not exists idx_aba_session_live_summaries_session
  on public.aba_session_live_summaries (session_id);
create index if not exists idx_aba_patient_aba_summaries_patient
  on public.aba_patient_aba_summaries (patient_id);
create index if not exists idx_aba_behavior_daily_summaries_patient_behavior_date
  on public.aba_behavior_daily_summaries (patient_id, behavior_id, date desc);

create index if not exists idx_aba_prompt_levels_organization
  on public.aba_prompt_levels (organization_id);
create index if not exists idx_aba_programs_organization
  on public.aba_programs (organization_id);
create index if not exists idx_aba_targets_organization
  on public.aba_targets (organization_id);
create index if not exists idx_aba_behavior_definitions_organization
  on public.aba_behavior_definitions (organization_id);
create index if not exists idx_aba_sessions_organization
  on public.aba_sessions (organization_id);
create index if not exists idx_aba_trials_organization
  on public.aba_trials (organization_id);
create index if not exists idx_aba_behavior_events_organization
  on public.aba_behavior_events (organization_id);
create index if not exists idx_aba_interval_records_organization
  on public.aba_interval_records (organization_id);
create index if not exists idx_aba_interval_summaries_organization
  on public.aba_interval_summaries (organization_id);
create index if not exists idx_aba_abc_events_organization
  on public.aba_abc_events (organization_id);
create index if not exists idx_aba_audit_events_organization
  on public.aba_audit_events (organization_id);
create index if not exists idx_aba_mastery_evaluations_organization
  on public.aba_mastery_evaluations (organization_id);
create index if not exists idx_aba_session_summaries_organization
  on public.aba_session_summaries (organization_id);
create index if not exists idx_aba_session_live_summaries_organization
  on public.aba_session_live_summaries (organization_id);
create index if not exists idx_aba_patient_aba_summaries_organization
  on public.aba_patient_aba_summaries (organization_id);
create index if not exists idx_aba_target_live_summaries_organization
  on public.aba_target_live_summaries (organization_id);
create index if not exists idx_aba_behavior_daily_summaries_organization
  on public.aba_behavior_daily_summaries (organization_id);

alter table public.aba_session_live_summaries enable row level security;
alter table public.aba_patient_aba_summaries enable row level security;
alter table public.aba_target_live_summaries enable row level security;
alter table public.aba_behavior_daily_summaries enable row level security;

drop policy if exists aba_session_live_summaries_patient_scope_rw on public.aba_session_live_summaries;
create policy aba_session_live_summaries_patient_scope_rw
on public.aba_session_live_summaries
for all
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_session_live_summaries.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_session_live_summaries.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_session_live_summaries.clinic_id)
      )
  )
)
with check (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_session_live_summaries.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_session_live_summaries.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_session_live_summaries.clinic_id)
      )
  )
);

drop policy if exists aba_patient_aba_summaries_patient_scope_rw on public.aba_patient_aba_summaries;
create policy aba_patient_aba_summaries_patient_scope_rw
on public.aba_patient_aba_summaries
for all
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_patient_aba_summaries.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_patient_aba_summaries.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_patient_aba_summaries.clinic_id)
      )
  )
)
with check (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_patient_aba_summaries.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_patient_aba_summaries.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_patient_aba_summaries.clinic_id)
      )
  )
);

drop policy if exists aba_target_live_summaries_patient_scope_rw on public.aba_target_live_summaries;
create policy aba_target_live_summaries_patient_scope_rw
on public.aba_target_live_summaries
for all
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_target_live_summaries.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_target_live_summaries.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_target_live_summaries.clinic_id)
      )
  )
)
with check (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_target_live_summaries.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_target_live_summaries.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_target_live_summaries.clinic_id)
      )
  )
);

drop policy if exists aba_behavior_daily_summaries_patient_scope_rw on public.aba_behavior_daily_summaries;
create policy aba_behavior_daily_summaries_patient_scope_rw
on public.aba_behavior_daily_summaries
for all
to authenticated
using (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_behavior_daily_summaries.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_behavior_daily_summaries.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_behavior_daily_summaries.clinic_id)
      )
  )
)
with check (
  exists (
    select 1 from public.patients p
    join public.users u on u.id = auth.uid()
    where p.id = aba_behavior_daily_summaries.patient_id
      and (
        u.role in ('owner', 'admin')
        or (u.role = 'coordinator' and u.clinic_id::text = aba_behavior_daily_summaries.clinic_id)
        or (u.role = 'therapist' and p.therapist_id = auth.uid() and u.clinic_id::text = aba_behavior_daily_summaries.clinic_id)
      )
  )
);

create or replace function public.aba_summary_key(raw_id text, fallback_label text)
returns text
language sql
immutable
as $$
  select coalesce(nullif(raw_id, ''), md5(coalesce(nullif(fallback_label, ''), 'unknown')));
$$;

create or replace function public.aba_summary_percent(numerator integer, denominator integer)
returns numeric
language sql
immutable
as $$
  select case when coalesce(denominator, 0) <= 0 then 0 else round((coalesce(numerator, 0)::numeric / denominator::numeric) * 100, 2) end;
$$;

create or replace function public.aba_touch_patient_summary(
  p_organization_id text,
  p_clinic_id text,
  p_patient_id uuid,
  p_session_delta integer default 0,
  p_trial_delta integer default 0,
  p_behavior_delta integer default 0,
  p_last_session_at timestamptz default null,
  p_last_behavior_event_label text default null,
  p_last_behavior_event_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_patient_id is null or p_clinic_id is null then
    return;
  end if;

  insert into public.aba_patient_aba_summaries (
    id,
    organization_id,
    clinic_id,
    patient_id,
    total_sessions,
    total_trials,
    total_behavior_events,
    last_session_at,
    last_behavior_event_label,
    last_behavior_event_at,
    updated_at
  )
  values (
    'patient-' || p_patient_id::text,
    coalesce(nullif(p_organization_id, ''), p_clinic_id),
    p_clinic_id,
    p_patient_id,
    greatest(coalesce(p_session_delta, 0), 0),
    greatest(coalesce(p_trial_delta, 0), 0),
    greatest(coalesce(p_behavior_delta, 0), 0),
    p_last_session_at,
    p_last_behavior_event_label,
    p_last_behavior_event_at,
    now()
  )
  on conflict (patient_id) do update set
    organization_id = excluded.organization_id,
    clinic_id = excluded.clinic_id,
    total_sessions = public.aba_patient_aba_summaries.total_sessions + greatest(coalesce(p_session_delta, 0), 0),
    total_trials = public.aba_patient_aba_summaries.total_trials + greatest(coalesce(p_trial_delta, 0), 0),
    total_behavior_events = public.aba_patient_aba_summaries.total_behavior_events + greatest(coalesce(p_behavior_delta, 0), 0),
    last_session_at = greatest(coalesce(public.aba_patient_aba_summaries.last_session_at, p_last_session_at), coalesce(p_last_session_at, public.aba_patient_aba_summaries.last_session_at)),
    last_behavior_event_label = coalesce(p_last_behavior_event_label, public.aba_patient_aba_summaries.last_behavior_event_label),
    last_behavior_event_at = greatest(coalesce(public.aba_patient_aba_summaries.last_behavior_event_at, p_last_behavior_event_at), coalesce(p_last_behavior_event_at, public.aba_patient_aba_summaries.last_behavior_event_at)),
    updated_at = now();
end;
$$;

create or replace function public.aba_summary_after_session_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org text := coalesce(nullif(new.organization_id, ''), new.clinic_id);
begin
  if new.patient_id is null or new.id is null then
    return new;
  end if;

  insert into public.aba_session_live_summaries (
    id, organization_id, clinic_id, patient_id, session_id, therapist_id, last_event_label, last_event_at, updated_at
  )
  values (
    'live-' || new.id,
    v_org,
    new.clinic_id,
    new.patient_id,
    new.id,
    new.therapist_id,
    'Sessao iniciada',
    new.started_at,
    now()
  )
  on conflict (session_id) do update set
    organization_id = excluded.organization_id,
    clinic_id = excluded.clinic_id,
    patient_id = excluded.patient_id,
    therapist_id = coalesce(excluded.therapist_id, public.aba_session_live_summaries.therapist_id),
    last_event_at = greatest(coalesce(public.aba_session_live_summaries.last_event_at, excluded.last_event_at), excluded.last_event_at),
    updated_at = now();

  perform public.aba_touch_patient_summary(v_org, new.clinic_id, new.patient_id, 1, 0, 0, new.started_at, null, null);
  return new;
end;
$$;

create or replace function public.aba_summary_after_trial_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org text := coalesce(nullif(new.organization_id, ''), new.clinic_id);
  v_correct_inc integer := case when new.correct then 1 else 0 end;
  v_independent_inc integer := case when new.independent then 1 else 0 end;
  v_prompted_inc integer := case when new.correct and not new.independent then 1 else 0 end;
  v_error_inc integer := case when not new.correct then 1 else 0 end;
  v_event_at timestamptz := coalesce(new.occurred_at, new.created_at, now());
  v_label text := 'Tentativa: ' || coalesce(nullif(new.target_name, ''), 'Meta sem nome');
  v_target_key text := public.aba_summary_key(new.target_id, new.target_name);
begin
  if new.patient_id is null then
    return new;
  end if;

  if new.session_id is not null and new.session_id <> '' then
    insert into public.aba_session_live_summaries (
      id, organization_id, clinic_id, patient_id, session_id, therapist_id,
      total_trials, independent_trials, prompted_trials, error_trials,
      accuracy_percent, independence_percent, last_event_label, last_event_at, updated_at
    )
    values (
      'live-' || new.session_id,
      v_org,
      new.clinic_id,
      new.patient_id,
      new.session_id,
      new.therapist_id,
      1,
      v_independent_inc,
      v_prompted_inc,
      v_error_inc,
      public.aba_summary_percent(v_correct_inc, 1),
      public.aba_summary_percent(v_independent_inc, 1),
      v_label,
      v_event_at,
      now()
    )
    on conflict (session_id) do update set
      organization_id = excluded.organization_id,
      clinic_id = excluded.clinic_id,
      patient_id = excluded.patient_id,
      therapist_id = coalesce(excluded.therapist_id, public.aba_session_live_summaries.therapist_id),
      total_trials = public.aba_session_live_summaries.total_trials + 1,
      independent_trials = public.aba_session_live_summaries.independent_trials + v_independent_inc,
      prompted_trials = public.aba_session_live_summaries.prompted_trials + v_prompted_inc,
      error_trials = public.aba_session_live_summaries.error_trials + v_error_inc,
      accuracy_percent = public.aba_summary_percent(
        (public.aba_session_live_summaries.total_trials + 1) - (public.aba_session_live_summaries.error_trials + v_error_inc),
        public.aba_session_live_summaries.total_trials + 1
      ),
      independence_percent = public.aba_summary_percent(
        public.aba_session_live_summaries.independent_trials + v_independent_inc,
        public.aba_session_live_summaries.total_trials + 1
      ),
      last_event_label = v_label,
      last_event_at = v_event_at,
      updated_at = now();

    insert into public.aba_target_live_summaries (
      id, organization_id, clinic_id, patient_id, target_id, target_key, target_name, session_id,
      attempts_today, correct_today, independent_today, prompted_today, errors_today,
      accuracy_percent, independence_percent, mastery_progress_label, updated_at
    )
    values (
      'target-' || new.session_id || '-' || v_target_key,
      v_org,
      new.clinic_id,
      new.patient_id,
      new.target_id,
      v_target_key,
      new.target_name,
      new.session_id,
      1,
      v_correct_inc,
      v_independent_inc,
      v_prompted_inc,
      v_error_inc,
      public.aba_summary_percent(v_correct_inc, 1),
      public.aba_summary_percent(v_independent_inc, 1),
      case when v_correct_inc = 1 then 'Em progresso' else 'Revisar' end,
      now()
    )
    on conflict (session_id, target_key) do update set
      organization_id = excluded.organization_id,
      clinic_id = excluded.clinic_id,
      target_name = coalesce(excluded.target_name, public.aba_target_live_summaries.target_name),
      attempts_today = public.aba_target_live_summaries.attempts_today + 1,
      correct_today = public.aba_target_live_summaries.correct_today + v_correct_inc,
      independent_today = public.aba_target_live_summaries.independent_today + v_independent_inc,
      prompted_today = public.aba_target_live_summaries.prompted_today + v_prompted_inc,
      errors_today = public.aba_target_live_summaries.errors_today + v_error_inc,
      accuracy_percent = public.aba_summary_percent(public.aba_target_live_summaries.correct_today + v_correct_inc, public.aba_target_live_summaries.attempts_today + 1),
      independence_percent = public.aba_summary_percent(public.aba_target_live_summaries.independent_today + v_independent_inc, public.aba_target_live_summaries.attempts_today + 1),
      mastery_progress_label = case
        when public.aba_summary_percent(public.aba_target_live_summaries.correct_today + v_correct_inc, public.aba_target_live_summaries.attempts_today + 1) >= 80 then 'Avancando'
        else 'Em progresso'
      end,
      updated_at = now();
  end if;

  perform public.aba_touch_patient_summary(v_org, new.clinic_id, new.patient_id, 0, 1, 0, null, v_label, v_event_at);
  return new;
end;
$$;

create or replace function public.aba_upsert_behavior_daily_duration(
  p_organization_id text,
  p_clinic_id text,
  p_patient_id uuid,
  p_behavior_id text,
  p_behavior_name text,
  p_event_date date,
  p_duration_seconds integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := public.aba_summary_key(p_behavior_id, p_behavior_name);
  v_duration integer := greatest(coalesce(p_duration_seconds, 0), 0);
begin
  if p_patient_id is null or p_event_date is null or v_duration <= 0 then
    return;
  end if;

  insert into public.aba_behavior_daily_summaries (
    id, organization_id, clinic_id, patient_id, behavior_id, behavior_key, behavior_name, date,
    duration_episode_count, duration_total_seconds, duration_avg_seconds, duration_max_seconds, updated_at
  )
  values (
    'behavior-day-' || p_patient_id::text || '-' || v_key || '-' || p_event_date::text,
    coalesce(nullif(p_organization_id, ''), p_clinic_id),
    p_clinic_id,
    p_patient_id,
    p_behavior_id,
    v_key,
    p_behavior_name,
    p_event_date,
    1,
    v_duration,
    v_duration,
    v_duration,
    now()
  )
  on conflict (patient_id, behavior_key, date) do update set
    organization_id = excluded.organization_id,
    clinic_id = excluded.clinic_id,
    behavior_name = coalesce(excluded.behavior_name, public.aba_behavior_daily_summaries.behavior_name),
    duration_episode_count = public.aba_behavior_daily_summaries.duration_episode_count + 1,
    duration_total_seconds = public.aba_behavior_daily_summaries.duration_total_seconds + v_duration,
    duration_avg_seconds = round((public.aba_behavior_daily_summaries.duration_total_seconds + v_duration)::numeric / nullif(public.aba_behavior_daily_summaries.duration_episode_count + 1, 0))::integer,
    duration_max_seconds = greatest(public.aba_behavior_daily_summaries.duration_max_seconds, v_duration),
    updated_at = now();
end;
$$;

create or replace function public.aba_summary_after_behavior_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org text := coalesce(nullif(new.organization_id, ''), new.clinic_id);
  v_event_at timestamptz := coalesce(new.occurred_at, new.started_at, new.created_at, now());
  v_label text := coalesce(nullif(new.behavior_name, ''), 'Comportamento') || ' - ' || coalesce(new.measurement_type, 'evento');
  v_behavior_key text := public.aba_summary_key(new.behavior_id, new.behavior_name);
  v_frequency_inc integer := case when new.measurement_type = 'frequency' then greatest(coalesce(new.count_delta, 1), 1) else 0 end;
  v_open_duration_inc integer := case when new.measurement_type = 'duration' and new.status = 'IN_PROGRESS' then 1 else 0 end;
  v_completed_duration_inc integer := case when new.measurement_type = 'duration' and new.status = 'COMPLETED' then 1 else 0 end;
  v_duration_seconds integer := coalesce(
    new.duration_seconds,
    case
      when new.started_at is not null and new.ended_at is not null then greatest(0, extract(epoch from (new.ended_at - new.started_at))::integer)
      else 0
    end
  );
begin
  if new.patient_id is null then
    return new;
  end if;

  if new.session_id is not null and new.session_id <> '' then
    insert into public.aba_session_live_summaries (
      id, organization_id, clinic_id, patient_id, session_id, therapist_id,
      total_behavior_events, frequency_event_count, duration_event_count, open_duration_count,
      last_event_label, last_event_at, updated_at
    )
    values (
      'live-' || new.session_id,
      v_org,
      new.clinic_id,
      new.patient_id,
      new.session_id,
      new.therapist_id,
      1,
      case when v_frequency_inc > 0 then 1 else 0 end,
      v_completed_duration_inc,
      v_open_duration_inc,
      v_label,
      v_event_at,
      now()
    )
    on conflict (session_id) do update set
      organization_id = excluded.organization_id,
      clinic_id = excluded.clinic_id,
      patient_id = excluded.patient_id,
      therapist_id = coalesce(excluded.therapist_id, public.aba_session_live_summaries.therapist_id),
      total_behavior_events = public.aba_session_live_summaries.total_behavior_events + 1,
      frequency_event_count = public.aba_session_live_summaries.frequency_event_count + case when v_frequency_inc > 0 then 1 else 0 end,
      duration_event_count = public.aba_session_live_summaries.duration_event_count + v_completed_duration_inc,
      open_duration_count = greatest(0, public.aba_session_live_summaries.open_duration_count + v_open_duration_inc),
      last_event_label = v_label,
      last_event_at = v_event_at,
      updated_at = now();
  end if;

  if v_frequency_inc > 0 then
    insert into public.aba_behavior_daily_summaries (
      id, organization_id, clinic_id, patient_id, behavior_id, behavior_key, behavior_name, date,
      frequency_count, updated_at
    )
    values (
      'behavior-day-' || new.patient_id::text || '-' || v_behavior_key || '-' || v_event_at::date::text,
      v_org,
      new.clinic_id,
      new.patient_id,
      new.behavior_id,
      v_behavior_key,
      new.behavior_name,
      v_event_at::date,
      v_frequency_inc,
      now()
    )
    on conflict (patient_id, behavior_key, date) do update set
      organization_id = excluded.organization_id,
      clinic_id = excluded.clinic_id,
      behavior_name = coalesce(excluded.behavior_name, public.aba_behavior_daily_summaries.behavior_name),
      frequency_count = public.aba_behavior_daily_summaries.frequency_count + v_frequency_inc,
      updated_at = now();
  end if;

  if v_completed_duration_inc > 0 then
    perform public.aba_upsert_behavior_daily_duration(
      v_org, new.clinic_id, new.patient_id, new.behavior_id, new.behavior_name, v_event_at::date, v_duration_seconds
    );
  end if;

  perform public.aba_touch_patient_summary(v_org, new.clinic_id, new.patient_id, 0, 0, 1, null, v_label, v_event_at);
  return new;
end;
$$;

create or replace function public.aba_summary_after_duration_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org text := coalesce(nullif(new.organization_id, ''), new.clinic_id);
  v_event_at timestamptz := coalesce(new.ended_at, new.occurred_at, new.created_at, now());
  v_label text := coalesce(nullif(new.behavior_name, ''), 'Duracao') || ' concluida';
  v_duration_seconds integer := coalesce(
    new.duration_seconds,
    case
      when new.started_at is not null and new.ended_at is not null then greatest(0, extract(epoch from (new.ended_at - new.started_at))::integer)
      else 0
    end
  );
begin
  if new.session_id is not null and new.session_id <> '' then
    update public.aba_session_live_summaries
    set duration_event_count = duration_event_count + 1,
        open_duration_count = greatest(0, open_duration_count - 1),
        last_event_label = v_label,
        last_event_at = v_event_at,
        updated_at = now()
    where session_id = new.session_id;
  end if;

  perform public.aba_upsert_behavior_daily_duration(
    v_org, new.clinic_id, new.patient_id, new.behavior_id, new.behavior_name, v_event_at::date, v_duration_seconds
  );

  perform public.aba_touch_patient_summary(v_org, new.clinic_id, new.patient_id, 0, 0, 0, null, v_label, v_event_at);
  return new;
end;
$$;

create or replace function public.aba_summary_after_interval_summary_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org text := coalesce(nullif(new.organization_id, ''), new.clinic_id);
  v_event_at timestamptz := coalesce(new.ended_at, new.created_at, now());
  v_label text := 'Intervalo: ' || coalesce(nullif(new.behavior_name, ''), 'Comportamento');
  v_behavior_key text := public.aba_summary_key(new.behavior_id, new.behavior_name);
  v_total integer := greatest(coalesce(new.answered_intervals, new.total_intervals, 0), 0);
  v_yes integer := greatest(coalesce(new.yes_count, 0), 0);
  v_no integer := greatest(coalesce(new.no_count, greatest(v_total - v_yes, 0)), 0);
begin
  if new.patient_id is null then
    return new;
  end if;

  if new.session_id is not null and new.session_id <> '' then
    insert into public.aba_session_live_summaries (
      id, organization_id, clinic_id, patient_id, session_id, therapist_id,
      interval_collection_count, last_event_label, last_event_at, updated_at
    )
    values (
      'live-' || new.session_id,
      v_org,
      new.clinic_id,
      new.patient_id,
      new.session_id,
      new.therapist_id,
      1,
      v_label,
      v_event_at,
      now()
    )
    on conflict (session_id) do update set
      organization_id = excluded.organization_id,
      clinic_id = excluded.clinic_id,
      patient_id = excluded.patient_id,
      therapist_id = coalesce(excluded.therapist_id, public.aba_session_live_summaries.therapist_id),
      interval_collection_count = public.aba_session_live_summaries.interval_collection_count + 1,
      last_event_label = v_label,
      last_event_at = v_event_at,
      updated_at = now();
  end if;

  insert into public.aba_behavior_daily_summaries (
    id, organization_id, clinic_id, patient_id, behavior_id, behavior_key, behavior_name, date,
    interval_collections_count, interval_total_count, interval_yes_count, interval_no_count, interval_occurrence_percent, updated_at
  )
  values (
    'behavior-day-' || new.patient_id::text || '-' || v_behavior_key || '-' || v_event_at::date::text,
    v_org,
    new.clinic_id,
    new.patient_id,
    new.behavior_id,
    v_behavior_key,
    new.behavior_name,
    v_event_at::date,
    1,
    v_total,
    v_yes,
    v_no,
    public.aba_summary_percent(v_yes, nullif(v_total, 0)),
    now()
  )
  on conflict (patient_id, behavior_key, date) do update set
    organization_id = excluded.organization_id,
    clinic_id = excluded.clinic_id,
    behavior_name = coalesce(excluded.behavior_name, public.aba_behavior_daily_summaries.behavior_name),
    interval_collections_count = public.aba_behavior_daily_summaries.interval_collections_count + 1,
    interval_total_count = public.aba_behavior_daily_summaries.interval_total_count + v_total,
    interval_yes_count = public.aba_behavior_daily_summaries.interval_yes_count + v_yes,
    interval_no_count = public.aba_behavior_daily_summaries.interval_no_count + v_no,
    interval_occurrence_percent = public.aba_summary_percent(
      public.aba_behavior_daily_summaries.interval_yes_count + v_yes,
      public.aba_behavior_daily_summaries.interval_total_count + v_total
    ),
    updated_at = now();

  perform public.aba_touch_patient_summary(v_org, new.clinic_id, new.patient_id, 0, 0, 1, null, v_label, v_event_at);
  return new;
end;
$$;

create or replace function public.aba_summary_after_session_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org text := coalesce(nullif(new.organization_id, ''), new.clinic_id);
  v_live public.aba_session_live_summaries%rowtype;
  v_summary_payload jsonb;
begin
  if lower(coalesce(new.status, '')) <> 'completed' then
    return new;
  end if;

  select *
  into v_live
  from public.aba_session_live_summaries
  where session_id = new.id
  limit 1;

  v_summary_payload := jsonb_build_object(
    'source', 'db_trigger',
    'frozenFrom', 'aba_session_live_summaries',
    'lastEventLabel', v_live.last_event_label,
    'lastEventAt', v_live.last_event_at
  );

  insert into public.aba_session_summaries (
    id,
    organization_id,
    clinic_id,
    session_id,
    patient_id,
    therapist_id,
    started_at,
    ended_at,
    duration_seconds,
    total_trials,
    independent_trials,
    prompted_trials,
    error_trials,
    accuracy_percent,
    independence_percent,
    total_behavior_events,
    frequency_summary,
    duration_summary,
    interval_summary,
    sync_status,
    source,
    summary_payload,
    last_event_label,
    last_event_at,
    created_at,
    updated_at
  )
  values (
    'summary-' || new.id,
    v_org,
    new.clinic_id,
    new.id,
    new.patient_id,
    new.therapist_id,
    new.started_at,
    coalesce(new.ended_at, now()),
    coalesce(new.duration_seconds, greatest(0, extract(epoch from (coalesce(new.ended_at, now()) - new.started_at))::integer)),
    coalesce(v_live.total_trials, 0),
    coalesce(v_live.independent_trials, 0),
    coalesce(v_live.prompted_trials, 0),
    coalesce(v_live.error_trials, 0),
    round(coalesce(v_live.accuracy_percent, 0))::integer,
    round(coalesce(v_live.independence_percent, 0))::integer,
    coalesce(v_live.total_behavior_events, 0),
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    'synced',
    'db_trigger',
    v_summary_payload,
    v_live.last_event_label,
    v_live.last_event_at,
    now(),
    now()
  )
  on conflict (id) do update set
    organization_id = excluded.organization_id,
    clinic_id = excluded.clinic_id,
    therapist_id = coalesce(excluded.therapist_id, public.aba_session_summaries.therapist_id),
    ended_at = excluded.ended_at,
    duration_seconds = excluded.duration_seconds,
    total_trials = greatest(public.aba_session_summaries.total_trials, excluded.total_trials),
    independent_trials = greatest(public.aba_session_summaries.independent_trials, excluded.independent_trials),
    prompted_trials = greatest(public.aba_session_summaries.prompted_trials, excluded.prompted_trials),
    error_trials = greatest(public.aba_session_summaries.error_trials, excluded.error_trials),
    accuracy_percent = greatest(public.aba_session_summaries.accuracy_percent, excluded.accuracy_percent),
    independence_percent = greatest(public.aba_session_summaries.independence_percent, excluded.independence_percent),
    total_behavior_events = greatest(public.aba_session_summaries.total_behavior_events, excluded.total_behavior_events),
    summary_payload = case
      when public.aba_session_summaries.summary_payload is null or public.aba_session_summaries.summary_payload = '{}'::jsonb then excluded.summary_payload
      else public.aba_session_summaries.summary_payload
    end,
    last_event_label = coalesce(public.aba_session_summaries.last_event_label, excluded.last_event_label),
    last_event_at = coalesce(public.aba_session_summaries.last_event_at, excluded.last_event_at),
    updated_at = now();

  perform public.aba_touch_patient_summary(v_org, new.clinic_id, new.patient_id, 0, 0, 0, new.ended_at, v_live.last_event_label, v_live.last_event_at);
  return new;
end;
$$;

drop trigger if exists trg_aba_summary_after_session_insert on public.aba_sessions;
create trigger trg_aba_summary_after_session_insert
after insert on public.aba_sessions
for each row
execute function public.aba_summary_after_session_insert();

drop trigger if exists trg_aba_summary_after_trial_insert on public.aba_trials;
create trigger trg_aba_summary_after_trial_insert
after insert on public.aba_trials
for each row
execute function public.aba_summary_after_trial_insert();

drop trigger if exists trg_aba_summary_after_behavior_insert on public.aba_behavior_events;
create trigger trg_aba_summary_after_behavior_insert
after insert on public.aba_behavior_events
for each row
execute function public.aba_summary_after_behavior_insert();

drop trigger if exists trg_aba_summary_after_duration_completed on public.aba_behavior_events;
create trigger trg_aba_summary_after_duration_completed
after update of status, ended_at, duration_seconds on public.aba_behavior_events
for each row
when (
  old.measurement_type = 'duration'
  and old.status = 'IN_PROGRESS'
  and new.status = 'COMPLETED'
)
execute function public.aba_summary_after_duration_completed();

drop trigger if exists trg_aba_summary_after_interval_summary_insert on public.aba_interval_summaries;
create trigger trg_aba_summary_after_interval_summary_insert
after insert on public.aba_interval_summaries
for each row
execute function public.aba_summary_after_interval_summary_insert();

drop trigger if exists trg_aba_summary_after_session_completed on public.aba_sessions;
create trigger trg_aba_summary_after_session_completed
after update of status on public.aba_sessions
for each row
when (
  lower(coalesce(old.status, '')) <> 'completed'
  and lower(coalesce(new.status, '')) = 'completed'
)
execute function public.aba_summary_after_session_completed();
