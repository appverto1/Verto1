-- Structured school management for Verto.
-- Additive, idempotent and preservation-first. No existing data is deleted.
begin;

create extension if not exists pgcrypto;
create extension if not exists unaccent;

create or replace function public.normalize_school_identity(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    trim(regexp_replace(
      regexp_replace(
        lower(unaccent(normalize(coalesce(p_value, ''), NFC))),
        '\m(colegio|colégio|escola|instituto|centro educacional|unidade|campus)\M',
        ' ',
        'g'
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    )),
    ''
  );
$$;

create or replace function public.normalize_school_digits(p_value text)
returns text
language sql
immutable
set search_path = public
as $$ select nullif(regexp_replace(coalesce(p_value, ''), '\D', '', 'g'), ''); $$;

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text,
  legal_name text,
  display_name text not null,
  normalized_name text not null,
  trade_name text,
  school_type text not null default 'OTHER' check (school_type in ('EARLY_CHILDHOOD','ELEMENTARY','HIGH_SCHOOL','SPECIAL_EDUCATION','TECHNICAL','HIGHER_EDUCATION','BILINGUAL','SUPPORT_INSTITUTION','OTHER')),
  education_network text not null default 'OTHER' check (education_network in ('PUBLIC_MUNICIPAL','PUBLIC_STATE','PUBLIC_FEDERAL','PRIVATE','PHILANTHROPIC','PARTNERED','OTHER')),
  tax_id text,
  inep_code text,
  email text,
  phone text,
  whatsapp text,
  website text,
  postal_code text,
  street text,
  street_number text,
  address_complement text,
  district text,
  city text,
  state text,
  country text not null default 'BR',
  notes text,
  responsible_professional_id text,
  is_active boolean not null default true,
  migration_source text,
  legacy_source_value text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.school_units (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  school_id uuid not null references public.schools(id) on delete restrict,
  name text not null,
  normalized_name text not null,
  code text,
  email text,
  phone text,
  whatsapp text,
  postal_code text,
  street text,
  street_number text,
  address_complement text,
  district text,
  city text,
  state text,
  country text not null default 'BR',
  is_active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.school_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  school_id uuid not null references public.schools(id) on delete restrict,
  school_unit_id uuid references public.school_units(id) on delete set null,
  name text not null,
  role text not null default 'OTHER' check (role in ('DIRECTOR','PEDAGOGICAL_COORDINATOR','TEACHER','SCHOOL_MEDIATOR','PSYCHOPEDAGOGUE','COUNSELOR','SECRETARY','SUPPORT_PROFESSIONAL','OTHER')),
  department text,
  email text,
  phone text,
  whatsapp text,
  preferred_contact_method text check (preferred_contact_method is null or preferred_contact_method in ('EMAIL','PHONE','WHATSAPP','OTHER')),
  notes text,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.patient_school_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  school_id uuid not null references public.schools(id) on delete restrict,
  school_unit_id uuid references public.school_units(id) on delete set null,
  academic_year integer,
  grade_level text,
  class_name text,
  shift text check (shift is null or shift in ('MORNING','AFTERNOON','EVENING','FULL_TIME','OTHER')),
  enrollment_code text,
  teacher_contact_id uuid references public.school_contacts(id) on delete set null,
  coordinator_contact_id uuid references public.school_contacts(id) on delete set null,
  is_current boolean not null default true,
  started_at date,
  ended_at date,
  exit_reason text,
  notes text,
  migration_source text,
  legacy_source_value text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or started_at is null or ended_at >= started_at)
);

