-- P0 #254. Reconcile the existing production schema with the already-shipped
-- append-only adult wellbeing API. Does not alter any clinical data or other tables.
-- Idempotent in Staging, where the table already exists.
begin;

create table if not exists public.patient_wellbeing_checkins (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  actor_user_id uuid null,
  metric_kind text not null,
  metric_value smallint not null,
  tag_id text null,
  tag_label text null,
  note text null,
  icon text null,
  local_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_wellbeing_checkins_metric_kind_chk check (metric_kind in ('mood', 'energy')),
  constraint patient_wellbeing_checkins_metric_value_chk check (metric_value between 0 and 100),
  constraint patient_wellbeing_checkins_tag_id_len_chk check (tag_id is null or char_length(tag_id) <= 80),
  constraint patient_wellbeing_checkins_tag_label_len_chk check (tag_label is null or char_length(tag_label) <= 120),
  constraint patient_wellbeing_checkins_note_len_chk check (note is null or char_length(note) <= 4000),
  constraint patient_wellbeing_checkins_icon_len_chk check (icon is null or char_length(icon) <= 20),
  constraint patient_wellbeing_checkins_org_clinic_chk check (organization_id = clinic_id)
);

-- No daily UNIQUE constraint: users may submit multiple check-ins per day.
create index if not exists idx_patient_wellbeing_checkins_patient_date
  on public.patient_wellbeing_checkins (clinic_id, patient_id, local_date desc, created_at desc);
create index if not exists idx_patient_wellbeing_checkins_patient_created
  on public.patient_wellbeing_checkins (clinic_id, patient_id, created_at desc, id desc);

alter table public.patient_wellbeing_checkins enable row level security;
revoke all on table public.patient_wellbeing_checkins from public, anon, authenticated;
revoke update, delete on table public.patient_wellbeing_checkins from service_role;
grant select, insert on table public.patient_wellbeing_checkins to service_role;

comment on table public.patient_wellbeing_checkins is
  'Canonical append-only patient-portal mood/energy events. Multiple events per day are preserved. Values are longitudinal context, not a diagnostic or global clinical score.';

commit;
