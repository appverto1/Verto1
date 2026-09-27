begin;

-- #259 clinic-scoped billing communication v1.
-- Forward-only, staging-first. This creates a staff-safe communication authority
-- separate from all patient-scoped inbox/chat/mention primitives.
-- Rollback classification: FORWARD_FIX_ONLY once communication history exists.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.clinic_communication_threads (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  subject text not null,
  status text not null default 'open' check (status in ('open','archived')),
  reference_type text,
  reference_id uuid,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  archived_by uuid references public.users(id) on delete set null,
  last_activity_at timestamptz not null default clock_timestamp(),
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  last_message_author_name_snapshot text,
  last_message_author_role_snapshot text,
  last_message_at timestamptz,
  constraint clinic_communication_threads_subject_v1
    check (char_length(btrim(subject)) between 1 and 120),
  constraint clinic_communication_threads_reference_v1
    check (
      (reference_type is null and reference_id is null)
      or (reference_type = 'TISS_OFFICIAL_LOT' and reference_id is not null)
    ),
  constraint clinic_communication_threads_archive_v1
    check (
      (status = 'open' and archived_at is null)
      or (status = 'archived' and archived_at is not null)
    ),
  unique (id, clinic_id)
);

create table public.clinic_communication_messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  thread_id uuid not null,
  sequence bigint not null check (sequence > 0),
  author_user_id uuid references public.users(id) on delete set null,
  author_name_snapshot text not null,
  author_role_snapshot text not null,
  body text not null,
  operation_type text not null check (operation_type in ('create_thread','send_message')),
  idempotency_key text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint clinic_communication_messages_thread_v1
    foreign key (thread_id, clinic_id)
    references public.clinic_communication_threads(id, clinic_id)
    on delete restrict,
  constraint clinic_communication_messages_body_v1
    check (
      char_length(btrim(body)) between 1 and 2000
      and body !~ '<[[:space:]]*/?[[:space:]]*[A-Za-z][^>]*>'
    ),
  constraint clinic_communication_messages_idempotency_v1
    check (
      char_length(idempotency_key) between 16 and 200
      and idempotency_key !~ '[[:space:]]'
    ),
  unique (thread_id, sequence),
  unique (id, thread_id, clinic_id)
);

create unique index clinic_communication_messages_idempotency_uq
  on public.clinic_communication_messages
  (clinic_id, author_user_id, operation_type, idempotency_key)
  where author_user_id is not null;

create table public.clinic_communication_mentions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  thread_id uuid not null,
  message_id uuid not null,
  mentioned_user_id uuid references public.users(id) on delete set null,
  mentioned_name_snapshot text not null,
  mentioned_role_snapshot text not null,
  created_at timestamptz not null default clock_timestamp(),
  notified_at timestamptz not null default clock_timestamp(),
  notification_read_at timestamptz,
  constraint clinic_communication_mentions_message_v1
    foreign key (message_id, thread_id, clinic_id)
    references public.clinic_communication_messages(id, thread_id, clinic_id)
    on delete restrict
);

create unique index clinic_communication_mentions_message_target_uq
  on public.clinic_communication_mentions(message_id, mentioned_user_id)
  where mentioned_user_id is not null;