create table if not exists public.school_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  school_enrollment_id uuid references public.patient_school_enrollments(id) on delete restrict,
  consent_type text not null check (consent_type in ('SCHOOL_CONTACT','CLINICAL_INFORMATION_SHARING','SCHOOL_MEETING_PARTICIPATION','REPORT_SENDING','SCHOOL_DOCUMENT_RECEIVING','IMAGE_RECORDING')),
  status text not null default 'PENDING' check (status in ('AUTHORIZED','PENDING','EXPIRED','REVOKED','NOT_REQUIRED')),
  granted_by_responsible_id text,
  granted_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  document_id text,
  notes text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.school_meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text not null,
  school_id uuid not null references public.schools(id) on delete restrict,
  school_unit_id uuid references public.school_units(id) on delete set null,
  meeting_type text not null default 'SCHOOL_MEETING' check (meeting_type in ('SCHOOL_MEETING','SCHOOL_VISIT','ALIGNMENT','FEEDBACK','CASE_DISCUSSION','STAFF_TRAINING','SCHOOL_OBSERVATION','ADMINISTRATIVE','OTHER')),
  title text not null,
  description text,
  agenda text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  timezone text not null default 'America/Sao_Paulo',
  location_type text not null default 'SCHOOL' check (location_type in ('CLINIC','SCHOOL','ONLINE','OTHER')),
  location text,
  online_meeting_url text,
  status text not null default 'DRAFT' check (status in ('DRAFT','SCHEDULED','CONFIRMED','COMPLETED','CANCELLED','RESCHEDULED','NOT_HELD')),
  created_by text,
  responsible_professional_id text,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  idempotency_key text,
  payload_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scheduled_end is null or scheduled_start is null or scheduled_end > scheduled_start)
);

create table if not exists public.school_meeting_patients (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  meeting_id uuid not null references public.school_meetings(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  school_enrollment_id uuid not null references public.patient_school_enrollments(id) on delete restrict,
  participation_status text not null default 'INVITED' check (participation_status in ('INVITED','CONFIRMED','ATTENDED','ABSENT','REMOVED')),
  consent_status_snapshot jsonb not null default '{}'::jsonb,
  patient_agenda text,
  included_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, patient_id)
);

create table if not exists public.school_meeting_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  meeting_id uuid not null references public.school_meetings(id) on delete restrict,
  participant_type text not null check (participant_type in ('INTERNAL_PROFESSIONAL','FAMILY_RESPONSIBLE','SCHOOL_CONTACT','EXTERNAL_GUEST')),
  professional_id text,
  responsible_id text,
  school_contact_id uuid references public.school_contacts(id) on delete set null,
  external_name text,
  external_email text,
  attendance_status text not null default 'INVITED' check (attendance_status in ('INVITED','CONFIRMED','DECLINED','ATTENDED','ABSENT')),
  invited_at timestamptz,
  confirmed_at timestamptz,
  attended boolean,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(professional_id, responsible_id, school_contact_id, external_name) = 1)
);

create table if not exists public.school_meeting_minutes (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text not null,
  meeting_id uuid not null unique references public.school_meetings(id) on delete restrict,
  actual_start timestamptz,
  actual_end timestamptz,
  general_summary text,
  decisions text,
  referrals text,
  next_meeting_at timestamptz,
  status text not null default 'DRAFT' check (status in ('DRAFT','COMPLETED','REVIEWED')),
  completed_by text,
  completed_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.school_meeting_patient_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text not null,
  meeting_id uuid not null references public.school_meetings(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  note text,
  decisions text,
  referrals text,
  visibility text not null default 'CLINICAL_TEAM' check (visibility in ('CLINICAL_TEAM','AUTHORIZED_FAMILY','AUTHORIZED_SCHOOL')),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, patient_id)
);

create table if not exists public.school_document_links (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text,
  school_id uuid references public.schools(id) on delete restrict,
  school_unit_id uuid references public.school_units(id) on delete set null,
  patient_id uuid references public.patients(id) on delete restrict,
  meeting_id uuid references public.school_meetings(id) on delete restrict,
  document_id text not null,
  document_type text not null default 'OTHER' check (document_type in ('SCHOOL_DECLARATION','PEDAGOGICAL_REPORT','PDI','SCHOOL_PEI','REPORT_CARD','EDUCATIONAL_PLAN','MEETING_MINUTES','CONSENT','REFERRAL','CLINIC_REPORT','OTHER')),
  visibility text not null default 'INTERNAL' check (visibility in ('INTERNAL','AUTHORIZED_FAMILY','AUTHORIZED_SCHOOL')),
  document_date date,
  created_by text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(school_id, patient_id, meeting_id) >= 1)
);

