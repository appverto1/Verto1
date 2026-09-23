-- Issue #208 — patient-scoped ABA reinforcers v1
-- Additive clinical data authority only. No SessionMode/UX/browser outbox changes.
-- Rollback classification: FORWARD_FIX_ONLY once clinical rows exist; never drop history destructively.

begin;

create extension if not exists pgcrypto;

create table public.aba_patient_reinforcers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  label text not null,
  category text,
  note text,
  is_active boolean not null default true,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aba_patient_reinforcers_label_v1 check (char_length(trim(label)) between 1 and 160),
  constraint aba_patient_reinforcers_category_v1 check (
    category is null or category in ('SOCIAL','ACTIVITY','ITEM_OBJECT','SENSORY','FOOD','OTHER')
  ),
  constraint aba_patient_reinforcers_note_v1 check (note is null or char_length(note) <= 500),
  unique (id, organization_id, patient_id)
);

create index aba_patient_reinforcers_patient_active_v1
  on public.aba_patient_reinforcers (organization_id, patient_id, is_active, updated_at desc, id);

create table public.aba_reinforcer_delivery_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  session_id text not null references public.aba_sessions(id) on delete restrict,
  reinforcer_id uuid not null,
  client_event_id text not null,
  event_type text not null default 'DELIVERED',
  label_snapshot text not null,
  category_snapshot text,
  actor_id uuid not null,
  occurred_at timestamptz not null,
  payload_hash text not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint aba_reinforcer_delivery_client_event_v1 check (char_length(trim(client_event_id)) between 1 and 240),
  constraint aba_reinforcer_delivery_event_type_v1 check (event_type = 'DELIVERED'),
  constraint aba_reinforcer_delivery_label_snapshot_v1 check (char_length(trim(label_snapshot)) between 1 and 160),
  constraint aba_reinforcer_delivery_category_snapshot_v1 check (
    category_snapshot is null or category_snapshot in ('SOCIAL','ACTIVITY','ITEM_OBJECT','SENSORY','FOOD','OTHER')
  ),
  constraint aba_reinforcer_delivery_payload_hash_v1 check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint aba_reinforcer_delivery_catalog_scope_v1 foreign key (reinforcer_id, organization_id, patient_id)
    references public.aba_patient_reinforcers(id, organization_id, patient_id) on delete restrict,
  constraint aba_reinforcer_delivery_idempotency_v1 unique (organization_id, session_id, client_event_id)
);

create index aba_reinforcer_delivery_session_timeline_v1
  on public.aba_reinforcer_delivery_events (organization_id, patient_id, session_id, occurred_at, id);
create index aba_reinforcer_delivery_patient_recent_v1
  on public.aba_reinforcer_delivery_events (organization_id, patient_id, occurred_at desc, id);
create index aba_reinforcer_delivery_patient_item_recent_v1
  on public.aba_reinforcer_delivery_events (organization_id, patient_id, reinforcer_id, occurred_at desc, id);

alter table public.aba_patient_reinforcers enable row level security;
alter table public.aba_reinforcer_delivery_events enable row level security;

