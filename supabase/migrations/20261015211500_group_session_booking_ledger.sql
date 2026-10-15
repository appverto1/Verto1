-- Canonical identity and idempotency ledger for ONE collective appointment slot.
-- Draft foundation only: the transactional booking/finance RPC must be completed
-- before this migration is applied or routes are enabled.
begin;

create table if not exists public.group_session_bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  booking_key text not null,
  payload_hash text not null,
  specialty text not null,
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz not null,
  room_id uuid not null references public.clinic_rooms(id) on delete restrict,
  professional_ids uuid[] not null,
  status text not null default 'RESERVED',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_session_booking_key_valid check (length(booking_key) between 12 and 120 and booking_key ~ '^[A-Za-z0-9:._-]+$'),
  constraint group_session_booking_hash_valid check (payload_hash ~ '^[a-f0-9]{64}$'),
  constraint group_session_booking_specialty_valid check (length(btrim(specialty)) between 2 and 120),
  constraint group_session_booking_time_valid check (scheduled_end_at > scheduled_start_at and scheduled_end_at <= scheduled_start_at + interval '360 minutes'),
  constraint group_session_booking_team_size_valid check (cardinality(professional_ids) between 1 and 8),
  constraint group_session_booking_status_valid check (status in ('RESERVED','COMPLETED','CANCELED')),
  constraint group_session_booking_idempotent unique (organization_id,booking_key),
  constraint group_session_booking_tenant_key unique (id,organization_id)
);

-- The booking header must never bind a room or professional from another
-- clinic. Its identity/slot is immutable; rescheduling will require its own
-- atomic operation, not arbitrary edits of the ledger row.
create or replace function public.verify_group_session_booking_v1()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $
declare
  v_capacity integer;
  v_team_count integer;
  v_authorized_count integer;
begin
  if tg_op = 'UPDATE' and (
      old.organization_id is distinct from new.organization_id or
      old.booking_key is distinct from new.booking_key or
      old.payload_hash is distinct from new.payload_hash or
      old.specialty is distinct from new.specialty or
      old.room_id is distinct from new.room_id or
      old.scheduled_start_at is distinct from new.scheduled_start_at or
      old.scheduled_end_at is distinct from new.scheduled_end_at or
      old.professional_ids is distinct from new.professional_ids or
      old.created_by is distinct from new.created_by
  ) then raise exception 'GROUP_BOOKING_SLOT_IMMUTABLE'; end if;
  -- Cancellation/completion must remain possible after a room or member is
  -- deactivated. Only INSERT needs current availability/membership checks.
  if tg_op = 'UPDATE' then return new; end if;

  select room.capacity into v_capacity
  from public.clinic_rooms room
  where room.id = new.room_id
    and room.clinic_id = new.organization_id
    and room.is_active = true;
  if v_capacity is null or v_capacity < 2 then
    raise exception 'GROUP_BOOKING_ROOM_SCOPE_INVALID';
  end if;
  if not exists (
    select 1 from public.clinic_memberships actor_membership
    where actor_membership.clinic_id = new.organization_id
      and actor_membership.user_id = new.created_by
      and lower(actor_membership.status) = 'active'
  ) then raise exception 'GROUP_BOOKING_ACTOR_SCOPE_INVALID'; end if;

  select count(distinct requested_id)::integer into v_team_count
  from unnest(new.professional_ids) requested_id;
  if v_team_count <> cardinality(new.professional_ids) then
    raise exception 'GROUP_BOOKING_TEAM_DUPLICATED';
  end if;

  select count(distinct membership.user_id)::integer into v_authorized_count
  from public.clinic_memberships membership
  where membership.clinic_id = new.organization_id
    and membership.user_id = any(new.professional_ids)
    and lower(membership.status) = 'active'
    and lower(membership.role) = 'therapist'
    and public.appointment_financial_service_key_v1(membership.specialty)
      = public.appointment_financial_service_key_v1(new.specialty);
  if v_authorized_count <> cardinality(new.professional_ids) then
    raise exception 'GROUP_BOOKING_PROFESSIONAL_SCOPE_INVALID';
  end if;
  return new;
end;
$;

drop trigger if exists group_booking_verify_scope on public.group_session_bookings;
create trigger group_booking_verify_scope
before insert or update on public.group_session_bookings
for each row execute function public.verify_group_session_booking_v1();

-- A record per patient connects the collective booking to the existing
-- independently auditable clinical appointment and its frozen patient rate.
create table if not exists public.group_session_participants (
  booking_id uuid not null,
  organization_id uuid not null,
  patient_id uuid not null references public.patients(id) on delete restrict,
  appointment_id uuid not null unique references public.appointments(id) on delete restrict,
  financial_plan_id uuid not null references public.patient_financial_plans(id) on delete restrict,
  unit_amount_cents integer not null,
  created_at timestamptz not null default now(),
  constraint group_session_participant_booking_scope foreign key (booking_id,organization_id)
    references public.group_session_bookings(id,organization_id) on delete restrict,
  constraint group_session_participant_amount_valid check (unit_amount_cents between 1 and 1000000000),
  constraint group_session_participant_one_per_patient primary key (booking_id,patient_id)
);