create table if not exists public.school_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text,
  actor_id text,
  resource_type text not null,
  resource_id text not null,
  action text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  reason text,
  idempotency_key text,
  created_at timestamptz not null default now()
);

create table if not exists public.school_migration_review_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  clinic_id text,
  patient_id uuid references public.patients(id) on delete restrict,
  original_value text not null,
  normalized_value text,
  candidate_school_ids uuid[] not null default '{}'::uuid[],
  status text not null default 'PENDING' check (status in ('PENDING','RESOLVED','IGNORED')),
  resolution_notes text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.school_idempotency_records (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  operation text not null,
  idempotency_key text not null,
  payload_hash text not null,
  resource_type text not null,
  resource_id text,
  response_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, operation, idempotency_key)
);

create unique index if not exists idx_schools_tax_id_unique on public.schools (organization_id, tax_id) where tax_id is not null and archived_at is null;
create unique index if not exists idx_schools_inep_unique on public.schools (organization_id, inep_code) where inep_code is not null and archived_at is null;
create index if not exists idx_schools_search on public.schools (organization_id, is_active, normalized_name, city, state);
create index if not exists idx_school_units_school on public.school_units (organization_id, school_id, is_active, normalized_name);
create index if not exists idx_school_contacts_school on public.school_contacts (organization_id, school_id, school_unit_id, is_active);
create unique index if not exists idx_school_primary_contact on public.school_contacts (organization_id, school_id, coalesce(school_unit_id, '00000000-0000-0000-0000-000000000000'::uuid), role) where is_primary and is_active;
create index if not exists idx_enrollments_patient on public.patient_school_enrollments (organization_id, patient_id, is_current, academic_year desc);
create index if not exists idx_enrollments_school on public.patient_school_enrollments (organization_id, school_id, school_unit_id, is_current, academic_year desc);
create unique index if not exists idx_enrollment_single_current on public.patient_school_enrollments (organization_id, patient_id) where is_current;
create index if not exists idx_school_consents_patient on public.school_consents (organization_id, patient_id, status, consent_type, expires_at);
create index if not exists idx_school_meetings_list on public.school_meetings (organization_id, school_id, school_unit_id, status, scheduled_start desc);
create unique index if not exists idx_school_meetings_idempotency on public.school_meetings (organization_id, idempotency_key) where idempotency_key is not null;
create index if not exists idx_school_meeting_patients_patient on public.school_meeting_patients (organization_id, patient_id, meeting_id);
create index if not exists idx_school_meeting_participants_meeting on public.school_meeting_participants (organization_id, meeting_id, participant_type);
create index if not exists idx_school_patient_notes_patient on public.school_meeting_patient_notes (organization_id, patient_id, created_at desc);
create index if not exists idx_school_documents_scope on public.school_document_links (organization_id, school_id, patient_id, meeting_id, document_date desc);
create unique index if not exists idx_school_audit_idempotency on public.school_audit_events (organization_id, idempotency_key) where idempotency_key is not null;

create or replace function public.school_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end; $$;

do $$ declare t text; begin
  foreach t in array array['schools','school_units','school_contacts','patient_school_enrollments','school_consents','school_meetings','school_meeting_patients','school_meeting_participants','school_meeting_minutes','school_meeting_patient_notes'] loop
    execute format('drop trigger if exists %I_touch_updated_at on public.%I', t, t);
    execute format('create trigger %I_touch_updated_at before update on public.%I for each row execute function public.school_touch_updated_at()', t, t);
  end loop;
end $$;

