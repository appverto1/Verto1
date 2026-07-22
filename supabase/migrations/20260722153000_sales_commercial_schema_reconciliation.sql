-- Verto commercial schema reconciliation and least-privilege hardening.
--
-- This migration is intentionally non-destructive:
-- - it does not create or alter commercial tables;
-- - it does not write commercial rows or the migration ledger;
-- - it aborts when the canonical sales_assisted_signup_v1 contract is absent;
-- - it only hardens proven excessive grants and installs a read-only fingerprint.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.get_sales_commercial_schema_fingerprint()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_version constant text := '20260722153000';
  v_contract constant text := 'sales_assisted_signup_v1';
  v_fingerprint constant text := 'sha256:8dd425a4045e9c10d81039e3d2962590ae2496b1c0e6e6e4d2ab8dd69c1cda5b';
  v_tables jsonb := '{}'::jsonb;
  v_columns jsonb := '{}'::jsonb;
  v_enums jsonb := '{}'::jsonb;
  v_rls jsonb := '{}'::jsonb;
  v_policies jsonb := '{}'::jsonb;
  v_indexes jsonb := '{}'::jsonb;
  v_rpc jsonb := '{}'::jsonb;
  v_grants jsonb := '{}'::jsonb;
  v_legacy jsonb := '{}'::jsonb;
  v_tables_ok boolean := false;
  v_columns_ok boolean := false;
  v_types_ok boolean := false;
  v_enums_ok boolean := false;
  v_rls_ok boolean := false;
  v_policies_ok boolean := false;
  v_indexes_ok boolean := false;
  v_rpc_definition_ok boolean := false;
  v_rpc_access_ok boolean := false;
  v_fingerprint_access_ok boolean := false;
  v_commercial_grants_ok boolean := false;
  v_pending_grants_ok boolean := false;
  v_legacy_absent boolean := false;
  v_structural_ready boolean := false;
  v_security_ready boolean := false;
  v_upsert_oid oid;
  v_fingerprint_oid oid;
  v_result_signature text := '';
  v_rpc_security_definer boolean := false;
  v_rpc_search_path_fixed boolean := false;
  v_rpc_named_arguments_ok boolean := false;
  v_platform_admin_helper_ok boolean := false;
  v_legacy_table boolean := false;
  v_legacy_function boolean := false;
  v_legacy_columns boolean := false;
  v_legacy_indexes boolean := false;