create table public.clinic_communication_read_states (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  thread_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  last_read_sequence bigint not null default 0 check (last_read_sequence >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  constraint clinic_communication_read_states_thread_v1
    foreign key (thread_id, clinic_id)
    references public.clinic_communication_threads(id, clinic_id)
    on delete cascade,
  unique (thread_id, user_id)
);

create table public.clinic_communication_audit_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  thread_id uuid references public.clinic_communication_threads(id) on delete restrict,
  message_id uuid references public.clinic_communication_messages(id) on delete restrict,
  actor_user_id uuid references public.users(id) on delete set null,
  event_type text not null check (event_type in ('thread_created','message_created','thread_archived','thread_reopened')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint clinic_communication_audit_metadata_object_v1
    check (jsonb_typeof(metadata) = 'object'),
  constraint clinic_communication_audit_metadata_no_content_v1
    check (
      not (metadata ?| array['body','message','subject','email','patient','patient_id','guide','xml','amount','value','diagnosis','card_number'])
    )
);

create index clinic_communication_threads_clinic_activity_idx
  on public.clinic_communication_threads(clinic_id, last_activity_at desc, id desc);
create index clinic_communication_threads_clinic_status_activity_idx
  on public.clinic_communication_threads(clinic_id, status, last_activity_at desc, id desc);
create index clinic_communication_messages_thread_sequence_idx
  on public.clinic_communication_messages(thread_id, sequence desc);
create index clinic_communication_mentions_target_notification_idx
  on public.clinic_communication_mentions(mentioned_user_id, notification_read_at, created_at desc, id desc)
  where mentioned_user_id is not null;
create index clinic_communication_mentions_message_idx
  on public.clinic_communication_mentions(message_id);
create index clinic_communication_read_states_user_clinic_idx
  on public.clinic_communication_read_states(user_id, clinic_id, updated_at desc);
create index clinic_communication_audit_clinic_created_idx
  on public.clinic_communication_audit_events(clinic_id, created_at desc, id desc);

alter table public.clinic_communication_threads enable row level security;
alter table public.clinic_communication_messages enable row level security;
alter table public.clinic_communication_mentions enable row level security;
alter table public.clinic_communication_read_states enable row level security;
alter table public.clinic_communication_audit_events enable row level security;

revoke all on table public.clinic_communication_threads from public, anon, authenticated;
revoke all on table public.clinic_communication_messages from public, anon, authenticated;
revoke all on table public.clinic_communication_mentions from public, anon, authenticated;
revoke all on table public.clinic_communication_read_states from public, anon, authenticated;
revoke all on table public.clinic_communication_audit_events from public, anon, authenticated;

comment on table public.clinic_communication_threads is
  'Clinic-scoped operational billing communication threads for #259; never patient-scoped authority.';
comment on table public.clinic_communication_messages is
  'Immutable plain-text staff communication messages; direct browser DML is prohibited.';
comment on table public.clinic_communication_mentions is
  'Structured same-clinic direct mentions and their minimal in-app notification projection.';
comment on table public.clinic_communication_read_states is
  'Server-owned monotonic per-user/per-thread read cursor, independent from mention notification state.';
comment on table public.clinic_communication_audit_events is
  'Append-only communication audit metadata; message/subject content is intentionally excluded.';

create or replace function private.clinic_billing_communication_capability_v1(
  p_user_id uuid,
  p_clinic_id uuid,
  p_capability text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_role text;
  v_effect text;
  v_default_allow boolean := false;
begin
  if p_user_id is null or p_clinic_id is null
     or p_capability not in (
       'communication.billing_updates.view',
       'communication.billing_updates.write',
       'communication.billing_updates.manage'
     ) then
    return false;
  end if;

  select cm.role
    into v_role
  from public.clinic_memberships cm
  where cm.user_id = p_user_id
    and cm.clinic_id = p_clinic_id
    and cm.status = 'active'
  limit 1;

  if v_role is null then
    return false;
  end if;

  select o.effect
    into v_effect
  from public.clinic_membership_permission_overrides o
  join public.clinic_memberships cm on cm.id = o.membership_id
  where cm.user_id = p_user_id
    and cm.clinic_id = p_clinic_id
    and cm.status = 'active'
    and o.permission_key = p_capability
  limit 1;

  if v_effect = 'deny' then
    return false;
  end if;

  v_default_allow :=
    v_role in ('director','coordinator')
    or (
      v_role = 'biller'
      and p_capability in (
        'communication.billing_updates.view',
        'communication.billing_updates.write'
      )
    );

  if v_default_allow then
    return true;
  end if;

  if v_effect = 'allow' and v_role in ('director','coordinator','receptionist') then
    return true;
  end if;

  return false;
end;
$function$;

revoke all on function private.clinic_billing_communication_capability_v1(uuid,uuid,text)
  from public, anon, authenticated, service_role;

create or replace function public.create_clinic_communication_thread_v1(
  p_clinic_id uuid,
  p_subject text,
  p_message text,
  p_mention_user_ids uuid[] default array[]::uuid[],
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_actor uuid := auth.uid();
  v_subject text := btrim(coalesce(p_subject,''));
  v_body text := btrim(coalesce(p_message,''));
  v_key text := btrim(coalesce(p_idempotency_key,''));
  v_mentions uuid[] := coalesce(p_mention_user_ids, array[]::uuid[]);
  v_role text;
  v_name text;
  v_existing public.clinic_communication_messages%rowtype;
  v_thread_id uuid := gen_random_uuid();
  v_message_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_valid_mentions integer := 0;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='COMMUNICATION_AUTH_REQUIRED';
  end if;
  if not private.clinic_billing_communication_capability_v1(
    v_actor,p_clinic_id,'communication.billing_updates.write'
  ) then
    raise exception using errcode='42501', message='COMMUNICATION_ACCESS_DENIED';
  end if;
  if char_length(v_subject) < 1 or char_length(v_subject) > 120 then
    raise exception using errcode='22023', message='COMMUNICATION_SUBJECT_INVALID';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000
     or v_body ~ '<[[:space:]]*/?[[:space:]]*[A-Za-z][^>]*>' then
    raise exception using errcode='22023', message='COMMUNICATION_MESSAGE_INVALID';
  end if;
  if char_length(v_key) < 16 or char_length(v_key) > 200 or v_key ~ '[[:space:]]' then
    raise exception using errcode='22023', message='COMMUNICATION_IDEMPOTENCY_INVALID';
  end if;
  if cardinality(v_mentions) > 20
     or exists (select 1 from pg_catalog.unnest(v_mentions) as m(user_id) where m.user_id is null)
     or (select count(*) from (select distinct m.user_id from pg_catalog.unnest(v_mentions) as m(user_id)) d) <> cardinality(v_mentions) then
    raise exception using errcode='22023', message='COMMUNICATION_MENTIONS_INVALID';
  end if;
  if not (
    (p_reference_type is null and p_reference_id is null)
    or (p_reference_type = 'TISS_OFFICIAL_LOT' and p_reference_id is not null)
  ) then
    raise exception using errcode='22023', message='COMMUNICATION_REFERENCE_INVALID';
  end if;
  if p_reference_type = 'TISS_OFFICIAL_LOT' and not exists (
    select 1 from public.tiss_official_documents d
    where d.id = p_reference_id and d.clinic_id = p_clinic_id
  ) then
    raise exception using errcode='42501', message='COMMUNICATION_REFERENCE_UNAVAILABLE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_clinic_id::text || ':' || v_actor::text || ':create_thread:' || v_key,
      0
    )
  );

  select m.* into v_existing
  from public.clinic_communication_messages m
  where m.clinic_id = p_clinic_id
    and m.author_user_id = v_actor
    and m.operation_type = 'create_thread'
    and m.idempotency_key = v_key
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'threadId',v_existing.thread_id,
      'messageId',v_existing.id,
      'sequence',v_existing.sequence,
      'idempotent',true
    );
  end if;

  select cm.role, coalesce(nullif(btrim(u.name),''),'Usuário')
    into v_role, v_name
  from public.clinic_memberships cm
  join public.users u on u.id = cm.user_id
  where cm.user_id = v_actor
    and cm.clinic_id = p_clinic_id
    and cm.status = 'active'
  limit 1;

  select count(*) into v_valid_mentions
  from pg_catalog.unnest(v_mentions) as requested(user_id)
  join public.clinic_memberships cm
    on cm.user_id = requested.user_id
   and cm.clinic_id = p_clinic_id
   and cm.status = 'active'
  where private.clinic_billing_communication_capability_v1(
    requested.user_id,p_clinic_id,'communication.billing_updates.view'
  );

  if v_valid_mentions <> cardinality(v_mentions) then
    raise exception using errcode='42501', message='COMMUNICATION_MENTION_UNAVAILABLE';
  end if;

  insert into public.clinic_communication_threads (
    id,clinic_id,subject,status,reference_type,reference_id,created_by,
    created_at,updated_at,last_activity_at,last_sequence,
    last_message_author_name_snapshot,last_message_author_role_snapshot,last_message_at
  ) values (
    v_thread_id,p_clinic_id,v_subject,'open',p_reference_type,p_reference_id,v_actor,
    v_now,v_now,v_now,1,v_name,v_role,v_now
  );

  insert into public.clinic_communication_messages (
    id,clinic_id,thread_id,sequence,author_user_id,author_name_snapshot,
    author_role_snapshot,body,operation_type,idempotency_key,created_at
  ) values (
    v_message_id,p_clinic_id,v_thread_id,1,v_actor,v_name,v_role,
    v_body,'create_thread',v_key,v_now
  );

  insert into public.clinic_communication_mentions (
    clinic_id,thread_id,message_id,mentioned_user_id,mentioned_name_snapshot,
    mentioned_role_snapshot,created_at,notified_at
  )
  select
    p_clinic_id,v_thread_id,v_message_id,requested.user_id,
    coalesce(nullif(btrim(u.name),''),'Usuário'),cm.role,v_now,v_now
  from pg_catalog.unnest(v_mentions) as requested(user_id)
  join public.clinic_memberships cm
    on cm.user_id = requested.user_id
   and cm.clinic_id = p_clinic_id
   and cm.status = 'active'
  join public.users u on u.id = requested.user_id;

  insert into public.clinic_communication_audit_events (
    clinic_id,thread_id,message_id,actor_user_id,event_type,metadata,created_at
  ) values (
    p_clinic_id,v_thread_id,v_message_id,v_actor,'thread_created',
    jsonb_build_object(
      'sequence',1,
      'mentionCount',cardinality(v_mentions),
      'referenceType',p_reference_type
    ),v_now
  );

  return jsonb_build_object(
    'threadId',v_thread_id,'messageId',v_message_id,'sequence',1,'idempotent',false
  );