-- Backend validation is mandatory, but cross-tenant and mismatched appointment
-- references must also fail in the database, not just in TypeScript.
create or replace function public.verify_group_session_participant_v1()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_booking public.group_session_bookings%rowtype;
  v_room_capacity integer;
  v_participant_count integer;
begin
  select * into v_booking
  from public.group_session_bookings
  where id = new.booking_id and organization_id = new.organization_id
  for update;
  if not found or v_booking.status <> 'RESERVED' then
    raise exception 'GROUP_PARTICIPANT_BOOKING_SCOPE_INVALID';
  end if;

  -- All joins of a booking serialize on the same header lock.
  select room.capacity into v_room_capacity from public.clinic_rooms room
  where room.id=v_booking.room_id and room.clinic_id=new.organization_id and room.is_active=true;
  if v_room_capacity is null or v_room_capacity < 2 then
    raise exception 'GROUP_PARTICIPANT_ROOM_UNAVAILABLE';
  end if;
  select count(*)::integer into v_participant_count
  from public.group_session_participants existing where existing.booking_id=new.booking_id;
  if v_participant_count >= 30 then
    raise exception 'GROUP_PARTICIPANT_CAPACITY_EXCEEDED';
  end if;
  if v_participant_count >= v_room_capacity then
    raise exception 'GROUP_PARTICIPANT_ROOM_CAPACITY_EXCEEDED';
  end if;

  if not exists (
    select 1 from public.patients patient
    where patient.id = new.patient_id and patient.clinic_id = new.organization_id
  ) then raise exception 'GROUP_PARTICIPANT_PATIENT_SCOPE_INVALID'; end if;

  if not exists (
    select 1 from public.patient_financial_plans plan
    where plan.id = new.financial_plan_id
      and plan.organization_id = new.organization_id
      and plan.patient_id = new.patient_id
      and plan.billing_mode = 'PRIVATE'
      and plan.status = 'ACTIVE'
      and public.appointment_financial_service_key_v1(
        coalesce(nullif(plan.service_name_snapshot,''),nullif(plan.custom_service_name,''),plan.service_type)
      ) = public.appointment_financial_service_key_v1(v_booking.specialty)
      and plan.group_amount_cents = new.unit_amount_cents
      and plan.valid_from <= v_booking.scheduled_start_at
      and (plan.valid_until is null or v_booking.scheduled_start_at < plan.valid_until)
  ) then raise exception 'GROUP_PARTICIPANT_RATE_SCOPE_INVALID'; end if;

  if not exists (
    select 1 from public.appointments appointment
    where appointment.id = new.appointment_id
      and appointment.clinic_id = new.organization_id
      and appointment.patient_id = new.patient_id
      and appointment.deleted_at is null
      and coalesce(appointment.is_active,true)=true
      and lower(coalesce(appointment.status,'')) in ('scheduled','pending','confirmed')
      and appointment.room_id = v_booking.room_id::text
      and appointment.location_type = 'clinica'
      and appointment.therapist_id = any(v_booking.professional_ids)
      and public.appointment_financial_service_key_v1(appointment.service_type)
        = public.appointment_financial_service_key_v1(v_booking.specialty)
      and coalesce(appointment.scheduled_duration_minutes,appointment.duration_minutes)
        = extract(epoch from (v_booking.scheduled_end_at-v_booking.scheduled_start_at))::integer / 60
      and coalesce(appointment.scheduled_start_at,appointment.scheduled_at) = v_booking.scheduled_start_at
      and appointment.scheduled_end_at = v_booking.scheduled_end_at
      and appointment.source_payload->>'sessionGroupId' = new.booking_id::text
      and appointment.source_payload->>'sessionModality' = 'GROUP'
      and jsonb_typeof(appointment.source_payload->'professionalIds') = 'array'
      and jsonb_array_length(appointment.source_payload->'professionalIds') = cardinality(v_booking.professional_ids)
      and appointment.source_payload->'professionalIds' @> to_jsonb(v_booking.professional_ids)
  ) then raise exception 'GROUP_PARTICIPANT_APPOINTMENT_SCOPE_INVALID'; end if;

  return new;
end;
$$;

drop trigger if exists group_participant_verify_scope on public.group_session_participants;
create trigger group_participant_verify_scope
before insert on public.group_session_participants
for each row execute function public.verify_group_session_participant_v1();

create index if not exists group_session_bookings_by_clinic_time
  on public.group_session_bookings(organization_id,scheduled_start_at);
create index if not exists group_session_participants_by_clinic_patient
  on public.group_session_participants(organization_id,patient_id,booking_id);

alter table public.group_session_bookings enable row level security;
alter table public.group_session_participants enable row level security;
revoke all on table public.group_session_bookings from public,anon,authenticated;
revoke all on table public.group_session_participants from public,anon,authenticated;
revoke all on function public.verify_group_session_booking_v1() from public,anon,authenticated;
revoke all on function public.verify_group_session_participant_v1() from public,anon,authenticated;
grant select,insert,update on table public.group_session_bookings to service_role;
grant select,insert on table public.group_session_participants to service_role;

comment on table public.group_session_bookings is 'Internal group-booking ledger; no booking exists until an atomic backend RPC commits all patient appointments and financial snapshots.';
comment on table public.group_session_participants is 'Tenant-scoped per-patient links to the clinical appointment and agreed group price; service-role writes only.';
commit;
