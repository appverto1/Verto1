-- Structured school management hardening and end-to-end completion.
-- Corrective migration for 20260725220000_structured_school_management.sql, already applied.
-- Additive/preservation-first: no clinical, school, meeting, document or audit row is deleted.

begin;

create extension if not exists pgcrypto;
create extension if not exists unaccent;

-- ---------------------------------------------------------------------------
-- 1. Canonical organization ownership. Clinics remain operational workspaces.
-- ---------------------------------------------------------------------------
create table if not exists public.school_organizations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references public.users(id) on delete set null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists school_organizations_owner_uidx
  on public.school_organizations(owner_user_id)
  where owner_user_id is not null;

alter table public.clinics
  add column if not exists school_organization_id uuid references public.school_organizations(id) on delete restrict;

-- Clinics of the same owner are grouped in one organization. Clinics without an
-- owner retain an isolated organization whose id equals the clinic id.
insert into public.school_organizations(id, owner_user_id, name)
select (array_agg(c.id order by c.id))[1], c.owner_user_id, max(coalesce(nullif(c.name, ''), 'Organização Verto'))
from public.clinics c
where c.owner_user_id is not null
group by c.owner_user_id
on conflict do nothing;

insert into public.school_organizations(id, owner_user_id, name)
select c.id, null, coalesce(nullif(c.name, ''), 'Organização Verto')
from public.clinics c
where c.owner_user_id is null
on conflict (id) do nothing;

update public.clinics c
set school_organization_id = resolved.organization_id
from (
  select c2.id as clinic_id,
         case
           when c2.owner_user_id is null then c2.id
           else (select c3.id from public.clinics c3 where c3.owner_user_id = c2.owner_user_id order by c3.id limit 1)
         end as organization_id
  from public.clinics c2
) resolved
where c.id = resolved.clinic_id
  and c.school_organization_id is distinct from resolved.organization_id;

alter table public.clinics alter column school_organization_id set not null;
create index if not exists clinics_school_organization_idx on public.clinics(school_organization_id, id);


create or replace function public.assign_school_organization_to_clinic()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
begin
  if tg_op = 'UPDATE' and new.school_organization_id is not null and new.owner_user_id is not distinct from old.owner_user_id then
    return new;
  end if;

  if new.owner_user_id is not null then
    select id into v_organization_id
    from public.school_organizations
    where owner_user_id = new.owner_user_id
    limit 1;

    if v_organization_id is null then
      begin
        insert into public.school_organizations(owner_user_id, name)
        values (new.owner_user_id, coalesce(nullif(new.name, ''), 'Organização Verto'))
        returning id into v_organization_id;
      exception when unique_violation then
        select id into v_organization_id
        from public.school_organizations
        where owner_user_id = new.owner_user_id
        limit 1;
      end;
    end if;
  else
    v_organization_id := coalesce(new.school_organization_id, new.id);
    insert into public.school_organizations(id, owner_user_id, name)
    values (v_organization_id, null, coalesce(nullif(new.name, ''), 'Organização Verto'))
    on conflict (id) do nothing;
  end if;

  new.school_organization_id := v_organization_id;
  return new;
end;
$$;

drop trigger if exists clinics_assign_school_organization on public.clinics;
create trigger clinics_assign_school_organization
before insert or update of owner_user_id on public.clinics
for each row execute function public.assign_school_organization_to_clinic();

create table if not exists public.school_clinic_links (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  school_id uuid not null references public.schools(id) on delete restrict,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  is_active boolean not null default true,
  linked_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (school_id, clinic_id)
);

-- Preserve possibly duplicated schools before moving clinic-scoped rows into the
-- shared organization. The previous unique indexes would otherwise reject a safe
-- tenant correction when two clinics had independently registered the same school.
alter table public.schools
  add column if not exists deduplication_status text not null default 'CANONICAL',
  add column if not exists duplicate_group_key text,
  add column if not exists duplicate_reviewed_at timestamptz,
  add column if not exists duplicate_reviewed_by text;

alter table public.schools drop constraint if exists schools_deduplication_status_check;
alter table public.schools add constraint schools_deduplication_status_check
  check (deduplication_status in ('CANONICAL','REVIEW_REQUIRED','CONFIRMED_DISTINCT')) not valid;
alter table public.schools validate constraint schools_deduplication_status_check;

drop index if exists public.idx_schools_tax_id_unique;
drop index if exists public.idx_schools_inep_unique;

-- Correct tenant values written by the previous migration (organization_id was
-- incorrectly populated with clinic_id). Existing ids and history are preserved.
update public.schools s
set organization_id = c.school_organization_id::text
from public.clinics c
where c.id::text = coalesce(nullif(s.clinic_id, ''), s.organization_id)
  and s.organization_id is distinct from c.school_organization_id::text;

update public.patient_school_enrollments e
set organization_id = c.school_organization_id::text
from public.clinics c
where c.id::text = e.clinic_id
  and e.organization_id is distinct from c.school_organization_id::text;

update public.school_consents e
set organization_id = c.school_organization_id::text
from public.clinics c
where c.id::text = e.clinic_id
  and e.organization_id is distinct from c.school_organization_id::text;

update public.school_meetings e
set organization_id = c.school_organization_id::text
from public.clinics c
where c.id::text = e.clinic_id
  and e.organization_id is distinct from c.school_organization_id::text;

update public.school_meeting_minutes e
set organization_id = c.school_organization_id::text
from public.clinics c
where c.id::text = e.clinic_id
  and e.organization_id is distinct from c.school_organization_id::text;

update public.school_meeting_patient_notes e
set organization_id = c.school_organization_id::text
from public.clinics c
where c.id::text = e.clinic_id
  and e.organization_id is distinct from c.school_organization_id::text;

update public.school_document_links e
set organization_id = c.school_organization_id::text
from public.clinics c
where c.id::text = e.clinic_id
  and e.organization_id is distinct from c.school_organization_id::text;

update public.school_units u
set organization_id = s.organization_id
from public.schools s
where s.id = u.school_id
  and u.organization_id is distinct from s.organization_id;

update public.school_contacts sc
set organization_id = s.organization_id
from public.schools s
where s.id = sc.school_id
  and sc.organization_id is distinct from s.organization_id;

update public.school_meeting_patients child
set organization_id = parent.organization_id
from public.school_meetings parent
where parent.id = child.meeting_id
  and child.organization_id is distinct from parent.organization_id;

update public.school_meeting_participants child
set organization_id = parent.organization_id
from public.school_meetings parent
where parent.id = child.meeting_id
  and child.organization_id is distinct from parent.organization_id;

update public.school_audit_events a
set organization_id = c.school_organization_id::text
from public.clinics c
where c.id::text = a.clinic_id
  and a.organization_id is distinct from c.school_organization_id::text;

update public.school_migration_review_queue q
set organization_id = c.school_organization_id::text
from public.clinics c
where c.id::text = q.clinic_id
  and q.organization_id is distinct from c.school_organization_id::text;

update public.school_idempotency_records i
set organization_id = c.school_organization_id::text
from public.clinics c
where i.organization_id = c.id::text
  and i.organization_id is distinct from c.school_organization_id::text;

insert into public.school_clinic_links(organization_id, school_id, clinic_id, linked_by)
select s.organization_id, s.id, c.id, null
from public.schools s
join public.clinics c on c.id::text = s.clinic_id
on conflict (school_id, clinic_id) do nothing;

-- Existing duplicates are never merged automatically. They remain available and
-- are explicitly marked for review. Future writes serialize on the identity key.
with duplicate_ids as (
  select organization_id, tax_id as identity_value
  from public.schools
  where tax_id is not null and archived_at is null
  group by organization_id, tax_id having count(*) > 1
)
update public.schools s
set deduplication_status='REVIEW_REQUIRED',
    duplicate_group_key='TAX:'||s.tax_id
from duplicate_ids d
where s.organization_id=d.organization_id and s.tax_id=d.identity_value and s.archived_at is null;

with duplicate_ids as (
  select organization_id, inep_code as identity_value
  from public.schools
  where inep_code is not null and archived_at is null
  group by organization_id, inep_code having count(*) > 1
)
update public.schools s
set deduplication_status='REVIEW_REQUIRED',
    duplicate_group_key=coalesce(s.duplicate_group_key,'INEP:'||s.inep_code)
from duplicate_ids d
where s.organization_id=d.organization_id and s.inep_code=d.identity_value and s.archived_at is null;

with duplicate_names as (
  select organization_id,normalized_name,coalesce(city,'') as city_key,coalesce(state,'') as state_key
  from public.schools
  where archived_at is null
  group by organization_id,normalized_name,coalesce(city,''),coalesce(state,'') having count(*)>1
)
update public.schools s
set deduplication_status='REVIEW_REQUIRED',
    duplicate_group_key=coalesce(s.duplicate_group_key,'NAME:'||s.normalized_name||':'||coalesce(s.city,'')||':'||coalesce(s.state,''))
from duplicate_names d
where s.organization_id=d.organization_id and s.normalized_name=d.normalized_name
  and coalesce(s.city,'')=d.city_key and coalesce(s.state,'')=d.state_key and s.archived_at is null;

create index if not exists schools_tax_lookup_idx on public.schools(organization_id,tax_id) where tax_id is not null and archived_at is null;
create index if not exists schools_inep_lookup_idx on public.schools(organization_id,inep_code) where inep_code is not null and archived_at is null;
create index if not exists schools_duplicate_review_idx on public.schools(organization_id,deduplication_status,duplicate_group_key) where archived_at is null;
create unique index if not exists schools_tax_canonical_uidx on public.schools(organization_id,tax_id)
  where tax_id is not null and archived_at is null and deduplication_status='CANONICAL';
create unique index if not exists schools_inep_canonical_uidx on public.schools(organization_id,inep_code)
  where inep_code is not null and archived_at is null and deduplication_status='CANONICAL';

-- ---------------------------------------------------------------------------
-- 2. Additive model corrections.
-- ---------------------------------------------------------------------------
alter table public.school_contacts
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text,
  add column if not exists archive_reason text;

alter table public.patient_school_enrollments
  add column if not exists enrollment_type text not null default 'PRIMARY_SCHOOL',
  add column if not exists ended_by text,
  add column if not exists idempotency_key text,
  add column if not exists payload_hash text;

alter table public.patient_school_enrollments
  drop constraint if exists patient_school_enrollments_enrollment_type_check;
alter table public.patient_school_enrollments
  add constraint patient_school_enrollments_enrollment_type_check
  check (enrollment_type in ('PRIMARY_SCHOOL','SECONDARY_SCHOOL','SUPPORT_INSTITUTION','HOME_EDUCATION','COURSE','OTHER')) not valid;
alter table public.patient_school_enrollments validate constraint patient_school_enrollments_enrollment_type_check;

drop index if exists public.idx_enrollment_single_current;
create unique index if not exists patient_school_primary_current_uidx
  on public.patient_school_enrollments(organization_id, patient_id)
  where is_current and enrollment_type = 'PRIMARY_SCHOOL';
create index if not exists patient_school_current_types_idx
  on public.patient_school_enrollments(organization_id, clinic_id, patient_id, enrollment_type, is_current, started_at desc);

alter table public.school_consents
  add column if not exists consent_version integer not null default 1,
  add column if not exists is_current boolean not null default true,
  add column if not exists supersedes_consent_id uuid references public.school_consents(id) on delete restrict,
  add column if not exists effective_at timestamptz not null default now(),
  add column if not exists idempotency_key text,
  add column if not exists payload_hash text;

with ranked as (
  select id,
         row_number() over (
           partition by organization_id, patient_id, coalesce(school_enrollment_id, '00000000-0000-0000-0000-000000000000'::uuid), consent_type
           order by coalesce(granted_at, effective_at, created_at) desc, created_at desc, id desc
         ) as rn,
         row_number() over (
           partition by organization_id, patient_id, coalesce(school_enrollment_id, '00000000-0000-0000-0000-000000000000'::uuid), consent_type
           order by coalesce(granted_at, effective_at, created_at), created_at, id
         ) as version_no
  from public.school_consents
)
update public.school_consents c
set is_current = ranked.rn = 1,
    consent_version = ranked.version_no
from ranked
where ranked.id = c.id;

create unique index if not exists school_consents_one_current_uidx
  on public.school_consents(
    organization_id,
    patient_id,
    coalesce(school_enrollment_id, '00000000-0000-0000-0000-000000000000'::uuid),
    consent_type
  ) where is_current;
create unique index if not exists school_consents_idempotency_uidx
  on public.school_consents(organization_id, idempotency_key)
  where idempotency_key is not null;


alter table public.school_meetings
  add column if not exists version integer not null default 1,
  add column if not exists last_transition_at timestamptz,
  add column if not exists last_transition_by text,
  add column if not exists previous_scheduled_start timestamptz,
  add column if not exists previous_scheduled_end timestamptz;

alter table public.school_meeting_patients
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by text,
  add column if not exists removal_reason text,
  add column if not exists attendance_marked_at timestamptz,
  add column if not exists attendance_marked_by text,
  add column if not exists attendance_notes text,
  add column if not exists actual_joined_at timestamptz,
  add column if not exists idempotency_key text;

alter table public.school_meeting_patients
  drop constraint if exists school_meeting_patients_participation_status_check;
alter table public.school_meeting_patients
  add constraint school_meeting_patients_participation_status_check
  check (participation_status in ('INVITED','CONFIRMED','ATTENDED','ABSENT','DECLINED','UNKNOWN','REMOVED')) not valid;
alter table public.school_meeting_patients validate constraint school_meeting_patients_participation_status_check;

alter table public.school_meeting_participants
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by text,
  add column if not exists removal_reason text,
  add column if not exists attendance_marked_at timestamptz,
  add column if not exists attendance_marked_by text,
  add column if not exists attendance_notes text,
  add column if not exists actual_joined_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists payload_hash text;

alter table public.school_meeting_participants
  drop constraint if exists school_meeting_participants_participant_type_check;
alter table public.school_meeting_participants
  add constraint school_meeting_participants_participant_type_check
  check (participant_type in ('INTERNAL_USER','INTERNAL_PROFESSIONAL','FAMILY_RESPONSIBLE','SCHOOL_CONTACT','EXTERNAL_GUEST')) not valid;
alter table public.school_meeting_participants validate constraint school_meeting_participants_participant_type_check;

alter table public.school_meeting_participants
  drop constraint if exists school_meeting_participants_attendance_status_check;
alter table public.school_meeting_participants
  add constraint school_meeting_participants_attendance_status_check
  check (attendance_status in ('INVITED','CONFIRMED','ATTENDED','ABSENT','DECLINED','UNKNOWN')) not valid;
alter table public.school_meeting_participants validate constraint school_meeting_participants_attendance_status_check;

create unique index if not exists school_meeting_participant_identity_uidx
  on public.school_meeting_participants(
    meeting_id,
    participant_type,
    coalesce(professional_id, ''),
    coalesce(responsible_id, ''),
    coalesce(school_contact_id::text, ''),
    coalesce(lower(external_email), ''),
    coalesce(public.normalize_school_identity(external_name), '')
  ) where removed_at is null;

alter table public.school_meeting_minutes
  add column if not exists task_sync_status text not null default 'NOT_REQUESTED',
  add column if not exists task_sync_error text,
  add column if not exists idempotency_key text,
  add column if not exists payload_hash text;

alter table public.school_meeting_minutes
  drop constraint if exists school_meeting_minutes_task_sync_status_check;
alter table public.school_meeting_minutes
  add constraint school_meeting_minutes_task_sync_status_check
  check (task_sync_status in ('NOT_REQUESTED','PENDING','COMPLETED','FAILED')) not valid;
alter table public.school_meeting_minutes validate constraint school_meeting_minutes_task_sync_status_check;

alter table public.school_meeting_patient_notes
  add column if not exists version integer not null default 1,
  add column if not exists is_current boolean not null default true,
  add column if not exists supersedes_note_id uuid references public.school_meeting_patient_notes(id) on delete restrict,
  add column if not exists idempotency_key text,
  add column if not exists payload_hash text;

alter table public.school_meeting_patient_notes
  drop constraint if exists school_meeting_patient_notes_meeting_id_patient_id_key;
create unique index if not exists school_meeting_patient_notes_current_uidx
  on public.school_meeting_patient_notes(meeting_id, patient_id)
  where is_current;
create unique index if not exists school_meeting_patient_notes_idempotency_uidx
  on public.school_meeting_patient_notes(organization_id, idempotency_key)
  where idempotency_key is not null;

alter table public.school_document_links
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_by text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text,
  add column if not exists archive_reason text,
  add column if not exists idempotency_key text,
  add column if not exists payload_hash text;