begin
  with expected(table_name) as (
    values
      ('sales_leads'),
      ('sales_lead_events'),
      ('sales_offers'),
      ('pending_activations'),
      ('sales_subscription_discounts'),
      ('sales_discount_notifications')
  ), checked as (
    select
      table_name,
      to_regclass(format('public.%I', table_name)) is not null as present
    from expected
  )
  select jsonb_object_agg(table_name, present), bool_and(present)
    into v_tables, v_tables_ok
  from checked;

  with expected(table_name, required_columns) as (
    values
      ('sales_leads', array[
        'id','name','email','normalized_email','phone','normalized_phone',
        'professional_registry','clinic_name','city','state',
        'estimated_active_patients','estimated_professionals','operation_type',
        'acquisition_channel','job_title','preferred_contact_period','notes',
        'status','contact_consent_at','contact_consent_version',
        'contact_consent_origin','contact_consent_purpose','do_not_contact',
        'assigned_owner_id','last_contact_at','next_followup_at',
        'converted_user_id','converted_clinic_id','created_at','updated_at','deleted_at'
      ]::text[]),
      ('sales_lead_events', array[
        'id','lead_id','event_type','actor_user_id','metadata','idempotency_key','created_at'
      ]::text[]),
      ('sales_offers', array[
        'id','lead_id','status','base_unit_amount_cents','currency',
        'initial_active_patient_quantity','discount_duration_months','discount_type',
        'discount_percentage','stripe_customer_id','stripe_checkout_session_id',
        'stripe_subscription_id','stripe_discount_id','stripe_coupon_id',
        'stripe_promotion_code_id','public_token_hash','commercial_notes','expires_at',
        'revoked_at','created_by','idempotency_key','created_at','updated_at','accepted_at'
      ]::text[]),
      ('pending_activations', array[
        'id','email','token','used','created_at','source','sales_offer_id','sales_lead_id',
        'stripe_checkout_session_id','expires_at','activation_email_sent_at'
      ]::text[]),
      ('sales_subscription_discounts', array[
        'id','offer_id','lead_id','user_id','clinic_id','stripe_subscription_id',
        'stripe_discount_id','stripe_coupon_id','stripe_promotion_code_id','discount_type',
        'discount_percentage','discount_duration_months','discount_started_at',
        'discount_ends_at','next_billing_at','post_discount_unit_amount_cents',
        'estimated_next_invoice_amount_cents','discount_status','last_discount_sync_at',
        'created_at','updated_at'
      ]::text[]),
      ('sales_discount_notifications', array[
        'id','subscription_discount_id','notification_window','idempotency_key',
        'internal_notification_sent_at','email_sent_at','email_error','created_at','updated_at'
      ]::text[])
  ), checked as (
    select
      e.table_name,
      not exists (
        select 1
        from unnest(e.required_columns) as required(column_name)
        where not exists (
          select 1
          from information_schema.columns c
          where c.table_schema = 'public'
            and c.table_name = e.table_name
            and c.column_name = required.column_name
        )
      ) as present
    from expected e
  )
  select jsonb_object_agg(table_name, present), bool_and(present)
    into v_columns, v_columns_ok
  from checked;

  with expected(table_name, column_name, udt_schema, udt_name, must_be_not_null) as (
    values
      ('sales_leads','id','pg_catalog','uuid',true),
      ('sales_leads','normalized_email','pg_catalog','text',true),
      ('sales_leads','normalized_phone','pg_catalog','text',true),
      ('sales_leads','status','public','sales_lead_status',true),
      ('sales_leads','contact_consent_at','pg_catalog','timestamptz',true),
      ('sales_lead_events','id','pg_catalog','uuid',true),
      ('sales_lead_events','event_type','public','sales_lead_event_type',true),
      ('sales_lead_events','metadata','pg_catalog','jsonb',true),
      ('sales_lead_events','idempotency_key','pg_catalog','text',true),
      ('sales_offers','id','pg_catalog','uuid',true),
      ('sales_offers','status','public','sales_offer_status',true),
      ('sales_offers','base_unit_amount_cents','pg_catalog','int4',true),
      ('sales_offers','initial_active_patient_quantity','pg_catalog','int4',true),
      ('sales_offers','public_token_hash','pg_catalog','text',true),
      ('sales_offers','created_by','pg_catalog','uuid',true),
      ('sales_offers','idempotency_key','pg_catalog','text',true),
      ('sales_offers','expires_at','pg_catalog','timestamptz',true),
      ('pending_activations','id','pg_catalog','uuid',true),
      ('pending_activations','token','pg_catalog','text',true),
      ('pending_activations','used','pg_catalog','bool',true),
      ('pending_activations','sales_offer_id','pg_catalog','uuid',false),
      ('pending_activations','sales_lead_id','pg_catalog','uuid',false),
      ('pending_activations','stripe_checkout_session_id','pg_catalog','text',false),
      ('sales_subscription_discounts','id','pg_catalog','uuid',true),
      ('sales_subscription_discounts','stripe_subscription_id','pg_catalog','text',true),
      ('sales_subscription_discounts','post_discount_unit_amount_cents','pg_catalog','int4',true),
      ('sales_discount_notifications','id','pg_catalog','uuid',true),
      ('sales_discount_notifications','subscription_discount_id','pg_catalog','uuid',true),
      ('sales_discount_notifications','notification_window','pg_catalog','text',true),
      ('sales_discount_notifications','idempotency_key','pg_catalog','text',true)
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
       or (e.must_be_not_null and c.is_nullable <> 'NO')
  ) into v_types_ok;

  select jsonb_build_object(
    'sales_lead_status', coalesce(array_agg(e.enumlabel::text order by e.enumlabel), array[]::text[]) = array[
      'archived','checkout_opened','checkout_sent','contact_started','converted',
      'demo_completed','demo_scheduled','lost','new','payment_pending',
      'proposal_preparing','proposal_sent'
    ]::text[]
  )
    into v_enums
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace and n.nspname = 'public'
  left join pg_enum e on e.enumtypid = t.oid
  where t.typname = 'sales_lead_status';

  v_enums := v_enums || (
    select jsonb_build_object(
      'sales_lead_event_type', coalesce(array_agg(e.enumlabel::text order by e.enumlabel), array[]::text[]) = array[
        'activation_completed','activation_sent','checkout_created','checkout_expired',
        'checkout_opened','contact_started','demo_completed','demo_scheduled',
        'google_interest_started','lead_created','lead_lost','lead_updated',
        'payment_completed','proposal_created','proposal_sent'
      ]::text[]
    )
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace and n.nspname = 'public'
    left join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'sales_lead_event_type'
  );

  v_enums := v_enums || (
    select jsonb_build_object(
      'sales_offer_status', coalesce(array_agg(e.enumlabel::text order by e.enumlabel), array[]::text[]) = array[
        'cancelled','checkout_created','draft','expired','opened','paid',
        'payment_pending','ready','sent'
      ]::text[]
    )
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace and n.nspname = 'public'
    left join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'sales_offer_status'
  );

  v_enums_ok := coalesce((v_enums ->> 'sales_lead_status')::boolean, false)
    and coalesce((v_enums ->> 'sales_lead_event_type')::boolean, false)
    and coalesce((v_enums ->> 'sales_offer_status')::boolean, false);

  v_upsert_oid := to_regprocedure(
    'public.upsert_public_sales_lead(text,text,text,text,text,text,text,text,text,integer,integer,text,text,text,text,text,text,text,text,text,text)'
  )::oid;

  if v_upsert_oid is not null then
    select
      p.prosecdef,
      coalesce(p.proconfig, array[]::text[]) @> array['search_path=public']::text[],
      regexp_replace(lower(pg_get_function_result(p.oid)), '[[:space:]]+', ' ', 'g'),
      p.proargnames[1:p.pronargs] = array[
        'p_name','p_email','p_normalized_email','p_phone','p_normalized_phone',
        'p_professional_registry','p_clinic_name','p_city','p_state',
        'p_estimated_active_patients','p_estimated_professionals','p_operation_type',
        'p_acquisition_channel','p_job_title','p_preferred_contact_period','p_notes',
        'p_consent_version','p_consent_origin','p_consent_purpose','p_source','p_idempotency_key'
      ]::text[]
      into v_rpc_security_definer, v_rpc_search_path_fixed, v_result_signature, v_rpc_named_arguments_ok
    from pg_proc p
    where p.oid = v_upsert_oid;
  end if;

  v_rpc_definition_ok := v_upsert_oid is not null
    and v_rpc_security_definer
    and v_rpc_search_path_fixed
    and v_rpc_named_arguments_ok
    and v_result_signature = 'table(lead_id uuid, event_created boolean, lead_created boolean)';

  v_rpc_access_ok := v_upsert_oid is not null
    and has_function_privilege('postgres', v_upsert_oid, 'EXECUTE')
    and has_function_privilege('service_role', v_upsert_oid, 'EXECUTE')
    and not has_function_privilege('anon', v_upsert_oid, 'EXECUTE')
    and not has_function_privilege('authenticated', v_upsert_oid, 'EXECUTE')
    and not exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      where p.oid = v_upsert_oid
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    );

  v_rpc := jsonb_build_object(
    'upsert_public_sales_lead', v_upsert_oid is not null,
    'signature', v_rpc_definition_ok,
    'security_definer', v_rpc_security_definer,
    'search_path_fixed', v_rpc_search_path_fixed,
    'named_arguments', v_rpc_named_arguments_ok,
    'postgres_execute', v_upsert_oid is not null and has_function_privilege('postgres', v_upsert_oid, 'EXECUTE'),
    'service_role_execute', v_upsert_oid is not null and has_function_privilege('service_role', v_upsert_oid, 'EXECUTE'),
    'anon_execute', v_upsert_oid is not null and has_function_privilege('anon', v_upsert_oid, 'EXECUTE'),
    'authenticated_execute', v_upsert_oid is not null and has_function_privilege('authenticated', v_upsert_oid, 'EXECUTE')
  );

  with expected(table_name) as (
    values
      ('sales_leads'),('sales_lead_events'),('sales_offers'),
      ('pending_activations'),('sales_subscription_discounts'),
      ('sales_discount_notifications')
  ), checked as (
    select e.table_name, coalesce(c.relrowsecurity, false) as enabled
    from expected e
    left join pg_class c
      on c.relnamespace = 'public'::regnamespace
     and c.relname = e.table_name
     and c.relkind in ('r','p')
  )
  select jsonb_object_agg(table_name, enabled), bool_and(enabled)
    into v_rls, v_rls_ok
  from checked;

  select exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure('public.is_platform_sales_admin()')::oid
      and p.prosecdef
      and coalesce(p.proconfig, array[]::text[]) @> array['search_path=public']::text[]
      and pg_get_function_result(p.oid) = 'boolean'
  ) into v_platform_admin_helper_ok;

  with expected(table_name) as (
    values
      ('sales_leads'),('sales_lead_events'),('sales_offers'),
      ('sales_subscription_discounts'),('sales_discount_notifications')
  ), checked as (
    select e.table_name, exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = e.table_name
        and p.policyname = e.table_name || '_platform_sales_admin_all'
        and p.permissive = 'PERMISSIVE'
        and p.cmd = 'ALL'
        and p.roles::text = '{authenticated}'
        and coalesce(p.qual, '') like '%is_platform_sales_admin()%'
        and coalesce(p.with_check, '') like '%is_platform_sales_admin()%'
    ) as valid
    from expected e
  )
  select jsonb_object_agg(table_name, valid), bool_and(valid)
    into v_policies, v_policies_ok
  from checked;

  v_policies_ok := v_policies_ok
    and v_platform_admin_helper_ok
    and not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename in (
          'sales_leads','sales_lead_events','sales_offers',
          'sales_subscription_discounts','sales_discount_notifications'
        )
        and p.policyname <> p.tablename || '_platform_sales_admin_all'
    )
    and not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = 'pending_activations'
    );

  v_policies := v_policies || jsonb_build_object(
    'platform_admin_helper', v_platform_admin_helper_ok,
    'pending_activations_no_public_policy', not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'pending_activations'
    )
  );

  with expected(index_name, table_name, key_columns, predicate_kind) as (
    values
      ('sales_leads_normalized_email_uidx','sales_leads',array['normalized_email']::text[],'deleted_at_null'),
      ('sales_leads_normalized_phone_uidx','sales_leads',array['normalized_phone']::text[],'deleted_at_null'),
      ('sales_lead_events_idempotency_uidx','sales_lead_events',array['idempotency_key']::text[],'none'),
      ('sales_offers_public_token_hash_uidx','sales_offers',array['public_token_hash']::text[],'none'),
      ('sales_offers_creator_idempotency_uidx','sales_offers',array['created_by','idempotency_key']::text[],'none'),
      ('pending_activations_sales_checkout_uidx','pending_activations',array['stripe_checkout_session_id']::text[],'stripe_checkout_not_null'),
      ('pending_activations_sales_token_uidx','pending_activations',array['token']::text[],'source_sales_assisted_signup'),
      ('sales_subscription_discounts_subscription_uidx','sales_subscription_discounts',array['stripe_subscription_id']::text[],'none'),
      ('sales_discount_notifications_idempotency_uidx','sales_discount_notifications',array['idempotency_key']::text[],'none')
  ), checked as (
    select e.index_name, exists (
      select 1
      from pg_class idx
      join pg_namespace idx_ns on idx_ns.oid = idx.relnamespace and idx_ns.nspname = 'public'
      join pg_index i on i.indexrelid = idx.oid
      join pg_class tbl on tbl.oid = i.indrelid and tbl.relname = e.table_name
      where idx.relname = e.index_name
        and idx.relkind = 'i'
        and i.indisunique
        and i.indisvalid
        and i.indisready
        and i.indexprs is null
        and i.indnkeyatts = cardinality(e.key_columns)
        and (
          select array_agg(a.attname::text order by keys.ordinality)
          from unnest(i.indkey::smallint[]) with ordinality as keys(attnum, ordinality)
          join pg_attribute a on a.attrelid = i.indrelid and a.attnum = keys.attnum
          where keys.ordinality <= i.indnkeyatts
        ) = e.key_columns
        and case e.predicate_kind
          when 'none' then i.indpred is null
          when 'deleted_at_null' then
            regexp_replace(lower(coalesce(pg_get_expr(i.indpred, i.indrelid), '')), '[[:space:]()]', '', 'g') = 'deleted_atisnull'
          when 'stripe_checkout_not_null' then
            regexp_replace(lower(coalesce(pg_get_expr(i.indpred, i.indrelid), '')), '[[:space:]()]', '', 'g') = 'stripe_checkout_session_idisnotnull'
          when 'source_sales_assisted_signup' then
            regexp_replace(lower(coalesce(pg_get_expr(i.indpred, i.indrelid), '')), '[[:space:]()]', '', 'g') in (
              'source=''sales_assisted_signup''',
              'source=''sales_assisted_signup''::text'
            )
          else false
        end
    ) as valid
    from expected e
  )
  select jsonb_object_agg(index_name, valid), bool_and(valid)
    into v_indexes, v_indexes_ok
  from checked;

  v_legacy_table := to_regclass('public.sales_activations') is not null;
  v_legacy_function := exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'capture_sales_lead'
  );
  v_legacy_columns := exists (
    select 1
    from (values
      ('sales_leads','role_title'),
      ('sales_leads','consent_text_version'),
      ('sales_leads','consent_source'),
      ('sales_leads','consent_purpose'),
      ('sales_leads','submission_fingerprint'),
      ('sales_offers','discount_started_at'),
      ('sales_offers','discount_ends_at'),
      ('sales_offers','discount_status'),
      ('sales_offers','post_discount_unit_amount_cents'),
      ('sales_offers','next_billing_at'),
      ('sales_offers','last_discount_sync_at'),
      ('sales_discount_notifications','offer_id'),
      ('sales_discount_notifications','subscription_id'),
      ('sales_discount_notifications','discount_ends_at'),
      ('sales_discount_notifications','notification_window_days'),
      ('sales_discount_notifications','status'),
      ('sales_discount_notifications','sent_at'),
      ('sales_discount_notifications','error_message')
    ) as legacy(table_name, column_name)
    join information_schema.columns c
      on c.table_schema = 'public'
     and c.table_name = legacy.table_name
     and c.column_name = legacy.column_name
  );
  v_legacy_indexes := to_regclass('public.sales_offers_idempotency_uidx') is not null
    or to_regclass('public.sales_offers_discount_expiry_idx') is not null;
  v_legacy_absent := not v_legacy_table
    and not v_legacy_function
    and not v_legacy_columns
    and not v_legacy_indexes;
  v_legacy := jsonb_build_object(
    'sales_activations', v_legacy_table,
    'capture_sales_lead', v_legacy_function,
    'legacy_columns', v_legacy_columns,
    'legacy_indexes', v_legacy_indexes
  );

  with expected(table_name) as (
    values
      ('sales_leads'),('sales_lead_events'),('sales_offers'),
      ('sales_subscription_discounts'),('sales_discount_notifications')
  ), checked as (
    select e.table_name, (
      not has_table_privilege('anon', c.oid, 'SELECT')
      and not has_table_privilege('anon', c.oid, 'INSERT')
      and not has_table_privilege('anon', c.oid, 'UPDATE')
      and not has_table_privilege('anon', c.oid, 'DELETE')
      and not has_table_privilege('anon', c.oid, 'TRUNCATE')
      and has_table_privilege('authenticated', c.oid, 'SELECT')
      and has_table_privilege('authenticated', c.oid, 'INSERT')
      and has_table_privilege('authenticated', c.oid, 'UPDATE')
      and not has_table_privilege('authenticated', c.oid, 'DELETE')
      and not has_table_privilege('authenticated', c.oid, 'TRUNCATE')
      and has_table_privilege('service_role', c.oid, 'SELECT')
      and has_table_privilege('service_role', c.oid, 'INSERT')
      and has_table_privilege('service_role', c.oid, 'UPDATE')
      and has_table_privilege('service_role', c.oid, 'DELETE')
      and not exists (
        select 1
        from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
        where acl.grantee = 0
      )
    ) as valid
    from expected e
    join pg_class c
      on c.relnamespace = 'public'::regnamespace
     and c.relname = e.table_name
     and c.relkind in ('r','p')
  )
  select coalesce(bool_and(valid), false)
    into v_commercial_grants_ok
  from checked;

  select (
    not has_table_privilege('anon', c.oid, 'SELECT')
    and not has_table_privilege('anon', c.oid, 'INSERT')
    and not has_table_privilege('anon', c.oid, 'UPDATE')
    and not has_table_privilege('anon', c.oid, 'DELETE')
    and not has_table_privilege('anon', c.oid, 'TRUNCATE')
    and not has_table_privilege('authenticated', c.oid, 'SELECT')
    and not has_table_privilege('authenticated', c.oid, 'INSERT')
    and not has_table_privilege('authenticated', c.oid, 'UPDATE')
    and not has_table_privilege('authenticated', c.oid, 'DELETE')
    and not has_table_privilege('authenticated', c.oid, 'TRUNCATE')
    and has_table_privilege('service_role', c.oid, 'SELECT')
    and has_table_privilege('service_role', c.oid, 'INSERT')
    and has_table_privilege('service_role', c.oid, 'UPDATE')
    and has_table_privilege('service_role', c.oid, 'DELETE')
    and not has_table_privilege('service_role', c.oid, 'TRUNCATE')
    and not has_table_privilege('service_role', c.oid, 'REFERENCES')
    and not has_table_privilege('service_role', c.oid, 'TRIGGER')
    and not exists (
      select 1
      from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
      where acl.grantee = 0
    )
  ) into v_pending_grants_ok
  from pg_class c
  where c.oid = 'public.pending_activations'::regclass;

  v_fingerprint_oid := to_regprocedure('public.get_sales_commercial_schema_fingerprint()')::oid;
  v_fingerprint_access_ok := v_fingerprint_oid is not null
    and has_function_privilege('postgres', v_fingerprint_oid, 'EXECUTE')
    and has_function_privilege('service_role', v_fingerprint_oid, 'EXECUTE')
    and not has_function_privilege('anon', v_fingerprint_oid, 'EXECUTE')
    and not has_function_privilege('authenticated', v_fingerprint_oid, 'EXECUTE')
    and not exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      where p.oid = v_fingerprint_oid
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    );

  v_grants := jsonb_build_object(
    'commercial_tables_restricted', v_commercial_grants_ok,
    'pending_activations_least_privilege', v_pending_grants_ok,
    'upsert_rpc_server_only', v_rpc_access_ok,
    'fingerprint_rpc_server_only', v_fingerprint_access_ok
  );

  v_structural_ready := v_tables_ok
    and v_columns_ok
    and v_types_ok
    and v_enums_ok
    and v_rpc_definition_ok
    and v_rls_ok
    and v_policies_ok
    and v_indexes_ok
    and v_legacy_absent;
  v_security_ready := v_commercial_grants_ok
    and v_pending_grants_ok
    and v_rpc_access_ok
    and v_fingerprint_access_ok;

  return jsonb_build_object(
    'version', v_version,
    'contract', v_contract,
    'fingerprint', v_fingerprint,
    'ready', v_structural_ready and v_security_ready,
    'structural_ready', v_structural_ready,
    'security_ready', v_security_ready,
    'checks', jsonb_build_object(
      'tables', v_tables,
      'columns', v_columns,
      'critical_types', v_types_ok,
      'enums', v_enums,
      'rpc', v_rpc,
      'rls', v_rls,
      'policies', v_policies,
      'indexes', v_indexes,
      'grants', v_grants,
      'legacy', v_legacy
    )
  );