end;
$function$;

create or replace function public.send_clinic_communication_message_v1(
  p_thread_id uuid,
  p_message text,
  p_mention_user_ids uuid[] default array[]::uuid[],
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_actor uuid := auth.uid();
  v_body text := btrim(coalesce(p_message,''));
  v_key text := btrim(coalesce(p_idempotency_key,''));
  v_mentions uuid[] := coalesce(p_mention_user_ids, array[]::uuid[]);
  v_thread public.clinic_communication_threads%rowtype;
  v_existing public.clinic_communication_messages%rowtype;
  v_role text;
  v_name text;
  v_message_id uuid := gen_random_uuid();
  v_sequence bigint;
  v_now timestamptz := clock_timestamp();
  v_valid_mentions integer := 0;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='COMMUNICATION_AUTH_REQUIRED';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000
     or v_body ~ '<[[:space:]]*/?[[:space:]]*[A-Za-z][^>]*>' then
    raise exception using errcode='22023', message='COMMUNICATION_MESSAGE_INVALID';
  end if;
  if char_length(v_key) < 16 or char_length(v_key) > 200 or v_key ~ '[[:space:]]' then
    raise exception using errcode='22023', message='COMMUNICATION_IDEMPOTENCY_INVALID';
  end if;
  if cardinality(v_mentions) > 20
     or exists (select 1 from pg_catalog.unnest(v_mentions) as m(user_id) where m.user_id is null)
     or (select count(*) from (select distinct m.user_id from pg_catalog.unnest(v_mentions) as m(user_id)) d) <> cardinality(v_mentions) then
    raise exception using errcode='22023', message='COMMUNICATION_MENTIONS_INVALID';
  end if;

  select t.* into v_thread
  from public.clinic_communication_threads t
  where t.id = p_thread_id;
  if v_thread.id is null then
    raise exception using errcode='P0002', message='COMMUNICATION_THREAD_UNAVAILABLE';
  end if;
  if not private.clinic_billing_communication_capability_v1(
    v_actor,v_thread.clinic_id,'communication.billing_updates.write'
  ) then
    raise exception using errcode='42501', message='COMMUNICATION_ACCESS_DENIED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_thread.clinic_id::text || ':' || v_actor::text || ':send_message:' || v_key,
      0
    )
  );

  select m.* into v_existing
  from public.clinic_communication_messages m
  where m.clinic_id = v_thread.clinic_id
    and m.author_user_id = v_actor
    and m.operation_type = 'send_message'
    and m.idempotency_key = v_key
  limit 1;

  if v_existing.id is not null then
    if v_existing.thread_id <> p_thread_id then
      raise exception using errcode='23505', message='COMMUNICATION_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object(
      'threadId',v_existing.thread_id,'messageId',v_existing.id,
      'sequence',v_existing.sequence,'idempotent',true
    );
  end if;

  select t.* into v_thread
  from public.clinic_communication_threads t
  where t.id = p_thread_id
  for update;
  if v_thread.id is null or v_thread.status <> 'open' then
    raise exception using errcode='P0002', message='COMMUNICATION_THREAD_UNAVAILABLE';
  end if;
  if not private.clinic_billing_communication_capability_v1(
    v_actor,v_thread.clinic_id,'communication.billing_updates.write'
  ) then
    raise exception using errcode='42501', message='COMMUNICATION_ACCESS_DENIED';
  end if;

  select cm.role, coalesce(nullif(btrim(u.name),''),'Usuário')
    into v_role, v_name
  from public.clinic_memberships cm
  join public.users u on u.id = cm.user_id
  where cm.user_id = v_actor
    and cm.clinic_id = v_thread.clinic_id
    and cm.status = 'active'
  limit 1;

  select count(*) into v_valid_mentions
  from pg_catalog.unnest(v_mentions) as requested(user_id)
  join public.clinic_memberships cm
    on cm.user_id = requested.user_id
   and cm.clinic_id = v_thread.clinic_id
   and cm.status = 'active'
  where private.clinic_billing_communication_capability_v1(
    requested.user_id,v_thread.clinic_id,'communication.billing_updates.view'
  );
  if v_valid_mentions <> cardinality(v_mentions) then
    raise exception using errcode='42501', message='COMMUNICATION_MENTION_UNAVAILABLE';
  end if;

  v_sequence := v_thread.last_sequence + 1;

  insert into public.clinic_communication_messages (
    id,clinic_id,thread_id,sequence,author_user_id,author_name_snapshot,
    author_role_snapshot,body,operation_type,idempotency_key,created_at
  ) values (
    v_message_id,v_thread.clinic_id,p_thread_id,v_sequence,v_actor,v_name,v_role,
    v_body,'send_message',v_key,v_now
  );

  insert into public.clinic_communication_mentions (
    clinic_id,thread_id,message_id,mentioned_user_id,mentioned_name_snapshot,
    mentioned_role_snapshot,created_at,notified_at
  )
  select
    v_thread.clinic_id,p_thread_id,v_message_id,requested.user_id,
    coalesce(nullif(btrim(u.name),''),'Usuário'),cm.role,v_now,v_now
  from pg_catalog.unnest(v_mentions) as requested(user_id)
  join public.clinic_memberships cm
    on cm.user_id = requested.user_id
   and cm.clinic_id = v_thread.clinic_id
   and cm.status = 'active'
  join public.users u on u.id = requested.user_id;

  update public.clinic_communication_threads
  set last_sequence = v_sequence,
      last_activity_at = v_now,
      last_message_at = v_now,
      last_message_author_name_snapshot = v_name,
      last_message_author_role_snapshot = v_role,
      updated_at = v_now
  where id = p_thread_id;

  insert into public.clinic_communication_audit_events (
    clinic_id,thread_id,message_id,actor_user_id,event_type,metadata,created_at
  ) values (
    v_thread.clinic_id,p_thread_id,v_message_id,v_actor,'message_created',
    jsonb_build_object('sequence',v_sequence,'mentionCount',cardinality(v_mentions)),v_now
  );

  return jsonb_build_object(
    'threadId',p_thread_id,'messageId',v_message_id,
    'sequence',v_sequence,'idempotent',false
  );
