-- Patient note visibility/privacy hardening.
-- Additive + idempotent. Preserves existing rows and backfills only missing authority metadata.

alter table if exists public.notes
  add column if not exists visibility text,
  add column if not exists type text,
  add column if not exists original_id uuid,
  add column if not exists created_by uuid,
  add column if not exists portability_scope text not null default 'PRIVATE',
  add column if not exists is_portable boolean not null default false,
  add column if not exists shared_with_patient boolean not null default false,
  add column if not exists shared_with_professionals boolean not null default false,
  add column if not exists original_author_id uuid;

update public.notes
set visibility = case
  when shared_with_patient is true
    or lower(coalesce(visibility, '')) in ('patient','shared','family','shared_patient')
    or lower(coalesce(type, '')) in ('patient','shared','family','shared_patient')
    or upper(coalesce(portability_scope, '')) = 'PATIENT'
    then 'shared_patient'
  when shared_with_professionals is true
    or lower(coalesce(visibility, '')) in ('professional','professionals','team','shared_clinic','clinic')
    or lower(coalesce(type, '')) in ('professional','professionals','team','shared_clinic')
    or upper(coalesce(portability_scope, '')) in ('PROFESSIONALS','PROFESSIONAL','TEAM')
    then 'shared_clinic'
  else 'private'
end
where visibility is null
   or btrim(visibility) = ''
   or lower(visibility) not in ('private','shared_patient','shared_clinic');

update public.notes
set shared_with_patient = true,
    portability_scope = 'PATIENT'
where visibility = 'shared_patient'
  and (shared_with_patient is distinct from true or portability_scope is distinct from 'PATIENT');

update public.notes
set shared_with_professionals = true,
    portability_scope = 'PROFESSIONALS'
where visibility = 'shared_clinic'
  and (shared_with_professionals is distinct from true or portability_scope is distinct from 'PROFESSIONALS');

-- Preserve authorship for rows that already carry a valid UUID creator.
update public.notes
set original_author_id = created_by::text::uuid
where original_author_id is null
  and created_by is not null
  and created_by::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

create index if not exists idx_notes_patient_visibility_created_v1
  on public.notes (patient_id, visibility, created_at desc);

create index if not exists idx_notes_patient_author_created_v1
  on public.notes (patient_id, original_author_id, created_at desc)
  where original_author_id is not null;

alter table public.notes enable row level security;

-- Remove legacy broad policies that exposed every note in the clinic to coordinator/reception.
drop policy if exists "notes_select_coord_reception" on public.notes;
drop policy if exists "notes_select_therapist_linked" on public.notes;
drop policy if exists notes_select_explicit_visibility_v1 on public.notes;

create policy notes_select_explicit_visibility_v1
on public.notes
for select
to authenticated
using (
  -- Private notes: only the author.
  coalesce(notes.created_by::text, notes.original_author_id::text, '') = auth.uid()::text

  -- Patient-visible notes: the patient/responsible portal.
  or (
    notes.visibility = 'shared_patient'
    and exists (
      select 1
      from public.patients p
      where p.id = notes.patient_id
        and (
          p.responsible_user_id = auth.uid()
          or p.id = auth.uid()
        )
    )
  )

  -- Patient/team-shared notes: active members of the canonical case team.
  or (
    notes.visibility in ('shared_patient','shared_clinic')
    and exists (
      select 1
      from public.patient_professional_links link
      where link.patient_id = notes.patient_id
        and link.professional_id = auth.uid()::text
        and link.status = 'active'
        and coalesce((link.permissions ->> 'read')::boolean, true) = true
    )
  )

  -- Active supervisors scoped to this patient (or to a supervised professional linked to it).
  or (
    notes.visibility in ('shared_patient','shared_clinic')
    and exists (
      select 1
      from public.clinical_supervision_links supervision
      where supervision.supervisor_user_id = auth.uid()
        and supervision.status = 'active'
        and (
          supervision.patient_id = notes.patient_id
          or (
            supervision.patient_id is null
            and supervision.supervised_user_id is not null
            and exists (
              select 1
              from public.patient_professional_links supervised_link
              where supervised_link.patient_id = notes.patient_id
                and supervised_link.professional_id = supervision.supervised_user_id::text
                and supervised_link.status = 'active'
            )
          )
        )
    )
  )
);

-- The browser never writes clinical notes directly; mutations pass through the validated backend.
revoke insert, update, delete on public.notes from authenticated;
grant select on public.notes to authenticated;
grant all on public.notes to service_role;