end;
$function$;

do $guard$
declare
  v_status jsonb;
begin
  v_status := public.get_sales_commercial_schema_fingerprint();
  if coalesce((v_status ->> 'structural_ready')::boolean, false) is not true then
    if coalesce((v_status #>> '{checks,legacy,sales_activations}')::boolean, false)
      or coalesce((v_status #>> '{checks,legacy,capture_sales_lead}')::boolean, false)
      or coalesce((v_status #>> '{checks,legacy,legacy_columns}')::boolean, false)
      or coalesce((v_status #>> '{checks,legacy,legacy_indexes}')::boolean, false) then
      raise exception using
        errcode = 'P0001',
        message = 'SALES_COMMERCIAL_SCHEMA_LEGACY_OR_HYBRID: manual reconciliation required';
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'SALES_COMMERCIAL_SCHEMA_INCOMPATIBLE: canonical contract incomplete';
  end if;
end;
$guard$;

-- Every repository consumer uses the server-side service-role client. Keep the
-- activation table private and grant only the DML operations used by server.ts.
revoke all on table public.pending_activations from public;
revoke all on table public.pending_activations from anon;
revoke all on table public.pending_activations from authenticated;
revoke all on table public.pending_activations from service_role;
grant select, insert, update, delete on table public.pending_activations to service_role;

revoke all on function public.upsert_public_sales_lead(
  text, text, text, text, text, text, text, text, text,
  integer, integer, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.upsert_public_sales_lead(
  text, text, text, text, text, text, text, text, text,
  integer, integer, text, text, text, text, text, text, text, text, text, text
) to postgres, service_role;

revoke all on function public.get_sales_commercial_schema_fingerprint()
  from public, anon, authenticated;
grant execute on function public.get_sales_commercial_schema_fingerprint()
  to postgres, service_role;

do $verify$
declare
  v_status jsonb;
begin
  v_status := public.get_sales_commercial_schema_fingerprint();
  if coalesce((v_status ->> 'ready')::boolean, false) is not true then
    raise exception using
      errcode = 'P0001',
      message = 'SALES_COMMERCIAL_SCHEMA_SECURITY_RECONCILIATION_FAILED';
  end if;
end;
$verify$;

comment on function public.get_sales_commercial_schema_fingerprint() is
  'Read-only, service-role-only readiness probe for the canonical Verto commercial schema.';

notify pgrst, 'reload schema';

commit;