end;
$function$;

create or replace function public.set_clinic_communication_thread_archived_v1(
  p_thread_id uuid,
  p_archived boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_actor uuid := auth.uid();
  v_thread public.clinic_communication_threads%rowtype;
  v_now timestamptz := clock_timestamp();
  v_target_status text;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='COMMUNICATION_AUTH_REQUIRED';
  end if;
  select t.* into v_thread
  from public.clinic_communication_threads t
  where t.id = p_thread_id
  for update;
  if v_thread.id is null then
    raise exception using errcode='P0002', message='COMMUNICATION_THREAD_UNAVAILABLE';
  end if;
  if not private.clinic_billing_communication_capability_v1(
    v_actor,v_thread.clinic_id,'communication.billing_updates.manage'
  ) then
    raise exception using errcode='42501', message='COMMUNICATION_ACCESS_DENIED';
  end if;
  v_target_status := case when coalesce(p_archived,false) then 'archived' else 'open' end;
  if v_thread.status = v_target_status then
    return jsonb_build_object('threadId',p_thread_id,'status',v_target_status,'idempotent',true);
  end if;

  update public.clinic_communication_threads
  set status = v_target_status,
      archived_at = case when v_target_status='archived' then v_now else null end,
      archived_by = case when v_target_status='archived' then v_actor else null end,
      updated_at = v_now
  where id = p_thread_id;

  insert into public.clinic_communication_audit_events (
    clinic_id,thread_id,actor_user_id,event_type,metadata,created_at
  ) values (
    v_thread.clinic_id,p_thread_id,v_actor,
    case when v_target_status='archived' then 'thread_archived' else 'thread_reopened' end,
    '{}'::jsonb,v_now
  );

  return jsonb_build_object('threadId',p_thread_id,'status',v_target_status,'idempotent',false);
end;
$function$;

create or replace function public.mark_clinic_communication_read_v1(
  p_thread_id uuid,
  p_observed_sequence bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_actor uuid := auth.uid();
  v_thread public.clinic_communication_threads%rowtype;
  v_effective bigint;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception using errcode='42501', message='COMMUNICATION_AUTH_REQUIRED';
  end if;
  select t.* into v_thread
  from public.clinic_communication_threads t
  where t.id = p_thread_id;
  if v_thread.id is null then
    raise exception using errcode='P0002', message='COMMUNICATION_THREAD_UNAVAILABLE';
  end if;
  if not private.clinic_billing_communication_capability_v1(
    v_actor,v_thread.clinic_id,'communication.billing_updates.view'
  ) then
    raise exception using errcode='42501', message='COMMUNICATION_ACCESS_DENIED';
  end if;
  if p_observed_sequence is null or p_observed_sequence < 0
     or p_observed_sequence > v_thread.last_sequence then
    raise exception using errcode='22023', message='COMMUNICATION_READ_CURSOR_INVALID';
  end if;

  insert into public.clinic_communication_read_states (
    clinic_id,thread_id,user_id,last_read_sequence,updated_at
  ) values (
    v_thread.clinic_id,p_thread_id,v_actor,p_observed_sequence,v_now
  )
  on conflict (thread_id,user_id)
  do update set
    last_read_sequence = greatest(
      public.clinic_communication_read_states.last_read_sequence,
      excluded.last_read_sequence
    ),
    updated_at = case
      when excluded.last_read_sequence > public.clinic_communication_read_states.last_read_sequence
        then excluded.updated_at
      else public.clinic_communication_read_states.updated_at
    end;

  select rs.last_read_sequence into v_effective
  from public.clinic_communication_read_states rs
  where rs.thread_id = p_thread_id and rs.user_id = v_actor;

  return jsonb_build_object('threadId',p_thread_id,'lastReadSequence',v_effective);
end;
$function$;

create or replace function public.mark_clinic_communication_notification_read_v1(
  p_mention_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_actor uuid := auth.uid();
  v_mention public.clinic_communication_mentions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception using errcode='42501', message='COMMUNICATION_AUTH_REQUIRED';
  end if;
  select m.* into v_mention
  from public.clinic_communication_mentions m
  where m.id = p_mention_id
    and m.mentioned_user_id = v_actor
  for update;
  if v_mention.id is null then
    raise exception using errcode='P0002', message='COMMUNICATION_NOTIFICATION_UNAVAILABLE';
  end if;
  if not private.clinic_billing_communication_capability_v1(
    v_actor,v_mention.clinic_id,'communication.billing_updates.view'
  ) then
    raise exception using errcode='42501', message='COMMUNICATION_ACCESS_DENIED';
  end if;

  update public.clinic_communication_mentions
  set notification_read_at = coalesce(notification_read_at,v_now)
  where id = p_mention_id;

  return jsonb_build_object('mentionId',p_mention_id,'notificationRead',true);
end;
$function$;

create or replace function public.list_clinic_communication_threads_v1(
  p_clinic_id uuid,
  p_limit integer default 30,
  p_before_activity_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_actor uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit,30),1),50);
  v_items jsonb;
  v_next_activity timestamptz;
  v_next_id uuid;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='COMMUNICATION_AUTH_REQUIRED';
  end if;
  if not private.clinic_billing_communication_capability_v1(
    v_actor,p_clinic_id,'communication.billing_updates.view'
  ) then
    raise exception using errcode='42501', message='COMMUNICATION_ACCESS_DENIED';
  end if;
  if (p_before_activity_at is null) <> (p_before_id is null) then
    raise exception using errcode='22023', message='COMMUNICATION_CURSOR_INVALID';
  end if;

  with page as (
    select
      t.*,
      greatest(t.last_sequence - coalesce(rs.last_read_sequence,0),0) as unread_count,
      case
        when t.reference_type is null then null
        when exists (
          select 1 from public.tiss_official_documents d
          where d.id=t.reference_id and d.clinic_id=t.clinic_id
        ) then 'EXISTS'
        else 'UNAVAILABLE'
      end as reference_state
    from public.clinic_communication_threads t
    left join public.clinic_communication_read_states rs
      on rs.thread_id=t.id and rs.user_id=v_actor
    where t.clinic_id=p_clinic_id
      and (
        p_before_activity_at is null
        or (t.last_activity_at,t.id) < (p_before_activity_at,p_before_id)
      )
    order by t.last_activity_at desc,t.id desc
    limit v_limit
  ), aggregated as (
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id',p.id,
          'clinicId',p.clinic_id,
          'subject',p.subject,
          'status',p.status,
          'referenceType',p.reference_type,
          'referenceId',p.reference_id,
          'referenceState',p.reference_state,
          'lastActivityAt',p.last_activity_at,
          'lastSequence',p.last_sequence,
          'unreadCount',p.unread_count,
          'lastAuthorName',p.last_message_author_name_snapshot,
          'lastAuthorRole',p.last_message_author_role_snapshot,
          'lastMessageAt',p.last_message_at
        ) order by p.last_activity_at desc,p.id desc
      ),'[]'::jsonb) as items
    from page p
  )
  select a.items into v_items from aggregated a;

  select p.last_activity_at,p.id
    into v_next_activity,v_next_id
  from public.clinic_communication_threads p
  where p.clinic_id=p_clinic_id
    and (
      p_before_activity_at is null
      or (p.last_activity_at,p.id) < (p_before_activity_at,p_before_id)
    )
  order by p.last_activity_at desc,p.id desc
  offset greatest(v_limit-1,0) limit 1;

  return jsonb_build_object(
    'items',coalesce(v_items,'[]'::jsonb),
    'nextCursor',case when v_next_id is null then null else jsonb_build_object(
      'lastActivityAt',v_next_activity,'id',v_next_id
    ) end
  );
