-- Minimal public sales lead capture: name, WhatsApp and optional clinic name.
-- Existing enriched leads remain authoritative; omitted optional data is never erased.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $guard$
begin
  if to_regclass('public.sales_leads') is null
     or to_regclass('public.sales_lead_events') is null
     or to_regprocedure(
       'public.upsert_public_sales_lead(text,text,text,text,text,text,text,text,text,integer,integer,text,text,text,text,text,text,text,text,text,text)'
     ) is null then
    raise exception 'SALES_MINIMAL_CAPTURE_CANONICAL_SCHEMA_REQUIRED';
  end if;
end
$guard$;

alter table public.sales_leads alter column email drop not null;
alter table public.sales_leads alter column normalized_email drop not null;
alter table public.sales_leads alter column estimated_active_patients drop not null;

comment on column public.sales_leads.email is
  'Optional during minimal interest capture; collected later during assisted sales.';
comment on column public.sales_leads.normalized_email is
  'Optional normalized lead email; WhatsApp is the initial canonical identity when absent.';
comment on column public.sales_leads.estimated_active_patients is
  'Optional until the commercial qualification step.';

create or replace function public.upsert_public_sales_lead(
  p_name text,
  p_email text,
  p_normalized_email text,
  p_phone text,
  p_normalized_phone text,
  p_professional_registry text,
  p_clinic_name text,
  p_city text,
  p_state text,
  p_estimated_active_patients integer,
  p_estimated_professionals integer,
  p_operation_type text,
  p_acquisition_channel text,
  p_job_title text,
  p_preferred_contact_period text,
  p_notes text,
  p_consent_version text,
  p_consent_origin text,
  p_consent_purpose text,
  p_source text,
  p_idempotency_key text
)
returns table (lead_id uuid, event_created boolean, lead_created boolean)
language plpgsql
security definer
set search_path = public
as $function$
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
  text, text, text, text, text, text, text, text, text,
  integer, integer, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.upsert_public_sales_lead(
  text, text, text, text, text, text, text, text, text,
  integer, integer, text, text, text, text, text, text, text, text, text, text
) to postgres, service_role;

-- Keep the read-only production auditor aligned without rewriting its history.
do $fingerprint_upgrade$
begin
  if to_regprocedure('public.get_sales_commercial_schema_fingerprint_v1()') is null then
    if to_regprocedure('public.get_sales_commercial_schema_fingerprint()') is null then
      raise exception 'SALES_COMMERCIAL_FINGERPRINT_V1_REQUIRED';
    end if;
    alter function public.get_sales_commercial_schema_fingerprint()
      rename to get_sales_commercial_schema_fingerprint_v1;
  end if;
end
$fingerprint_upgrade$;

create or replace function public.get_sales_commercial_schema_fingerprint()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fingerprint$
declare
  v_base jsonb;
  v_result jsonb;
  v_types_ok boolean := false;
  v_tables_ok boolean := false;
  v_columns_ok boolean := false;
  v_enums_ok boolean := false;
  v_indexes_ok boolean := false;
  v_rpc_ok boolean := false;
  v_legacy_absent boolean := false;
  v_structural_ready boolean := false;
  v_security_ready boolean := false;
