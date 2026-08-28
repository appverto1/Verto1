-- Patient evolution external timeline v1.
-- Monthly clinical summaries with up to three independent items per month.
-- External links are locators only: access requires an active e-mail grant + OTP.

begin;

create extension if not exists pgcrypto;

create table if not exists public.patient_evolution_timeline_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  month_key date not null,
  slot smallint not null,
  subject text not null,
  content text null,
  patient_file_id uuid null references public.patient_files(id) on delete set null,
  created_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  constraint patient_evolution_timeline_month_first_day_chk
    check (month_key = date_trunc('month', month_key::timestamp)::date),
  constraint patient_evolution_timeline_slot_chk
    check (slot between 1 and 3),
  constraint patient_evolution_timeline_subject_length_chk
    check (char_length(btrim(subject)) between 1 and 180),
  constraint patient_evolution_timeline_content_length_chk
    check (content is null or char_length(content) <= 12000),
  constraint patient_evolution_timeline_payload_chk
    check (
      archived_at is not null
      or nullif(btrim(coalesce(content, '')), '') is not null
      or patient_file_id is not null
    )
);

create unique index if not exists patient_evolution_timeline_active_slot_uidx
  on public.patient_evolution_timeline_items (clinic_id, patient_id, month_key, slot)
  where archived_at is null;

create unique index if not exists patient_evolution_timeline_active_file_uidx
  on public.patient_evolution_timeline_items (patient_file_id)
  where archived_at is null and patient_file_id is not null;

create index if not exists patient_evolution_timeline_patient_month_idx
  on public.patient_evolution_timeline_items (clinic_id, patient_id, month_key desc, slot)
  where archived_at is null;

create table if not exists public.patient_evolution_share_grants (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid(),
  timeline_item_id uuid not null references public.patient_evolution_timeline_items(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  recipient_email text not null,
  status text not null default 'ACTIVE',
  purpose text not null default 'CONTINUITY_OF_CARE',
  authorization_statement_version text not null default 'external_share_v1',
  authorization_declared_by uuid null,
  authorization_declared_at timestamptz not null default now(),
  created_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_invited_at timestamptz null,
  revoked_at timestamptz null,
  revoked_by_user_id uuid null,
  constraint patient_evolution_share_grants_public_id_uidx unique (public_id),
  constraint patient_evolution_share_grants_email_length_chk
    check (char_length(btrim(recipient_email)) between 3 and 254),
  constraint patient_evolution_share_grants_status_chk
    check (status in ('ACTIVE', 'REVOKED')),
  constraint patient_evolution_share_grants_purpose_chk
    check (purpose in ('CONTINUITY_OF_CARE'))
);

create unique index if not exists patient_evolution_share_grants_item_email_uidx
  on public.patient_evolution_share_grants (timeline_item_id, lower(recipient_email));

create index if not exists patient_evolution_share_grants_patient_idx
  on public.patient_evolution_share_grants (clinic_id, patient_id, timeline_item_id, status);

create index if not exists patient_evolution_share_grants_public_lookup_idx
  on public.patient_evolution_share_grants (public_id, status);

create table if not exists public.patient_evolution_external_access_audit (
  id bigint generated always as identity primary key,
  grant_id uuid null references public.patient_evolution_share_grants(id) on delete set null,
  timeline_item_id uuid null references public.patient_evolution_timeline_items(id) on delete set null,
  clinic_id uuid null,
  patient_id uuid null,
  recipient_email text null,
  action text not null,
  request_ip_hash text null,
  user_agent_hash text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint patient_evolution_external_audit_action_chk
    check (action in ('INVITE_SENT','OTP_REQUESTED','OTP_VERIFIED','VIEWED','FILE_ACCESSED','REVOKED','ITEM_ARCHIVED'))
);

create index if not exists patient_evolution_external_audit_grant_idx
  on public.patient_evolution_external_access_audit (grant_id, created_at desc);

create index if not exists patient_evolution_external_audit_patient_idx
  on public.patient_evolution_external_access_audit (clinic_id, patient_id, created_at desc);

create or replace function public.set_patient_evolution_timeline_updated_at_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists patient_evolution_timeline_updated_at_v1 on public.patient_evolution_timeline_items;
create trigger patient_evolution_timeline_updated_at_v1
before update on public.patient_evolution_timeline_items
for each row execute function public.set_patient_evolution_timeline_updated_at_v1();

drop trigger if exists patient_evolution_share_grants_updated_at_v1 on public.patient_evolution_share_grants;
create trigger patient_evolution_share_grants_updated_at_v1
before update on public.patient_evolution_share_grants
for each row execute function public.set_patient_evolution_timeline_updated_at_v1();

create or replace function public.create_patient_evolution_timeline_item_v1(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_month_key date,
  p_subject text,
  p_content text,
  p_patient_file_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_month date := date_trunc('month', p_month_key::timestamp)::date;
  v_subject text := btrim(coalesce(p_subject, ''));
  v_content text := nullif(btrim(coalesce(p_content, '')), '');
  v_slot smallint;
  v_id uuid;
begin
  if p_clinic_id is null or p_patient_id is null or p_month_key is null then
    raise exception 'EVOLUTION_TIMELINE_SCOPE_REQUIRED';
  end if;
  if char_length(v_subject) < 1 or char_length(v_subject) > 180 then
    raise exception 'EVOLUTION_TIMELINE_SUBJECT_INVALID';
  end if;
  if v_content is not null and char_length(v_content) > 12000 then
    raise exception 'EVOLUTION_TIMELINE_CONTENT_TOO_LONG';
  end if;
  if v_content is null and p_patient_file_id is null then
    raise exception 'EVOLUTION_TIMELINE_CONTENT_OR_FILE_REQUIRED';
  end if;

  perform 1
  from public.patients patient
  where patient.id = p_patient_id
    and patient.clinic_id = p_clinic_id
    and coalesce(patient.is_active, true)
    and patient.deleted_at is null;
  if not found then
    raise exception 'EVOLUTION_TIMELINE_PATIENT_SCOPE_INVALID';
  end if;

  if p_patient_file_id is not null then
    perform 1
    from public.patient_files file
    where file.id = p_patient_file_id
      and file.patient_id = p_patient_id
      and file.clinic_id = p_clinic_id;
    if not found then
      raise exception 'EVOLUTION_TIMELINE_FILE_SCOPE_INVALID';
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_clinic_id::text || ':' || p_patient_id::text || ':' || v_month::text, 0)
  );

  select candidate.slot::smallint
  into v_slot
  from generate_series(1, 3) as candidate(slot)
  where not exists (
    select 1
    from public.patient_evolution_timeline_items item
    where item.clinic_id = p_clinic_id
      and item.patient_id = p_patient_id
      and item.month_key = v_month
      and item.slot = candidate.slot
      and item.archived_at is null
  )
  order by candidate.slot
  limit 1;

  if v_slot is null then
    raise exception 'EVOLUTION_TIMELINE_MONTH_LIMIT';
  end if;

  insert into public.patient_evolution_timeline_items (
    clinic_id, patient_id, month_key, slot, subject, content, patient_file_id, created_by_user_id
  ) values (
    p_clinic_id, p_patient_id, v_month, v_slot, v_subject, v_content, p_patient_file_id, p_actor_id
  ) returning id into v_id;

  return jsonb_build_object('id', v_id, 'slot', v_slot, 'monthKey', v_month);