end;
$function$;

create or replace function public.list_clinic_communication_messages_v1(
  p_thread_id uuid,
  p_limit integer default 50,
  p_before_sequence bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_actor uuid := auth.uid();
  v_clinic_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit,50),1),100);
  v_items jsonb;
  v_next bigint;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='COMMUNICATION_AUTH_REQUIRED';
  end if;
  select t.clinic_id into v_clinic_id
  from public.clinic_communication_threads t where t.id=p_thread_id;
  if v_clinic_id is null then
    raise exception using errcode='P0002', message='COMMUNICATION_THREAD_UNAVAILABLE';
  end if;
  if not private.clinic_billing_communication_capability_v1(
    v_actor,v_clinic_id,'communication.billing_updates.view'
  ) then
    raise exception using errcode='42501', message='COMMUNICATION_ACCESS_DENIED';
  end if;

  with page as (
    select m.*
    from public.clinic_communication_messages m
    where m.thread_id=p_thread_id
      and (p_before_sequence is null or m.sequence < p_before_sequence)
    order by m.sequence desc
    limit v_limit
  ), mention_agg as (
    select mn.message_id,
      jsonb_agg(
        jsonb_build_object(
          'userId',mn.mentioned_user_id,
          'name',mn.mentioned_name_snapshot,
          'role',mn.mentioned_role_snapshot
        ) order by mn.created_at,mn.id
      ) as mentions
    from public.clinic_communication_mentions mn
    where mn.message_id in (select p.id from page p)
    group by mn.message_id
  ), aggregated as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',p.id,
        'threadId',p.thread_id,
        'sequence',p.sequence,
        'authorUserId',p.author_user_id,
        'authorName',p.author_name_snapshot,
        'authorRole',p.author_role_snapshot,
        'body',p.body,
        'createdAt',p.created_at,
        'mentions',coalesce(ma.mentions,'[]'::jsonb)
      ) order by p.sequence desc
    ),'[]'::jsonb) as items,
    min(p.sequence) as next_sequence
    from page p
    left join mention_agg ma on ma.message_id=p.id
  )
  select a.items,a.next_sequence into v_items,v_next from aggregated a;

  return jsonb_build_object('items',coalesce(v_items,'[]'::jsonb),'nextBeforeSequence',v_next);