create or replace function public.create_school_meeting_batch(
  p_organization_id text,
  p_clinic_id text,
  p_actor_id text,
  p_school_id uuid,
  p_school_unit_id uuid,
  p_patient_ids uuid[],
  p_title text,
  p_meeting_type text,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_timezone text,
  p_location_type text,
  p_location text,
  p_online_meeting_url text,
  p_agenda text,
  p_responsible_professional_id text,
  p_status text,
  p_idempotency_key text,
  p_payload_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.school_idempotency_records%rowtype;
  v_meeting public.school_meetings%rowtype;
  v_count integer;
  v_consent jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_organization_id is null or p_school_id is null or coalesce(array_length(p_patient_ids,1),0)=0 then raise exception 'INVALID_PAYLOAD'; end if;
  if not exists (select 1 from public.users u where u.id=auth.uid() and (u.clinic_id::text=p_organization_id or u.id::text=p_organization_id) and u.role in ('owner','admin','coordinator','receptionist','therapist')) then raise exception 'ACCESS_DENIED'; end if;
  select * into v_existing from public.school_idempotency_records where organization_id=p_organization_id and operation='CREATE_SCHOOL_MEETING_BATCH' and idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.payload_hash <> p_payload_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return v_existing.response_payload;
  end if;
  if not exists (select 1 from public.schools s where s.id=p_school_id and s.organization_id=p_organization_id and s.archived_at is null) then raise exception 'SCHOOL_NOT_FOUND'; end if;
  if p_school_unit_id is not null and not exists (select 1 from public.school_units su where su.id=p_school_unit_id and su.school_id=p_school_id and su.organization_id=p_organization_id and su.archived_at is null) then raise exception 'SCHOOL_UNIT_NOT_FOUND'; end if;
  select count(*) into v_count
  from unnest(p_patient_ids) selected(patient_id)
  join public.patients p on p.id=selected.patient_id and p.clinic_id::text=p_organization_id
  join public.patient_school_enrollments e on e.patient_id=p.id and e.organization_id=p_organization_id and e.school_id=p_school_id and e.is_current
  where p_school_unit_id is null or e.school_unit_id=p_school_unit_id;
  if v_count <> cardinality(p_patient_ids) then raise exception 'PATIENT_SCHOOL_SCOPE_MISMATCH'; end if;
  insert into public.school_meetings(organization_id,clinic_id,school_id,school_unit_id,title,meeting_type,scheduled_start,scheduled_end,timezone,location_type,location,online_meeting_url,agenda,responsible_professional_id,status,created_by,idempotency_key,payload_hash)
  values(p_organization_id,p_clinic_id,p_school_id,p_school_unit_id,left(trim(p_title),200),p_meeting_type,p_scheduled_start,p_scheduled_end,coalesce(nullif(p_timezone,''),'America/Sao_Paulo'),p_location_type,left(p_location,300),left(p_online_meeting_url,500),left(p_agenda,10000),p_responsible_professional_id,p_status,p_actor_id,p_idempotency_key,p_payload_hash)
  returning * into v_meeting;
  insert into public.school_meeting_patients(organization_id,meeting_id,patient_id,school_enrollment_id,consent_status_snapshot,included_by)
  select p_organization_id,v_meeting.id,p.id,e.id,
    coalesce((select jsonb_object_agg(c.consent_type,c.status) from public.school_consents c where c.organization_id=p_organization_id and c.patient_id=p.id and (c.school_enrollment_id=e.id or c.school_enrollment_id is null) and c.status in ('AUTHORIZED','PENDING','EXPIRED','REVOKED','NOT_REQUIRED')),'{}'::jsonb),p_actor_id
  from unnest(p_patient_ids) selected(patient_id)
  join public.patients p on p.id=selected.patient_id
  join public.patient_school_enrollments e on e.patient_id=p.id and e.organization_id=p_organization_id and e.school_id=p_school_id and e.is_current and (p_school_unit_id is null or e.school_unit_id=p_school_unit_id);
  insert into public.school_audit_events(organization_id,clinic_id,actor_id,resource_type,resource_id,action,after_state,idempotency_key)
  values(p_organization_id,p_clinic_id,p_actor_id,'SCHOOL_MEETING',v_meeting.id::text,'MEETING_CREATED',jsonb_build_object('schoolId',p_school_id,'patientCount',cardinality(p_patient_ids),'status',p_status),p_idempotency_key||':audit');
  v_consent := jsonb_build_object('success',true,'meeting',to_jsonb(v_meeting),'patientCount',cardinality(p_patient_ids));
  insert into public.school_idempotency_records(organization_id,operation,idempotency_key,payload_hash,resource_type,resource_id,response_payload)
  values(p_organization_id,'CREATE_SCHOOL_MEETING_BATCH',p_idempotency_key,p_payload_hash,'SCHOOL_MEETING',v_meeting.id::text,v_consent);
  return v_consent;
end;
$$;

revoke all on function public.create_school_meeting_batch(text,text,text,uuid,uuid,uuid[],text,text,timestamptz,timestamptz,text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.create_school_meeting_batch(text,text,text,uuid,uuid,uuid[],text,text,timestamptz,timestamptz,text,text,text,text,text,text,text,text,text) to authenticated;

-- RLS: explicit tenant-scoped policies. Backend still validates role and resource relationships.
do $$ declare t text; begin
  foreach t in array array['schools','school_units','school_contacts','patient_school_enrollments','school_consents','school_meetings','school_meeting_patients','school_meeting_participants','school_meeting_minutes','school_meeting_patient_notes','school_document_links','school_audit_events','school_migration_review_queue','school_idempotency_records'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (exists (select 1 from public.users u where u.id=auth.uid() and (u.clinic_id::text=%I.organization_id or u.id::text=%I.organization_id)))', t, t, t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (exists (select 1 from public.users u where u.id=auth.uid() and (u.clinic_id::text=%I.organization_id or u.id::text=%I.organization_id) and u.role in (''owner'',''admin'',''coordinator'',''receptionist'',''therapist'')))', t, t, t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (exists (select 1 from public.users u where u.id=auth.uid() and (u.clinic_id::text=%I.organization_id or u.id::text=%I.organization_id))) with check (exists (select 1 from public.users u where u.id=auth.uid() and (u.clinic_id::text=%I.organization_id or u.id::text=%I.organization_id) and u.role in (''owner'',''admin'',''coordinator'',''receptionist'',''therapist'')))', t, t, t, t, t, t);
  end loop;
end $$;


-- Tighten write permissions by domain. Administrative catalogs and links are not writable by therapists.
do $$ declare t text; begin
  foreach t in array array['schools','school_units','school_contacts','patient_school_enrollments','school_migration_review_queue'] loop
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (exists (select 1 from public.users u where u.id=auth.uid() and (u.clinic_id::text=%I.organization_id or u.id::text=%I.organization_id) and u.role in (''owner'',''admin'',''coordinator'',''receptionist'')))', t, t, t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (exists (select 1 from public.users u where u.id=auth.uid() and (u.clinic_id::text=%I.organization_id or u.id::text=%I.organization_id) and u.role in (''owner'',''admin'',''coordinator'',''receptionist''))) with check (exists (select 1 from public.users u where u.id=auth.uid() and (u.clinic_id::text=%I.organization_id or u.id::text=%I.organization_id) and u.role in (''owner'',''admin'',''coordinator'',''receptionist'')))', t, t, t, t, t, t);
  end loop;
end $$;

-- Preserve legacy free-text school fields without guessing institution, city or unit.
-- Values are placed in a tenant-scoped review queue; no existing patient field is changed.
do $$
declare
  v_column text;
  v_sql text;
begin
  select column_name into v_column
  from information_schema.columns
  where table_schema='public' and table_name='patients' and column_name in ('school_name','school','educational_institution')
  order by case column_name when 'school_name' then 1 when 'school' then 2 else 3 end
  limit 1;
  if v_column is not null then
    v_sql := format($fmt$
      insert into public.school_migration_review_queue(organization_id,clinic_id,patient_id,original_value,normalized_value,status)
      select p.clinic_id::text,p.clinic_id::text,p.id,left(trim(p.%I::text),500),public.normalize_school_identity(p.%I::text),'PENDING'
      from public.patients p
      where nullif(trim(p.%I::text),'') is not null
        and not exists (
          select 1 from public.school_migration_review_queue q
          where q.organization_id=p.clinic_id::text and q.patient_id=p.id and q.original_value=left(trim(p.%I::text),500)
        )
    $fmt$,v_column,v_column,v_column,v_column);
    execute v_sql;
  end if;
end $$;

-- Physical deletes are intentionally unavailable to authenticated users.
do $$ declare t text; begin
  foreach t in array array['schools','school_units','school_contacts','patient_school_enrollments','school_consents','school_meetings','school_meeting_patients','school_meeting_participants','school_meeting_minutes','school_meeting_patient_notes','school_document_links','school_audit_events','school_migration_review_queue','school_idempotency_records'] loop
    execute format('revoke delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

commit;

-- POST-MIGRATION READ-ONLY VALIDATION QUERIES
-- 1-6 totals and enrollment history
select count(*) as total_schools from public.schools;
select count(*) as total_units from public.school_units;
select count(*) as total_contacts from public.school_contacts;
select count(*) as total_enrollments from public.patient_school_enrollments;
select count(*) as current_enrollments from public.patient_school_enrollments where is_current;
select count(*) as historical_enrollments from public.patient_school_enrollments where not is_current;
-- 7 patients without school
select count(*) as patients_without_school from public.patients p where not exists (select 1 from public.patient_school_enrollments e where e.patient_id=p.id and e.is_current);
-- 8 conflicting current links
select organization_id,patient_id,count(*) from public.patient_school_enrollments where is_current group by organization_id,patient_id having count(*)>1;
-- 9 potential duplicate schools
select organization_id,normalized_name,city,state,count(*),array_agg(id) from public.schools where archived_at is null group by organization_id,normalized_name,city,state having count(*)>1;
-- 10-13 distributions
select organization_id,city,count(*) from public.schools group by organization_id,city order by count(*) desc;
select organization_id,education_network,count(*) from public.schools group by organization_id,education_network;
select organization_id,count(*) from public.schools group by organization_id;
select e.organization_id,e.school_id,s.display_name,count(distinct e.patient_id) from public.patient_school_enrollments e join public.schools s on s.id=e.school_id where e.is_current group by e.organization_id,e.school_id,s.display_name order by count(*) desc;
-- 14-19 consents and meetings
select organization_id,status,count(*) from public.school_consents group by organization_id,status;
select organization_id,status,count(*) from public.school_meetings group by organization_id,status;
select * from public.school_meetings where scheduled_start>=now() and status in ('SCHEDULED','CONFIRMED') order by scheduled_start;
select m.* from public.school_meetings m left join public.school_meeting_minutes mm on mm.meeting_id=m.id where m.status='COMPLETED' and (mm.id is null or mm.status='DRAFT');
select meeting_id,count(*) as patient_count from public.school_meeting_patients where participation_status<>'REMOVED' group by meeting_id;
select mp.meeting_id,array_agg(distinct e.school_id) schools from public.school_meeting_patients mp join public.patient_school_enrollments e on e.id=mp.school_enrollment_id group by mp.meeting_id having count(distinct e.school_id)>1;
-- 20-21 missing tenant and orphan references
select 'schools' source,count(*) from public.schools where organization_id is null union all select 'enrollments',count(*) from public.patient_school_enrollments where organization_id is null union all select 'meetings',count(*) from public.school_meetings where organization_id is null;
select 'unit_without_school' issue,count(*) from public.school_units u left join public.schools s on s.id=u.school_id where s.id is null union all select 'enrollment_without_patient',count(*) from public.patient_school_enrollments e left join public.patients p on p.id=e.patient_id where p.id is null;
-- 22-24 RLS, grants and indexes
select schemaname,tablename,policyname,cmd from pg_policies where schemaname='public' and tablename like 'school%' or tablename='patient_school_enrollments' order by tablename,policyname;
select routine_name,grantee,privilege_type from information_schema.routine_privileges where routine_schema='public' and routine_name like '%school%';
select tablename,indexname,indexdef from pg_indexes where schemaname='public' and (tablename like 'school%' or tablename='patient_school_enrollments') order by tablename,indexname;
-- 25-30 migration review, audits, tasks/docs references and clinic distribution
select migration_source,count(*) from public.patient_school_enrollments group by migration_source;
select status,count(*) from public.school_migration_review_queue group by status;
select action,count(*) from public.school_audit_events group by action order by count(*) desc;
select count(*) as task_reference_events from public.school_audit_events where action='TASK_CREATED';
select document_type,count(*) from public.school_document_links group by document_type;
select clinic_id,count(*) from public.patient_school_enrollments group by clinic_id;