create or replace function public.aba_reinforcer_actor_can_read_v1(
  p_actor_id uuid,
  p_organization_id uuid,
  p_patient_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select
    p_actor_id is not null
    and exists (
      select 1 from public.patients p
      where p.id = p_patient_id and p.clinic_id = p_organization_id
    )
    and public.patient_file_actor_has_patient_access_v1(p_actor_id, p_organization_id, p_patient_id)
    and (
      exists (
        select 1 from public.clinics c
        where c.id = p_organization_id and c.owner_user_id = p_actor_id
      )
      or exists (
        select 1
        from public.users u
        where u.id = p_actor_id
          and u.clinic_id = p_organization_id
          and lower(coalesce(u.role,'')) in ('owner','admin')
      )
      or exists (
        select 1
        from public.clinic_memberships cm
        where cm.user_id = p_actor_id
          and cm.clinic_id = p_organization_id
          and cm.status = 'active'
          and lower(cm.role) in ('director','coordinator','supervisor','therapist')
          and not exists (
            select 1 from public.clinic_membership_permission_overrides o
            where o.membership_id = cm.id
              and o.permission_key = 'clinical.record.view'
              and o.effect = 'deny'
          )
      )
    );
$function$;

create or replace function public.aba_reinforcer_actor_can_write_v1(
  p_actor_id uuid,
  p_organization_id uuid,
  p_patient_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
  select
    p_actor_id is not null
    and exists (
      select 1 from public.patients p
      where p.id = p_patient_id and p.clinic_id = p_organization_id
    )
    and public.patient_file_actor_has_patient_access_v1(p_actor_id, p_organization_id, p_patient_id)
    and (
      exists (
        select 1 from public.clinics c
        where c.id = p_organization_id and c.owner_user_id = p_actor_id
      )
      or exists (
        select 1
        from public.users u
        where u.id = p_actor_id
          and u.clinic_id = p_organization_id
          and lower(coalesce(u.role,'')) in ('owner','admin')
      )
      or exists (
        select 1
        from public.clinic_memberships cm
        where cm.user_id = p_actor_id
          and cm.clinic_id = p_organization_id
          and cm.status = 'active'
          and not exists (
            select 1 from public.clinic_membership_permission_overrides o
            where o.membership_id = cm.id
              and o.permission_key = 'session.data.write'
              and o.effect = 'deny'
          )
          and (
            lower(cm.role) in ('director','coordinator','therapist')
            or (
              lower(cm.role) = 'supervisor'
              and exists (
                select 1 from public.clinic_membership_permission_overrides o
                where o.membership_id = cm.id
                  and o.permission_key = 'session.data.write'
                  and o.effect = 'allow'
              )
            )
          )
      )
    );
$function$;

revoke all on function public.aba_reinforcer_actor_can_read_v1(uuid,uuid,uuid) from public, anon;
revoke all on function public.aba_reinforcer_actor_can_write_v1(uuid,uuid,uuid) from public, anon;
grant execute on function public.aba_reinforcer_actor_can_read_v1(uuid,uuid,uuid) to authenticated, service_role;
grant execute on function public.aba_reinforcer_actor_can_write_v1(uuid,uuid,uuid) to authenticated, service_role;

create policy aba_patient_reinforcers_read_scope_v1
  on public.aba_patient_reinforcers
  for select to authenticated
  using (public.aba_reinforcer_actor_can_read_v1((select auth.uid()), organization_id, patient_id));
create policy aba_patient_reinforcers_write_scope_v1
  on public.aba_patient_reinforcers
  for all to authenticated
  using (public.aba_reinforcer_actor_can_write_v1((select auth.uid()), organization_id, patient_id))
  with check (public.aba_reinforcer_actor_can_write_v1((select auth.uid()), organization_id, patient_id));
create policy aba_reinforcer_delivery_events_read_scope_v1
  on public.aba_reinforcer_delivery_events
  for select to authenticated
  using (public.aba_reinforcer_actor_can_read_v1((select auth.uid()), organization_id, patient_id));
create policy aba_reinforcer_delivery_events_write_scope_v1
  on public.aba_reinforcer_delivery_events
  for all to authenticated
  using (public.aba_reinforcer_actor_can_write_v1((select auth.uid()), organization_id, patient_id))
  with check (public.aba_reinforcer_actor_can_write_v1((select auth.uid()), organization_id, patient_id));

revoke all on public.aba_patient_reinforcers from public, anon, authenticated;
revoke all on public.aba_reinforcer_delivery_events from public, anon, authenticated;
grant select, insert, update on public.aba_patient_reinforcers to service_role;
grant select, insert on public.aba_reinforcer_delivery_events to service_role;

create or replace function public.guard_aba_patient_reinforcer_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_actor uuid;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode='P0001', message='ABA_REINFORCER_HARD_DELETE_FORBIDDEN';
  end if;

  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.patient_id is distinct from old.patient_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception using errcode='P0001', message='ABA_REINFORCER_IDENTITY_IMMUTABLE';
  end if;

  v_actor := case when tg_op = 'INSERT' then new.created_by else new.updated_by end;
  if not public.aba_reinforcer_actor_can_write_v1(v_actor, new.organization_id, new.patient_id) then
    raise exception using errcode='P0001', message='ABA_REINFORCER_ACTOR_FORBIDDEN';
  end if;

  if not exists (
    select 1 from public.patients p
    where p.id = new.patient_id and p.clinic_id = new.organization_id
  ) then
    raise exception using errcode='P0001', message='ABA_REINFORCER_PATIENT_SCOPE_INVALID';
  end if;

  new.label := trim(new.label);
  new.category := nullif(upper(trim(coalesce(new.category,''))), '');
  new.note := nullif(trim(coalesce(new.note,'')), '');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$function$;

create trigger trg_guard_aba_patient_reinforcer_v1
before insert or update or delete on public.aba_patient_reinforcers
for each row execute function public.guard_aba_patient_reinforcer_v1();

create or replace function public.guard_aba_reinforcer_delivery_append_only_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception using errcode='P0001', message='ABA_REINFORCER_DELIVERY_APPEND_ONLY';
end;
$function$;

create trigger trg_guard_aba_reinforcer_delivery_append_only_v1
before update or delete on public.aba_reinforcer_delivery_events
for each row execute function public.guard_aba_reinforcer_delivery_append_only_v1();

create or replace function public.validate_aba_reinforcer_delivery_insert_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
declare
  v_session public.aba_sessions%rowtype;
  v_reinforcer public.aba_patient_reinforcers%rowtype;
begin
  if not public.aba_reinforcer_actor_can_write_v1(new.actor_id, new.organization_id, new.patient_id) then
    raise exception using errcode='P0001', message='ABA_REINFORCER_DELIVERY_ACTOR_FORBIDDEN';
  end if;

  select * into v_session from public.aba_sessions s where s.id = new.session_id for share;
  if not found
     or v_session.clinic_id is distinct from new.organization_id::text
     or v_session.patient_id is distinct from new.patient_id then
    raise exception using errcode='P0001', message='ABA_REINFORCER_DELIVERY_SESSION_SCOPE_INVALID';
  end if;
  if lower(coalesce(v_session.status,'')) <> 'active' or v_session.ended_at is not null then
    raise exception using errcode='P0001', message='ABA_REINFORCER_DELIVERY_SESSION_CLOSED';
  end if;
  if new.occurred_at < v_session.started_at then
    raise exception using errcode='P0001', message='ABA_REINFORCER_DELIVERY_TIME_BEFORE_SESSION';
  end if;

  select * into v_reinforcer
  from public.aba_patient_reinforcers r
  where r.id = new.reinforcer_id
    and r.organization_id = new.organization_id
    and r.patient_id = new.patient_id
  for share;
  if not found then
    raise exception using errcode='P0001', message='ABA_REINFORCER_DELIVERY_CATALOG_SCOPE_INVALID';
  end if;
  if not v_reinforcer.is_active then
    raise exception using errcode='P0001', message='ABA_REINFORCER_INACTIVE';
  end if;

  new.event_type := 'DELIVERED';
  new.label_snapshot := v_reinforcer.label;
  new.category_snapshot := v_reinforcer.category;
  new.client_event_id := trim(new.client_event_id);
  return new;
end;
$function$;

create trigger trg_validate_aba_reinforcer_delivery_insert_v1
before insert on public.aba_reinforcer_delivery_events
for each row execute function public.validate_aba_reinforcer_delivery_insert_v1();

create or replace function public.save_aba_patient_reinforcer_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_actor_id uuid,
  p_reinforcer_id uuid default null,
  p_label text default null,
  p_category text default null,
  p_note text default null,
  p_is_active boolean default true
)
returns public.aba_patient_reinforcers
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $function$
declare
  v_id uuid := coalesce(p_reinforcer_id, gen_random_uuid());
  v_row public.aba_patient_reinforcers%rowtype;
  v_label text := trim(coalesce(p_label,''));
  v_category text := nullif(upper(trim(coalesce(p_category,''))), '');
  v_note text := nullif(trim(coalesce(p_note,'')), '');
begin
  if p_organization_id is null or p_patient_id is null or p_actor_id is null then
    raise exception using errcode='P0001', message='ABA_REINFORCER_SCOPE_REQUIRED';
  end if;
  if not public.aba_reinforcer_actor_can_write_v1(p_actor_id, p_organization_id, p_patient_id) then
    raise exception using errcode='P0001', message='ABA_REINFORCER_ACTOR_FORBIDDEN';
  end if;
  if char_length(v_label) < 1 or char_length(v_label) > 160 then
    raise exception using errcode='P0001', message='ABA_REINFORCER_LABEL_INVALID';
  end if;
  if v_category is not null and v_category not in ('SOCIAL','ACTIVITY','ITEM_OBJECT','SENSORY','FOOD','OTHER') then
    raise exception using errcode='P0001', message='ABA_REINFORCER_CATEGORY_INVALID';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception using errcode='P0001', message='ABA_REINFORCER_NOTE_TOO_LONG';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'aba-reinforcer:' || p_organization_id::text || ':' || p_patient_id::text || ':' || v_id::text, 0
  ));

  if p_reinforcer_id is null then
    insert into public.aba_patient_reinforcers(
      id, organization_id, patient_id, label, category, note, is_active, created_by, updated_by
    ) values (
      v_id, p_organization_id, p_patient_id, v_label, v_category, v_note, coalesce(p_is_active,true), p_actor_id, p_actor_id
    ) returning * into v_row;
  else
    update public.aba_patient_reinforcers r
    set label = v_label,
        category = v_category,
        note = v_note,
        is_active = coalesce(p_is_active, r.is_active),
        updated_by = p_actor_id,
        updated_at = now()
    where r.id = p_reinforcer_id
      and r.organization_id = p_organization_id
      and r.patient_id = p_patient_id
    returning * into v_row;
    if not found then
      raise exception using errcode='P0001', message='ABA_REINFORCER_NOT_FOUND';
    end if;
  end if;
  return v_row;