alter table public.school_migration_review_queue
  add column if not exists source_field text,
  add column if not exists decision text,
  add column if not exists selected_school_id uuid references public.schools(id) on delete restrict,
  add column if not exists selected_school_unit_id uuid references public.school_units(id) on delete set null,
  add column if not exists review_error text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists idempotency_key text,
  add column if not exists payload_hash text;

alter table public.school_migration_review_queue
  drop constraint if exists school_migration_review_queue_status_check;
alter table public.school_migration_review_queue
  add constraint school_migration_review_queue_status_check
  check (status in ('PENDING','AMBIGUOUS','DEFERRED','RESOLVED','IGNORED','NOT_SCHOOL','ERROR')) not valid;
alter table public.school_migration_review_queue validate constraint school_migration_review_queue_status_check;

alter table public.school_idempotency_records
  add column if not exists performed_at timestamptz not null default now();

create table if not exists public.school_meeting_referrals (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text not null,
  meeting_id uuid not null references public.school_meetings(id) on delete restrict,
  patient_id uuid references public.patients(id) on delete restrict,
  title text not null,
  description text,
  responsible_user_id text not null,
  due_at timestamptz,
  priority text not null default 'MEDIUM' check (priority in ('LOW','MEDIUM','HIGH','URGENT')),
  status text not null default 'PENDING_TASK' check (status in ('PENDING_TASK','TASK_CREATED','TASK_FAILED','CANCELLED')),
  task_id uuid,
  task_error text,
  idempotency_key text not null,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index if not exists school_clinic_links_scope_idx on public.school_clinic_links(organization_id, clinic_id, is_active, school_id);
create index if not exists school_meeting_patients_active_idx on public.school_meeting_patients(organization_id, meeting_id, participation_status, patient_id);
create index if not exists school_meeting_participants_active_idx on public.school_meeting_participants(organization_id, meeting_id, attendance_status) where removed_at is null;
create index if not exists school_documents_active_scope_idx on public.school_document_links(organization_id, school_id, meeting_id, patient_id, document_date desc) where archived_at is null;
create index if not exists school_review_queue_status_idx on public.school_migration_review_queue(organization_id, clinic_id, status, created_at);
create index if not exists school_meeting_referrals_meeting_idx on public.school_meeting_referrals(organization_id, meeting_id, status, due_at);

-- ---------------------------------------------------------------------------
-- 3. Authorization helpers used by RLS and SECURITY DEFINER RPCs.
-- ---------------------------------------------------------------------------
create or replace function public.school_actor_effective_role(p_actor_id uuid, p_clinic_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select 'owner' from public.clinics c where c.id = p_clinic_id and c.owner_user_id = p_actor_id limit 1),
    (select lower(cm.role) from public.clinic_memberships cm where cm.user_id = p_actor_id and cm.clinic_id = p_clinic_id and cm.status = 'active' limit 1),
    (select lower(u.role) from public.users u where u.id = p_actor_id and u.clinic_id = p_clinic_id limit 1)
  );
$$;

create or replace function public.school_actor_has_role(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_organization_id uuid,
  p_allowed_roles text[]
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.clinics c
    where c.id = p_clinic_id and c.school_organization_id = p_organization_id
  ) and coalesce(public.school_actor_effective_role(p_actor_id, p_clinic_id) = any(p_allowed_roles), false);
$$;

create or replace function public.school_actor_can_access_patient(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_patient_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.patients p
    where p.id = p_patient_id
      and p.clinic_id = p_clinic_id
      and (
        public.school_actor_effective_role(p_actor_id, p_clinic_id) in ('owner','admin','coordinator','receptionist')
        or (
          public.school_actor_effective_role(p_actor_id, p_clinic_id) = 'therapist'
          and p.therapist_id::text = p_actor_id::text
        )
      )
  );
$$;

create or replace function public.school_rls_org_access(p_organization_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.clinics c
    left join public.clinic_memberships cm
      on cm.clinic_id = c.id and cm.user_id = auth.uid() and cm.status = 'active'
    left join public.users u on u.id = auth.uid() and u.clinic_id = c.id
    where c.school_organization_id::text = p_organization_id
      and (
        c.owner_user_id = auth.uid()
        or lower(cm.role) in ('owner','admin','coordinator','receptionist','therapist')
        or lower(u.role) in ('owner','admin','coordinator','receptionist','therapist')
      )
  );
$$;

create or replace function public.school_rls_patient_access(p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.patients p
    join public.clinics c on c.id = p.clinic_id
    left join public.clinic_memberships cm
      on cm.clinic_id = p.clinic_id and cm.user_id = auth.uid() and cm.status = 'active'
    left join public.users u on u.id = auth.uid() and u.clinic_id = p.clinic_id
    where p.id = p_patient_id
      and (
        c.owner_user_id = auth.uid()
        or lower(cm.role) in ('admin','coordinator','receptionist')
        or lower(u.role) in ('admin','coordinator','receptionist')
        or ((lower(cm.role) = 'therapist' or lower(u.role) = 'therapist') and p.therapist_id = auth.uid())
      )
  );
$$;

create or replace function public.school_rls_meeting_access(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.school_meetings m
    join public.clinics c on c.id::text = m.clinic_id
    where m.id = p_meeting_id
      and (
        public.school_actor_effective_role(auth.uid(), c.id) in ('owner','admin','coordinator','receptionist')
        or exists (
          select 1 from public.school_meeting_participants mp
          where mp.meeting_id = m.id
            and mp.removed_at is null
            and mp.professional_id = auth.uid()::text
        )
        or exists (
          select 1 from public.school_meeting_patients smp
          where smp.meeting_id = m.id
            and smp.participation_status <> 'REMOVED'
            and public.school_rls_patient_access(smp.patient_id)
        )
      )
  );
$$;

create or replace function public.school_consent_current_status(
  p_organization_id text,
  p_patient_id uuid,
  p_enrollment_id uuid,
  p_consent_type text,
  p_at timestamptz default now()
) returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when c.revoked_at is not null or c.status = 'REVOKED' then 'REVOKED'
      when c.expires_at is not null and c.expires_at < p_at then 'EXPIRED'
      else c.status
    end
    from public.school_consents c
    where c.organization_id = p_organization_id
      and c.patient_id = p_patient_id
      and c.consent_type = p_consent_type
      and c.is_current
      and (c.school_enrollment_id = p_enrollment_id or c.school_enrollment_id is null)
    order by (c.school_enrollment_id = p_enrollment_id) desc, c.effective_at desc, c.created_at desc
    limit 1
  ), 'PENDING');
$$;

create or replace function public.school_idempotency_existing(
  p_organization_id text,
  p_operation text,
  p_idempotency_key text,
  p_payload_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.school_idempotency_records%rowtype;
begin
  if nullif(trim(p_idempotency_key), '') is null or nullif(trim(p_payload_hash), '') is null then
    raise exception 'SCHOOL_IDEMPOTENCY_REQUIRED';
  end if;
  -- Serializes equal retries before the resource is created. The second caller
  -- reads the original response instead of racing into a duplicate insert.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id || ':' || p_operation || ':' || p_idempotency_key, 0));
  select * into v_row
  from public.school_idempotency_records
  where organization_id = p_organization_id
    and operation = p_operation
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_row.payload_hash <> p_payload_hash then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_row.response_payload;
  end if;
  return null;
end;
$$;

create or replace function public.school_idempotency_store(
  p_organization_id text,
  p_operation text,
  p_idempotency_key text,
  p_payload_hash text,
  p_resource_type text,
  p_resource_id text,
  p_response jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.school_idempotency_records(
    organization_id, operation, idempotency_key, payload_hash,
    resource_type, resource_id, response_payload, performed_at
  ) values (
    p_organization_id, p_operation, p_idempotency_key, p_payload_hash,
    p_resource_type, p_resource_id, coalesce(p_response, '{}'::jsonb), now()
  )
  on conflict (organization_id, operation, idempotency_key) do nothing;
end;
$$;

create or replace function public.school_audit_append(
  p_organization_id text,
  p_clinic_id uuid,
  p_actor_id uuid,
  p_resource_type text,
  p_resource_id text,
  p_action text,
  p_before jsonb,
  p_after jsonb,
  p_reason text,
  p_idempotency_key text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_idempotency_key is not null and exists (
    select 1 from public.school_audit_events
    where organization_id = p_organization_id and idempotency_key = p_idempotency_key
  ) then return; end if;
  insert into public.school_audit_events(
    organization_id, clinic_id, actor_id, resource_type, resource_id,
    action, before_state, after_state, reason, idempotency_key
  ) values (
    p_organization_id, p_clinic_id::text, p_actor_id::text,
    p_resource_type, p_resource_id, p_action,
    coalesce(p_before, '{}'::jsonb), coalesce(p_after, '{}'::jsonb),
    left(p_reason, 1000), p_idempotency_key
  );
end;
$$;

create or replace function public.school_assert_professional_availability(
  p_organization_id text,
  p_clinic_id uuid,
  p_professional_ids text[],
  p_start timestamptz,
  p_end timestamptz,
  p_exclude_meeting_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_professional text;
  v_conflict jsonb;
begin
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'INVALID_MEETING_TIME';
  end if;
  foreach v_professional in array coalesce(p_professional_ids, '{}'::text[]) loop
    if nullif(v_professional, '') is null then continue; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_organization_id || ':school-professional:' || v_professional, 0));

    select jsonb_build_object(
      'professionalId', v_professional,
      'eventId', a.id,
      'start', coalesce(a.scheduled_start_at, a.scheduled_at),
      'end', coalesce(
        a.scheduled_end_at,
        coalesce(a.scheduled_start_at, a.scheduled_at)
          + make_interval(mins => greatest(coalesce(a.scheduled_duration_minutes, a.duration_minutes, 50), 1))
      ),
      'eventType', 'CLINICAL_APPOINTMENT'
    ) into v_conflict
    from public.appointments a
    where a.clinic_id = p_clinic_id
      and (
        a.therapist_id::text = v_professional
        or exists (
          select 1 from public.appointment_professionals ap
          where ap.appointment_id = a.id and ap.professional_id::text = v_professional
        )
      )
      and a.deleted_at is null
      and coalesce(a.is_active, true)
      and lower(coalesce(a.status, 'scheduled')) not in ('cancelled','canceled','completed','no_show','missed','deleted')
      and coalesce(a.scheduled_start_at, a.scheduled_at) is not null
      and tstzrange(
        coalesce(a.scheduled_start_at, a.scheduled_at),
        coalesce(
          a.scheduled_end_at,
          coalesce(a.scheduled_start_at, a.scheduled_at)
            + make_interval(mins => greatest(coalesce(a.scheduled_duration_minutes, a.duration_minutes, 50), 1))
        ),
        '[)'
      ) && tstzrange(p_start, p_end, '[)')
    order by coalesce(a.scheduled_start_at, a.scheduled_at)
    limit 1;

    if v_conflict is null then
      select jsonb_build_object(
        'professionalId', v_professional,
        'eventId', m.id,
        'start', m.scheduled_start,
        'end', m.scheduled_end,
        'eventType', m.meeting_type
      ) into v_conflict
      from public.school_meetings m
      where m.organization_id = p_organization_id
        and m.clinic_id = p_clinic_id::text
        and m.id is distinct from p_exclude_meeting_id
        and m.status not in ('CANCELLED','NOT_HELD')
        and m.scheduled_start is not null and m.scheduled_end is not null
        and (
          m.responsible_professional_id = v_professional
          or exists (
            select 1 from public.school_meeting_participants mp
            where mp.meeting_id = m.id and mp.removed_at is null
              and mp.professional_id = v_professional
          )
        )
        and tstzrange(m.scheduled_start, m.scheduled_end, '[)') && tstzrange(p_start, p_end, '[)')
      order by m.scheduled_start
      limit 1;
    end if;

    if v_conflict is not null then
      raise exception 'SCHOOL_PROFESSIONAL_CONFLICT:%', v_conflict::text;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Transactional/idempotent write RPCs. Called only by the trusted backend.
-- ---------------------------------------------------------------------------
create or replace function public.school_create_school_v2(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_organization_id uuid,
  p_payload jsonb,
  p_idempotency_key text,
  p_payload_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing jsonb;
  v_school public.schools%rowtype;
  v_display_name text := left(trim(coalesce(p_payload->>'displayName','')), 200);
  v_normalized text;
  v_city text := left(nullif(trim(p_payload->>'city'),''),160);
  v_state text := upper(left(nullif(trim(p_payload->>'state'),''),2));
  v_tax_id text := public.normalize_school_digits(p_payload->>'taxId');
  v_inep_code text := public.normalize_school_digits(p_payload->>'inepCode');
  v_name_duplicate boolean := false;
  v_deduplication_status text := 'CANONICAL';
  v_response jsonb;
begin
  if not public.school_actor_has_role(p_actor_id,p_clinic_id,p_organization_id,array['owner','admin','coordinator','receptionist']) then raise exception 'ACCESS_DENIED'; end if;
  v_existing := public.school_idempotency_existing(p_organization_id::text,'CREATE_SCHOOL',p_idempotency_key,p_payload_hash);
  if v_existing is not null then return v_existing; end if;
  if v_display_name = '' then raise exception 'INVALID_SCHOOL_NAME'; end if;
  v_normalized := public.normalize_school_identity(v_display_name);

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':SCHOOL:'||coalesce(v_tax_id,v_inep_code,v_normalized||':'||coalesce(v_city,'')||':'||coalesce(v_state,'')),0));
  if v_tax_id is not null and exists(select 1 from public.schools s where s.organization_id=p_organization_id::text and s.tax_id=v_tax_id and s.archived_at is null) then raise exception 'SCHOOL_TAX_ID_DUPLICATE'; end if;
  if v_inep_code is not null and exists(select 1 from public.schools s where s.organization_id=p_organization_id::text and s.inep_code=v_inep_code and s.archived_at is null) then raise exception 'SCHOOL_INEP_DUPLICATE'; end if;
  select exists(select 1 from public.schools s where s.organization_id=p_organization_id::text and s.normalized_name=v_normalized and coalesce(s.city,'')=coalesce(v_city,'') and coalesce(s.state,'')=coalesce(v_state,'') and s.archived_at is null) into v_name_duplicate;
  if v_name_duplicate and coalesce((p_payload->>'confirmPossibleDuplicate')::boolean,false) is not true then raise exception 'POSSIBLE_SCHOOL_DUPLICATE'; end if;
  if v_name_duplicate then v_deduplication_status := 'CONFIRMED_DISTINCT'; end if;

  insert into public.schools(
    organization_id, clinic_id, legal_name, display_name, normalized_name, trade_name,
    school_type, education_network, tax_id, inep_code, email, phone, whatsapp, website,
    postal_code, street, street_number, address_complement, district, city, state, country,
    notes, responsible_professional_id, created_by, updated_by,deduplication_status,duplicate_group_key,
    duplicate_reviewed_at,duplicate_reviewed_by
  ) values (
    p_organization_id::text,p_clinic_id::text,left(nullif(trim(p_payload->>'legalName'),''),240),v_display_name,v_normalized,
    left(nullif(trim(p_payload->>'tradeName'),''),200),coalesce(nullif(upper(p_payload->>'schoolType'),''),'OTHER'),
    coalesce(nullif(upper(p_payload->>'educationNetwork'),''),'OTHER'),v_tax_id,v_inep_code,left(nullif(trim(p_payload->>'email'),''),320),
    left(nullif(trim(p_payload->>'phone'),''),40),left(nullif(trim(p_payload->>'whatsapp'),''),40),
    left(nullif(trim(p_payload->>'website'),''),500),left(nullif(trim(p_payload->>'postalCode'),''),20),
    left(nullif(trim(p_payload->>'street'),''),240),left(nullif(trim(p_payload->>'streetNumber'),''),40),
    left(nullif(trim(p_payload->>'addressComplement'),''),160),left(nullif(trim(p_payload->>'district'),''),160),
    v_city,v_state,coalesce(nullif(upper(p_payload->>'country'),''),'BR'),left(nullif(p_payload->>'notes',''),4000),
    left(nullif(trim(p_payload->>'responsibleProfessionalId'),''),120),p_actor_id::text,p_actor_id::text,
    v_deduplication_status,case when v_name_duplicate then 'NAME:'||v_normalized||':'||coalesce(v_city,'')||':'||coalesce(v_state,'') else null end,
    case when v_name_duplicate then now() else null end,case when v_name_duplicate then p_actor_id::text else null end
  ) returning * into v_school;

  insert into public.school_clinic_links(organization_id,school_id,clinic_id,linked_by)
  values(p_organization_id::text,v_school.id,p_clinic_id,p_actor_id)
  on conflict (school_id,clinic_id) do update set is_active=true,archived_at=null,updated_at=now();

  perform public.school_audit_append(p_organization_id::text,p_clinic_id,p_actor_id,'SCHOOL',v_school.id::text,'SCHOOL_CREATED','{}'::jsonb,to_jsonb(v_school),null,p_idempotency_key||':audit');
  v_response := jsonb_build_object('success',true,'data',to_jsonb(v_school));
  perform public.school_idempotency_store(p_organization_id::text,'CREATE_SCHOOL',p_idempotency_key,p_payload_hash,'SCHOOL',v_school.id::text,v_response);
  return v_response;
