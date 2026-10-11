-- Verto #211: tenant onboarding communication data contract v1.
-- Additive, staging-first contract. Keeps onboarding operational data separate from commercial campaigns.

begin;

create extension if not exists pgcrypto;

create or replace function public.onboarding_text_array_valid_v1(
  p_values text[],
  p_min_count integer,
  p_max_count integer,
  p_max_length integer
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select coalesce(cardinality(p_values), 0) between p_min_count and p_max_count
    and not exists (
      select 1
      from unnest(coalesce(p_values, '{}'::text[])) value
      where value is null
         or char_length(btrim(value)) < 1
         or char_length(btrim(value)) > p_max_length
    );
$$;

create or replace function public.onboarding_actor_can_respond_v1(
  p_actor_id uuid,
  p_clinic_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select exists (
    select 1
    from public.clinic_memberships membership
    where membership.user_id = p_actor_id
      and membership.clinic_id = p_clinic_id
      and lower(coalesce(membership.status, '')) = 'active'
      and (
        lower(coalesce(membership.role, '')) in ('director', 'coordinator')
        or exists (
          select 1
          from public.clinic_membership_permission_overrides permission_override
          where permission_override.membership_id = membership.id
            and permission_override.permission_key = 'onboarding.respond'
            and permission_override.effect = 'allow'
        )
      )
      and not exists (
        select 1
        from public.clinic_membership_permission_overrides permission_override
        where permission_override.membership_id = membership.id
          and permission_override.permission_key = 'onboarding.respond'
          and permission_override.effect = 'deny'
      )
  );
$$;

revoke all on function public.onboarding_text_array_valid_v1(text[], integer, integer, integer) from public, anon;
grant execute on function public.onboarding_text_array_valid_v1(text[], integer, integer, integer) to authenticated, service_role;
revoke all on function public.onboarding_actor_can_respond_v1(uuid, uuid) from public, anon;
grant execute on function public.onboarding_actor_can_respond_v1(uuid, uuid) to authenticated, service_role;

create table if not exists public.onboarding_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  topics text[] not null default '{}'::text[],
  participant_guidance text not null,
  status text not null default 'draft' check (status in ('draft', 'archived')),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onboarding_templates_title_length check (char_length(btrim(title)) between 1 and 160),
  constraint onboarding_templates_message_length check (char_length(btrim(message)) between 1 and 4000),
  constraint onboarding_templates_guidance_length check (char_length(btrim(participant_guidance)) between 1 and 1200),
  constraint onboarding_templates_topics_valid check (public.onboarding_text_array_valid_v1(topics, 1, 20, 240))
);

create table if not exists public.onboarding_publications (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.onboarding_templates(id) on delete restrict,
  version integer not null check (version > 0),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  snapshot_title text not null,
  snapshot_message text not null,
  snapshot_topics text[] not null,
  snapshot_participant_guidance text not null,
  status text not null default 'published' check (status in ('published', 'viewed', 'responded', 'cancelled')),
  published_by uuid not null references public.users(id) on delete restrict,
  published_at timestamptz not null default now(),
  viewed_at timestamptz,
  responded_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint onboarding_publications_title_length check (char_length(btrim(snapshot_title)) between 1 and 160),
  constraint onboarding_publications_message_length check (char_length(btrim(snapshot_message)) between 1 and 4000),
  constraint onboarding_publications_guidance_length check (char_length(btrim(snapshot_participant_guidance)) between 1 and 1200),
  constraint onboarding_publications_topics_valid check (public.onboarding_text_array_valid_v1(snapshot_topics, 1, 20, 240)),
  constraint onboarding_publications_viewed_time check (viewed_at is null or viewed_at >= published_at),
  constraint onboarding_publications_responded_time check (responded_at is null or responded_at >= published_at),
  constraint onboarding_publications_cancelled_time check (cancelled_at is null or cancelled_at >= published_at),
  unique (template_id, version)
);

create table if not exists public.onboarding_slots (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.onboarding_publications(id) on delete restrict,
  starts_at timestamptz not null,
  timezone text not null default 'America/Sao_Paulo',
  status text not null default 'available' check (status in ('available', 'inactive', 'reserved', 'cancelled')),
  reserved_at timestamptz,
  inactivated_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onboarding_slots_timezone_length check (char_length(btrim(timezone)) between 1 and 80),
  constraint onboarding_slots_reserved_time check (reserved_at is null or reserved_at >= created_at),
  unique (publication_id, starts_at)
);

create table if not exists public.onboarding_responses (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.onboarding_publications(id) on delete restrict,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  slot_id uuid not null references public.onboarding_slots(id) on delete restrict,
  participants text[] not null,
  idempotency_key text not null,
  status text not null default 'responded' check (status in ('responded', 'cancelled', 'superseded')),
  is_current boolean not null default true,
  previous_response_id uuid references public.onboarding_responses(id) on delete restrict,
  responded_by uuid not null references public.users(id) on delete restrict,
  responded_at timestamptz not null default now(),
  cancelled_at timestamptz,
  superseded_at timestamptz,
  admin_ack_at timestamptz,
  admin_ack_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint onboarding_responses_participants_valid check (public.onboarding_text_array_valid_v1(participants, 1, 20, 120)),
  constraint onboarding_responses_idempotency_length check (char_length(idempotency_key) between 12 and 160),
  constraint onboarding_responses_cancelled_time check (cancelled_at is null or cancelled_at >= responded_at),
  constraint onboarding_responses_superseded_time check (superseded_at is null or superseded_at >= responded_at)
);

create unique index if not exists onboarding_responses_current_publication_uidx
  on public.onboarding_responses(publication_id) where is_current;
create unique index if not exists onboarding_responses_slot_uidx
  on public.onboarding_responses(slot_id) where status = 'responded';
create unique index if not exists onboarding_responses_publication_idempotency_uidx
  on public.onboarding_responses(publication_id, idempotency_key);
create index if not exists onboarding_publications_clinic_status_idx
  on public.onboarding_publications(clinic_id, status, published_at desc);
create index if not exists onboarding_slots_publication_status_starts_idx
  on public.onboarding_slots(publication_id, status, starts_at);
create index if not exists onboarding_responses_clinic_responded_idx
  on public.onboarding_responses(clinic_id, responded_at desc);
create index if not exists onboarding_responses_admin_inbox_idx
  on public.onboarding_responses(responded_at desc)
  where is_current and status = 'responded' and admin_ack_at is null;

create or replace function public.onboarding_publication_snapshot_immutable_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.template_id is distinct from old.template_id
     or new.version is distinct from old.version
     or new.clinic_id is distinct from old.clinic_id
     or new.snapshot_title is distinct from old.snapshot_title
     or new.snapshot_message is distinct from old.snapshot_message
     or new.snapshot_topics is distinct from old.snapshot_topics
     or new.snapshot_participant_guidance is distinct from old.snapshot_participant_guidance
     or new.published_by is distinct from old.published_by
     or new.published_at is distinct from old.published_at then
    raise exception 'ONBOARDING_PUBLICATION_SNAPSHOT_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists onboarding_publication_snapshot_immutable on public.onboarding_publications;
create trigger onboarding_publication_snapshot_immutable
before update on public.onboarding_publications
for each row execute function public.onboarding_publication_snapshot_immutable_v1();

create or replace function public.onboarding_slot_no_hard_delete_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'ONBOARDING_SLOT_HARD_DELETE_FORBIDDEN' using errcode = 'P0001';
end;
$$;

drop trigger if exists onboarding_slot_no_hard_delete on public.onboarding_slots;
create trigger onboarding_slot_no_hard_delete
before delete on public.onboarding_slots
for each row execute function public.onboarding_slot_no_hard_delete_v1();

alter table public.onboarding_templates enable row level security;
alter table public.onboarding_publications enable row level security;
alter table public.onboarding_slots enable row level security;
alter table public.onboarding_responses enable row level security;

drop policy if exists onboarding_templates_platform_select on public.onboarding_templates;
drop policy if exists onboarding_templates_platform_insert on public.onboarding_templates;
drop policy if exists onboarding_templates_platform_update on public.onboarding_templates;
create policy onboarding_templates_platform_select on public.onboarding_templates
  for select to authenticated using (public.is_platform_sales_admin());
create policy onboarding_templates_platform_insert on public.onboarding_templates
  for insert to authenticated with check (public.is_platform_sales_admin());
create policy onboarding_templates_platform_update on public.onboarding_templates
  for update to authenticated using (public.is_platform_sales_admin()) with check (public.is_platform_sales_admin());

drop policy if exists onboarding_publications_select on public.onboarding_publications;
drop policy if exists onboarding_publications_platform_insert on public.onboarding_publications;
drop policy if exists onboarding_publications_platform_update on public.onboarding_publications;
create policy onboarding_publications_select on public.onboarding_publications
  for select to authenticated using (
    public.is_platform_sales_admin()
    or public.onboarding_actor_can_respond_v1(auth.uid(), clinic_id)
  );
create policy onboarding_publications_platform_insert on public.onboarding_publications
  for insert to authenticated with check (public.is_platform_sales_admin());
create policy onboarding_publications_platform_update on public.onboarding_publications
  for update to authenticated using (public.is_platform_sales_admin()) with check (public.is_platform_sales_admin());

drop policy if exists onboarding_slots_select on public.onboarding_slots;
drop policy if exists onboarding_slots_platform_insert on public.onboarding_slots;
drop policy if exists onboarding_slots_platform_update on public.onboarding_slots;
create policy onboarding_slots_select on public.onboarding_slots
  for select to authenticated using (
    public.is_platform_sales_admin()
    or exists (
      select 1
      from public.onboarding_publications publication
      where publication.id = onboarding_slots.publication_id
        and public.onboarding_actor_can_respond_v1(auth.uid(), publication.clinic_id)
    )
  );
create policy onboarding_slots_platform_insert on public.onboarding_slots
  for insert to authenticated with check (
    public.is_platform_sales_admin()
    and exists (select 1 from public.onboarding_publications publication where publication.id = onboarding_slots.publication_id)
  );
create policy onboarding_slots_platform_update on public.onboarding_slots
  for update to authenticated using (public.is_platform_sales_admin()) with check (public.is_platform_sales_admin());

drop policy if exists onboarding_responses_select on public.onboarding_responses;
create policy onboarding_responses_select on public.onboarding_responses
  for select to authenticated using (
    public.is_platform_sales_admin()
    or public.onboarding_actor_can_respond_v1(auth.uid(), clinic_id)
  );

revoke all on public.onboarding_templates from anon, authenticated;
revoke all on public.onboarding_publications from anon, authenticated;
revoke all on public.onboarding_slots from anon, authenticated;
revoke all on public.onboarding_responses from anon, authenticated;
grant select, insert, update on public.onboarding_templates to authenticated;
grant select, insert, update on public.onboarding_publications to authenticated;
grant select, insert, update on public.onboarding_slots to authenticated;
grant select on public.onboarding_responses to authenticated;
grant all on public.onboarding_templates to service_role;
grant all on public.onboarding_publications to service_role;
grant all on public.onboarding_slots to service_role;
grant all on public.onboarding_responses to service_role;

create or replace function public.submit_onboarding_response_v1(
  p_publication_id uuid,
  p_slot_id uuid,
  p_participants text[],
  p_idempotency_key text,
  p_actor_id uuid
)
returns table (
  response_id uuid,
  publication_id uuid,
  slot_id uuid,
  clinic_id uuid,
  participants text[],
  responded_at timestamptz,
  admin_ack_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_publication public.onboarding_publications%rowtype;
  v_slot public.onboarding_slots%rowtype;
  v_response public.onboarding_responses%rowtype;
  v_participants text[];
begin
  if p_actor_id is null or (p_actor_id <> auth.uid() and auth.role() <> 'service_role') then
    raise exception 'ONBOARDING_ACTOR_MISMATCH' using errcode = '42501';
  end if;

  if p_idempotency_key is null or char_length(p_idempotency_key) not between 12 and 160 then
    raise exception 'ONBOARDING_INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;

  select array_agg(btrim(participant) order by ordinality)
  into v_participants
  from unnest(coalesce(p_participants, '{}'::text[])) with ordinality as input(participant, ordinality)
  where participant is not null and btrim(participant) <> '';

  if not public.onboarding_text_array_valid_v1(v_participants, 1, 20, 120) then
    raise exception 'ONBOARDING_INVALID_PARTICIPANTS' using errcode = '22023';
  end if;

  select * into v_response
  from public.onboarding_responses response
  where response.publication_id = p_publication_id
    and response.idempotency_key = p_idempotency_key
  order by response.created_at desc
  limit 1;

  if found then
    return query select v_response.id, v_response.publication_id, v_response.slot_id,
      v_response.clinic_id, v_response.participants, v_response.responded_at, v_response.admin_ack_at;
    return;
  end if;

  select * into v_publication
  from public.onboarding_publications publication
  where publication.id = p_publication_id
  for update;

  if not found then
    raise exception 'ONBOARDING_PUBLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not public.onboarding_actor_can_respond_v1(p_actor_id, v_publication.clinic_id) then
    raise exception 'ONBOARDING_FORBIDDEN' using errcode = '42501';
  end if;

  if v_publication.status = 'responded' then
    raise exception 'ONBOARDING_ALREADY_RESPONDED' using errcode = 'P0001';
  end if;
  if v_publication.status not in ('published', 'viewed') then
    raise exception 'ONBOARDING_PUBLICATION_NOT_RESPONDABLE' using errcode = 'P0001';
  end if;

  select * into v_slot
  from public.onboarding_slots slot
  where slot.id = p_slot_id
    and slot.publication_id = p_publication_id
  for update;

  if not found or v_slot.status <> 'available' then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001';
  end if;

  insert into public.onboarding_responses (
    publication_id, clinic_id, slot_id, participants, idempotency_key, responded_by
  ) values (
    v_publication.id, v_publication.clinic_id, v_slot.id, v_participants, p_idempotency_key, p_actor_id
  )
  returning * into v_response;

  update public.onboarding_slots
  set status = 'reserved', reserved_at = v_response.responded_at, updated_at = now()
  where id = v_slot.id;

  update public.onboarding_publications
  set status = 'responded', responded_at = v_response.responded_at
  where id = v_publication.id;

  return query select v_response.id, v_response.publication_id, v_response.slot_id,
    v_response.clinic_id, v_response.participants, v_response.responded_at, v_response.admin_ack_at;
exception
  when unique_violation then
    select * into v_response
    from public.onboarding_responses response
    where response.publication_id = p_publication_id
      and response.idempotency_key = p_idempotency_key
    limit 1;
    if found then
      return query select v_response.id, v_response.publication_id, v_response.slot_id,
        v_response.clinic_id, v_response.participants, v_response.responded_at, v_response.admin_ack_at;
      return;
    end if;
    raise exception 'SLOT_TAKEN' using errcode = 'P0001';
end;
$$;

revoke all on function public.submit_onboarding_response_v1(uuid, uuid, text[], text, uuid) from public, anon, authenticated;
grant execute on function public.submit_onboarding_response_v1(uuid, uuid, text[], text, uuid) to service_role;

create or replace function public.ack_onboarding_response_v1(
  p_response_id uuid,
  p_actor_id uuid
)
returns table (response_id uuid, admin_ack_at timestamptz, admin_ack_by uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_ack_at timestamptz;
  v_ack_by uuid;
begin
  if p_actor_id is null or not exists (
    select 1 from public.users actor
    where actor.id = p_actor_id and lower(actor.role) in ('owner', 'admin')
  ) then
    raise exception 'ONBOARDING_PLATFORM_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  update public.onboarding_responses response
  set admin_ack_at = coalesce(response.admin_ack_at, now()),
      admin_ack_by = coalesce(response.admin_ack_by, p_actor_id)
  where response.id = p_response_id
  returning response.admin_ack_at, response.admin_ack_by into v_ack_at, v_ack_by;

  if not found then
    raise exception 'ONBOARDING_RESPONSE_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query select p_response_id, v_ack_at, v_ack_by;
end;
$$;

revoke all on function public.ack_onboarding_response_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ack_onboarding_response_v1(uuid, uuid) to service_role;

comment on table public.onboarding_templates is 'Editable operational onboarding drafts; separate from commercial campaigns.';
comment on table public.onboarding_publications is 'Immutable published onboarding snapshot targeted to exactly one clinic.';
comment on table public.onboarding_slots is 'Non-destructive availability lifecycle for a published onboarding instance.';
comment on table public.onboarding_responses is 'Canonical onboarding response history; admin inbox/read state derives from these rows.';

notify pgrst, 'reload schema';

commit;