end;
$function$;

create or replace function public.record_aba_reinforcer_delivery_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_reinforcer_id uuid,
  p_client_event_id text,
  p_occurred_at timestamptz,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
set row_security = off
as $function$
declare
  v_client_event_id text := trim(coalesce(p_client_event_id,''));
  v_hash text;
  v_existing public.aba_reinforcer_delivery_events%rowtype;
  v_inserted public.aba_reinforcer_delivery_events%rowtype;
begin
  if p_organization_id is null or p_patient_id is null or p_session_id is null
     or p_reinforcer_id is null or p_occurred_at is null or p_actor_id is null then
    raise exception using errcode='P0001', message='ABA_REINFORCER_DELIVERY_SCOPE_REQUIRED';
  end if;
  if char_length(v_client_event_id) < 1 or char_length(v_client_event_id) > 240 then
    raise exception using errcode='P0001', message='ABA_REINFORCER_CLIENT_EVENT_ID_INVALID';
  end if;

  v_hash := encode(digest(jsonb_build_object(
    'organization_id', p_organization_id,
    'patient_id', p_patient_id,
    'session_id', p_session_id,
    'reinforcer_id', p_reinforcer_id,
    'client_event_id', v_client_event_id,
    'occurred_at', p_occurred_at,
    'actor_id', p_actor_id,
    'event_type', 'DELIVERED'
  )::text, 'sha256'), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'aba-reinforcer-event:' || p_organization_id::text || ':' || p_session_id || ':' || v_client_event_id, 0
  ));

  select * into v_existing
  from public.aba_reinforcer_delivery_events e
  where e.organization_id = p_organization_id
    and e.session_id = p_session_id
    and e.client_event_id = v_client_event_id;

  if found then
    if v_existing.payload_hash is distinct from v_hash then
      raise exception using errcode='P0001', message='ABA_REINFORCER_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'event_id', v_existing.id,
      'client_event_id', v_existing.client_event_id,
      'inserted', false,
      'received_at', v_existing.received_at
    );
  end if;

  insert into public.aba_reinforcer_delivery_events(
    organization_id, patient_id, session_id, reinforcer_id, client_event_id,
    event_type, label_snapshot, category_snapshot, actor_id, occurred_at, payload_hash
  ) values (
    p_organization_id, p_patient_id, p_session_id, p_reinforcer_id, v_client_event_id,
    'DELIVERED', 'PENDING_SNAPSHOT', null, p_actor_id, p_occurred_at, v_hash
  ) returning * into v_inserted;

  return jsonb_build_object(
    'event_id', v_inserted.id,
    'client_event_id', v_inserted.client_event_id,
    'inserted', true,
    'received_at', v_inserted.received_at
  );