end;
$$;

create or replace function public.school_update_school_v2(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_organization_id uuid,
  p_school_id uuid,
  p_payload jsonb,
  p_idempotency_key text,
  p_payload_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing jsonb;
  v_before public.schools%rowtype;
  v_after public.schools%rowtype;
  v_display_name text;
  v_normalized text;
  v_city text;
  v_state text;
  v_tax_id text;
  v_inep_code text;
  v_name_duplicate boolean := false;
  v_is_archiving boolean := coalesce((p_payload->>'archive')::boolean, false);
  v_is_reactivating boolean := coalesce((p_payload->>'reactivate')::boolean, false);
  v_response jsonb;
begin
  if not public.school_actor_has_role(p_actor_id,p_clinic_id,p_organization_id,array['owner','admin','coordinator','receptionist']) then raise exception 'ACCESS_DENIED'; end if;
  v_existing := public.school_idempotency_existing(p_organization_id::text,'UPDATE_SCHOOL',p_idempotency_key,p_payload_hash);
  if v_existing is not null then return v_existing; end if;
  select * into v_before from public.schools where id=p_school_id and organization_id=p_organization_id::text for update;
  if not found then raise exception 'SCHOOL_NOT_FOUND'; end if;
  if v_is_archiving and exists(select 1 from public.patient_school_enrollments e where e.organization_id=p_organization_id::text and e.school_id=p_school_id and e.is_current) and coalesce((p_payload->>'confirmHistoricalArchive')::boolean,false) is not true then raise exception 'SCHOOL_ARCHIVE_HAS_ACTIVE_ENROLLMENTS'; end if;

  v_display_name := case when p_payload ? 'displayName' then left(nullif(trim(p_payload->>'displayName'),''),200) else v_before.display_name end;
  if v_display_name is null then raise exception 'INVALID_SCHOOL_NAME'; end if;
  v_normalized:=public.normalize_school_identity(v_display_name);
  v_city:=case when p_payload ? 'city' then left(nullif(trim(p_payload->>'city'),''),160) else v_before.city end;
  v_state:=case when p_payload ? 'state' then upper(left(nullif(trim(p_payload->>'state'),''),2)) else v_before.state end;
  v_tax_id:=case when p_payload ? 'taxId' then public.normalize_school_digits(p_payload->>'taxId') else v_before.tax_id end;
  v_inep_code:=case when p_payload ? 'inepCode' then public.normalize_school_digits(p_payload->>'inepCode') else v_before.inep_code end;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':SCHOOL:'||coalesce(v_tax_id,v_inep_code,v_normalized||':'||coalesce(v_city,'')||':'||coalesce(v_state,'')),0));
  if v_tax_id is not null and exists(select 1 from public.schools s where s.organization_id=p_organization_id::text and s.id<>p_school_id and s.tax_id=v_tax_id and s.archived_at is null) then raise exception 'SCHOOL_TAX_ID_DUPLICATE'; end if;
  if v_inep_code is not null and exists(select 1 from public.schools s where s.organization_id=p_organization_id::text and s.id<>p_school_id and s.inep_code=v_inep_code and s.archived_at is null) then raise exception 'SCHOOL_INEP_DUPLICATE'; end if;
  select exists(select 1 from public.schools s where s.organization_id=p_organization_id::text and s.id<>p_school_id and s.normalized_name=v_normalized and coalesce(s.city,'')=coalesce(v_city,'') and coalesce(s.state,'')=coalesce(v_state,'') and s.archived_at is null) into v_name_duplicate;
  if v_name_duplicate and coalesce((p_payload->>'confirmPossibleDuplicate')::boolean,false) is not true then raise exception 'POSSIBLE_SCHOOL_DUPLICATE'; end if;

  update public.schools set
    display_name=v_display_name,normalized_name=v_normalized,
    legal_name=case when p_payload ? 'legalName' then left(nullif(trim(p_payload->>'legalName'),''),240) else legal_name end,
    trade_name=case when p_payload ? 'tradeName' then left(nullif(trim(p_payload->>'tradeName'),''),200) else trade_name end,
    school_type=case when p_payload ? 'schoolType' then upper(p_payload->>'schoolType') else school_type end,
    education_network=case when p_payload ? 'educationNetwork' then upper(p_payload->>'educationNetwork') else education_network end,
    tax_id=v_tax_id,inep_code=v_inep_code,
    email=case when p_payload ? 'email' then left(nullif(trim(p_payload->>'email'),''),320) else email end,
    phone=case when p_payload ? 'phone' then left(nullif(trim(p_payload->>'phone'),''),40) else phone end,
    whatsapp=case when p_payload ? 'whatsapp' then left(nullif(trim(p_payload->>'whatsapp'),''),40) else whatsapp end,
    website=case when p_payload ? 'website' then left(nullif(trim(p_payload->>'website'),''),500) else website end,
    postal_code=case when p_payload ? 'postalCode' then left(nullif(trim(p_payload->>'postalCode'),''),20) else postal_code end,
    street=case when p_payload ? 'street' then left(nullif(trim(p_payload->>'street'),''),240) else street end,
    street_number=case when p_payload ? 'streetNumber' then left(nullif(trim(p_payload->>'streetNumber'),''),40) else street_number end,
    address_complement=case when p_payload ? 'addressComplement' then left(nullif(trim(p_payload->>'addressComplement'),''),160) else address_complement end,
    district=case when p_payload ? 'district' then left(nullif(trim(p_payload->>'district'),''),160) else district end,
    city=v_city,state=v_state,
    country=case when p_payload ? 'country' then coalesce(nullif(upper(p_payload->>'country'),''),'BR') else country end,
    notes=case when p_payload ? 'notes' then left(nullif(p_payload->>'notes',''),4000) else notes end,
    responsible_professional_id=case when p_payload ? 'responsibleProfessionalId' then left(nullif(trim(p_payload->>'responsibleProfessionalId'),''),120) else responsible_professional_id end,
    is_active=case when v_is_archiving then false when v_is_reactivating then true else is_active end,
    archived_at=case when v_is_archiving then coalesce(archived_at,now()) when v_is_reactivating then null else archived_at end,
    deduplication_status=case when v_name_duplicate then 'CONFIRMED_DISTINCT' when deduplication_status='REVIEW_REQUIRED' and coalesce((p_payload->>'reviewDuplicate')::boolean,false) then 'CANONICAL' else deduplication_status end,
    duplicate_group_key=case when v_name_duplicate then 'NAME:'||v_normalized||':'||coalesce(v_city,'')||':'||coalesce(v_state,'') when coalesce((p_payload->>'reviewDuplicate')::boolean,false) then null else duplicate_group_key end,
    duplicate_reviewed_at=case when v_name_duplicate or coalesce((p_payload->>'reviewDuplicate')::boolean,false) then now() else duplicate_reviewed_at end,
    duplicate_reviewed_by=case when v_name_duplicate or coalesce((p_payload->>'reviewDuplicate')::boolean,false) then p_actor_id::text else duplicate_reviewed_by end,
    updated_by=p_actor_id::text,updated_at=now()
  where id=p_school_id returning * into v_after;

  perform public.school_audit_append(p_organization_id::text,p_clinic_id,p_actor_id,'SCHOOL',p_school_id::text,case when v_is_archiving then 'SCHOOL_ARCHIVED' when v_is_reactivating then 'SCHOOL_REACTIVATED' else 'SCHOOL_UPDATED' end,to_jsonb(v_before),to_jsonb(v_after),p_payload->>'reason',p_idempotency_key||':audit');
  v_response:=jsonb_build_object('success',true,'data',to_jsonb(v_after));
  perform public.school_idempotency_store(p_organization_id::text,'UPDATE_SCHOOL',p_idempotency_key,p_payload_hash,'SCHOOL',p_school_id::text,v_response);
  return v_response;
end;
$$;

create or replace function public.school_upsert_unit_v2(
  p_actor_id uuid,p_clinic_id uuid,p_organization_id uuid,p_school_id uuid,p_unit_id uuid,
  p_payload jsonb,p_idempotency_key text,p_payload_hash text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_existing jsonb; v_before public.school_units%rowtype; v_row public.school_units%rowtype;
  v_name text; v_active boolean; v_response jsonb;
begin
  if not public.school_actor_has_role(p_actor_id,p_clinic_id,p_organization_id,array['owner','admin','coordinator','receptionist']) then raise exception 'ACCESS_DENIED'; end if;
  if not exists(select 1 from public.schools s where s.id=p_school_id and s.organization_id=p_organization_id::text) then raise exception 'SCHOOL_NOT_FOUND'; end if;
  v_existing:=public.school_idempotency_existing(p_organization_id::text,case when p_unit_id is null then 'CREATE_SCHOOL_UNIT' else 'UPDATE_SCHOOL_UNIT' end,p_idempotency_key,p_payload_hash);
  if v_existing is not null then return v_existing; end if;

  if p_unit_id is not null then
    select * into v_before from public.school_units u where u.id=p_unit_id and u.school_id=p_school_id and u.organization_id=p_organization_id::text for update;
    if not found then raise exception 'SCHOOL_UNIT_NOT_FOUND'; end if;
  end if;
  v_name:=left(trim(coalesce(p_payload->>'name',v_before.name,'')),180);
  if v_name='' then raise exception 'INVALID_UNIT_NAME'; end if;
  v_active:=case when p_payload ? 'isActive' then coalesce((p_payload->>'isActive')::boolean,true) else coalesce(v_before.is_active,true) end;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':UNIT:'||p_school_id::text||':'||public.normalize_school_identity(v_name),0));
  if exists(select 1 from public.school_units u where u.organization_id=p_organization_id::text and u.school_id=p_school_id and u.id is distinct from p_unit_id and u.normalized_name=public.normalize_school_identity(v_name) and u.archived_at is null) then raise exception 'SCHOOL_UNIT_DUPLICATE'; end if;
  if p_unit_id is not null and not v_active and exists(select 1 from public.patient_school_enrollments e where e.organization_id=p_organization_id::text and e.school_unit_id=p_unit_id and e.is_current) and coalesce((p_payload->>'confirmActiveEnrollments')::boolean,false) is not true then raise exception 'SCHOOL_UNIT_HAS_ACTIVE_ENROLLMENTS'; end if;

  if p_unit_id is null then
    insert into public.school_units(organization_id,school_id,name,normalized_name,code,email,phone,whatsapp,postal_code,street,street_number,address_complement,district,city,state,country,is_active,created_by,updated_by,archived_at)
    values(p_organization_id::text,p_school_id,v_name,public.normalize_school_identity(v_name),left(nullif(trim(p_payload->>'code'),''),80),left(nullif(trim(p_payload->>'email'),''),320),left(nullif(trim(p_payload->>'phone'),''),40),left(nullif(trim(p_payload->>'whatsapp'),''),40),left(nullif(trim(p_payload->>'postalCode'),''),20),left(nullif(trim(p_payload->>'street'),''),240),left(nullif(trim(p_payload->>'streetNumber'),''),40),left(nullif(trim(p_payload->>'addressComplement'),''),160),left(nullif(trim(p_payload->>'district'),''),160),left(nullif(trim(p_payload->>'city'),''),160),upper(left(nullif(trim(p_payload->>'state'),''),2)),coalesce(nullif(upper(p_payload->>'country'),''),'BR'),v_active,p_actor_id::text,p_actor_id::text,case when v_active then null else now() end)
    returning * into v_row;
  else
    update public.school_units set
      name=v_name,normalized_name=public.normalize_school_identity(v_name),
      code=case when p_payload ? 'code' then left(nullif(trim(p_payload->>'code'),''),80) else code end,
      email=case when p_payload ? 'email' then left(nullif(trim(p_payload->>'email'),''),320) else email end,
      phone=case when p_payload ? 'phone' then left(nullif(trim(p_payload->>'phone'),''),40) else phone end,
      whatsapp=case when p_payload ? 'whatsapp' then left(nullif(trim(p_payload->>'whatsapp'),''),40) else whatsapp end,
      postal_code=case when p_payload ? 'postalCode' then left(nullif(trim(p_payload->>'postalCode'),''),20) else postal_code end,
      street=case when p_payload ? 'street' then left(nullif(trim(p_payload->>'street'),''),240) else street end,
      street_number=case when p_payload ? 'streetNumber' then left(nullif(trim(p_payload->>'streetNumber'),''),40) else street_number end,
      address_complement=case when p_payload ? 'addressComplement' then left(nullif(trim(p_payload->>'addressComplement'),''),160) else address_complement end,
      district=case when p_payload ? 'district' then left(nullif(trim(p_payload->>'district'),''),160) else district end,
      city=case when p_payload ? 'city' then left(nullif(trim(p_payload->>'city'),''),160) else city end,
      state=case when p_payload ? 'state' then upper(left(nullif(trim(p_payload->>'state'),''),2)) else state end,
      country=case when p_payload ? 'country' then coalesce(nullif(upper(p_payload->>'country'),''),'BR') else country end,
      is_active=v_active,archived_at=case when v_active then null else coalesce(archived_at,now()) end,
      updated_by=p_actor_id::text,updated_at=now()
    where id=p_unit_id returning * into v_row;
  end if;
  perform public.school_audit_append(p_organization_id::text,p_clinic_id,p_actor_id,'SCHOOL_UNIT',v_row.id::text,case when p_unit_id is null then 'UNIT_CREATED' when v_row.is_active and not coalesce(v_before.is_active,false) then 'UNIT_REACTIVATED' when not v_row.is_active then 'UNIT_ARCHIVED' else 'UNIT_UPDATED' end,coalesce(to_jsonb(v_before),'{}'::jsonb),to_jsonb(v_row),p_payload->>'reason',p_idempotency_key||':audit');
  v_response:=jsonb_build_object('success',true,'data',to_jsonb(v_row));
  perform public.school_idempotency_store(p_organization_id::text,case when p_unit_id is null then 'CREATE_SCHOOL_UNIT' else 'UPDATE_SCHOOL_UNIT' end,p_idempotency_key,p_payload_hash,'SCHOOL_UNIT',v_row.id::text,v_response);
  return v_response;
end; $$;

