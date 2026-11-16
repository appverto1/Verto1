-- Public lead signup must not reclassify or overwrite converted customers.
-- Existing sales leads, paid offers, clinics and events are preserved.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.upsert_public_sales_lead(p_name text, p_email text, p_normalized_email text, p_phone text, p_normalized_phone text, p_professional_registry text, p_clinic_name text, p_city text, p_state text, p_estimated_active_patients integer, p_estimated_professionals integer, p_operation_type text, p_acquisition_channel text, p_job_title text, p_preferred_contact_period text, p_notes text, p_consent_version text, p_consent_origin text, p_consent_purpose text, p_source text, p_idempotency_key text)
 RETURNS TABLE(lead_id uuid, event_created boolean, lead_created boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lead_id uuid;
  v_email_lead_id uuid;
  v_phone_lead_id uuid;
  v_created boolean := false;
  v_event_created boolean := false;
  v_event_type public.sales_lead_event_type;
  v_rows integer := 0;
  v_name text := nullif(btrim(p_name), '');
  v_email text := nullif(lower(btrim(p_email)), '');
  v_normalized_email text := nullif(lower(btrim(p_normalized_email)), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_normalized_phone text := regexp_replace(coalesce(p_normalized_phone, ''), '[^0-9]', '', 'g');
  v_operation_type text;
  v_acquisition_channel text := coalesce(nullif(btrim(p_acquisition_channel), ''), 'public_landing');
begin
  v_normalized_email := coalesce(v_normalized_email, v_email);
  v_email := coalesce(v_email, v_normalized_email);
  v_operation_type := case
    when p_operation_type in ('independent_professional', 'clinic', 'multidisciplinary_team')
      then p_operation_type
    when nullif(btrim(p_clinic_name), '') is not null then 'clinic'
    else 'independent_professional'
  end;

  if v_name is null or char_length(v_name) not between 2 and 180 then
    raise exception 'SALES_LEAD_NAME_INVALID' using errcode = '22023';
  end if;
  if v_normalized_phone !~ '^55[0-9]{10,11}$' then
    raise exception 'SALES_LEAD_PHONE_INVALID' using errcode = '22023';
  end if;
  if v_email is not null
     and (char_length(v_email) not between 3 and 254 or position('@' in v_email) < 2) then
    raise exception 'SALES_LEAD_EMAIL_INVALID' using errcode = '22023';
  end if;
  if p_estimated_active_patients is not null
     and p_estimated_active_patients not between 0 and 100000 then
    raise exception 'SALES_LEAD_PATIENT_ESTIMATE_INVALID' using errcode = '22023';
  end if;
  if p_estimated_professionals is not null
     and p_estimated_professionals not between 0 and 10000 then
    raise exception 'SALES_LEAD_PROFESSIONAL_ESTIMATE_INVALID' using errcode = '22023';
  end if;
  if nullif(btrim(p_consent_version), '') is null
     or nullif(btrim(p_consent_origin), '') is null
     or p_consent_purpose is distinct from 'sales_contact' then
    raise exception 'SALES_LEAD_CONTACT_REQUEST_INVALID' using errcode = '22023';
  end if;
  if char_length(coalesce(p_idempotency_key, '')) not between 12 and 240 then
    raise exception 'SALES_LEAD_IDEMPOTENCY_KEY_INVALID' using errcode = '22023';
  end if;

  if v_normalized_email is not null then
    select id into v_email_lead_id
    from public.sales_leads
    where deleted_at is null
      and normalized_email = v_normalized_email
    order by updated_at desc
    limit 1
    for update;
  end if;

  select id into v_phone_lead_id
  from public.sales_leads
  where deleted_at is null
    and normalized_phone = v_normalized_phone
  order by updated_at desc
  limit 1
  for update;

  if v_email_lead_id is not null
     and v_phone_lead_id is not null
     and v_email_lead_id <> v_phone_lead_id then
    raise exception 'SALES_LEAD_IDENTITY_CONFLICT';
  end if;

  v_lead_id := coalesce(v_email_lead_id, v_phone_lead_id);

  if v_lead_id is null then
    begin
      insert into public.sales_leads (
        name, email, normalized_email, phone, normalized_phone,
        professional_registry, clinic_name, city, state,
        estimated_active_patients, estimated_professionals, operation_type,
        acquisition_channel, job_title, preferred_contact_period, notes,
        status, contact_consent_at, contact_consent_version,
        contact_consent_origin, contact_consent_purpose, created_at, updated_at
      ) values (
        v_name, v_email, v_normalized_email, coalesce(v_phone, '+' || v_normalized_phone), v_normalized_phone,
        nullif(btrim(p_professional_registry), ''), nullif(btrim(p_clinic_name), ''),
        nullif(btrim(p_city), ''), nullif(btrim(p_state), ''),
        p_estimated_active_patients, p_estimated_professionals, v_operation_type,
        v_acquisition_channel, nullif(btrim(p_job_title), ''),
        nullif(btrim(p_preferred_contact_period), ''), nullif(btrim(p_notes), ''),
        'new', now(), p_consent_version, p_consent_origin, p_consent_purpose,
        now(), now()
      )
      returning id into v_lead_id;
      v_created := true;
    exception when unique_violation then
      if v_normalized_email is not null then
        select id into v_email_lead_id
        from public.sales_leads
        where deleted_at is null
          and normalized_email = v_normalized_email
        order by updated_at desc
        limit 1
        for update;
      end if;

      select id into v_phone_lead_id
      from public.sales_leads
      where deleted_at is null
        and normalized_phone = v_normalized_phone
      order by updated_at desc
      limit 1
      for update;

      if v_email_lead_id is not null
         and v_phone_lead_id is not null
         and v_email_lead_id <> v_phone_lead_id then
        raise exception 'SALES_LEAD_IDENTITY_CONFLICT';
      end if;
      v_lead_id := coalesce(v_email_lead_id, v_phone_lead_id);
    end;
  end if;

  if v_lead_id is null then
    raise exception 'SALES_LEAD_UPSERT_FAILED';
  end if;

  -- The canonical public upsert must never mutate a paid customer if their
  -- WhatsApp or email is reused on the website. Existing identity lookups
  -- hold the lead FOR UPDATE, including the uniqueness-conflict retry.
  if not v_created and exists (
    select 1 from public.sales_leads existing
    where existing.id = v_lead_id
      and (
        existing.status = 'converted'
        or existing.converted_user_id is not null
        or existing.converted_clinic_id is not null
        or exists (
          select 1 from public.sales_offers paid
          where paid.lead_id = existing.id
            and paid.status = 'paid'
            and paid.payment_confirmed_at is not null
        )
      )
  ) then
    raise exception 'SALES_LEAD_ALREADY_CUSTOMER' using errcode = 'P0001';
  end if;

  if not v_created then
    update public.sales_leads
    set name = v_name,
        email = coalesce(v_email, email),
        normalized_email = coalesce(v_normalized_email, normalized_email),
        phone = coalesce(v_phone, phone),
        normalized_phone = v_normalized_phone,
        professional_registry = coalesce(nullif(btrim(p_professional_registry), ''), professional_registry),
        clinic_name = coalesce(nullif(btrim(p_clinic_name), ''), clinic_name),
        city = coalesce(nullif(btrim(p_city), ''), city),
        state = coalesce(nullif(btrim(p_state), ''), state),
        estimated_active_patients = coalesce(p_estimated_active_patients, estimated_active_patients),
        estimated_professionals = coalesce(p_estimated_professionals, estimated_professionals),
        operation_type = case
          when nullif(btrim(p_clinic_name), '') is null
               and nullif(btrim(p_professional_registry), '') is null
            then operation_type
          else v_operation_type
        end,
        acquisition_channel = coalesce(nullif(btrim(p_acquisition_channel), ''), acquisition_channel),
        job_title = coalesce(nullif(btrim(p_job_title), ''), job_title),
        preferred_contact_period = coalesce(nullif(btrim(p_preferred_contact_period), ''), preferred_contact_period),
        notes = coalesce(nullif(btrim(p_notes), ''), notes),
        contact_consent_at = now(),
        contact_consent_version = p_consent_version,
        contact_consent_origin = p_consent_origin,
        contact_consent_purpose = p_consent_purpose,
        updated_at = now()
    where id = v_lead_id;
  end if;

  v_event_type := case
    when p_source = 'google_interest' then 'google_interest_started'::public.sales_lead_event_type
    when v_created then 'lead_created'::public.sales_lead_event_type
    else 'lead_updated'::public.sales_lead_event_type
  end;

  insert into public.sales_lead_events (
    lead_id, event_type, metadata, idempotency_key
  ) values (
    v_lead_id,
    v_event_type,
    jsonb_build_object(
      'source', left(coalesce(p_source, 'public_landing'), 80),
      'capture', 'minimal_interest',
      'consent_version', p_consent_version,
      'consent_purpose', p_consent_purpose
    ),
    p_idempotency_key
  )
  on conflict (idempotency_key) do nothing;
  get diagnostics v_rows = row_count;
  v_event_created := v_rows > 0;

  return query select v_lead_id, v_event_created, v_created;
end
$function$;

revoke all on function public.upsert_public_sales_lead(
  text,text,text,text,text,text,text,text,text,
  integer,integer,text,text,text,text,text,text,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.upsert_public_sales_lead(
  text,text,text,text,text,text,text,text,text,
  integer,integer,text,text,text,text,text,text,text,text,text,text
) to postgres,service_role;
commit;