end;
$function$;

create or replace function public.list_aba_patient_reinforcers_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_actor_id uuid,
  p_include_inactive boolean default false,
  p_limit integer default 100
)
returns table(
  reinforcer_id uuid,
  label text,
  category text,
  note text,
  is_active boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  if not public.aba_reinforcer_actor_can_read_v1(p_actor_id, p_organization_id, p_patient_id) then
    raise exception using errcode='P0001', message='ABA_REINFORCER_READ_FORBIDDEN';
  end if;
  return query
  select r.id, r.label, r.category, r.note, r.is_active, r.updated_at
  from public.aba_patient_reinforcers r
  where r.organization_id = p_organization_id
    and r.patient_id = p_patient_id
    and (coalesce(p_include_inactive,false) or r.is_active)
  order by r.is_active desc, lower(r.label), r.id
  limit greatest(1, least(coalesce(p_limit,100), 200));
end;
$function$;

create or replace function public.list_recent_aba_patient_reinforcers_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_actor_id uuid,
  p_limit integer default 6,
  p_lookback_days integer default 90
)
returns table(
  reinforcer_id uuid,
  label text,
  category text,
  last_delivered_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  if not public.aba_reinforcer_actor_can_read_v1(p_actor_id, p_organization_id, p_patient_id) then
    raise exception using errcode='P0001', message='ABA_REINFORCER_READ_FORBIDDEN';
  end if;
  return query
  select r.id, r.label, r.category, max(e.occurred_at) as last_delivered_at
  from public.aba_reinforcer_delivery_events e
  join public.aba_patient_reinforcers r
    on r.id = e.reinforcer_id
   and r.organization_id = e.organization_id
   and r.patient_id = e.patient_id
  where e.organization_id = p_organization_id
    and e.patient_id = p_patient_id
    and r.is_active
    and e.occurred_at >= now() - make_interval(days => greatest(1, least(coalesce(p_lookback_days,90), 365)))
  group by r.id, r.label, r.category
  order by max(e.occurred_at) desc, r.id
  limit greatest(1, least(coalesce(p_limit,6), 20));
end;
$function$;

create or replace function public.list_aba_session_reinforcer_events_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_actor_id uuid,
  p_limit integer default 200
)
returns table(
  event_id uuid,
  reinforcer_id uuid,
  label_snapshot text,
  category_snapshot text,
  occurred_at timestamptz,
  received_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  if not public.aba_reinforcer_actor_can_read_v1(p_actor_id, p_organization_id, p_patient_id) then
    raise exception using errcode='P0001', message='ABA_REINFORCER_READ_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.aba_sessions s
    where s.id = p_session_id
      and s.clinic_id = p_organization_id::text
      and s.patient_id = p_patient_id
  ) then
    raise exception using errcode='P0001', message='ABA_REINFORCER_SESSION_SCOPE_INVALID';
  end if;
  return query
  select e.id, e.reinforcer_id, e.label_snapshot, e.category_snapshot, e.occurred_at, e.received_at
  from public.aba_reinforcer_delivery_events e
  where e.organization_id = p_organization_id
    and e.patient_id = p_patient_id
    and e.session_id = p_session_id
  order by e.occurred_at desc, e.id desc
  limit greatest(1, least(coalesce(p_limit,200), 500));