create or replace function public.school_upsert_contact_v2(
  p_actor_id uuid,p_clinic_id uuid,p_organization_id uuid,p_school_id uuid,p_contact_id uuid,
  p_payload jsonb,p_idempotency_key text,p_payload_hash text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_existing jsonb; v_before public.school_contacts%rowtype; v_row public.school_contacts%rowtype;
  v_name text; v_unit uuid; v_role text; v_active boolean; v_primary boolean; v_email text; v_response jsonb;
begin
  if not public.school_actor_has_role(p_actor_id,p_clinic_id,p_organization_id,array['owner','admin','coordinator','receptionist']) then raise exception 'ACCESS_DENIED'; end if;
  if not exists(select 1 from public.schools s where s.id=p_school_id and s.organization_id=p_organization_id::text) then raise exception 'SCHOOL_NOT_FOUND'; end if;
  v_existing:=public.school_idempotency_existing(p_organization_id::text,case when p_contact_id is null then 'CREATE_SCHOOL_CONTACT' else 'UPDATE_SCHOOL_CONTACT' end,p_idempotency_key,p_payload_hash); if v_existing is not null then return v_existing; end if;
  if p_contact_id is not null then select * into v_before from public.school_contacts c where c.id=p_contact_id and c.school_id=p_school_id and c.organization_id=p_organization_id::text for update; if not found then raise exception 'SCHOOL_CONTACT_NOT_FOUND'; end if; end if;
  v_name:=left(trim(coalesce(p_payload->>'name',v_before.name,'')),180); if v_name='' then raise exception 'INVALID_CONTACT_NAME'; end if;
  v_unit:=case when p_payload ? 'schoolUnitId' then nullif(p_payload->>'schoolUnitId','')::uuid else v_before.school_unit_id end;
  v_role:=case when p_payload ? 'role' then coalesce(nullif(upper(p_payload->>'role'),''),'OTHER') else coalesce(v_before.role,'OTHER') end;
  v_role:=case v_role
    when 'DIRECTION' then 'DIRECTOR'
    when 'PEDAGOGICAL_COORDINATION' then 'PEDAGOGICAL_COORDINATOR'
    when 'SECRETARIAT' then 'SECRETARY'
    else v_role
  end;
  if v_role not in ('DIRECTOR','PEDAGOGICAL_COORDINATOR','TEACHER','SCHOOL_MEDIATOR','PSYCHOPEDAGOGUE','COUNSELOR','SECRETARY','SUPPORT_PROFESSIONAL','OTHER') then raise exception 'INVALID_SCHOOL_CONTACT_ROLE'; end if;
  v_email:=case when p_payload ? 'email' then left(nullif(trim(p_payload->>'email'),''),320) else v_before.email end;
  v_active:=case when p_payload ? 'isActive' then coalesce((p_payload->>'isActive')::boolean,true) else coalesce(v_before.is_active,true) end;
  v_primary:=case when p_payload ? 'isPrimary' then coalesce((p_payload->>'isPrimary')::boolean,false) else coalesce(v_before.is_primary,false) end;
  if v_unit is not null and not exists(select 1 from public.school_units u where u.id=v_unit and u.school_id=p_school_id and u.organization_id=p_organization_id::text) then raise exception 'SCHOOL_UNIT_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':CONTACT:'||p_school_id::text||':'||public.normalize_school_identity(v_name)||':'||coalesce(lower(v_email),''),0));
  if exists(select 1 from public.school_contacts c where c.organization_id=p_organization_id::text and c.school_id=p_school_id and c.id is distinct from p_contact_id and c.is_active and c.archived_at is null and public.normalize_school_identity(c.name)=public.normalize_school_identity(v_name) and coalesce(lower(c.email),'')=coalesce(lower(v_email),'') and coalesce(c.school_unit_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(v_unit,'00000000-0000-0000-0000-000000000000'::uuid)) then raise exception 'SCHOOL_CONTACT_DUPLICATE'; end if;
  if v_primary then update public.school_contacts set is_primary=false,updated_by=p_actor_id::text,updated_at=now() where organization_id=p_organization_id::text and school_id=p_school_id and id is distinct from p_contact_id and coalesce(school_unit_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(v_unit,'00000000-0000-0000-0000-000000000000'::uuid) and role=v_role and is_active; end if;
  if p_contact_id is null then
    insert into public.school_contacts(organization_id,school_id,school_unit_id,name,role,department,email,phone,whatsapp,preferred_contact_method,notes,is_primary,is_active,created_by,updated_by,archived_at)
    values(p_organization_id::text,p_school_id,v_unit,v_name,v_role,left(nullif(trim(p_payload->>'department'),''),160),v_email,left(nullif(trim(p_payload->>'phone'),''),40),left(nullif(trim(p_payload->>'whatsapp'),''),40),nullif(upper(p_payload->>'preferredContactMethod'),''),left(nullif(p_payload->>'notes',''),3000),v_primary,v_active,p_actor_id::text,p_actor_id::text,case when v_active then null else now() end) returning * into v_row;
  else
    update public.school_contacts set school_unit_id=v_unit,name=v_name,role=v_role,
      department=case when p_payload ? 'department' then left(nullif(trim(p_payload->>'department'),''),160) else department end,
      email=v_email,phone=case when p_payload ? 'phone' then left(nullif(trim(p_payload->>'phone'),''),40) else phone end,
      whatsapp=case when p_payload ? 'whatsapp' then left(nullif(trim(p_payload->>'whatsapp'),''),40) else whatsapp end,
      preferred_contact_method=case when p_payload ? 'preferredContactMethod' then nullif(upper(p_payload->>'preferredContactMethod'),'') else preferred_contact_method end,
      notes=case when p_payload ? 'notes' then left(nullif(p_payload->>'notes',''),3000) else notes end,
      is_primary=v_primary,is_active=v_active,archived_at=case when v_active then null else coalesce(archived_at,now()) end,
      archived_by=case when v_active then null else p_actor_id::text end,archive_reason=case when v_active then null else left(p_payload->>'reason',1000) end,
      updated_by=p_actor_id::text,updated_at=now()
    where id=p_contact_id returning * into v_row;
  end if;
  perform public.school_audit_append(p_organization_id::text,p_clinic_id,p_actor_id,'SCHOOL_CONTACT',v_row.id::text,case when p_contact_id is null then 'CONTACT_CREATED' when v_row.is_active and not coalesce(v_before.is_active,false) then 'CONTACT_REACTIVATED' when not v_row.is_active then 'CONTACT_DEACTIVATED' else 'CONTACT_UPDATED' end,coalesce(to_jsonb(v_before),'{}'::jsonb),to_jsonb(v_row),p_payload->>'reason',p_idempotency_key||':audit');
  v_response:=jsonb_build_object('success',true,'data',to_jsonb(v_row));
  perform public.school_idempotency_store(p_organization_id::text,case when p_contact_id is null then 'CREATE_SCHOOL_CONTACT' else 'UPDATE_SCHOOL_CONTACT' end,p_idempotency_key,p_payload_hash,'SCHOOL_CONTACT',v_row.id::text,v_response);
  return v_response;
end; $$;

create or replace function public.school_change_enrollment_v2(
  p_actor_id uuid,p_clinic_id uuid,p_organization_id uuid,p_patient_id uuid,
  p_payload jsonb,p_idempotency_key text,p_payload_hash text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_existing jsonb; v_school uuid; v_unit uuid; v_type text; v_teacher uuid; v_coordinator uuid;
  v_row public.patient_school_enrollments%rowtype; v_closed uuid[]; v_response jsonb; v_close boolean;
begin
  if not public.school_actor_has_role(p_actor_id,p_clinic_id,p_organization_id,array['owner','admin','coordinator','receptionist']) then raise exception 'ACCESS_DENIED'; end if;
  if not public.school_actor_can_access_patient(p_actor_id,p_clinic_id,p_patient_id) then raise exception 'PATIENT_NOT_FOUND'; end if;
  v_existing:=public.school_idempotency_existing(p_organization_id::text,'CHANGE_SCHOOL_ENROLLMENT',p_idempotency_key,p_payload_hash); if v_existing is not null then return v_existing; end if;
  v_school:=nullif(p_payload->>'schoolId','')::uuid; v_unit:=nullif(p_payload->>'schoolUnitId','')::uuid;
  v_type:=coalesce(nullif(upper(p_payload->>'enrollmentType'),''),'PRIMARY_SCHOOL'); v_close:=coalesce((p_payload->>'closeCurrent')::boolean,v_type='PRIMARY_SCHOOL');
  v_teacher:=nullif(p_payload->>'teacherContactId','')::uuid; v_coordinator:=nullif(p_payload->>'coordinatorContactId','')::uuid;
  if not exists(select 1 from public.schools s where s.id=v_school and s.organization_id=p_organization_id::text and s.is_active and s.archived_at is null) then raise exception 'SCHOOL_NOT_FOUND_OR_ARCHIVED'; end if;
  if v_unit is not null and not exists(select 1 from public.school_units u where u.id=v_unit and u.school_id=v_school and u.organization_id=p_organization_id::text and u.is_active and u.archived_at is null) then raise exception 'SCHOOL_UNIT_NOT_FOUND'; end if;
  if v_teacher is not null and not exists(select 1 from public.school_contacts c where c.id=v_teacher and c.school_id=v_school and c.organization_id=p_organization_id::text and c.is_active and c.archived_at is null) then raise exception 'TEACHER_CONTACT_INVALID'; end if;
  if v_coordinator is not null and not exists(select 1 from public.school_contacts c where c.id=v_coordinator and c.school_id=v_school and c.organization_id=p_organization_id::text and c.is_active and c.archived_at is null) then raise exception 'COORDINATOR_CONTACT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':ENROLLMENT:'||p_patient_id::text,0));
  perform 1 from public.patient_school_enrollments where organization_id=p_organization_id::text and patient_id=p_patient_id and is_current for update;
  if v_type='PRIMARY_SCHOOL' and not v_close and exists(select 1 from public.patient_school_enrollments where organization_id=p_organization_id::text and patient_id=p_patient_id and is_current and enrollment_type='PRIMARY_SCHOOL') then raise exception 'PRIMARY_ENROLLMENT_EXISTS'; end if;
  if v_close then
    with closed as (
      update public.patient_school_enrollments set is_current=false,ended_at=coalesce(ended_at,now()),ended_by=p_actor_id::text,exit_reason=coalesce(nullif(p_payload->>'exitReason',''),'Substituído por novo vínculo'),updated_at=now()
      where organization_id=p_organization_id::text and patient_id=p_patient_id and is_current and (v_type='PRIMARY_SCHOOL' and enrollment_type='PRIMARY_SCHOOL' or coalesce((p_payload->>'closeSameType')::boolean,false) and enrollment_type=v_type)
      returning id
    ) select coalesce(array_agg(id),'{}'::uuid[]) into v_closed from closed;
  else v_closed:='{}'::uuid[]; end if;
  insert into public.patient_school_enrollments(organization_id,clinic_id,patient_id,school_id,school_unit_id,academic_year,grade_level,class_name,shift,enrollment_code,teacher_contact_id,coordinator_contact_id,is_current,started_at,notes,created_by,enrollment_type,idempotency_key,payload_hash)
  values(p_organization_id::text,p_clinic_id::text,p_patient_id,v_school,v_unit,nullif(p_payload->>'academicYear','')::integer,left(nullif(trim(p_payload->>'gradeLevel'),''),120),left(nullif(trim(p_payload->>'className'),''),120),left(nullif(trim(p_payload->>'shift'),''),40),left(nullif(trim(p_payload->>'enrollmentCode'),''),120),v_teacher,v_coordinator,true,coalesce(nullif(p_payload->>'startedAt','')::timestamptz,now()),left(nullif(p_payload->>'notes',''),4000),p_actor_id::text,v_type,p_idempotency_key,p_payload_hash) returning * into v_row;
  insert into public.school_clinic_links(organization_id,school_id,clinic_id,linked_by) values(p_organization_id::text,v_school,p_clinic_id,p_actor_id) on conflict(school_id,clinic_id) do update set is_active=true,archived_at=null,updated_at=now();
  perform public.school_audit_append(p_organization_id::text,p_clinic_id,p_actor_id,'PATIENT_SCHOOL_ENROLLMENT',v_row.id::text,'PATIENT_LINKED_TO_SCHOOL',jsonb_build_object('closedEnrollmentIds',v_closed),to_jsonb(v_row),p_payload->>'exitReason',p_idempotency_key||':audit');
  v_response:=jsonb_build_object('success',true,'data',to_jsonb(v_row),'closedEnrollmentIds',to_jsonb(v_closed));
  perform public.school_idempotency_store(p_organization_id::text,'CHANGE_SCHOOL_ENROLLMENT',p_idempotency_key,p_payload_hash,'PATIENT_SCHOOL_ENROLLMENT',v_row.id::text,v_response);
  return v_response;
end; $$;

create or replace function public.school_end_enrollment_v2(
  p_actor_id uuid,p_clinic_id uuid,p_organization_id uuid,p_patient_id uuid,p_enrollment_id uuid,
  p_reason text,p_idempotency_key text,p_payload_hash text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare v_existing jsonb; v_before public.patient_school_enrollments%rowtype; v_after public.patient_school_enrollments%rowtype; v_response jsonb;
begin
  if not public.school_actor_has_role(p_actor_id,p_clinic_id,p_organization_id,array['owner','admin','coordinator','receptionist']) then raise exception 'ACCESS_DENIED'; end if;
  if not public.school_actor_can_access_patient(p_actor_id,p_clinic_id,p_patient_id) then raise exception 'PATIENT_ACCESS_DENIED'; end if;
  v_existing:=public.school_idempotency_existing(p_organization_id::text,'END_SCHOOL_ENROLLMENT',p_idempotency_key,p_payload_hash); if v_existing is not null then return v_existing; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':ENROLLMENT:'||p_patient_id::text,0));
  select * into v_before from public.patient_school_enrollments where id=p_enrollment_id and patient_id=p_patient_id and organization_id=p_organization_id::text and clinic_id=p_clinic_id::text for update;
  if not found then raise exception 'SCHOOL_ENROLLMENT_NOT_FOUND'; end if;
  update public.patient_school_enrollments set is_current=false,ended_at=coalesce(ended_at,now()),ended_by=p_actor_id::text,exit_reason=coalesce(nullif(p_reason,''),exit_reason,'Vínculo encerrado'),updated_at=now() where id=p_enrollment_id returning * into v_after;
  perform public.school_audit_append(p_organization_id::text,p_clinic_id,p_actor_id,'PATIENT_SCHOOL_ENROLLMENT',p_enrollment_id::text,'SCHOOL_ENROLLMENT_ENDED',to_jsonb(v_before),to_jsonb(v_after),p_reason,p_idempotency_key||':audit');
  v_response:=jsonb_build_object('success',true,'data',to_jsonb(v_after));
  perform public.school_idempotency_store(p_organization_id::text,'END_SCHOOL_ENROLLMENT',p_idempotency_key,p_payload_hash,'PATIENT_SCHOOL_ENROLLMENT',p_enrollment_id::text,v_response);
  return v_response;
end; $$;

create or replace function public.school_record_consent_v2(
  p_actor_id uuid,p_clinic_id uuid,p_organization_id uuid,p_patient_id uuid,
  p_payload jsonb,p_idempotency_key text,p_payload_hash text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_existing jsonb;
  v_enrollment uuid;
  v_type text;
  v_status text;
  v_effective_at timestamptz;
  v_granted_at timestamptz;
  v_expires_at timestamptz;
  v_revoked_at timestamptz;
  v_previous public.school_consents%rowtype;
  v_row public.school_consents%rowtype;
  v_response jsonb;
begin
  if not public.school_actor_has_role(p_actor_id,p_clinic_id,p_organization_id,array['owner','admin','coordinator','receptionist','therapist']) then raise exception 'ACCESS_DENIED'; end if;
  if not public.school_actor_can_access_patient(p_actor_id,p_clinic_id,p_patient_id) then raise exception 'PATIENT_NOT_FOUND'; end if;

  v_existing:=public.school_idempotency_existing(p_organization_id::text,'RECORD_SCHOOL_CONSENT',p_idempotency_key,p_payload_hash);
  if v_existing is not null then return v_existing; end if;

  v_enrollment:=nullif(p_payload->>'schoolEnrollmentId','')::uuid;
  v_type:=upper(coalesce(p_payload->>'consentType',''));
  v_status:=upper(coalesce(p_payload->>'status','PENDING'));
  v_effective_at:=coalesce(nullif(p_payload->>'effectiveAt','')::timestamptz,now());
  v_granted_at:=case when v_status='AUTHORIZED' then coalesce(nullif(p_payload->>'grantedAt','')::timestamptz,v_effective_at) else nullif(p_payload->>'grantedAt','')::timestamptz end;
  v_expires_at:=nullif(p_payload->>'expiresAt','')::timestamptz;
  v_revoked_at:=case when v_status='REVOKED' then coalesce(nullif(p_payload->>'revokedAt','')::timestamptz,v_effective_at) else null end;

  if v_type not in ('SCHOOL_CONTACT','CLINICAL_INFORMATION_SHARING','SCHOOL_MEETING_PARTICIPATION','REPORT_SENDING','SCHOOL_DOCUMENT_RECEIVING','IMAGE_RECORDING') then raise exception 'INVALID_CONSENT_TYPE'; end if;
  if v_status not in ('AUTHORIZED','PENDING','EXPIRED','REVOKED','NOT_REQUIRED') then raise exception 'INVALID_CONSENT_STATUS'; end if;
  if v_expires_at is not null and v_granted_at is not null and v_expires_at <= v_granted_at then raise exception 'INVALID_CONSENT_EXPIRATION'; end if;
  if v_status='REVOKED' and nullif(trim(p_payload->>'revocationReason'),'') is null then raise exception 'REVOCATION_REASON_REQUIRED'; end if;
  if v_enrollment is not null and not exists(
    select 1 from public.patient_school_enrollments e
    where e.id=v_enrollment and e.patient_id=p_patient_id
      and e.organization_id=p_organization_id::text and e.clinic_id=p_clinic_id::text
  ) then raise exception 'SCHOOL_ENROLLMENT_NOT_FOUND'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':school-consent:'||p_patient_id::text||':'||v_type||':'||coalesce(v_enrollment::text,''),0));
  select * into v_previous
  from public.school_consents c
  where c.organization_id=p_organization_id::text and c.patient_id=p_patient_id
    and c.consent_type=v_type and c.is_current
    and coalesce(c.school_enrollment_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(v_enrollment,'00000000-0000-0000-0000-000000000000'::uuid)
  for update;

  if found then
    update public.school_consents set is_current=false,updated_by=p_actor_id::text,updated_at=now() where id=v_previous.id;
  end if;

  insert into public.school_consents(
    organization_id,clinic_id,patient_id,school_enrollment_id,consent_type,status,
    granted_by_responsible_id,granted_at,expires_at,revoked_at,revocation_reason,
    document_id,notes,created_by,updated_by,consent_version,is_current,
    supersedes_consent_id,effective_at,idempotency_key,payload_hash
  ) values(
    p_organization_id::text,p_clinic_id::text,p_patient_id,v_enrollment,v_type,v_status,
    left(nullif(trim(p_payload->>'grantedByResponsibleId'),''),120),v_granted_at,v_expires_at,v_revoked_at,
    left(nullif(p_payload->>'revocationReason',''),1000),left(nullif(p_payload->>'documentId',''),180),
    left(nullif(p_payload->>'notes',''),3000),p_actor_id::text,p_actor_id::text,
    coalesce(v_previous.consent_version,0)+1,true,v_previous.id,v_effective_at,p_idempotency_key,p_payload_hash
  ) returning * into v_row;

  perform public.school_audit_append(
    p_organization_id::text,p_clinic_id,p_actor_id,'SCHOOL_CONSENT',v_row.id::text,
    case when v_row.status='REVOKED' then 'CONSENT_REVOKED'
         when v_row.status='AUTHORIZED' and v_previous.id is null then 'CONSENT_GRANTED'
         when v_row.status='AUTHORIZED' then 'CONSENT_RENEWED'
         else 'CONSENT_STATUS_CHANGED' end,
    coalesce(to_jsonb(v_previous),'{}'::jsonb),to_jsonb(v_row),v_row.revocation_reason,p_idempotency_key||':audit'
  );
  v_response:=jsonb_build_object('success',true,'data',to_jsonb(v_row));
  perform public.school_idempotency_store(p_organization_id::text,'RECORD_SCHOOL_CONSENT',p_idempotency_key,p_payload_hash,'SCHOOL_CONSENT',v_row.id::text,v_response);
  return v_response;
end; $$;

create or replace function public.create_school_meeting_batch_v2(
  p_actor_id uuid,p_clinic_id uuid,p_organization_id uuid,p_payload jsonb,
  p_patient_ids uuid[],p_internal_professional_ids text[],p_idempotency_key text,p_payload_hash text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_existing jsonb; v_school uuid; v_unit uuid; v_status text; v_meeting public.school_meetings%rowtype;
  v_count int; v_invalid jsonb; v_start timestamptz; v_end timestamptz; v_response jsonb;
  v_professional text; v_professionals text[];
begin
  if not public.school_actor_has_role(p_actor_id,p_clinic_id,p_organization_id,array['owner','admin','coordinator','receptionist','therapist']) then raise exception 'ACCESS_DENIED'; end if;
  v_existing:=public.school_idempotency_existing(p_organization_id::text,'CREATE_SCHOOL_MEETING_BATCH_V2',p_idempotency_key,p_payload_hash); if v_existing is not null then return v_existing; end if;
  if coalesce(cardinality(p_patient_ids),0)=0 then raise exception 'PATIENTS_REQUIRED'; end if;
  if nullif(trim(p_payload->>'title'),'') is null then raise exception 'MEETING_TITLE_REQUIRED'; end if;
  v_school:=nullif(p_payload->>'schoolId','')::uuid; v_unit:=nullif(p_payload->>'schoolUnitId','')::uuid;
  v_status:=coalesce(nullif(upper(p_payload->>'status'),''),'DRAFT'); v_start:=nullif(p_payload->>'scheduledStart','')::timestamptz; v_end:=nullif(p_payload->>'scheduledEnd','')::timestamptz;
  if v_status not in ('DRAFT','SCHEDULED','CONFIRMED') then raise exception 'INVALID_MEETING_STATUS'; end if;
  if not exists(select 1 from public.schools s where s.id=v_school and s.organization_id=p_organization_id::text and s.archived_at is null and s.is_active) then raise exception 'SCHOOL_NOT_FOUND'; end if;
  if v_unit is not null and not exists(select 1 from public.school_units u where u.id=v_unit and u.school_id=v_school and u.organization_id=p_organization_id::text and u.archived_at is null and u.is_active) then raise exception 'SCHOOL_UNIT_NOT_FOUND'; end if;

  select array_agg(distinct p) into v_professionals from unnest(array_remove(array_append(coalesce(p_internal_professional_ids,'{}'::text[]),nullif(p_payload->>'responsibleProfessionalId','')),null)) p where nullif(p,'') is not null;
  foreach v_professional in array coalesce(v_professionals,'{}'::text[]) loop
    if not public.school_actor_has_role(v_professional::uuid,p_clinic_id,p_organization_id,array['owner','admin','coordinator','receptionist','therapist']) then raise exception 'PROFESSIONAL_SCOPE_MISMATCH'; end if;
  end loop;

  select count(distinct selected.patient_id) into v_count
  from unnest(p_patient_ids) selected(patient_id)
  join public.patient_school_enrollments e on e.patient_id=selected.patient_id and e.organization_id=p_organization_id::text and e.clinic_id=p_clinic_id::text and e.school_id=v_school and e.is_current and (v_unit is null or e.school_unit_id=v_unit)
  where public.school_actor_can_access_patient(p_actor_id,p_clinic_id,selected.patient_id);
  if v_count<>cardinality(p_patient_ids) then raise exception 'PATIENT_SCHOOL_SCOPE_MISMATCH'; end if;

  if v_status<>'DRAFT' then
    select jsonb_agg(jsonb_build_object('patientId',x.patient_id,'status',x.consent_status)) into v_invalid
    from (
      select selected.patient_id,public.school_consent_current_status(p_organization_id::text,selected.patient_id,e.id,'SCHOOL_MEETING_PARTICIPATION',now()) consent_status
      from unnest(p_patient_ids) selected(patient_id)
      join public.patient_school_enrollments e on e.patient_id=selected.patient_id and e.organization_id=p_organization_id::text and e.clinic_id=p_clinic_id::text and e.school_id=v_school and e.is_current and (v_unit is null or e.school_unit_id=v_unit)
    ) x where x.consent_status not in ('AUTHORIZED','NOT_REQUIRED');
    if v_invalid is not null then raise exception 'SCHOOL_CONSENT_REQUIRED:%',v_invalid::text; end if;
    perform public.school_assert_professional_availability(p_organization_id::text,p_clinic_id,coalesce(v_professionals,'{}'::text[]),v_start,v_end,null);
  end if;

  insert into public.school_meetings(organization_id,clinic_id,school_id,school_unit_id,meeting_type,title,description,agenda,scheduled_start,scheduled_end,timezone,location_type,location,online_meeting_url,status,created_by,responsible_professional_id,idempotency_key,payload_hash,last_transition_at,last_transition_by)
  values(p_organization_id::text,p_clinic_id::text,v_school,v_unit,coalesce(nullif(upper(p_payload->>'meetingType'),''),'SCHOOL_MEETING'),left(trim(p_payload->>'title'),200),left(nullif(p_payload->>'description',''),5000),left(nullif(p_payload->>'agenda',''),10000),v_start,v_end,coalesce(nullif(p_payload->>'timezone',''),'America/Sao_Paulo'),coalesce(nullif(upper(p_payload->>'locationType'),''),'SCHOOL'),left(nullif(p_payload->>'location',''),300),left(nullif(p_payload->>'onlineMeetingUrl',''),500),v_status,p_actor_id::text,left(nullif(p_payload->>'responsibleProfessionalId',''),120),p_idempotency_key,p_payload_hash,now(),p_actor_id::text)
  returning * into v_meeting;

  insert into public.school_meeting_patients(organization_id,meeting_id,patient_id,school_enrollment_id,participation_status,consent_status_snapshot,patient_agenda,included_by,idempotency_key)
  select p_organization_id::text,v_meeting.id,selected.patient_id,e.id,'INVITED',jsonb_build_object('SCHOOL_MEETING_PARTICIPATION',public.school_consent_current_status(p_organization_id::text,selected.patient_id,e.id,'SCHOOL_MEETING_PARTICIPATION',now()),'CLINICAL_INFORMATION_SHARING',public.school_consent_current_status(p_organization_id::text,selected.patient_id,e.id,'CLINICAL_INFORMATION_SHARING',now())),left(nullif((p_payload->'patientAgendas'->>selected.patient_id::text),''),5000),p_actor_id::text,p_idempotency_key||':patient:'||selected.patient_id::text
  from unnest(p_patient_ids) selected(patient_id)
  join public.patient_school_enrollments e on e.patient_id=selected.patient_id and e.organization_id=p_organization_id::text and e.clinic_id=p_clinic_id::text and e.school_id=v_school and e.is_current and (v_unit is null or e.school_unit_id=v_unit);

  insert into public.school_meeting_participants(organization_id,meeting_id,participant_type,professional_id,attendance_status,invited_at,created_by,idempotency_key,payload_hash)
  select p_organization_id::text,v_meeting.id,'INTERNAL_USER',pid,'INVITED',now(),p_actor_id::text,p_idempotency_key||':professional:'||pid,p_payload_hash
  from unnest(coalesce(v_professionals,'{}'::text[])) pid where nullif(pid,'') is not null on conflict do nothing;

  perform public.school_audit_append(p_organization_id::text,p_clinic_id,p_actor_id,'SCHOOL_MEETING',v_meeting.id::text,'MEETING_CREATED','{}'::jsonb,jsonb_build_object('meeting',to_jsonb(v_meeting),'patientCount',cardinality(p_patient_ids),'professionalCount',cardinality(coalesce(v_professionals,'{}'::text[]))),null,p_idempotency_key||':audit');
  v_response:=jsonb_build_object('success',true,'meeting',to_jsonb(v_meeting),'patientCount',cardinality(p_patient_ids));
  perform public.school_idempotency_store(p_organization_id::text,'CREATE_SCHOOL_MEETING_BATCH_V2',p_idempotency_key,p_payload_hash,'SCHOOL_MEETING',v_meeting.id::text,v_response);
  return v_response;
end; $$;

create or replace function public.school_transition_meeting_v2(
  p_actor_id uuid,p_clinic_id uuid,p_organization_id uuid,p_meeting_id uuid,
  p_action text,p_payload jsonb,p_idempotency_key text,p_payload_hash text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_existing jsonb; v_before public.school_meetings%rowtype; v_after public.school_meetings%rowtype;
  v_action text; v_target text; v_professionals text[]; v_start timestamptz; v_end timestamptz;
  v_invalid jsonb; v_response jsonb;
begin
  if not public.school_actor_has_role(p_actor_id,p_clinic_id,p_organization_id,array['owner','admin','coordinator','receptionist','therapist']) then raise exception 'ACCESS_DENIED'; end if;
  v_existing:=public.school_idempotency_existing(p_organization_id::text,'TRANSITION_SCHOOL_MEETING',p_idempotency_key,p_payload_hash); if v_existing is not null then return v_existing; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':MEETING:'||p_meeting_id::text,0));
  select * into v_before from public.school_meetings where id=p_meeting_id and organization_id=p_organization_id::text and clinic_id=p_clinic_id::text for update;
  if not found then raise exception 'SCHOOL_MEETING_NOT_FOUND'; end if;
  v_action:=upper(coalesce(nullif(p_action,''),nullif(p_payload->>'action',''),nullif(p_payload->>'status','')));
  v_action:=case v_action when 'SCHEDULED' then 'SCHEDULE' when 'CONFIRMED' then 'CONFIRM' when 'RESCHEDULED' then 'RESCHEDULE' when 'CANCELLED' then 'CANCEL' when 'COMPLETED' then 'COMPLETE' else v_action end;
  v_target:=case v_action when 'SCHEDULE' then 'SCHEDULED' when 'CONFIRM' then 'CONFIRMED' when 'RESCHEDULE' then 'RESCHEDULED' when 'CANCEL' then 'CANCELLED' when 'COMPLETE' then 'COMPLETED' when 'NOT_HELD' then 'NOT_HELD' when 'START' then 'CONFIRMED' else null end;
  if v_target is null then raise exception 'INVALID_MEETING_TRANSITION'; end if;
  if v_action='SCHEDULE' and v_before.status not in ('DRAFT','RESCHEDULED') then raise exception 'INVALID_MEETING_TRANSITION'; end if;
  if v_action='CONFIRM' and v_before.status not in ('SCHEDULED','RESCHEDULED') then raise exception 'INVALID_MEETING_TRANSITION'; end if;
  if v_action='RESCHEDULE' and v_before.status not in ('SCHEDULED','CONFIRMED','RESCHEDULED') then raise exception 'INVALID_MEETING_TRANSITION'; end if;
  if v_action in ('CANCEL','NOT_HELD','COMPLETE') and v_before.status not in ('SCHEDULED','CONFIRMED','RESCHEDULED') then raise exception 'INVALID_MEETING_TRANSITION'; end if;
  if v_action in ('CANCEL','NOT_HELD') and nullif(trim(p_payload->>'reason'),'') is null then raise exception 'MEETING_REASON_REQUIRED'; end if;
  v_start:=coalesce(nullif(p_payload->>'scheduledStart','')::timestamptz,v_before.scheduled_start);
  v_end:=coalesce(nullif(p_payload->>'scheduledEnd','')::timestamptz,v_before.scheduled_end);

  if v_action in ('SCHEDULE','RESCHEDULE','CONFIRM') then
    select jsonb_agg(jsonb_build_object('patientId',mp.patient_id,'status',public.school_consent_current_status(p_organization_id::text,mp.patient_id,mp.school_enrollment_id,'SCHOOL_MEETING_PARTICIPATION',now()))) into v_invalid
    from public.school_meeting_patients mp where mp.meeting_id=p_meeting_id and mp.participation_status<>'REMOVED'
      and public.school_consent_current_status(p_organization_id::text,mp.patient_id,mp.school_enrollment_id,'SCHOOL_MEETING_PARTICIPATION',now()) not in ('AUTHORIZED','NOT_REQUIRED');
    if v_invalid is not null then raise exception 'SCHOOL_CONSENT_REQUIRED:%',v_invalid::text; end if;
    select array_agg(distinct x) into v_professionals from (select v_before.responsible_professional_id x union all select professional_id from public.school_meeting_participants where meeting_id=p_meeting_id and removed_at is null and professional_id is not null) q where nullif(x,'') is not null;
    perform public.school_assert_professional_availability(p_organization_id::text,p_clinic_id,coalesce(v_professionals,'{}'::text[]),v_start,v_end,p_meeting_id);
  end if;
  if v_action='COMPLETE' and exists(select 1 from public.school_meeting_patients where meeting_id=p_meeting_id and participation_status not in ('ATTENDED','ABSENT','DECLINED','REMOVED')) then raise exception 'PATIENT_ATTENDANCE_REQUIRED'; end if;
  if v_action='COMPLETE' and exists(select 1 from public.school_meeting_participants where meeting_id=p_meeting_id and removed_at is null and attendance_status not in ('ATTENDED','ABSENT','DECLINED')) then raise exception 'PARTICIPANT_ATTENDANCE_REQUIRED'; end if;

  update public.school_meetings set
    previous_scheduled_start=case when v_action='RESCHEDULE' then scheduled_start else previous_scheduled_start end,
    previous_scheduled_end=case when v_action='RESCHEDULE' then scheduled_end else previous_scheduled_end end,
    scheduled_start=v_start,scheduled_end=v_end,status=v_target,
    cancelled_at=case when v_target='CANCELLED' then now() else cancelled_at end,
    cancellation_reason=case when v_target in ('CANCELLED','NOT_HELD') then left(p_payload->>'reason',1000) else cancellation_reason end,
    completed_at=case when v_target='COMPLETED' then now() else completed_at end,
    version=version+1,last_transition_at=now(),last_transition_by=p_actor_id::text,updated_at=now()
  where id=p_meeting_id returning * into v_after;
  if v_target='COMPLETED' then
    update public.school_meeting_minutes set status='COMPLETED',completed_by=p_actor_id::text,completed_at=coalesce(completed_at,now()),updated_by=p_actor_id::text,updated_at=now() where meeting_id=p_meeting_id;
  end if;
  perform public.school_audit_append(p_organization_id::text,p_clinic_id,p_actor_id,'SCHOOL_MEETING',p_meeting_id::text,'MEETING_'||v_action,to_jsonb(v_before),to_jsonb(v_after),p_payload->>'reason',p_idempotency_key||':audit');
  v_response:=jsonb_build_object('success',true,'data',to_jsonb(v_after));
  perform public.school_idempotency_store(p_organization_id::text,'TRANSITION_SCHOOL_MEETING',p_idempotency_key,p_payload_hash,'SCHOOL_MEETING',p_meeting_id::text,v_response);
  return v_response;
end; $$;

create or replace function public.school_modify_meeting_patients_v2(
  p_actor_id uuid,p_clinic_id uuid,p_organization_id uuid,p_meeting_id uuid,
  p_action text,p_patient_ids uuid[],p_reason text,p_idempotency_key text,p_payload_hash text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare v_existing jsonb; v_meeting public.school_meetings%rowtype; v_count int; v_response jsonb;
begin
  if not public.school_actor_has_role(p_actor_id,p_clinic_id,p_organization_id,array['owner','admin','coordinator','receptionist','therapist']) then raise exception 'ACCESS_DENIED'; end if;
  if coalesce(cardinality(p_patient_ids),0)=0 then raise exception 'PATIENTS_REQUIRED'; end if;
  v_existing:=public.school_idempotency_existing(p_organization_id::text,'MODIFY_SCHOOL_MEETING_PATIENTS',p_idempotency_key,p_payload_hash); if v_existing is not null then return v_existing; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':MEETING:'||p_meeting_id::text,0));
  select * into v_meeting from public.school_meetings where id=p_meeting_id and organization_id=p_organization_id::text and clinic_id=p_clinic_id::text for update; if not found then raise exception 'SCHOOL_MEETING_NOT_FOUND'; end if;
  if upper(p_action)='ADD' then
    select count(distinct selected.patient_id) into v_count from unnest(p_patient_ids) selected(patient_id)
    join public.patient_school_enrollments e on e.patient_id=selected.patient_id and e.organization_id=p_organization_id::text and e.clinic_id=p_clinic_id::text and e.school_id=v_meeting.school_id and e.is_current and (v_meeting.school_unit_id is null or e.school_unit_id=v_meeting.school_unit_id)
    where public.school_actor_can_access_patient(p_actor_id,p_clinic_id,selected.patient_id);
    if v_count<>cardinality(p_patient_ids) then raise exception 'PATIENT_SCHOOL_SCOPE_MISMATCH'; end if;
    if v_meeting.status<>'DRAFT' and exists(select 1 from unnest(p_patient_ids) selected(patient_id) join public.patient_school_enrollments e on e.patient_id=selected.patient_id and e.organization_id=p_organization_id::text and e.clinic_id=p_clinic_id::text and e.school_id=v_meeting.school_id and e.is_current and (v_meeting.school_unit_id is null or e.school_unit_id=v_meeting.school_unit_id) where public.school_consent_current_status(p_organization_id::text,selected.patient_id,e.id,'SCHOOL_MEETING_PARTICIPATION',now()) not in ('AUTHORIZED','NOT_REQUIRED')) then raise exception 'SCHOOL_CONSENT_REQUIRED'; end if;
    insert into public.school_meeting_patients(organization_id,meeting_id,patient_id,school_enrollment_id,participation_status,consent_status_snapshot,included_by,idempotency_key)
    select p_organization_id::text,p_meeting_id,selected.patient_id,e.id,'INVITED',jsonb_build_object('SCHOOL_MEETING_PARTICIPATION',public.school_consent_current_status(p_organization_id::text,selected.patient_id,e.id,'SCHOOL_MEETING_PARTICIPATION',now()),'CLINICAL_INFORMATION_SHARING',public.school_consent_current_status(p_organization_id::text,selected.patient_id,e.id,'CLINICAL_INFORMATION_SHARING',now())),p_actor_id::text,p_idempotency_key||':'||selected.patient_id::text
    from unnest(p_patient_ids) selected(patient_id) join public.patient_school_enrollments e on e.patient_id=selected.patient_id and e.organization_id=p_organization_id::text and e.clinic_id=p_clinic_id::text and e.school_id=v_meeting.school_id and e.is_current and (v_meeting.school_unit_id is null or e.school_unit_id=v_meeting.school_unit_id)
    on conflict(meeting_id,patient_id) do update set participation_status='INVITED',removed_at=null,removed_by=null,removal_reason=null,consent_status_snapshot=excluded.consent_status_snapshot,updated_at=now();
  elsif upper(p_action)='REMOVE' then
    if nullif(trim(p_reason),'') is null then raise exception 'REMOVAL_REASON_REQUIRED'; end if;
    if exists(select 1 from unnest(p_patient_ids) selected(patient_id) where not public.school_actor_can_access_patient(p_actor_id,p_clinic_id,selected.patient_id)) then raise exception 'PATIENT_ACCESS_DENIED'; end if;
    update public.school_meeting_patients set participation_status='REMOVED',removed_at=now(),removed_by=p_actor_id::text,removal_reason=left(p_reason,1000),updated_at=now() where meeting_id=p_meeting_id and organization_id=p_organization_id::text and patient_id=any(p_patient_ids) and participation_status<>'REMOVED';
  else raise exception 'INVALID_PATIENT_ACTION'; end if;
  perform public.school_audit_append(p_organization_id::text,p_clinic_id,p_actor_id,'SCHOOL_MEETING',p_meeting_id::text,'MEETING_PATIENTS_'||upper(p_action),'{}'::jsonb,jsonb_build_object('patientIds',to_jsonb(p_patient_ids)),p_reason,p_idempotency_key||':audit');
  v_response:=jsonb_build_object('success',true,'meetingId',p_meeting_id,'patientIds',to_jsonb(p_patient_ids),'action',upper(p_action));
  perform public.school_idempotency_store(p_organization_id::text,'MODIFY_SCHOOL_MEETING_PATIENTS',p_idempotency_key,p_payload_hash,'SCHOOL_MEETING',p_meeting_id::text,v_response);
  return v_response;
end; $$;

create or replace function public.school_upsert_participant_v2(
  p_actor_id uuid,p_clinic_id uuid,p_organization_id uuid,p_meeting_id uuid,p_participant_id uuid,
  p_payload jsonb,p_idempotency_key text,p_payload_hash text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_existing jsonb; v_meeting public.school_meetings%rowtype; v_row public.school_meeting_participants%rowtype;
  v_before public.school_meeting_participants%rowtype; v_type text; v_professional text; v_response jsonb;
begin
  if not public.school_actor_has_role(p_actor_id,p_clinic_id,p_organization_id,array['owner','admin','coordinator','receptionist','therapist']) then raise exception 'ACCESS_DENIED'; end if;
  v_existing:=public.school_idempotency_existing(p_organization_id::text,case when p_participant_id is null then 'ADD_SCHOOL_PARTICIPANT' else 'UPDATE_SCHOOL_PARTICIPANT' end,p_idempotency_key,p_payload_hash); if v_existing is not null then return v_existing; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':MEETING:'||p_meeting_id::text,0));
  select * into v_meeting from public.school_meetings where id=p_meeting_id and organization_id=p_organization_id::text and clinic_id=p_clinic_id::text for update; if not found then raise exception 'SCHOOL_MEETING_NOT_FOUND'; end if;
  if p_participant_id is not null then select * into v_before from public.school_meeting_participants where id=p_participant_id and meeting_id=p_meeting_id and organization_id=p_organization_id::text for update; if not found then raise exception 'PARTICIPANT_NOT_FOUND'; end if; end if;
  v_type:=coalesce(nullif(upper(p_payload->>'participantType'),''),v_before.participant_type,'EXTERNAL_GUEST');
  v_professional:=coalesce(nullif(p_payload->>'professionalId',''),v_before.professional_id);
  if v_type in ('INTERNAL_USER','INTERNAL_PROFESSIONAL') then
    if nullif(v_professional,'') is null or not public.school_actor_has_role(v_professional::uuid,p_clinic_id,p_organization_id,array['owner','admin','coordinator','receptionist','therapist']) then raise exception 'PARTICIPANT_SCOPE_MISMATCH'; end if;
    if v_meeting.status<>'DRAFT' then perform public.school_assert_professional_availability(p_organization_id::text,p_clinic_id,array[v_professional],v_meeting.scheduled_start,v_meeting.scheduled_end,p_meeting_id); end if;
  elsif v_type='SCHOOL_CONTACT' then
    if not exists(select 1 from public.school_contacts c where c.id=coalesce(nullif(p_payload->>'schoolContactId','')::uuid,v_before.school_contact_id) and c.school_id=v_meeting.school_id and c.organization_id=p_organization_id::text and c.is_active and c.archived_at is null) then raise exception 'SCHOOL_CONTACT_NOT_FOUND'; end if;
  elsif v_type='FAMILY_RESPONSIBLE' then
    if not exists(select 1 from public.school_meeting_patients mp join public.patients p on p.id=mp.patient_id where mp.meeting_id=p_meeting_id and mp.participation_status<>'REMOVED' and (p.responsible_user_id::text=coalesce(nullif(p_payload->>'responsibleId',''),v_before.responsible_id) or lower(p.email)=lower(nullif(p_payload->>'responsibleEmail','')))) then raise exception 'RESPONSIBLE_SCOPE_MISMATCH'; end if;
  elsif v_type='EXTERNAL_GUEST' and nullif(trim(coalesce(p_payload->>'externalName',v_before.external_name,'')),'') is null then raise exception 'EXTERNAL_GUEST_NAME_REQUIRED';
  end if;

  if p_participant_id is null and exists (
    select 1
    from public.school_meeting_participants existing
    where existing.meeting_id=p_meeting_id
      and existing.organization_id=p_organization_id::text
      and existing.removed_at is null
      and (
        (v_type in ('INTERNAL_USER','INTERNAL_PROFESSIONAL') and existing.professional_id=v_professional)
        or (v_type='SCHOOL_CONTACT' and existing.school_contact_id=nullif(p_payload->>'schoolContactId','')::uuid)
        or (v_type='FAMILY_RESPONSIBLE' and existing.responsible_id=left(nullif(p_payload->>'responsibleId',''),120))
        or (v_type='EXTERNAL_GUEST' and nullif(lower(trim(existing.external_email)),'') is not distinct from nullif(lower(trim(p_payload->>'externalEmail')),'') and public.normalize_school_identity(existing.external_name)=public.normalize_school_identity(p_payload->>'externalName'))
      )
  ) then raise exception 'PARTICIPANT_DUPLICATE'; end if;

  if p_participant_id is null then
    insert into public.school_meeting_participants(organization_id,meeting_id,participant_type,professional_id,responsible_id,school_contact_id,external_name,external_email,attendance_status,invited_at,notes,created_by,idempotency_key,payload_hash)
    values(p_organization_id::text,p_meeting_id,v_type,case when v_type in ('INTERNAL_USER','INTERNAL_PROFESSIONAL') then v_professional end,case when v_type='FAMILY_RESPONSIBLE' then left(nullif(p_payload->>'responsibleId',''),120) end,case when v_type='SCHOOL_CONTACT' then nullif(p_payload->>'schoolContactId','')::uuid end,case when v_type='EXTERNAL_GUEST' then left(nullif(p_payload->>'externalName',''),180) end,case when v_type='EXTERNAL_GUEST' then left(nullif(p_payload->>'externalEmail',''),320) end,coalesce(nullif(upper(p_payload->>'attendanceStatus'),''),'INVITED'),coalesce(nullif(p_payload->>'invitedAt','')::timestamptz,now()),left(nullif(p_payload->>'notes',''),2000),p_actor_id::text,p_idempotency_key,p_payload_hash) returning * into v_row;
  else
    update public.school_meeting_participants set
      attendance_status=case when p_payload ? 'attendanceStatus' then upper(p_payload->>'attendanceStatus') else attendance_status end,
      external_name=case when p_payload ? 'externalName' then left(nullif(p_payload->>'externalName',''),180) else external_name end,
      external_email=case when p_payload ? 'externalEmail' then left(nullif(p_payload->>'externalEmail',''),320) else external_email end,
      notes=case when p_payload ? 'notes' then left(nullif(p_payload->>'notes',''),2000) else notes end,
      removed_at=case when coalesce((p_payload->>'isActive')::boolean,true) then null else now() end,
      removed_by=case when coalesce((p_payload->>'isActive')::boolean,true) then null else p_actor_id::text end,
      removal_reason=case when coalesce((p_payload->>'isActive')::boolean,true) then null else left(p_payload->>'reason',1000) end,
      updated_at=now()
    where id=p_participant_id returning * into v_row;
  end if;
  perform public.school_audit_append(p_organization_id::text,p_clinic_id,p_actor_id,'SCHOOL_MEETING_PARTICIPANT',v_row.id::text,case when p_participant_id is null then 'PARTICIPANT_ADDED' when v_row.removed_at is null then 'PARTICIPANT_UPDATED' else 'PARTICIPANT_REMOVED' end,coalesce(to_jsonb(v_before),'{}'::jsonb),to_jsonb(v_row),p_payload->>'reason',p_idempotency_key||':audit');
  v_response:=jsonb_build_object('success',true,'data',to_jsonb(v_row));
  perform public.school_idempotency_store(p_organization_id::text,case when p_participant_id is null then 'ADD_SCHOOL_PARTICIPANT' else 'UPDATE_SCHOOL_PARTICIPANT' end,p_idempotency_key,p_payload_hash,'SCHOOL_MEETING_PARTICIPANT',v_row.id::text,v_response);
  return v_response;
end; $$;

create or replace function public.school_record_attendance_v2(
  p_actor_id uuid,p_clinic_id uuid,p_organization_id uuid,p_meeting_id uuid,
  p_subject_type text,p_subject_id uuid,p_status text,p_notes text,p_joined_at timestamptz,
  p_idempotency_key text,p_payload_hash text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare v_existing jsonb; v_response jsonb; v_data jsonb; v_status text:=upper(p_status);
begin
  if not public.school_actor_has_role(p_actor_id,p_clinic_id,p_organization_id,array['owner','admin','coordinator','receptionist','therapist']) then raise exception 'ACCESS_DENIED'; end if;
  if v_status not in ('INVITED','CONFIRMED','ATTENDED','ABSENT','DECLINED','UNKNOWN') then raise exception 'INVALID_ATTENDANCE_STATUS'; end if;
  if not exists(select 1 from public.school_meetings m where m.id=p_meeting_id and m.organization_id=p_organization_id::text and m.clinic_id=p_clinic_id::text) then raise exception 'SCHOOL_MEETING_NOT_FOUND'; end if;
  v_existing:=public.school_idempotency_existing(p_organization_id::text,'RECORD_SCHOOL_ATTENDANCE',p_idempotency_key,p_payload_hash); if v_existing is not null then return v_existing; end if;
  if upper(p_subject_type)='PATIENT' then
    update public.school_meeting_patients set participation_status=v_status,attendance_marked_at=now(),attendance_marked_by=p_actor_id::text,attendance_notes=left(p_notes,1000),actual_joined_at=p_joined_at,updated_at=now()
    where id=p_subject_id and meeting_id=p_meeting_id and organization_id=p_organization_id::text and participation_status<>'REMOVED';
    if not found then raise exception 'ATTENDANCE_SUBJECT_NOT_FOUND'; end if;
    select to_jsonb(mp) into v_data from public.school_meeting_patients mp where mp.id=p_subject_id;
  elsif upper(p_subject_type)='PARTICIPANT' then
    update public.school_meeting_participants set attendance_status=v_status,attended=(v_status='ATTENDED'),attendance_marked_at=now(),attendance_marked_by=p_actor_id::text,attendance_notes=left(p_notes,1000),actual_joined_at=p_joined_at,updated_at=now()
    where id=p_subject_id and meeting_id=p_meeting_id and organization_id=p_organization_id::text and removed_at is null;
    if not found then raise exception 'ATTENDANCE_SUBJECT_NOT_FOUND'; end if;
    select to_jsonb(mp) into v_data from public.school_meeting_participants mp where mp.id=p_subject_id;
  else raise exception 'INVALID_ATTENDANCE_SUBJECT'; end if;
  perform public.school_audit_append(p_organization_id::text,p_clinic_id,p_actor_id,'SCHOOL_MEETING',p_meeting_id::text,'ATTENDANCE_RECORDED','{}'::jsonb,jsonb_build_object('subjectType',upper(p_subject_type),'subjectId',p_subject_id,'status',v_status),p_notes,p_idempotency_key||':audit');
  v_response:=jsonb_build_object('success',true,'data',v_data);
  perform public.school_idempotency_store(p_organization_id::text,'RECORD_SCHOOL_ATTENDANCE',p_idempotency_key,p_payload_hash,'SCHOOL_MEETING',p_meeting_id::text,v_response);
  return v_response;
end; $$;

create or replace function public.school_save_minutes_v2(
  p_actor_id uuid,p_clinic_id uuid,p_organization_id uuid,p_meeting_id uuid,
  p_payload jsonb,p_patient_notes jsonb,p_referrals jsonb,p_idempotency_key text,p_payload_hash text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare v_existing jsonb; v_meeting public.school_meetings%rowtype; v_minutes public.school_meeting_minutes%rowtype; v_note jsonb; v_prev public.school_meeting_patient_notes%rowtype; v_ref jsonb; v_referral_count int:=0; v_response jsonb; v_visibility text; v_enrollment uuid;
begin
  if not public.school_actor_has_role(p_actor_id,p_clinic_id,p_organization_id,array['owner','admin','coordinator','therapist']) then raise exception 'ACCESS_DENIED'; end if;
  v_existing:=public.school_idempotency_existing(p_organization_id::text,'SAVE_SCHOOL_MINUTES',p_idempotency_key,p_payload_hash); if v_existing is not null then return v_existing; end if;
  select * into v_meeting from public.school_meetings where id=p_meeting_id and organization_id=p_organization_id::text and clinic_id=p_clinic_id::text for update; if not found then raise exception 'SCHOOL_MEETING_NOT_FOUND'; end if;
  insert into public.school_meeting_minutes(organization_id,clinic_id,meeting_id,actual_start,actual_end,general_summary,decisions,referrals,next_meeting_at,status,completed_by,completed_at,created_by,updated_by,task_sync_status,idempotency_key,payload_hash)
  values(p_organization_id::text,p_clinic_id::text,p_meeting_id,nullif(p_payload->>'actualStart','')::timestamptz,nullif(p_payload->>'actualEnd','')::timestamptz,left(nullif(p_payload->>'generalSummary',''),15000),left(nullif(p_payload->>'decisions',''),15000),left(nullif(p_payload->>'referralsText',''),15000),nullif(p_payload->>'nextMeetingAt','')::timestamptz,'DRAFT',null,null,p_actor_id::text,p_actor_id::text,case when jsonb_array_length(coalesce(p_referrals,'[]'::jsonb))>0 then 'PENDING' else 'NOT_REQUESTED' end,p_idempotency_key,p_payload_hash)
  on conflict(meeting_id) do update set actual_start=excluded.actual_start,actual_end=excluded.actual_end,general_summary=excluded.general_summary,decisions=excluded.decisions,referrals=excluded.referrals,next_meeting_at=excluded.next_meeting_at,status='DRAFT',updated_by=p_actor_id::text,task_sync_status=excluded.task_sync_status,task_sync_error=null,idempotency_key=p_idempotency_key,payload_hash=p_payload_hash,updated_at=now()
  returning * into v_minutes;
  for v_note in select value from jsonb_array_elements(coalesce(p_patient_notes,'[]'::jsonb)) loop
    if not exists(select 1 from public.school_meeting_patients mp where mp.meeting_id=p_meeting_id and mp.patient_id=(v_note->>'patientId')::uuid and mp.participation_status<>'REMOVED') then raise exception 'PATIENT_NOT_IN_MEETING'; end if;
    if not public.school_actor_can_access_patient(p_actor_id,p_clinic_id,(v_note->>'patientId')::uuid) then raise exception 'PATIENT_ACCESS_DENIED'; end if;
    v_visibility:=coalesce(nullif(upper(v_note->>'visibility'),''),'CLINICAL_TEAM');
    if v_visibility='AUTHORIZED_SCHOOL' then
      select mp.school_enrollment_id into v_enrollment from public.school_meeting_patients mp where mp.meeting_id=p_meeting_id and mp.patient_id=(v_note->>'patientId')::uuid;
      if public.school_consent_current_status(p_organization_id::text,(v_note->>'patientId')::uuid,v_enrollment,'CLINICAL_INFORMATION_SHARING',now()) not in ('AUTHORIZED','NOT_REQUIRED') then raise exception 'SCHOOL_SHARING_CONSENT_REQUIRED'; end if;
    end if;
    select * into v_prev from public.school_meeting_patient_notes n where n.meeting_id=p_meeting_id and n.patient_id=(v_note->>'patientId')::uuid and n.is_current for update;
    if found then update public.school_meeting_patient_notes set is_current=false,updated_by=p_actor_id::text where id=v_prev.id; end if;
    insert into public.school_meeting_patient_notes(organization_id,clinic_id,meeting_id,patient_id,note,decisions,referrals,visibility,created_by,updated_by,version,is_current,supersedes_note_id,idempotency_key,payload_hash)
    values(p_organization_id::text,p_clinic_id::text,p_meeting_id,(v_note->>'patientId')::uuid,left(nullif(v_note->>'note',''),12000),left(nullif(v_note->>'decisions',''),12000),left(nullif(v_note->>'referrals',''),12000),v_visibility,p_actor_id::text,p_actor_id::text,coalesce(v_prev.version,0)+1,true,v_prev.id,p_idempotency_key||':note:'||(v_note->>'patientId'),encode(digest(coalesce(v_note::text,''),'sha256'),'hex'));
  end loop;
  for v_ref in select value from jsonb_array_elements(coalesce(p_referrals,'[]'::jsonb)) loop
    if nullif(trim(v_ref->>'title'),'') is null or nullif(trim(v_ref->>'responsibleUserId'),'') is null then raise exception 'INVALID_REFERRAL'; end if;
    if nullif(v_ref->>'patientId','') is not null and not exists(select 1 from public.school_meeting_patients mp where mp.meeting_id=p_meeting_id and mp.patient_id=(v_ref->>'patientId')::uuid and mp.participation_status<>'REMOVED') then raise exception 'REFERRAL_PATIENT_NOT_IN_MEETING'; end if;
    insert into public.school_meeting_referrals(organization_id,clinic_id,meeting_id,patient_id,title,description,responsible_user_id,due_at,priority,status,idempotency_key,created_by)
    values(p_organization_id::text,p_clinic_id::text,p_meeting_id,nullif(v_ref->>'patientId','')::uuid,left(trim(v_ref->>'title'),180),left(nullif(v_ref->>'description',''),4000),left(trim(v_ref->>'responsibleUserId'),120),nullif(v_ref->>'dueAt','')::timestamptz,coalesce(nullif(upper(v_ref->>'priority'),''),'MEDIUM'),'PENDING_TASK',p_idempotency_key||':referral:'||v_referral_count,p_actor_id::text)
    on conflict(organization_id,idempotency_key) do nothing;
    v_referral_count:=v_referral_count+1;
  end loop;
  perform public.school_audit_append(p_organization_id::text,p_clinic_id,p_actor_id,'SCHOOL_MEETING',p_meeting_id::text,'MINUTES_SAVED','{}'::jsonb,jsonb_build_object('minutesId',v_minutes.id,'patientNoteCount',jsonb_array_length(coalesce(p_patient_notes,'[]'::jsonb)),'referralCount',v_referral_count),null,p_idempotency_key||':audit');
  v_response:=jsonb_build_object('success',true,'data',to_jsonb(v_minutes),'referralCount',v_referral_count); perform public.school_idempotency_store(p_organization_id::text,'SAVE_SCHOOL_MINUTES',p_idempotency_key,p_payload_hash,'SCHOOL_MEETING_MINUTES',v_minutes.id::text,v_response); return v_response;
end; $$;

create or replace function public.school_link_document_v2(
  p_actor_id uuid,p_clinic_id uuid,p_organization_id uuid,p_payload jsonb,p_idempotency_key text,p_payload_hash text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_existing jsonb;
  v_row public.school_document_links%rowtype;
  v_patient uuid;
  v_file_patient uuid;
  v_enrollment uuid;
  v_visibility text;
  v_response jsonb;
begin
  if not public.school_actor_has_role(p_actor_id,p_clinic_id,p_organization_id,array['owner','admin','coordinator','therapist']) then raise exception 'ACCESS_DENIED'; end if;
  v_existing:=public.school_idempotency_existing(p_organization_id::text,'LINK_SCHOOL_DOCUMENT',p_idempotency_key,p_payload_hash);
  if v_existing is not null then return v_existing; end if;

  v_patient:=nullif(p_payload->>'patientId','')::uuid;
  v_visibility:=coalesce(nullif(upper(p_payload->>'visibility'),''),'INTERNAL');
  if nullif(trim(p_payload->>'documentId'),'') is null then raise exception 'DOCUMENT_REQUIRED'; end if;
  if v_visibility not in ('INTERNAL','AUTHORIZED_FAMILY','AUTHORIZED_SCHOOL') then raise exception 'INVALID_DOCUMENT_VISIBILITY'; end if;
  if v_patient is null then raise exception 'DOCUMENT_PATIENT_REQUIRED'; end if;
  if not public.school_actor_can_access_patient(p_actor_id,p_clinic_id,v_patient) then raise exception 'PATIENT_ACCESS_DENIED'; end if;
  if nullif(p_payload->>'schoolId','') is not null and not exists(select 1 from public.schools s where s.id=(p_payload->>'schoolId')::uuid and s.organization_id=p_organization_id::text) then raise exception 'SCHOOL_NOT_FOUND'; end if;
  if nullif(p_payload->>'schoolUnitId','') is not null and not exists(select 1 from public.school_units u where u.id=(p_payload->>'schoolUnitId')::uuid and u.school_id=(p_payload->>'schoolId')::uuid and u.organization_id=p_organization_id::text) then raise exception 'SCHOOL_UNIT_NOT_FOUND'; end if;
  if nullif(p_payload->>'meetingId','') is not null and not exists(select 1 from public.school_meetings m where m.id=(p_payload->>'meetingId')::uuid and m.organization_id=p_organization_id::text and m.clinic_id=p_clinic_id::text) then raise exception 'SCHOOL_MEETING_NOT_FOUND'; end if;

  if to_regclass('public.patient_files') is not null then
    select pf.patient_id into v_file_patient
    from public.patient_files pf
    where pf.id=(p_payload->>'documentId')::uuid and pf.clinic_id=p_clinic_id;
    if v_file_patient is null then raise exception 'DOCUMENT_NOT_FOUND'; end if;
    if v_file_patient is distinct from v_patient then raise exception 'DOCUMENT_PATIENT_MISMATCH'; end if;
  end if;

  if v_visibility='AUTHORIZED_SCHOOL' then
    select e.id into v_enrollment
    from public.patient_school_enrollments e
    where e.patient_id=v_patient and e.school_id=(p_payload->>'schoolId')::uuid
      and e.organization_id=p_organization_id::text and e.clinic_id=p_clinic_id::text
      and e.is_current
    order by (e.enrollment_type='PRIMARY_SCHOOL') desc,e.started_at desc
    limit 1;
    if v_enrollment is null or public.school_consent_current_status(p_organization_id::text,v_patient,v_enrollment,'REPORT_SENDING',now()) not in ('AUTHORIZED','NOT_REQUIRED') then
      raise exception 'SCHOOL_DOCUMENT_CONSENT_REQUIRED';
    end if;
  end if;

  insert into public.school_document_links(
    organization_id,clinic_id,school_id,school_unit_id,patient_id,meeting_id,document_id,
    document_type,visibility,document_date,metadata,created_by,updated_by,idempotency_key,payload_hash
  ) values(
    p_organization_id::text,p_clinic_id::text,nullif(p_payload->>'schoolId','')::uuid,
    nullif(p_payload->>'schoolUnitId','')::uuid,v_patient,nullif(p_payload->>'meetingId','')::uuid,
    left(trim(p_payload->>'documentId'),180),coalesce(nullif(upper(p_payload->>'documentType'),''),'OTHER'),
    v_visibility,nullif(p_payload->>'documentDate','')::date,coalesce(p_payload->'metadata','{}'::jsonb),
    p_actor_id::text,p_actor_id::text,p_idempotency_key,p_payload_hash
  ) returning * into v_row;
  perform public.school_audit_append(p_organization_id::text,p_clinic_id,p_actor_id,'SCHOOL_DOCUMENT_LINK',v_row.id::text,'DOCUMENT_LINKED','{}'::jsonb,to_jsonb(v_row),null,p_idempotency_key||':audit');
  v_response:=jsonb_build_object('success',true,'data',to_jsonb(v_row));
  perform public.school_idempotency_store(p_organization_id::text,'LINK_SCHOOL_DOCUMENT',p_idempotency_key,p_payload_hash,'SCHOOL_DOCUMENT_LINK',v_row.id::text,v_response);
  return v_response;
end; $$;


create or replace function public.school_update_document_v2(
  p_actor_id uuid,p_clinic_id uuid,p_organization_id uuid,p_link_id uuid,
  p_payload jsonb,p_idempotency_key text,p_payload_hash text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_existing jsonb;
  v_before public.school_document_links%rowtype;
  v_after public.school_document_links%rowtype;
  v_response jsonb;
begin
  if not public.school_actor_has_role(p_actor_id,p_clinic_id,p_organization_id,array['owner','admin','coordinator','receptionist','therapist']) then raise exception 'ACCESS_DENIED'; end if;
  v_existing:=public.school_idempotency_existing(p_organization_id::text,'UPDATE_SCHOOL_DOCUMENT',p_idempotency_key,p_payload_hash); if v_existing is not null then return v_existing; end if;
  select * into v_before from public.school_document_links where id=p_link_id and organization_id=p_organization_id::text and clinic_id=p_clinic_id::text for update;
  if not found then raise exception 'DOCUMENT_NOT_FOUND'; end if;
  if v_before.patient_id is not null and not public.school_actor_can_access_patient(p_actor_id,p_clinic_id,v_before.patient_id) then raise exception 'PATIENT_ACCESS_DENIED'; end if;
  if public.school_actor_effective_role(p_actor_id,p_clinic_id)='receptionist' and coalesce(v_before.visibility,'INTERNAL') not in ('INTERNAL','ADMINISTRATIVE') then raise exception 'ACCESS_DENIED'; end if;
  update public.school_document_links
  set document_type=case when p_payload ? 'documentType' then upper(p_payload->>'documentType') else document_type end,
      visibility=case when p_payload ? 'visibility' then upper(p_payload->>'visibility') else visibility end,
      document_date=case when p_payload ? 'documentDate' then nullif(p_payload->>'documentDate','')::date else document_date end,
      metadata=case when p_payload ? 'metadata' then coalesce(p_payload->'metadata','{}'::jsonb) else metadata end,
      archived_at=case when coalesce((p_payload->>'archive')::boolean,false) then coalesce(archived_at,now()) when coalesce((p_payload->>'reactivate')::boolean,false) then null else archived_at end,
      archived_by=case when coalesce((p_payload->>'archive')::boolean,false) then p_actor_id::text when coalesce((p_payload->>'reactivate')::boolean,false) then null else archived_by end,
      archive_reason=case when coalesce((p_payload->>'archive')::boolean,false) then left(p_payload->>'reason',1000) when coalesce((p_payload->>'reactivate')::boolean,false) then null else archive_reason end,
      updated_by=p_actor_id::text,updated_at=now()
  where id=p_link_id returning * into v_after;
  perform public.school_audit_append(p_organization_id::text,p_clinic_id,p_actor_id,'SCHOOL_DOCUMENT_LINK',p_link_id::text,case when v_after.archived_at is not null then 'DOCUMENT_LINK_ARCHIVED' else 'DOCUMENT_LINK_UPDATED' end,to_jsonb(v_before),to_jsonb(v_after),p_payload->>'reason',p_idempotency_key||':audit');
  v_response:=jsonb_build_object('success',true,'data',to_jsonb(v_after));
  perform public.school_idempotency_store(p_organization_id::text,'UPDATE_SCHOOL_DOCUMENT',p_idempotency_key,p_payload_hash,'SCHOOL_DOCUMENT_LINK',p_link_id::text,v_response);
  return v_response;
end;
$$;

create or replace function public.school_attach_referral_tasks_v2(
  p_actor_id uuid,p_clinic_id uuid,p_organization_id uuid,p_meeting_id uuid,
  p_links jsonb,p_idempotency_key text,p_payload_hash text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_existing jsonb;
  v_invalid integer;
  v_count integer;
  v_response jsonb;
begin
  if not public.school_actor_has_role(p_actor_id,p_clinic_id,p_organization_id,array['owner','admin','coordinator','therapist']) then raise exception 'ACCESS_DENIED'; end if;
  v_existing:=public.school_idempotency_existing(p_organization_id::text,'ATTACH_SCHOOL_REFERRAL_TASKS',p_idempotency_key,p_payload_hash); if v_existing is not null then return v_existing; end if;
  if not exists(select 1 from public.school_meetings m where m.id=p_meeting_id and m.organization_id=p_organization_id::text and m.clinic_id=p_clinic_id::text) then raise exception 'SCHOOL_MEETING_NOT_FOUND'; end if;

  select count(*) into v_invalid
  from jsonb_to_recordset(coalesce(p_links,'[]'::jsonb)) as x("referralId" uuid,"taskId" uuid,status text,error text)
  left join public.school_meeting_referrals r on r.id=x."referralId" and r.meeting_id=p_meeting_id and r.organization_id=p_organization_id::text
  left join public.tasks t on t.id=x."taskId"
  left join public.patients task_patient on task_patient.id=t.patient_id and task_patient.clinic_id=p_clinic_id
  where r.id is null or (upper(coalesce(x.status,'TASK_CREATED'))='TASK_CREATED' and (t.id is null or task_patient.id is null or t.patient_id is distinct from r.patient_id));
  if v_invalid>0 then raise exception 'INVALID_REFERRAL_TASK_LINK'; end if;

  with links as (
    select * from jsonb_to_recordset(coalesce(p_links,'[]'::jsonb)) as x("referralId" uuid,"taskId" uuid,status text,error text)
  )
  update public.school_meeting_referrals r
  set task_id=l."taskId",
      status=case when upper(coalesce(l.status,'TASK_CREATED'))='TASK_FAILED' then 'TASK_FAILED' else 'TASK_CREATED' end,
      task_error=left(l.error,1000),
      updated_at=now()
  from links l
  where r.id=l."referralId" and r.meeting_id=p_meeting_id and r.organization_id=p_organization_id::text;
  get diagnostics v_count=row_count;

  update public.school_meeting_minutes
  set task_sync_status=case when exists(select 1 from public.school_meeting_referrals r where r.meeting_id=p_meeting_id and r.status='TASK_FAILED') then 'FAILED' else 'COMPLETED' end,
      task_sync_error=case when exists(select 1 from public.school_meeting_referrals r where r.meeting_id=p_meeting_id and r.status='TASK_FAILED') then 'Uma ou mais tarefas não foram sincronizadas.' else null end,
      updated_at=now()
  where meeting_id=p_meeting_id;

  perform public.school_audit_append(p_organization_id::text,p_clinic_id,p_actor_id,'SCHOOL_MEETING',p_meeting_id::text,'REFERRAL_TASKS_SYNCHRONIZED','{}'::jsonb,jsonb_build_object('links',p_links,'count',v_count),null,p_idempotency_key||':audit');
  v_response:=jsonb_build_object('success',true,'processed',v_count);
  perform public.school_idempotency_store(p_organization_id::text,'ATTACH_SCHOOL_REFERRAL_TASKS',p_idempotency_key,p_payload_hash,'SCHOOL_MEETING',p_meeting_id::text,v_response);
  return v_response;
end;
$$;

create or replace function public.school_resolve_migration_review_v2(
  p_actor_id uuid,p_clinic_id uuid,p_organization_id uuid,p_queue_ids uuid[],
  p_action text,p_school_id uuid,p_unit_id uuid,p_reason text,p_idempotency_key text,p_payload_hash text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare v_existing jsonb; v_count int; v_response jsonb;
begin
  if not public.school_actor_has_role(p_actor_id,p_clinic_id,p_organization_id,array['owner','admin','coordinator','receptionist']) then raise exception 'ACCESS_DENIED'; end if;
  v_existing:=public.school_idempotency_existing(p_organization_id::text,'RESOLVE_SCHOOL_MIGRATION_REVIEW',p_idempotency_key,p_payload_hash); if v_existing is not null then return v_existing; end if;
  if upper(p_action)='ASSOCIATE' then
    if not exists(select 1 from public.schools s where s.id=p_school_id and s.organization_id=p_organization_id::text) then raise exception 'SCHOOL_NOT_FOUND'; end if;
    if p_unit_id is not null and not exists(select 1 from public.school_units u where u.id=p_unit_id and u.school_id=p_school_id and u.organization_id=p_organization_id::text) then raise exception 'SCHOOL_UNIT_NOT_FOUND'; end if;
    insert into public.patient_school_enrollments(organization_id,clinic_id,patient_id,school_id,school_unit_id,enrollment_type,is_current,started_at,migration_source,legacy_source_value,created_by,updated_by)
    select p_organization_id::text,p_clinic_id::text,q.patient_id,p_school_id,p_unit_id,'PRIMARY_SCHOOL',not exists(select 1 from public.patient_school_enrollments e where e.patient_id=q.patient_id and e.organization_id=p_organization_id::text and e.is_current and e.enrollment_type='PRIMARY_SCHOOL'),current_date,'SCHOOL_MIGRATION_REVIEW',q.original_value,p_actor_id::text,p_actor_id::text
    from public.school_migration_review_queue q
    where q.id=any(p_queue_ids) and q.organization_id=p_organization_id::text and q.clinic_id=p_clinic_id::text and q.status in ('PENDING','AMBIGUOUS','DEFERRED')
    on conflict do nothing;
    update public.school_migration_review_queue set status='RESOLVED',decision='ASSOCIATE',selected_school_id=p_school_id,selected_school_unit_id=p_unit_id,resolution_notes=left(p_reason,2000),resolved_by=p_actor_id::text,resolved_at=now(),updated_at=now(),idempotency_key=p_idempotency_key,payload_hash=p_payload_hash where id=any(p_queue_ids) and organization_id=p_organization_id::text and clinic_id=p_clinic_id::text and status in ('PENDING','AMBIGUOUS','DEFERRED');
  elsif upper(p_action) in ('IGNORE','NOT_SCHOOL','DEFER') then
    update public.school_migration_review_queue set status=case upper(p_action) when 'IGNORE' then 'IGNORED' when 'NOT_SCHOOL' then 'NOT_SCHOOL' else 'DEFERRED' end,decision=upper(p_action),resolution_notes=left(p_reason,2000),resolved_by=case when upper(p_action)='DEFER' then null else p_actor_id::text end,resolved_at=case when upper(p_action)='DEFER' then null else now() end,updated_at=now(),idempotency_key=p_idempotency_key,payload_hash=p_payload_hash where id=any(p_queue_ids) and organization_id=p_organization_id::text and clinic_id=p_clinic_id::text and status in ('PENDING','AMBIGUOUS','DEFERRED');
  else raise exception 'INVALID_REVIEW_ACTION'; end if;
  get diagnostics v_count=row_count;
  perform public.school_audit_append(p_organization_id::text,p_clinic_id,p_actor_id,'SCHOOL_MIGRATION_REVIEW','BATCH','MIGRATION_REVIEW_'||upper(p_action),'{}'::jsonb,jsonb_build_object('queueIds',to_jsonb(p_queue_ids),'schoolId',p_school_id,'unitId',p_unit_id,'count',v_count),p_reason,p_idempotency_key||':audit');
  v_response:=jsonb_build_object('success',true,'processed',v_count,'action',upper(p_action)); perform public.school_idempotency_store(p_organization_id::text,'RESOLVE_SCHOOL_MIGRATION_REVIEW',p_idempotency_key,p_payload_hash,'SCHOOL_MIGRATION_REVIEW','BATCH',v_response); return v_response;
end; $$;

-- ---------------------------------------------------------------------------
-- 5. Explicit RLS. Sensitive writes are RPC-only.
-- ---------------------------------------------------------------------------
alter table public.school_organizations enable row level security;
alter table public.school_clinic_links enable row level security;
alter table public.school_meeting_referrals enable row level security;

drop policy if exists school_organizations_select on public.school_organizations;
create policy school_organizations_select on public.school_organizations for select to authenticated
using (public.school_rls_org_access(id::text));

-- Remove the broad policies introduced previously.
do $$ declare t text; p record; begin
  foreach t in array array['schools','school_units','school_contacts','patient_school_enrollments','school_consents','school_meetings','school_meeting_patients','school_meeting_participants','school_meeting_minutes','school_meeting_patient_notes','school_document_links','school_audit_events','school_migration_review_queue','school_idempotency_records'] loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I',p.policyname,t);
    end loop;
  end loop;
end $$;

create policy schools_select_explicit on public.schools for select to authenticated using (
  public.school_rls_org_access(organization_id)
  and (
    exists(select 1 from public.clinics c where c.school_organization_id::text=schools.organization_id and public.school_actor_effective_role(auth.uid(),c.id) in ('owner','admin'))
    or exists(select 1 from public.clinics c join public.clinic_memberships cm on cm.clinic_id=c.id where c.school_organization_id::text=schools.organization_id and cm.user_id=auth.uid() and cm.status='active' and lower(cm.role) in ('coordinator','receptionist'))
    or exists(select 1 from public.patient_school_enrollments e where e.school_id=schools.id and e.is_current and public.school_rls_patient_access(e.patient_id))
    or exists(select 1 from public.school_meetings m join public.school_meeting_participants mp on mp.meeting_id=m.id where m.school_id=schools.id and mp.professional_id=auth.uid()::text and mp.removed_at is null)
  )
);

create policy school_units_select_explicit on public.school_units for select to authenticated using (exists(select 1 from public.schools s where s.id=school_units.school_id));
create policy school_contacts_select_explicit on public.school_contacts for select to authenticated using (exists(select 1 from public.schools s where s.id=school_contacts.school_id));
create policy enrollments_select_explicit on public.patient_school_enrollments for select to authenticated using (public.school_rls_patient_access(patient_id));
create policy consents_select_explicit on public.school_consents for select to authenticated using (public.school_rls_patient_access(patient_id));
create policy meetings_select_explicit on public.school_meetings for select to authenticated using (public.school_rls_meeting_access(id));
create policy meeting_patients_select_explicit on public.school_meeting_patients for select to authenticated using (public.school_rls_meeting_access(meeting_id) and public.school_rls_patient_access(patient_id));
create policy meeting_participants_select_explicit on public.school_meeting_participants for select to authenticated using (public.school_rls_meeting_access(meeting_id));
create policy meeting_minutes_select_explicit on public.school_meeting_minutes for select to authenticated using (public.school_rls_meeting_access(meeting_id));
create policy patient_notes_select_explicit on public.school_meeting_patient_notes for select to authenticated using (
  public.school_rls_patient_access(patient_id)
  and public.school_rls_meeting_access(meeting_id)
  and lower(coalesce(public.school_actor_effective_role(auth.uid(),clinic_id::uuid),'')) in ('owner','admin','coordinator','therapist')
);
create policy school_documents_select_explicit on public.school_document_links for select to authenticated using (
  public.school_rls_org_access(organization_id)
  and (
    patient_id is null
    or (
      public.school_rls_patient_access(patient_id)
      and lower(coalesce(public.school_actor_effective_role(auth.uid(),clinic_id::uuid),'')) in ('owner','admin','coordinator','therapist')
    )
  )
  and (meeting_id is null or public.school_rls_meeting_access(meeting_id))
);
create policy school_audit_select_explicit on public.school_audit_events for select to authenticated using (
  public.school_rls_org_access(organization_id)
  and coalesce(public.school_actor_effective_role(auth.uid(),clinic_id::uuid),'') in ('owner','admin','coordinator')
);
create policy school_review_select_explicit on public.school_migration_review_queue for select to authenticated using (
  public.school_rls_org_access(organization_id)
  and coalesce(public.school_actor_effective_role(auth.uid(),clinic_id::uuid),'') in ('owner','admin','coordinator','receptionist')
);
create policy school_clinic_links_select_explicit on public.school_clinic_links for select to authenticated using (
  public.school_rls_org_access(organization_id)
  and exists(select 1 from public.schools s where s.id=school_clinic_links.school_id)
);
create policy school_referrals_select_explicit on public.school_meeting_referrals for select to authenticated using (
  public.school_rls_meeting_access(meeting_id)
  and (patient_id is null or public.school_rls_patient_access(patient_id))
  and coalesce(public.school_actor_effective_role(auth.uid(),clinic_id::uuid),'') in ('owner','admin','coordinator','therapist')
);

-- Idempotency records are intentionally not directly readable by authenticated users.
revoke all on public.school_idempotency_records from anon, authenticated;

-- Direct sensitive writes are disabled. The trusted backend invokes transactional RPCs.
do $$ declare t text; begin
  foreach t in array array['schools','school_units','school_contacts','patient_school_enrollments','school_consents','school_meetings','school_meeting_patients','school_meeting_participants','school_meeting_minutes','school_meeting_patient_notes','school_document_links','school_audit_events','school_migration_review_queue','school_idempotency_records','school_clinic_links','school_meeting_referrals'] loop
    execute format('revoke insert, update, delete on public.%I from anon, authenticated',t);
  end loop;
end $$;

-- The old RPC trusted caller-supplied tenant ids and required auth.uid(), while the
-- current backend uses the service role. It remains for historical compatibility
-- but is no longer executable by application roles.
do $$ declare fn record; begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='create_school_meeting_batch'
  loop
    execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
  end loop;
end $$;

-- RPC grants: backend service role only. No anon/authenticated direct writes.
do $$ declare fn record; begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'school_create_school_v2','school_update_school_v2','school_upsert_unit_v2','school_upsert_contact_v2','school_change_enrollment_v2','school_end_enrollment_v2','school_record_consent_v2','create_school_meeting_batch_v2','school_transition_meeting_v2','school_modify_meeting_patients_v2','school_upsert_participant_v2','school_record_attendance_v2','school_save_minutes_v2','school_link_document_v2','school_update_document_v2','school_attach_referral_tasks_v2','school_resolve_migration_review_v2'
    )
  loop
    execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
    execute format('grant execute on function %s to service_role',fn.signature);
  end loop;
end $$;

-- Helper functions are needed by authenticated RLS policies but expose no rows.
do $$ declare fn record; begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('school_actor_effective_role','school_rls_org_access','school_rls_patient_access','school_rls_meeting_access','school_consent_current_status')
  loop
    execute format('revoke all on function %s from public,anon',fn.signature);
    execute format('grant execute on function %s to authenticated,service_role',fn.signature);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- POST-MIGRATION READ-ONLY VALIDATION QUERIES
-- ---------------------------------------------------------------------------
select count(*) as school_organizations from public.school_organizations;
select count(*) as clinics_without_school_organization from public.clinics where school_organization_id is null;
select count(*) as schools from public.schools;
select count(*) as units from public.school_units;
select count(*) as contacts from public.school_contacts;
select count(*) as enrollments from public.patient_school_enrollments;
select count(*) as current_primary_enrollments from public.patient_school_enrollments where is_current and enrollment_type='PRIMARY_SCHOOL';
select organization_id,patient_id,count(*) from public.patient_school_enrollments where is_current and enrollment_type='PRIMARY_SCHOOL' group by organization_id,patient_id having count(*)>1;
select organization_id,patient_id,enrollment_type,count(*) from public.patient_school_enrollments where is_current group by organization_id,patient_id,enrollment_type order by count(*) desc;
select count(*) as consent_history_rows from public.school_consents;
select organization_id,patient_id,consent_type,count(*) versions from public.school_consents group by organization_id,patient_id,consent_type having count(*)>1;
select organization_id,patient_id,consent_type,count(*) current_versions from public.school_consents where is_current group by organization_id,patient_id,consent_type having count(*)>1;
select status,count(*) from public.school_meetings group by status;
select count(*) as meetings_without_patients from public.school_meetings m where not exists(select 1 from public.school_meeting_patients mp where mp.meeting_id=m.id and mp.participation_status<>'REMOVED');
select meeting_id,count(*) patient_count from public.school_meeting_patients where participation_status<>'REMOVED' group by meeting_id order by patient_count desc;
select meeting_id,count(*) participant_count from public.school_meeting_participants where removed_at is null group by meeting_id order by participant_count desc;
select visibility,count(*) from public.school_meeting_patient_notes where is_current group by visibility;
select status,count(*) from public.school_migration_review_queue group by status;
select status,count(*) from public.school_meeting_referrals group by status;
select count(*) as active_document_links from public.school_document_links where archived_at is null;
select organization_id,normalized_name,city,state,count(*) duplicates from public.schools where archived_at is null group by organization_id,normalized_name,city,state having count(*)>1;
select schemaname,tablename,policyname,cmd,roles from pg_policies where schemaname='public' and (tablename like 'school%' or tablename='patient_school_enrollments') order by tablename,policyname;
select routine_name,grantee,privilege_type from information_schema.routine_privileges where routine_schema='public' and routine_name like '%school%' order by routine_name,grantee;
select tablename,indexname,indexdef from pg_indexes where schemaname='public' and (tablename like 'school%' or tablename='patient_school_enrollments' or tablename='clinics') order by tablename,indexname;