end;
$function$;

create or replace function public.list_clinic_communication_mention_targets_v1(
  p_clinic_id uuid,
  p_query text default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_actor uuid := auth.uid();
  v_query text := btrim(coalesce(p_query,''));
  v_limit integer := least(greatest(coalesce(p_limit,20),1),30);
  v_items jsonb;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='COMMUNICATION_AUTH_REQUIRED';
  end if;
  if not private.clinic_billing_communication_capability_v1(
    v_actor,p_clinic_id,'communication.billing_updates.write'
  ) then
    raise exception using errcode='42501', message='COMMUNICATION_ACCESS_DENIED';
  end if;

  select coalesce(jsonb_agg(item order by lower(item->>'name'),item->>'role',item->>'userId'),'[]'::jsonb)
    into v_items
  from (
    select jsonb_build_object(
      'userId',cm.user_id,
      'name',coalesce(nullif(btrim(u.name),''),'Usuário'),
      'role',cm.role
    ) as item
    from public.clinic_memberships cm
    join public.users u on u.id=cm.user_id
    where cm.clinic_id=p_clinic_id
      and cm.status='active'
      and private.clinic_billing_communication_capability_v1(
        cm.user_id,p_clinic_id,'communication.billing_updates.view'
      )
      and (v_query='' or coalesce(u.name,'') ilike '%' || v_query || '%')
    order by lower(coalesce(u.name,'')),cm.role,cm.user_id
    limit v_limit
  ) q;

  return jsonb_build_object('items',coalesce(v_items,'[]'::jsonb));
end;
$function$;

create or replace function public.list_clinic_communication_notifications_v1(
  p_limit integer default 30,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_actor uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit,30),1),50);
  v_items jsonb;
  v_next_created timestamptz;
  v_next_id uuid;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='COMMUNICATION_AUTH_REQUIRED';
  end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception using errcode='22023', message='COMMUNICATION_CURSOR_INVALID';
  end if;

  with page as (
    select m.*
    from public.clinic_communication_mentions m
    where m.mentioned_user_id=v_actor
      and private.clinic_billing_communication_capability_v1(
        v_actor,m.clinic_id,'communication.billing_updates.view'
      )
      and (
        p_before_created_at is null
        or (m.created_at,m.id) < (p_before_created_at,p_before_id)
      )
    order by m.created_at desc,m.id desc
    limit v_limit
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'mentionId',p.id,
      'clinicId',p.clinic_id,
      'threadId',p.thread_id,
      'createdAt',p.created_at,
      'readAt',p.notification_read_at,
      'copy','Você foi mencionado em uma atualização da clínica.'
    ) order by p.created_at desc,p.id desc
  ),'[]'::jsonb)
  into v_items
  from page p;

  select m.created_at,m.id into v_next_created,v_next_id
  from public.clinic_communication_mentions m
  where m.mentioned_user_id=v_actor
    and private.clinic_billing_communication_capability_v1(
      v_actor,m.clinic_id,'communication.billing_updates.view'
    )
    and (
      p_before_created_at is null
      or (m.created_at,m.id) < (p_before_created_at,p_before_id)
    )
  order by m.created_at desc,m.id desc
  offset greatest(v_limit-1,0) limit 1;

  return jsonb_build_object(
    'items',coalesce(v_items,'[]'::jsonb),
    'nextCursor',case when v_next_id is null then null else jsonb_build_object(
      'createdAt',v_next_created,'id',v_next_id
    ) end
  );