end;
$function$;

create or replace function public.get_aba_session_reinforcer_summary_v1(
  p_organization_id uuid,
  p_patient_id uuid,
  p_session_id text,
  p_actor_id uuid,
  p_limit integer default 100
)
returns table(
  reinforcer_id uuid,
  label_snapshot text,
  category_snapshot text,
  delivery_count bigint,
  last_delivered_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $function$
begin
  if not public.aba_reinforcer_actor_can_read_v1(p_actor_id, p_organization_id, p_patient_id) then
    raise exception using errcode='P0001', message='ABA_REINFORCER_READ_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.aba_sessions s
    where s.id = p_session_id
      and s.clinic_id = p_organization_id::text
      and s.patient_id = p_patient_id
  ) then
    raise exception using errcode='P0001', message='ABA_REINFORCER_SESSION_SCOPE_INVALID';
  end if;
  return query
  with grouped as (
    select e.reinforcer_id,
           count(*) as delivery_count,
           max(e.occurred_at) as last_delivered_at
    from public.aba_reinforcer_delivery_events e
    where e.organization_id = p_organization_id
      and e.patient_id = p_patient_id
      and e.session_id = p_session_id
    group by e.reinforcer_id
  ), latest as (
    select distinct on (e.reinforcer_id)
      e.reinforcer_id, e.label_snapshot, e.category_snapshot
    from public.aba_reinforcer_delivery_events e
    where e.organization_id = p_organization_id
      and e.patient_id = p_patient_id
      and e.session_id = p_session_id
    order by e.reinforcer_id, e.occurred_at desc, e.id desc
  )
  select g.reinforcer_id, l.label_snapshot, l.category_snapshot, g.delivery_count, g.last_delivered_at
  from grouped g
  join latest l using (reinforcer_id)
  order by g.last_delivered_at desc, g.reinforcer_id
  limit greatest(1, least(coalesce(p_limit,100), 200));
