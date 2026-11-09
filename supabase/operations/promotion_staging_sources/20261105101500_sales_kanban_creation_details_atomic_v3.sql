-- Smoke 02: manual CRM opportunity identification is persisted in the same
-- atomic, idempotent transaction as the existing phone/channel batch.
-- The legacy v1/v2 RPCs, their callers and prior creation batches stay intact.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.sales_kanban_creation_channel_batches
  add column if not exists details_hash text;

create or replace function public.create_sales_kanban_opportunities_v3(
  p_phones jsonb,
  p_actor_id uuid,
  p_action_key text,
  p_channels jsonb,
  p_details jsonb
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_batch public.sales_kanban_creation_channel_batches%rowtype;
  v_entry jsonb;
  v_details jsonb := '[]'::jsonb;
  v_created jsonb;
  v_result jsonb;
  v_name text;
  v_clinic text;
  v_email text;
  v_seen_emails text[] := array[]::text[];
  v_request_hash text;
  v_details_hash text;
begin
  -- Never treat the frontend actor ID as authority. The server's MFA guard
  -- remains mandatory, and the database re-checks an active platform admin.
  if p_actor_id is null or not exists (
    select 1 from public.platform_admins where user_id = p_actor_id and active = true
  ) then
    raise exception 'PLATFORM_ADMIN_REQUIRED';
  end if;
  if p_action_key is null or char_length(p_action_key) not between 12 and 120 then
    raise exception 'INVALID_CREATION_KEY';
  end if;
  if jsonb_typeof(p_phones) is distinct from 'array'
     or jsonb_array_length(p_phones) not between 1 and 100
     or jsonb_typeof(p_channels) is distinct from 'array'
     or jsonb_array_length(p_channels) <> jsonb_array_length(p_phones)
     or jsonb_typeof(p_details) is distinct from 'array'
     or jsonb_array_length(p_details) <> jsonb_array_length(p_phones) then
    raise exception 'INVALID_CREATION_DETAILS';
  end if;

  -- Validate all rows before any insertion. Reject unknown fields, oversized
  -- strings, malformed addresses, and duplicate contact e-mails in the batch.
  for v_entry in select value from jsonb_array_elements(p_details) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(v_entry) k
                  where k not in ('name','clinicName','email'))
       or exists (select 1 from jsonb_each(v_entry) e
                  where jsonb_typeof(e.value) not in ('string','null')) then
      raise exception 'INVALID_CREATION_DETAILS';
    end if;
    v_name := btrim(coalesce(v_entry->>'name',''));
    v_clinic := btrim(coalesce(v_entry->>'clinicName',''));
    v_email := lower(btrim(coalesce(v_entry->>'email','')));
    if (v_name <> '' and char_length(v_name) < 2)
       or char_length(v_name) > 180
       or char_length(v_clinic) > 180
       or char_length(v_email) > 254
       or (v_email <> '' and (char_length(v_email) < 3
                             or v_email !~ '^[^ @]+@[^ @]+[.][^ @]+$'))
       or v_name ~ '[[:cntrl:]]'
       or v_clinic ~ '[[:cntrl:]]'
       or v_email ~ '[[:cntrl:]]' then
      raise exception 'INVALID_CREATION_DETAILS';
    end if;
    if v_email <> '' then
      if v_email = any(v_seen_emails) then
        raise exception 'DUPLICATE_EMAIL_IN_BATCH';
      end if;
      v_seen_emails := array_append(v_seen_emails, v_email);
    end if;
    v_details := v_details || jsonb_build_array(jsonb_build_object(
      'name', nullif(v_name,''),
      'clinicName', nullif(v_clinic,''),
      'email', nullif(v_email,'')
    ));
  end loop;

  -- Reuse the same per-action advisory lock and batch row as v2.
  -- A retry must match phones, channels, actor AND initial contact details.
  v_request_hash := md5(p_phones::text || '|' || p_channels::text || '|' || p_actor_id::text);
  v_details_hash := md5(v_details::text);
  perform pg_advisory_xact_lock(hashtextextended(
    'sales-kanban-acquisition-create:' || p_action_key, 0
  ));
  select * into v_batch
    from public.sales_kanban_creation_channel_batches
    where idempotency_key = p_action_key for update;
  if found then
    if v_batch.actor_user_id is distinct from p_actor_id
       or v_batch.request_hash <> v_request_hash
       or v_batch.details_hash is distinct from v_details_hash then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return v_batch.response;
  end if;

  -- Existing v2 authority enforces phone uniqueness, channel catalog
  -- availability, the legacy creation audit and durable batch replay.
  v_created := public.create_sales_kanban_opportunities_v2(
    p_phones, p_actor_id, p_action_key, p_channels
  );

  -- ONE bounded update for up to 100 contacts, not per-contact HTTP requests.
  -- Any unique e-mail violation rolls back the entire creation transaction.
  with provided as (
    select (created.value->>'id')::uuid as lead_id,
      detail.value->>'name' as contact_name,
      detail.value->>'clinicName' as clinic_name,
      detail.value->>'email' as contact_email
    from jsonb_array_elements(v_created) with ordinality as created(value, position)
    join jsonb_array_elements(v_details) with ordinality as detail(value, position)
      on detail.position = created.position
  )
  update public.sales_leads l set
    name = coalesce(provided.contact_name, l.name),
    clinic_name = coalesce(provided.clinic_name, l.clinic_name),
    email = coalesce(provided.contact_email, l.email),
    normalized_email = coalesce(provided.contact_email, l.normalized_email),
    updated_at = clock_timestamp()
  from provided
  where l.id = provided.lead_id
    and (provided.contact_name is not null
         or provided.clinic_name is not null
         or provided.contact_email is not null);

  select coalesce(jsonb_agg(
    created.value || jsonb_build_object(
      'name', l.name,
      'clinicName', l.clinic_name,
      'email', l.email,
      'updatedAt', l.updated_at
    ) order by created.position
  ), '[]'::jsonb)
  into v_result
  from jsonb_array_elements(v_created) with ordinality as created(value, position)
  join public.sales_leads l on l.id = (created.value->>'id')::uuid;

  if jsonb_array_length(v_result) <> jsonb_array_length(v_created) then
    raise exception 'CREATION_DETAILS_INCOMPLETE';
  end if;

  update public.sales_kanban_creation_channel_batches set
    details_hash = v_details_hash,
    response = v_result
  where idempotency_key = p_action_key and actor_user_id = p_actor_id;

  return v_result;
end $$;

revoke all on function public.create_sales_kanban_opportunities_v3(
  jsonb, uuid, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.create_sales_kanban_opportunities_v3(
  jsonb, uuid, text, jsonb, jsonb
) to service_role;

notify pgrst, 'reload schema';
commit;