end;
$function$;

create or replace function public.archive_patient_evolution_timeline_item_v1(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_item_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_item public.patient_evolution_timeline_items%rowtype;
  v_revoked integer := 0;
begin
  select * into v_item
  from public.patient_evolution_timeline_items item
  where item.id = p_item_id
    and item.clinic_id = p_clinic_id
    and item.patient_id = p_patient_id
    and item.archived_at is null
  for update;

  if not found then
    raise exception 'EVOLUTION_TIMELINE_ITEM_NOT_FOUND';
  end if;

  update public.patient_evolution_timeline_items
  set archived_at = now(), updated_at = now()
  where id = p_item_id;

  update public.patient_evolution_share_grants
  set status = 'REVOKED', revoked_at = now(), revoked_by_user_id = p_actor_id, updated_at = now()
  where timeline_item_id = p_item_id
    and status = 'ACTIVE';
  get diagnostics v_revoked = row_count;

  return jsonb_build_object('id', p_item_id, 'archived', true, 'revokedGrantCount', v_revoked);
end;
$function$;

create or replace function public.upsert_patient_evolution_share_grant_v1(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_item_id uuid,
  p_recipient_email text,
  p_actor_id uuid,
  p_authorization_statement_version text default 'external_share_v1'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_email text := lower(btrim(coalesce(p_recipient_email, '')));
  v_grant public.patient_evolution_share_grants%rowtype;
  v_public_id uuid := gen_random_uuid();
begin
  if v_email = '' or char_length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'EVOLUTION_SHARE_EMAIL_INVALID';
  end if;

  perform 1
  from public.patient_evolution_timeline_items item
  where item.id = p_item_id
    and item.clinic_id = p_clinic_id
    and item.patient_id = p_patient_id
    and item.archived_at is null
  for share;
  if not found then
    raise exception 'EVOLUTION_TIMELINE_ITEM_NOT_FOUND';
  end if;

  select * into v_grant
  from public.patient_evolution_share_grants grant_row
  where grant_row.timeline_item_id = p_item_id
    and lower(grant_row.recipient_email) = v_email
  for update;

  if found then
    -- An already-active grant keeps its locator stable. Re-authorizing a revoked
    -- recipient rotates the locator so every previously distributed URL stays dead.
    if v_grant.status = 'ACTIVE' then
      v_public_id := v_grant.public_id;
    end if;
    update public.patient_evolution_share_grants
    set public_id = v_public_id,
        recipient_email = v_email,
        status = 'ACTIVE',
        purpose = 'CONTINUITY_OF_CARE',
        authorization_statement_version = coalesce(nullif(btrim(p_authorization_statement_version), ''), 'external_share_v1'),
        authorization_declared_by = p_actor_id,
        authorization_declared_at = now(),
        created_by_user_id = coalesce(created_by_user_id, p_actor_id),
        revoked_at = null,
        revoked_by_user_id = null,
        updated_at = now()
    where id = v_grant.id
    returning * into v_grant;
  else
    insert into public.patient_evolution_share_grants (
      public_id, timeline_item_id, clinic_id, patient_id, recipient_email,
      status, purpose, authorization_statement_version,
      authorization_declared_by, authorization_declared_at, created_by_user_id
    ) values (
      v_public_id, p_item_id, p_clinic_id, p_patient_id, v_email,
      'ACTIVE', 'CONTINUITY_OF_CARE', coalesce(nullif(btrim(p_authorization_statement_version), ''), 'external_share_v1'),
      p_actor_id, now(), p_actor_id
    ) returning * into v_grant;
  end if;

  return jsonb_build_object(
    'id', v_grant.id,
    'publicId', v_grant.public_id,
    'recipientEmail', v_grant.recipient_email,
    'status', v_grant.status,
    'authorizationDeclaredAt', v_grant.authorization_declared_at
  );
end;
$function$;

create or replace function public.revoke_patient_evolution_share_grant_v1(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_item_id uuid,
  p_grant_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_public_id uuid;
begin
  update public.patient_evolution_share_grants grant_row
  set status = 'REVOKED',
      revoked_at = now(),
      revoked_by_user_id = p_actor_id,
      updated_at = now()
  where grant_row.id = p_grant_id
    and grant_row.timeline_item_id = p_item_id
    and grant_row.clinic_id = p_clinic_id
    and grant_row.patient_id = p_patient_id
    and grant_row.status = 'ACTIVE'
  returning public_id into v_public_id;

  if v_public_id is null then
    raise exception 'EVOLUTION_SHARE_GRANT_NOT_FOUND';
  end if;

  return jsonb_build_object('id', p_grant_id, 'publicId', v_public_id, 'status', 'REVOKED');
end;
$function$;

alter table public.patient_evolution_timeline_items enable row level security;
alter table public.patient_evolution_share_grants enable row level security;
alter table public.patient_evolution_external_access_audit enable row level security;

revoke all on table public.patient_evolution_timeline_items from public, anon, authenticated;
revoke all on table public.patient_evolution_share_grants from public, anon, authenticated;
revoke all on table public.patient_evolution_external_access_audit from public, anon, authenticated;

grant select, insert, update, delete on table public.patient_evolution_timeline_items to service_role;
grant select, insert, update, delete on table public.patient_evolution_share_grants to service_role;
grant select, insert on table public.patient_evolution_external_access_audit to service_role;

revoke all on function public.set_patient_evolution_timeline_updated_at_v1() from public, anon, authenticated;
revoke all on function public.create_patient_evolution_timeline_item_v1(uuid, uuid, date, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.archive_patient_evolution_timeline_item_v1(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.upsert_patient_evolution_share_grant_v1(uuid, uuid, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.revoke_patient_evolution_share_grant_v1(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.create_patient_evolution_timeline_item_v1(uuid, uuid, date, text, text, uuid, uuid) to service_role;
grant execute on function public.archive_patient_evolution_timeline_item_v1(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.upsert_patient_evolution_share_grant_v1(uuid, uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.revoke_patient_evolution_share_grant_v1(uuid, uuid, uuid, uuid, uuid) to service_role;

-- Reuse the existing distributed OTP infrastructure for external clinical share access.
alter table if exists public.otp_challenges
  drop constraint if exists otp_challenges_purpose_check;
alter table if exists public.otp_challenges
  add constraint otp_challenges_purpose_check
  check (purpose in ('password_recovery', 'phone_verification', 'portal_login', 'external_clinical_share'));

comment on table public.patient_evolution_timeline_items is
  'Monthly clinical-sharing timeline. Up to three active items per patient/month. Subject label is UI-neutral and may be renamed without schema migration.';
comment on table public.patient_evolution_share_grants is
  'Explicit external recipient grants. public_id only locates a grant; it is never sufficient for access without recipient e-mail OTP authentication.';
comment on table public.patient_evolution_external_access_audit is
  'PHI-minimal audit trail for external evolution-sharing authentication and access.';

notify pgrst, 'reload schema';

commit;