end;
$function$;

revoke all on function public.save_aba_patient_reinforcer_v1(uuid,uuid,uuid,uuid,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.record_aba_reinforcer_delivery_v1(uuid,uuid,text,uuid,text,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.list_aba_patient_reinforcers_v1(uuid,uuid,uuid,boolean,integer) from public, anon, authenticated;
revoke all on function public.list_recent_aba_patient_reinforcers_v1(uuid,uuid,uuid,integer,integer) from public, anon, authenticated;
revoke all on function public.list_aba_session_reinforcer_events_v1(uuid,uuid,text,uuid,integer) from public, anon, authenticated;
revoke all on function public.get_aba_session_reinforcer_summary_v1(uuid,uuid,text,uuid,integer) from public, anon, authenticated;

grant execute on function public.save_aba_patient_reinforcer_v1(uuid,uuid,uuid,uuid,text,text,text,boolean) to service_role;
grant execute on function public.record_aba_reinforcer_delivery_v1(uuid,uuid,text,uuid,text,timestamptz,uuid) to service_role;
grant execute on function public.list_aba_patient_reinforcers_v1(uuid,uuid,uuid,boolean,integer) to service_role;
grant execute on function public.list_recent_aba_patient_reinforcers_v1(uuid,uuid,uuid,integer,integer) to service_role;
grant execute on function public.list_aba_session_reinforcer_events_v1(uuid,uuid,text,uuid,integer) to service_role;
grant execute on function public.get_aba_session_reinforcer_summary_v1(uuid,uuid,text,uuid,integer) to service_role;

comment on table public.aba_patient_reinforcers is 'Patient-scoped ABA reinforcer catalog v1. Current lifecycle only; no efficacy or recommendation semantics.';
comment on table public.aba_reinforcer_delivery_events is 'Append-only factual ABA reinforcer delivery events v1. Snapshots are immutable; events are not measurement outcomes.';

commit;