begin
  v_base := public.get_sales_commercial_schema_fingerprint_v1();

  with expected(table_name, column_name, udt_schema, udt_name, is_nullable) as (
    values
      ('sales_leads','id','pg_catalog','uuid','NO'),
      ('sales_leads','email','pg_catalog','text','YES'),
      ('sales_leads','normalized_email','pg_catalog','text','YES'),
      ('sales_leads','normalized_phone','pg_catalog','text','NO'),
      ('sales_leads','estimated_active_patients','pg_catalog','int4','YES'),
      ('sales_leads','status','public','sales_lead_status','NO'),
      ('sales_leads','contact_consent_at','pg_catalog','timestamptz','NO')
  )
  select not exists (
    select 1
    from expected e
    left join information_schema.columns c
      on c.table_schema = 'public'
     and c.table_name = e.table_name
     and c.column_name = e.column_name
    where c.column_name is null
       or c.udt_schema <> e.udt_schema
       or c.udt_name <> e.udt_name
       or c.is_nullable <> e.is_nullable
  ) into v_types_ok;

  select coalesce(bool_and(value::boolean), false)
    into v_tables_ok
  from jsonb_each_text(v_base #> '{checks,tables}');
  select coalesce(bool_and(value::boolean), false)
    into v_columns_ok
  from jsonb_each_text(v_base #> '{checks,columns}');
  select coalesce(bool_and(value::boolean), false)
    into v_enums_ok
  from jsonb_each_text(v_base #> '{checks,enums}');
  select coalesce(bool_and(value::boolean), false)
    into v_indexes_ok
  from jsonb_each_text(v_base #> '{checks,indexes}');

  v_rpc_ok := coalesce((v_base #>> '{checks,rpc,upsert_public_sales_lead}')::boolean, false)
    and coalesce((v_base #>> '{checks,rpc,signature}')::boolean, false)
    and coalesce((v_base #>> '{checks,rpc,security_definer}')::boolean, false)
    and coalesce((v_base #>> '{checks,rpc,search_path_fixed}')::boolean, false)
    and coalesce((v_base #>> '{checks,rpc,named_arguments}')::boolean, false);
  v_legacy_absent := not coalesce((v_base #>> '{checks,legacy,sales_activations}')::boolean, true)
    and not coalesce((v_base #>> '{checks,legacy,capture_sales_lead}')::boolean, true)
    and not coalesce((v_base #>> '{checks,legacy,legacy_columns}')::boolean, true)
    and not coalesce((v_base #>> '{checks,legacy,legacy_indexes}')::boolean, true);
  v_security_ready := coalesce((v_base ->> 'security_ready')::boolean, false);
  v_structural_ready := v_tables_ok and v_columns_ok and v_types_ok
    and v_enums_ok and v_indexes_ok and v_rpc_ok and v_legacy_absent;

  v_result := jsonb_set(v_base, '{version}', to_jsonb('20260722170000'::text), true);
  v_result := jsonb_set(v_result, '{contract}', to_jsonb('sales_assisted_signup_v2_minimal_capture'::text), true);
  v_result := jsonb_set(v_result, '{fingerprint}', to_jsonb('sha256:a978f0d9079d3585d92d22e143c57c8236bb2256b2ddb0d86564c759480f198e'::text), true);
  v_result := jsonb_set(v_result, '{checks,critical_types}', to_jsonb(v_types_ok), true);
  v_result := jsonb_set(
    v_result,
    '{checks,minimal_capture}',
    jsonb_build_object(
      'email_optional', v_types_ok,
      'estimated_active_patients_optional', v_types_ok,
      'whatsapp_identity', true
    ),
    true
  );
  v_result := jsonb_set(v_result, '{structural_ready}', to_jsonb(v_structural_ready), true);
  v_result := jsonb_set(v_result, '{security_ready}', to_jsonb(v_security_ready), true);
  v_result := jsonb_set(v_result, '{ready}', to_jsonb(v_structural_ready and v_security_ready), true);
  return v_result;
end
$fingerprint$;

revoke all on function public.get_sales_commercial_schema_fingerprint()
  from public, anon, authenticated;
grant execute on function public.get_sales_commercial_schema_fingerprint()
  to postgres, service_role;
revoke all on function public.get_sales_commercial_schema_fingerprint_v1()
  from public, anon, authenticated;
grant execute on function public.get_sales_commercial_schema_fingerprint_v1()
  to postgres, service_role;

do $validate$
declare
  v_status jsonb;
begin
  v_status := public.get_sales_commercial_schema_fingerprint();
  if coalesce((v_status ->> 'ready')::boolean, false) is not true then
    raise exception 'SALES_MINIMAL_CAPTURE_SCHEMA_INCOMPATIBLE: %', v_status;
  end if;
end
$validate$;

notify pgrst, 'reload schema';

commit;