end;
$function$;

create or replace function public.get_clinic_communication_unread_count_v1(
  p_clinic_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $function$
declare
  v_actor uuid := auth.uid();
  v_count bigint;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='COMMUNICATION_AUTH_REQUIRED';
  end if;
  if not private.clinic_billing_communication_capability_v1(
    v_actor,p_clinic_id,'communication.billing_updates.view'
  ) then
    raise exception using errcode='42501', message='COMMUNICATION_ACCESS_DENIED';
  end if;

  select coalesce(sum(greatest(t.last_sequence-coalesce(rs.last_read_sequence,0),0)),0)::bigint
    into v_count
  from public.clinic_communication_threads t
  left join public.clinic_communication_read_states rs
    on rs.thread_id=t.id and rs.user_id=v_actor
  where t.clinic_id=p_clinic_id;
  return coalesce(v_count,0);
end;
$function$;

do $grants$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'create_clinic_communication_thread_v1',
        'send_clinic_communication_message_v1',
        'set_clinic_communication_thread_archived_v1',
        'mark_clinic_communication_read_v1',
        'mark_clinic_communication_notification_read_v1',
        'list_clinic_communication_threads_v1',
        'list_clinic_communication_messages_v1',
        'list_clinic_communication_mention_targets_v1',
        'list_clinic_communication_notifications_v1',
        'get_clinic_communication_unread_count_v1'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',fn.signature);
    execute format('grant execute on function %s to authenticated',fn.signature);
  end loop;
end;
$grants$;

notify pgrst, 'reload schema';
commit;
