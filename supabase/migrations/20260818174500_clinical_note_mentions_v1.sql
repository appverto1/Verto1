begin;

create table if not exists public.clinical_note_mentions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  patient_id uuid not null,
  note_id uuid not null,
  recipient_user_id uuid not null,
  mentioned_by uuid not null,
  note_subject text null,
  note_excerpt text null,
  read_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists clinical_note_mentions_note_recipient_uidx
  on public.clinical_note_mentions (note_id, recipient_user_id);
create index if not exists clinical_note_mentions_recipient_created_idx
  on public.clinical_note_mentions (recipient_user_id, created_at desc);
create index if not exists clinical_note_mentions_patient_created_idx
  on public.clinical_note_mentions (patient_id, created_at desc);

alter table public.clinical_note_mentions enable row level security;

drop policy if exists clinical_note_mentions_recipient_select on public.clinical_note_mentions;
create policy clinical_note_mentions_recipient_select
  on public.clinical_note_mentions
  for select
  to authenticated
  using (recipient_user_id = auth.uid());

drop policy if exists clinical_note_mentions_recipient_update on public.clinical_note_mentions;
create policy clinical_note_mentions_recipient_update
  on public.clinical_note_mentions
  for update
  to authenticated
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

revoke all on table public.clinical_note_mentions from anon;
revoke insert, delete on table public.clinical_note_mentions from authenticated;
grant select on table public.clinical_note_mentions to authenticated;
grant update (read_at, updated_at) on table public.clinical_note_mentions to authenticated;
grant all on table public.clinical_note_mentions to service_role;

commit;
