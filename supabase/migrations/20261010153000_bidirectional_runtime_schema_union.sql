-- Issue #366: additive runtime schema dependencies from verified staging metadata.

-- Existing production financial functions, director compatibility, data and legacy RPC overloads remain intact.

begin;

set local lock_timeout = '5s';

set local statement_timeout = '90s';

CREATE TABLE IF NOT EXISTS public."aba_patient_reinforcers" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "label" text NOT NULL,
  "category" text,
  "note" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid NOT NULL,
  "updated_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."aba_reinforcer_delivery_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "session_id" text NOT NULL,
  "reinforcer_id" uuid NOT NULL,
  "client_event_id" text NOT NULL,
  "event_type" text DEFAULT 'DELIVERED'::text NOT NULL,
  "label_snapshot" text NOT NULL,
  "category_snapshot" text,
  "actor_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "payload_hash" text NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."aba_session_locations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."aba_user_session_preferences" (
  "clinic_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "quick_behavior_shortcuts" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."clinic_communication_audit_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "thread_id" uuid,
  "message_id" uuid,
  "actor_user_id" uuid,
  "event_type" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."clinic_communication_mentions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "thread_id" uuid NOT NULL,
  "message_id" uuid NOT NULL,
  "mentioned_user_id" uuid,
  "mentioned_name_snapshot" text NOT NULL,
  "mentioned_role_snapshot" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "notified_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "notification_read_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public."clinic_communication_messages" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "thread_id" uuid NOT NULL,
  "sequence" bigint NOT NULL,
  "author_user_id" uuid,
  "author_name_snapshot" text NOT NULL,
  "author_role_snapshot" text NOT NULL,
  "body" text NOT NULL,
  "operation_type" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."clinic_communication_read_states" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "thread_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "last_read_sequence" bigint DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."clinic_communication_threads" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "subject" text NOT NULL,
  "status" text DEFAULT 'open'::text NOT NULL,
  "reference_type" text,
  "reference_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "archived_at" timestamp with time zone,
  "archived_by" uuid,
  "last_activity_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "last_sequence" bigint DEFAULT 0 NOT NULL,
  "last_message_author_name_snapshot" text,
  "last_message_author_role_snapshot" text,
  "last_message_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public."clinic_protocol_grants" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "clinic_id" uuid NOT NULL,
  "canonical_key" text NOT NULL,
  "source_request_id" uuid NOT NULL,
  "granted_by" uuid NOT NULL,
  "granted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."module_subscription_upgrade_intents" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "sales_offer_id" uuid NOT NULL,
  "stripe_subscription_id" text NOT NULL,
  "expected_access_profile_version" bigint NOT NULL,
  "expected_access_profile_mode" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "intent_status" text DEFAULT 'claimed'::text NOT NULL,
  "claim_token" uuid DEFAULT gen_random_uuid() NOT NULL,
  "claim_expires_at" timestamp with time zone NOT NULL,
  "stripe_operation_id" text,
  "stripe_invoice_id" text,
  "stripe_event_id" text,
  "stripe_event_created_at" timestamp with time zone,
  "last_error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public."onboarding_publications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "template_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "clinic_id" uuid NOT NULL,
  "snapshot_title" text NOT NULL,
  "snapshot_message" text NOT NULL,
  "snapshot_topics" text[] NOT NULL,
  "snapshot_participant_guidance" text NOT NULL,
  "status" text DEFAULT 'published'::text NOT NULL,
  "published_by" uuid NOT NULL,
  "published_at" timestamp with time zone DEFAULT now() NOT NULL,
  "viewed_at" timestamp with time zone,
  "responded_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."onboarding_responses" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "publication_id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "slot_id" uuid NOT NULL,
  "participants" text[] NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" text DEFAULT 'responded'::text NOT NULL,
  "is_current" boolean DEFAULT true NOT NULL,
  "previous_response_id" uuid,
  "responded_by" uuid NOT NULL,
  "responded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "cancelled_at" timestamp with time zone,
  "superseded_at" timestamp with time zone,
  "admin_ack_at" timestamp with time zone,
  "admin_ack_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."onboarding_slots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "publication_id" uuid NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "timezone" text DEFAULT 'America/Sao_Paulo'::text NOT NULL,
  "status" text DEFAULT 'available'::text NOT NULL,
  "reserved_at" timestamp with time zone,
  "inactivated_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."onboarding_templates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "topics" text[] DEFAULT '{}'::text[] NOT NULL,
  "participant_guidance" text NOT NULL,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "created_by" uuid NOT NULL,
  "updated_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."organization_billing_access_state" (
  "organization_id" uuid NOT NULL,
  "stripe_subscription_id" text NOT NULL,
  "access_state" text DEFAULT 'ACTIVE'::text NOT NULL,
  "trigger_reason" text,
  "grace_started_at" timestamp with time zone,
  "grace_ends_at" timestamp with time zone,
  "source_event_id" text NOT NULL,
  "source_event_created_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source_event_order_rank" smallint DEFAULT 0 NOT NULL,
  "source_event_order_key" text DEFAULT ''::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public."patient_file_access_grants" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "file_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "grantee_user_id" uuid NOT NULL,
  "granted_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."patient_message_reads" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "clinic_id" uuid NOT NULL,
  "patient_id" uuid NOT NULL,
  "note_id" uuid NOT NULL,
  "recipient_user_id" uuid NOT NULL,
  "read_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public."user_feature_access" (
  "user_id" uuid NOT NULL,
  "feature_key" text NOT NULL,
  "first_accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."aba_session_target_measurement_bindings" ADD COLUMN IF NOT EXISTS "program_version_id" uuid;

ALTER TABLE public."aba_session_target_measurement_bindings" ADD COLUMN IF NOT EXISTS "program_version_snapshot" integer;

ALTER TABLE public."aba_session_target_measurement_bindings" ADD COLUMN IF NOT EXISTS "measurement_type_snapshot" text;

ALTER TABLE public."aba_session_target_measurement_bindings" ADD COLUMN IF NOT EXISTS "target_status_snapshot" text;

ALTER TABLE public."adult_task_reviews" ADD COLUMN IF NOT EXISTS "therapeutic_plan_id" uuid;

ALTER TABLE public."adult_task_reviews" ADD COLUMN IF NOT EXISTS "therapeutic_objective_id" uuid;

ALTER TABLE public."adult_task_reviews" ADD COLUMN IF NOT EXISTS "therapeutic_program_id" text;

ALTER TABLE public."adult_task_reviews" ADD COLUMN IF NOT EXISTS "clinical_target_id" text;

ALTER TABLE public."adult_task_reviews" ADD COLUMN IF NOT EXISTS "clinical_link_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public."adult_task_reviews" ADD COLUMN IF NOT EXISTS "evidence_kind" text DEFAULT 'contextual_task_review'::text NOT NULL;

ALTER TABLE public."assigned_tasks" ADD COLUMN IF NOT EXISTS "therapeutic_plan_id" uuid;

ALTER TABLE public."assigned_tasks" ADD COLUMN IF NOT EXISTS "therapeutic_objective_id" uuid;

ALTER TABLE public."assigned_tasks" ADD COLUMN IF NOT EXISTS "therapeutic_program_id" text;

ALTER TABLE public."assigned_tasks" ADD COLUMN IF NOT EXISTS "clinical_target_id" text;

ALTER TABLE public."assigned_tasks" ADD COLUMN IF NOT EXISTS "clinical_link_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public."assigned_tasks" ADD COLUMN IF NOT EXISTS "clinical_link_version" smallint DEFAULT 1 NOT NULL;

ALTER TABLE public."clinic_announcements" ADD COLUMN IF NOT EXISTS "deployment_env" text;

ALTER TABLE public."clinics" ADD COLUMN IF NOT EXISTS "patient_photo_policy" text DEFAULT 'PORTAL'::text NOT NULL;

ALTER TABLE public."history" ADD COLUMN IF NOT EXISTS "therapeutic_plan_id" uuid;

ALTER TABLE public."history" ADD COLUMN IF NOT EXISTS "therapeutic_objective_id" uuid;

ALTER TABLE public."history" ADD COLUMN IF NOT EXISTS "therapeutic_program_id" text;

ALTER TABLE public."history" ADD COLUMN IF NOT EXISTS "clinical_target_id" text;

ALTER TABLE public."history" ADD COLUMN IF NOT EXISTS "clinical_link_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;

ALTER TABLE public."notification_jobs" ADD COLUMN IF NOT EXISTS "deployment_env" text;

ALTER TABLE public."patient_files" ADD COLUMN IF NOT EXISTS "access_scope" text DEFAULT 'PATIENT_ACCESS'::text NOT NULL;

ALTER TABLE public."patient_files" ADD COLUMN IF NOT EXISTS "patient_portal_visible" boolean DEFAULT false NOT NULL;

ALTER TABLE public."patients" ADD COLUMN IF NOT EXISTS "portal_profile_picture" text;

ALTER TABLE public."patients" ADD COLUMN IF NOT EXISTS "portal_profile_picture_path" text;

ALTER TABLE public."portal_notifications" ADD COLUMN IF NOT EXISTS "deployment_env" text;

ALTER TABLE public."protocol_import_requests" ADD COLUMN IF NOT EXISTS "canonical_request_key" text GENERATED ALWAYS AS (lower(TRIM(BOTH FROM COALESCE(approved_canonical_key, suggested_canonical_key, protocol_name)))) STORED;

ALTER TABLE public."protocol_import_requests" ADD COLUMN IF NOT EXISTS "quarantine_status" text DEFAULT 'quarantined'::text NOT NULL;

ALTER TABLE public."protocol_import_requests" ADD COLUMN IF NOT EXISTS "scan_status" text DEFAULT 'pending'::text NOT NULL;

ALTER TABLE public."protocol_import_requests" ADD COLUMN IF NOT EXISTS "safe_preview_status" text DEFAULT 'not_generated'::text NOT NULL;

ALTER TABLE public."protocol_import_requests" ADD COLUMN IF NOT EXISTS "raw_file_access" text DEFAULT 'blocked'::text NOT NULL;

ALTER TABLE public."protocol_import_requests" ADD COLUMN IF NOT EXISTS "safe_preview_text" text;

ALTER TABLE public."protocol_import_requests" ADD COLUMN IF NOT EXISTS "scan_report" jsonb;

ALTER TABLE public."push_subscriptions" ADD COLUMN IF NOT EXISTS "renewal_token_hash" text;

ALTER TABLE public."push_subscriptions" ADD COLUMN IF NOT EXISTS "renewal_token_created_at" timestamp with time zone;

ALTER TABLE public."push_subscriptions" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;

ALTER TABLE public."push_subscriptions" ADD COLUMN IF NOT EXISTS "invalidated_at" timestamp with time zone;

ALTER TABLE public."push_subscriptions" ADD COLUMN IF NOT EXISTS "deployment_env" text;

ALTER TABLE public."tiss_official_tracking_events" ADD COLUMN IF NOT EXISTS "idempotency_key" text;

ALTER TABLE public."tiss_revenue_cycle_events" ADD COLUMN IF NOT EXISTS "idempotency_key" text;

CREATE OR REPLACE FUNCTION public.ack_onboarding_response_v1(p_response_id uuid, p_actor_id uuid)
 RETURNS TABLE(response_id uuid, admin_ack_at timestamp with time zone, admin_ack_by uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
declare v_ack_at timestamptz; v_ack_by uuid;
begin
 if p_actor_id is null or not exists(select 1 from public.users actor where actor.id=p_actor_id and lower(actor.role) in ('owner','admin')) then raise exception 'ONBOARDING_PLATFORM_ADMIN_REQUIRED' using errcode='42501'; end if;
 update public.onboarding_responses response set admin_ack_at=coalesce(response.admin_ack_at,now()),admin_ack_by=coalesce(response.admin_ack_by,p_actor_id) where response.id=p_response_id returning response.admin_ack_at,response.admin_ack_by into v_ack_at,v_ack_by;
 if not found then raise exception 'ONBOARDING_RESPONSE_NOT_FOUND' using errcode='P0002'; end if;
 return query select p_response_id,v_ack_at,v_ack_by;
end; $function$;

CREATE OR REPLACE FUNCTION public.acquire_module_subscription_upgrade_intent_v1(p_organization_id uuid, p_sales_offer_id uuid, p_stripe_subscription_id text, p_expected_access_profile_version bigint, p_expected_access_profile_mode text, p_idempotency_key text, p_claim_ttl_seconds integer DEFAULT 900)
 RETURNS module_subscription_upgrade_intents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_profile public.organization_module_access_profiles%rowtype; v_billing public.organization_billing_access_state%rowtype; v_existing public.module_subscription_upgrade_intents%rowtype; v_result public.module_subscription_upgrade_intents%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_idempotency_key is null or length(btrim(p_idempotency_key))<8 or length(p_idempotency_key)>200 then raise exception 'INVALID_IDEMPOTENCY_KEY'; end if;
 if p_claim_ttl_seconds<60 or p_claim_ttl_seconds>3600 then raise exception 'INVALID_CLAIM_TTL'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_stripe_subscription_id,0));
 select * into v_profile from public.organization_module_access_profiles where organization_id=p_organization_id for update;
 if not found then raise exception 'ACCESS_PROFILE_NOT_FOUND'; end if;
 if v_profile.version<>p_expected_access_profile_version or v_profile.mode<>p_expected_access_profile_mode or v_profile.stripe_subscription_id is distinct from p_stripe_subscription_id then raise exception 'STALE_ACCESS_PROFILE'; end if;
 select * into v_billing from public.organization_billing_access_state where organization_id=p_organization_id and stripe_subscription_id=p_stripe_subscription_id for update;
 if not found or v_billing.access_state<>'ACTIVE' then raise exception 'BILLING_NOT_ACTIVE'; end if;
 if not exists(select 1 from public.sales_offers so join public.sales_leads sl on sl.id=so.lead_id where so.id=p_sales_offer_id and sl.converted_clinic_id=p_organization_id and so.revoked_at is null) then raise exception 'OFFER_ORGANIZATION_MISMATCH'; end if;
 select * into v_existing from public.module_subscription_upgrade_intents where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
 if found then
  if v_existing.sales_offer_id<>p_sales_offer_id or v_existing.stripe_subscription_id<>p_stripe_subscription_id or v_existing.expected_access_profile_version<>p_expected_access_profile_version then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return v_existing;
 end if;
 update public.module_subscription_upgrade_intents set intent_status='superseded',updated_at=now(),completed_at=coalesce(completed_at,now()) where organization_id=p_organization_id and stripe_subscription_id=p_stripe_subscription_id and intent_status='claimed' and claim_expires_at<=now();
 insert into public.module_subscription_upgrade_intents(organization_id,sales_offer_id,stripe_subscription_id,expected_access_profile_version,expected_access_profile_mode,idempotency_key,claim_expires_at) values(p_organization_id,p_sales_offer_id,p_stripe_subscription_id,p_expected_access_profile_version,p_expected_access_profile_mode,p_idempotency_key,now()+make_interval(secs=>p_claim_ttl_seconds)) returning * into v_result;
 return v_result;
exception when unique_violation then raise exception 'UPGRADE_ALREADY_IN_PROGRESS'; end $function$;

CREATE OR REPLACE FUNCTION public.advance_module_subscription_upgrade_intent_v1(p_intent_id uuid, p_claim_token uuid, p_expected_status text, p_next_status text, p_stripe_operation_id text DEFAULT NULL::text, p_stripe_invoice_id text DEFAULT NULL::text, p_stripe_event_id text DEFAULT NULL::text, p_stripe_event_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_error_code text DEFAULT NULL::text)
 RETURNS module_subscription_upgrade_intents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row public.module_subscription_upgrade_intents%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into v_row from public.module_subscription_upgrade_intents where id=p_intent_id for update; if not found then raise exception 'INTENT_NOT_FOUND'; end if;
 if v_row.claim_token<>p_claim_token then raise exception 'STALE_CLAIM'; end if; if v_row.intent_status<>p_expected_status then raise exception 'STALE_INTENT_STATUS'; end if;
 if p_next_status not in ('stripe_pending','requires_action','stripe_confirmed','provisioned','failed','cancelled') then raise exception 'INVALID_NEXT_STATUS'; end if;
 if p_stripe_event_created_at is not null and v_row.stripe_event_created_at is not null and p_stripe_event_created_at<v_row.stripe_event_created_at then raise exception 'STALE_STRIPE_EVENT'; end if;
 update public.module_subscription_upgrade_intents set intent_status=p_next_status,stripe_operation_id=coalesce(p_stripe_operation_id,stripe_operation_id),stripe_invoice_id=coalesce(p_stripe_invoice_id,stripe_invoice_id),stripe_event_id=coalesce(p_stripe_event_id,stripe_event_id),stripe_event_created_at=coalesce(p_stripe_event_created_at,stripe_event_created_at),last_error_code=p_error_code,updated_at=now(),completed_at=case when p_next_status in ('provisioned','failed','cancelled') then now() else completed_at end where id=p_intent_id returning * into v_row; return v_row; end $function$;

CREATE OR REPLACE FUNCTION public.apply_billing_payment_failure_v1(p_clinic_id uuid, p_user_id uuid, p_email text, p_invoice_id text, p_failed_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_failed_at timestamptz := coalesce(p_failed_at, now());
  v_email text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_clinic_block timestamptz;
  v_user_block timestamptz;
begin
  if p_clinic_id is not null then
    update public.clinics
    set subscription_status = 'delinquent',
        stripe_payment_failed_at = coalesce(stripe_payment_failed_at, v_failed_at),
        stripe_access_block_at = coalesce(stripe_payment_failed_at, v_failed_at) + interval '7 days',
        stripe_last_failed_invoice_id = coalesce(nullif(trim(p_invoice_id), ''), stripe_last_failed_invoice_id),
        updated_at = now()
    where id = p_clinic_id
    returning stripe_access_block_at into v_clinic_block;
  end if;

  if p_user_id is not null then
    update public.users
    set subscription_status = 'delinquent',
        stripe_payment_failed_at = coalesce(stripe_payment_failed_at, v_failed_at),
        stripe_access_block_at = coalesce(stripe_payment_failed_at, v_failed_at) + interval '7 days',
        stripe_last_failed_invoice_id = coalesce(nullif(trim(p_invoice_id), ''), stripe_last_failed_invoice_id),
        updated_at = now()
    where id = p_user_id
    returning stripe_access_block_at into v_user_block;
  elsif v_email is not null then
    update public.users
    set subscription_status = 'delinquent',
        stripe_payment_failed_at = coalesce(stripe_payment_failed_at, v_failed_at),
        stripe_access_block_at = coalesce(stripe_payment_failed_at, v_failed_at) + interval '7 days',
        stripe_last_failed_invoice_id = coalesce(nullif(trim(p_invoice_id), ''), stripe_last_failed_invoice_id),
        updated_at = now()
    where lower(email) = v_email
    returning stripe_access_block_at into v_user_block;
  end if;

  return jsonb_build_object(
    'clinicAccessBlockAt', v_clinic_block,
    'userAccessBlockAt', v_user_block,
    'graceDays', 7
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.clinical_specialty_scope_key_v1(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when v in ('fono', 'fonoaudiologia', 'fonoaudiologo', 'fonoaudiologa', 'speech therapy', 'speech_therapy') then 'speech_therapy'
    when v in ('to', 'terapia ocupacional', 'terapeuta ocupacional', 'occupational therapy', 'occupational_therapy') then 'occupational_therapy'
    when v in ('psicologia', 'psicoterapia', 'psicoterapeuta', 'psicologo', 'psicologa', 'psychology', 'psychotherapy') then 'psychotherapy'
    when v in ('nutricao', 'nutricionista', 'nutrition') then 'nutrition'
    when v in ('psicomotricidade', 'psicomotricista', 'psychomotricity') then 'psychomotricity'
    when v in ('psicopedagogia', 'psicopedagogo', 'psicopedagoga', 'psychopedagogy') then 'psychopedagogy'
    when v in ('arteterapia', 'arteterapeuta', 'art therapy', 'art_therapy') then 'art_therapy'
    when v in ('musicoterapia', 'musicoterapeuta', 'music therapy', 'music_therapy') then 'music_therapy'
    when v in ('fisioterapia', 'fisioterapeuta', 'physiotherapy') then 'physiotherapy'
    else null
  end
  from (
    select btrim(regexp_replace(
      translate(lower(coalesce(p_value, '')),
        'áàâãäéèêëíìîïóòôõöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc'),
      '[^a-z0-9_]+', ' ', 'g'
    )) as v
  ) normalized;
$function$;

CREATE OR REPLACE FUNCTION public.complete_patient_assigned_task_v2(p_task_id uuid, p_actor_user_id uuid, p_expected_patient_id uuid, p_patient_effort integer, p_patient_effort_emoji text, p_patient_effort_label text, p_effort_semantics text, p_patient_comment text, p_completed_at timestamp with time zone, p_history_id uuid, p_date_group text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_task public.assigned_tasks%rowtype;
  v_history public.history%rowtype;
  v_task_data jsonb;
  v_completed_at timestamptz := coalesce(p_completed_at, now());
  v_clinic uuid;
  v_patient_clinic uuid;
  v_semantics text := coalesce(nullif(trim(p_effort_semantics), ''), 'effort_min_0_max_100_v2');
begin
  if v_semantics <> 'effort_min_0_max_100_v2' then
    raise exception 'ASSIGNED_TASK_EFFORT_SEMANTICS_INVALID';
  end if;
  select * into v_task from public.assigned_tasks where id = p_task_id for update;
  if v_task.id is null then raise exception 'ASSIGNED_TASK_NOT_FOUND'; end if;
  if p_expected_patient_id is null or v_task.patient_id is distinct from p_expected_patient_id then raise exception 'ASSIGNED_TASK_SCOPE_CHANGED'; end if;
  if p_patient_effort is not null and (p_patient_effort < 0 or p_patient_effort > 100) then raise exception 'ASSIGNED_TASK_EFFORT_INVALID'; end if;
  begin v_clinic := v_task.clinic_id::uuid; exception when others then raise exception 'ASSIGNED_TASK_CLINIC_INVALID'; end;
  select p.clinic_id into v_patient_clinic from public.patients p where p.id = v_task.patient_id and coalesce(p.is_active, true) and p.deleted_at is null for share;
  if v_patient_clinic is null or v_patient_clinic is distinct from v_clinic then raise exception 'ASSIGNED_TASK_PATIENT_CLINIC_SCOPE_INVALID'; end if;

  if lower(coalesce(v_task.status, 'pending')) in ('completed', 'done') then
    if v_task.last_history_event_id is not null then
      select * into v_history from public.history
      where id = v_task.last_history_event_id and patient_id = v_task.patient_id
        and assigned_task_id = v_task.id and source = 'assigned_task_completion'
        and deleted_at is null limit 1;
    end if;
    if v_history.id is null then
      select * into v_history from public.history
      where patient_id = v_task.patient_id and assigned_task_id = v_task.id
        and source = 'assigned_task_completion' and deleted_at is null
      order by created_at asc, id asc limit 1;
    end if;
    return jsonb_build_object('task', to_jsonb(v_task), 'history', case when v_history.id is null then null else to_jsonb(v_history) end, 'idempotent', true);
  end if;

  v_task_data := coalesce(v_task.task_data, '{}'::jsonb) || jsonb_build_object(
    'patientEffort', p_patient_effort, 'patient_effort', p_patient_effort,
    'patientEffortEmoji', nullif(p_patient_effort_emoji, ''), 'patient_effort_emoji', nullif(p_patient_effort_emoji, ''),
    'patientEffortLabel', nullif(p_patient_effort_label, ''), 'patient_effort_label', nullif(p_patient_effort_label, ''),
    'patientEffortSemantics', v_semantics, 'patient_effort_semantics', v_semantics
  );
  update public.assigned_tasks
  set patient_effort = p_patient_effort,
      patient_effort_emoji = nullif(p_patient_effort_emoji, ''),
      patient_effort_label = nullif(p_patient_effort_label, ''),
      patient_comment = coalesce(p_patient_comment, ''),
      task_data = v_task_data, status = 'completed',
      completed_at = coalesce(v_task.completed_at, v_completed_at),
      last_history_event_id = p_history_id, updated_at = now()
  where id = p_task_id returning * into v_task;

  insert into public.history(
    id, patient_id, patient_email, type, title, score, energy, note, icon, therapist_id, created_at, date_group,
    assigned_task_id, source, task_data, is_active, deleted_at
  ) values (
    p_history_id, v_task.patient_id, v_task.patient_email,
    coalesce(nullif(v_task.task_type, ''), 'task'),
    coalesce(nullif(v_task.task_data->>'title', ''), 'Tarefa concluída'),
    null, p_patient_effort, coalesce(p_patient_comment, ''),
    coalesce(nullif(v_task.task_data->>'icon', ''), '📌'),
    v_task.professional_id, coalesce(v_task.completed_at, v_completed_at),
    p_date_group, v_task.id, 'assigned_task_completion', v_task.task_data, true, null
  )
  on conflict (id) do update set
    patient_id = excluded.patient_id, patient_email = excluded.patient_email, type = excluded.type,
    title = excluded.title, score = null, energy = excluded.energy, note = excluded.note,
    icon = excluded.icon, therapist_id = excluded.therapist_id, created_at = excluded.created_at,
    date_group = excluded.date_group, assigned_task_id = excluded.assigned_task_id,
    source = excluded.source, task_data = excluded.task_data, is_active = true, deleted_at = null
  returning * into v_history;

  insert into public.patient_portal_submission_audit(
    organization_id, clinic_id, patient_id, actor_user_id, resource_type, resource_id, action, idempotency_key
  ) values (
    v_clinic, v_clinic, v_task.patient_id, p_actor_user_id, 'assigned_task', v_task.id,
    'patient_task_completed', 'assigned-task-completion:' || v_task.id::text
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object('task', to_jsonb(v_task), 'history', to_jsonb(v_history));
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_patient_legacy_task_v1(p_legacy_task_id text, p_assigned_task_id uuid, p_actor_user_id uuid, p_expected_patient_id uuid, p_expected_clinic_id uuid, p_patient_email text, p_professional_id text, p_task_type text, p_task_data jsonb, p_scheduled_at timestamp with time zone, p_patient_effort integer, p_patient_effort_emoji text, p_patient_effort_label text, p_effort_semantics text, p_patient_comment text, p_completed_at timestamp with time zone, p_history_id uuid, p_date_group text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_legacy_patient_id text;
  v_patient_clinic uuid;
  v_assigned public.assigned_tasks%rowtype;
  v_bridge_data jsonb;
begin
  if nullif(trim(p_legacy_task_id), '') is null
     or p_assigned_task_id is null
     or p_expected_patient_id is null
     or p_expected_clinic_id is null then
    raise exception 'LEGACY_TASK_SCOPE_INVALID';
  end if;

  select t.patient_id::text
  into v_legacy_patient_id
  from public.tasks t
  where t.id::text = p_legacy_task_id
  for update;

  if not found then
    raise exception 'LEGACY_TASK_NOT_FOUND';
  end if;
  if v_legacy_patient_id is distinct from p_expected_patient_id::text then
    raise exception 'LEGACY_TASK_SCOPE_CHANGED';
  end if;

  select p.clinic_id
  into v_patient_clinic
  from public.patients p
  where p.id = p_expected_patient_id
    and coalesce(p.is_active, true)
    and p.deleted_at is null
  for share;

  if v_patient_clinic is null or v_patient_clinic is distinct from p_expected_clinic_id then
    raise exception 'LEGACY_TASK_PATIENT_CLINIC_SCOPE_INVALID';
  end if;

  insert into public.assigned_tasks(
    id,
    clinic_id,
    patient_id,
    patient_email,
    professional_id,
    task_type,
    task_data,
    scheduled_at,
    status
  ) values (
    p_assigned_task_id,
    p_expected_clinic_id::text,
    p_expected_patient_id,
    nullif(trim(p_patient_email), ''),
    coalesce(nullif(trim(p_professional_id), ''), 'legacy-task-migration'),
    coalesce(nullif(trim(p_task_type), ''), 'task'),
    coalesce(p_task_data, '{}'::jsonb) || jsonb_build_object(
      'legacyTaskId', p_legacy_task_id,
      'legacy_task_id', p_legacy_task_id,
      'legacySource', 'tasks',
      'legacy_source', 'tasks'
    ),
    coalesce(p_scheduled_at, now()),
    'pending'
  )
  on conflict (id) do nothing;

  select *
  into v_assigned
  from public.assigned_tasks
  where id = p_assigned_task_id
  for update;

  if v_assigned.id is null
     or v_assigned.patient_id is distinct from p_expected_patient_id
     or v_assigned.clinic_id is distinct from p_expected_clinic_id::text then
    raise exception 'LEGACY_TASK_BRIDGE_SCOPE_INVALID';
  end if;

  v_bridge_data := public.complete_patient_assigned_task_v2(
    p_assigned_task_id,
    p_actor_user_id,
    p_expected_patient_id,
    p_patient_effort,
    p_patient_effort_emoji,
    p_patient_effort_label,
    p_effort_semantics,
    p_patient_comment,
    p_completed_at,
    p_history_id,
    p_date_group
  );

  return v_bridge_data;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_clinic_communication_thread_v1(p_clinic_id uuid, p_subject text, p_message text, p_mention_user_ids uuid[] DEFAULT ARRAY[]::uuid[], p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.create_tiss_official_document(p_organization_id uuid, p_payer_id uuid, p_competence_month date, p_guide_type text, p_document_type text, p_communication_version text, p_content_structure_version text, p_tuss_version text, p_schema_root_file text, p_schema_manifest_checksum text, p_batch_number text, p_xml_content text, p_xml_hash text, p_generated_from_pre_guide_ids uuid[], p_idempotency_key text, p_validation_summary jsonb, p_metadata jsonb, p_guide_count integer, p_total_amount_cents integer, p_pre_guide_versions jsonb, p_generated_by uuid DEFAULT NULL::uuid)
 RETURNS tiss_official_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := coalesce(auth.uid(), p_generated_by);
  v_clinic_id uuid;
  v_role text;
  v_existing public.tiss_official_documents%rowtype;
  v_document public.tiss_official_documents%rowtype;
  v_pre_guide_count integer;
  v_distinct_payer_count integer;
  v_invalid_count integer;
  v_duplicate_count integer;
  v_has_pre_guide_official_document_id boolean := false;
  v_has_pre_guide_revenue_state boolean := false;
  v_has_pre_guide_revenue_reason boolean := false;
  v_has_event_official_document_id boolean := false;
  v_link_update_sql text;
begin
  if v_user_id is null then
    raise exception 'TISS_OFFICIAL_USER_REQUIRED';
  end if;

  select coalesce(u.clinic_id, u.id), u.role
    into v_clinic_id, v_role
  from public.users u
  where u.id = v_user_id
  limit 1;

  if v_clinic_id is null or v_role not in ('owner', 'admin', 'coordinator') then
    raise exception 'TISS_OFFICIAL_FORBIDDEN';
  end if;

  if p_organization_id is null or p_organization_id <> v_clinic_id then
    raise exception 'TISS_OFFICIAL_FORBIDDEN';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointment_tiss_pre_guides'
      and column_name = 'official_document_id'
  ) into v_has_pre_guide_official_document_id;

  if not v_has_pre_guide_official_document_id then
    raise exception 'TISS_OFFICIAL_PRE_GUIDE_LINK_SCHEMA_MISSING';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointment_tiss_pre_guides'
      and column_name = 'revenue_cycle_state'
  ) into v_has_pre_guide_revenue_state;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appointment_tiss_pre_guides'
      and column_name = 'revenue_cycle_state_reason'
  ) into v_has_pre_guide_revenue_reason;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tiss_revenue_cycle_events'
      and column_name = 'official_document_id'
  ) into v_has_event_official_document_id;

  if not v_has_event_official_document_id then
    raise exception 'TISS_OFFICIAL_AUDIT_SCHEMA_MISSING';
  end if;

  v_link_update_sql := 'update public.appointment_tiss_pre_guides pg set official_document_id = $1';
  if v_has_pre_guide_revenue_state then
    v_link_update_sql := v_link_update_sql || ', revenue_cycle_state = ''official_xml_validated''';
  end if;
  if v_has_pre_guide_revenue_reason then
    v_link_update_sql := v_link_update_sql || ', revenue_cycle_state_reason = ''XML TISS oficial validado contra XSD e armazenado. Nenhum dado foi enviado a operadora.''';
  end if;
  v_link_update_sql := v_link_update_sql || ', updated_at = now() where pg.organization_id = $2 and pg.id = any($3)';

  if cardinality(p_generated_from_pre_guide_ids) < 1 or cardinality(p_generated_from_pre_guide_ids) > 100 then
    raise exception 'TISS_OFFICIAL_PRE_GUIDE_COUNT_INVALID';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 32 then
    raise exception 'TISS_OFFICIAL_IDEMPOTENCY_KEY_INVALID';
  end if;

  if jsonb_typeof(p_pre_guide_versions) <> 'object' then
    raise exception 'TISS_OFFICIAL_PRE_GUIDE_VERSIONS_INVALID';
  end if;

  if octet_length(convert_to(coalesce(p_xml_content, ''), 'UTF8')) > 6291456 then
    raise exception 'TISS_OFFICIAL_XML_TOO_LARGE';
  end if;

  perform convert_to(p_xml_content, 'LATIN1');

  if exists (
    select 1
    from public.tiss_official_documents d
    where d.organization_id = v_clinic_id
      and d.idempotency_key = p_idempotency_key
      and d.xml_content = p_xml_content
      and d.xml_hash = p_xml_hash
  ) then
    null; -- exact historical replay; existing idempotency checks below remain authoritative.
  elsif p_xml_hash <> encode(extensions.digest(convert_to(p_xml_content, 'LATIN1'), 'sha256'::text), 'hex') then
    raise exception 'TISS_OFFICIAL_XML_HASH_MISMATCH';
  end if;

  if not exists (
    select 1 from public.clinic_payers cp
    where cp.id = p_payer_id
      and cp.organization_id = v_clinic_id
  ) then
    raise exception 'TISS_OFFICIAL_PAYER_NOT_FOUND';
  end if;

  select
    d.id,
    d.organization_id,
    d.clinic_id,
    d.payer_id,
    d.competence_month,
    d.guide_type,
    d.document_type,
    d.communication_version,
    d.content_structure_version,
    d.tuss_version,
    d.schema_root_file,
    d.schema_manifest_checksum,
    d.batch_number,
    d.status,
    d.xml_content,
    d.xml_hash,
    d.generated_from_pre_guide_ids,
    d.idempotency_key,
    d.validation_summary,
    d.metadata,
    d.guide_count,
    d.total_amount_cents,
    d.generated_by,
    d.generated_at,
    d.created_at,
    d.updated_at
    into v_existing
  from public.tiss_official_documents d
  where d.organization_id = v_clinic_id
    and d.idempotency_key = p_idempotency_key
  limit 1;

  if v_existing.id is not null then
    if not (
      v_existing.generated_from_pre_guide_ids @> p_generated_from_pre_guide_ids
      and p_generated_from_pre_guide_ids @> v_existing.generated_from_pre_guide_ids
    ) then
      raise exception 'TISS_OFFICIAL_IDEMPOTENCY_CONFLICT';
    end if;
    execute v_link_update_sql using v_existing.id, v_clinic_id, p_generated_from_pre_guide_ids;
    return v_existing;
  end if;

  with selected as (
    select pg.id, pg.payer_id, pg.status, pg.validation_error_codes, pg.snapshot_data, pg.scheduled_start, pg.updated_at
    from public.appointment_tiss_pre_guides pg
    where pg.id = any(p_generated_from_pre_guide_ids)
      and pg.organization_id = v_clinic_id
    for update
  )
  select
    count(*)::integer,
    count(distinct payer_id)::integer,
    count(*) filter (
      where status <> 'valid'
        or coalesce(array_length(validation_error_codes, 1), 0) > 0
        or snapshot_data is null
        or payer_id <> p_payer_id
        or date_trunc('month', scheduled_start)::date <> date_trunc('month', p_competence_month)::date
        or not (p_pre_guide_versions ? selected.id::text)
        or selected.updated_at is distinct from (p_pre_guide_versions ->> selected.id::text)::timestamptz
    )::integer
    into v_pre_guide_count, v_distinct_payer_count, v_invalid_count
  from selected;

  if v_pre_guide_count <> cardinality(p_generated_from_pre_guide_ids) then
    raise exception 'TISS_OFFICIAL_PRE_GUIDE_SCOPE_MISMATCH';
  end if;

  if v_distinct_payer_count <> 1 or v_invalid_count > 0 then
    raise exception 'TISS_OFFICIAL_PRE_GUIDE_NOT_ELIGIBLE';
  end if;

  select
    d.id,
    d.organization_id,
    d.clinic_id,
    d.payer_id,
    d.competence_month,
    d.guide_type,
    d.document_type,
    d.communication_version,
    d.content_structure_version,
    d.tuss_version,
    d.schema_root_file,
    d.schema_manifest_checksum,
    d.batch_number,
    d.status,
    d.xml_content,
    d.xml_hash,
    d.generated_from_pre_guide_ids,
    d.idempotency_key,
    d.validation_summary,
    d.metadata,
    d.guide_count,
    d.total_amount_cents,
    d.generated_by,
    d.generated_at,
    d.created_at,
    d.updated_at
    into v_existing
  from public.tiss_official_documents d
  where d.organization_id = v_clinic_id
    and d.idempotency_key = p_idempotency_key
  limit 1;

  if v_existing.id is not null then
    if not (
      v_existing.generated_from_pre_guide_ids @> p_generated_from_pre_guide_ids
      and p_generated_from_pre_guide_ids @> v_existing.generated_from_pre_guide_ids
    ) then
      raise exception 'TISS_OFFICIAL_IDEMPOTENCY_CONFLICT';
    end if;
    execute v_link_update_sql using v_existing.id, v_clinic_id, p_generated_from_pre_guide_ids;
    return v_existing;
  end if;

  select count(*)::integer
    into v_duplicate_count
  from public.tiss_official_documents d
  where d.organization_id = v_clinic_id
    and d.status = 'validated'
    and d.generated_from_pre_guide_ids && p_generated_from_pre_guide_ids;

  if v_duplicate_count > 0 then
    raise exception 'TISS_OFFICIAL_PRE_GUIDE_ALREADY_LINKED';
  end if;

  insert into public.tiss_official_documents (
    organization_id,
    clinic_id,
    payer_id,
    competence_month,
    guide_type,
    document_type,
    communication_version,
    content_structure_version,
    tuss_version,
    schema_root_file,
    schema_manifest_checksum,
    batch_number,
    status,
    xml_content,
    xml_hash,
    generated_from_pre_guide_ids,
    idempotency_key,
    validation_summary,
    metadata,
    guide_count,
    total_amount_cents,
    generated_by,
    generated_at
  ) values (
    v_clinic_id,
    v_clinic_id,
    p_payer_id,
    date_trunc('month', p_competence_month)::date,
    'sp_sadt',
    'official_tiss_sp_sadt_xml',
    p_communication_version,
    p_content_structure_version,
    p_tuss_version,
    p_schema_root_file,
    p_schema_manifest_checksum,
    p_batch_number,
    'validated',
    p_xml_content,
    p_xml_hash,
    p_generated_from_pre_guide_ids,
    p_idempotency_key,
    coalesce(p_validation_summary, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb),
    p_guide_count,
    p_total_amount_cents,
    v_user_id,
    now()
  )
  returning * into v_document;

  insert into public.tiss_revenue_cycle_events (
    organization_id,
    clinic_id,
    patient_id,
    appointment_id,
    pre_guide_id,
    official_document_id,
    payer_id,
    event_type,
    previous_state,
    new_state,
    reason,
    performed_by,
    performed_at,
    metadata
  )
  select
    v_clinic_id,
    v_clinic_id,
    pg.patient_id,
    pg.appointment_id,
    pg.id,
    v_document.id,
    p_payer_id,
    'TISS_OFFICIAL_XML_GENERATED',
    null,
    'official_xml_validated',
    'XML TISS oficial gerado e validado contra o XSD. Nenhum dado foi enviado a operadora.',
    v_user_id,
    now(),
    jsonb_build_object(
      'officialDocumentId', v_document.id,
      'batchNumber', p_batch_number,
      'communicationVersion', p_communication_version,
      'contentStructureVersion', p_content_structure_version,
      'xmlHash', p_xml_hash,
      'guideCount', p_guide_count,
      'totalAmountCents', p_total_amount_cents,
      'notSentToPayer', true
    )
  from public.appointment_tiss_pre_guides pg
  where pg.organization_id = v_clinic_id
    and pg.id = any(p_generated_from_pre_guide_ids);

  execute v_link_update_sql using v_document.id, v_clinic_id, p_generated_from_pre_guide_ids;

  insert into public.tiss_revenue_cycle_events (
    organization_id,
    clinic_id,
    official_document_id,
    payer_id,
    event_type,
    previous_state,
    new_state,
    reason,
    performed_by,
    performed_at,
    metadata
  ) values (
    v_clinic_id,
    v_clinic_id,
    v_document.id,
    p_payer_id,
    'TISS_OFFICIAL_XML_XSD_VALIDATED',
    'official_xml_validated',
    'official_xml_validated',
    'Validacao XSD oficial concluida antes da persistencia do documento.',
    v_user_id,
    now(),
    jsonb_build_object(
      'officialDocumentId', v_document.id,
      'schemaRootFile', p_schema_root_file,
      'schemaManifestChecksum', p_schema_manifest_checksum,
      'xmlHash', p_xml_hash,
      'guideCount', p_guide_count,
      'totalAmountCents', p_total_amount_cents,
      'notSentToPayer', true
    )
  );

  return v_document;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_patient_file_acl_write_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.uploaded_by is distinct from old.uploaded_by
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'PATIENT_FILE_UPLOADER_IMMUTABLE';
  end if;

  if (
      new.access_scope is distinct from old.access_scope
      or new.patient_portal_visible is distinct from old.patient_portal_visible
    )
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'PATIENT_FILE_ACCESS_RPC_REQUIRED';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_aba_patient_overview_v3(p_organization_id uuid, p_patient_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
declare
  v_session_count bigint := 0;
  v_last_session_at timestamptz;
  v_probe_review_count bigint := 0;
  v_ioa_review_count bigint := 0;
begin
  if p_organization_id is null or p_patient_id is null then
    raise exception 'ABA_V3_READ_SCOPE_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.patients patient
    where patient.id = p_patient_id
      and patient.clinic_id = p_organization_id::text
  ) then
    raise exception 'ABA_V3_READ_PATIENT_SCOPE_INVALID';
  end if;

  select count(distinct binding.session_id), max(session_row.started_at)
    into v_session_count, v_last_session_at
  from public.aba_session_target_measurement_bindings binding
  join public.aba_sessions session_row
    on session_row.id = binding.session_id
   and session_row.patient_id = binding.patient_id
   and session_row.clinic_id = binding.organization_id::text
  where binding.organization_id = p_organization_id
    and binding.patient_id = p_patient_id
    and binding.measurement_model_version = 'V3';

  select count(*) into v_probe_review_count
  from public.aba_maintenance_probes_v3 probe
  where probe.organization_id = p_organization_id
    and probe.patient_id = p_patient_id
    and probe.requires_review;

  select count(*) into v_ioa_review_count
  from public.aba_ioa_summaries_v3 ioa
  where ioa.organization_id = p_organization_id
    and ioa.patient_id = p_patient_id
    and ioa.requires_review;

  return jsonb_build_object(
    'v3_session_count', v_session_count,
    'last_v3_session_at', v_last_session_at,
    'review_counts', jsonb_build_object(
      'maintenance_probes', v_probe_review_count,
      'ioa', v_ioa_review_count
    ),
    'targets', coalesce((
      select jsonb_agg(
        (to_jsonb(state_read) - 'organization_id' - 'patient_id')
        order by state_read.program_name, state_read.target_name, state_read.target_id
      )
      from public.aba_target_state_read_v3 state_read
      where state_read.organization_id = p_organization_id
        and state_read.patient_id = p_patient_id
    ), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_aba_v3_pilot_readiness(p_organization_id uuid, p_patient_id uuid, p_program_id text DEFAULT NULL::text, p_target_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
declare
  v_target_count integer := 0;
  v_missing_definition integer := 0;
  v_missing_phase integer := 0;
  v_missing_task_steps integer := 0;
  v_abc_binding_count integer := 0;
  v_quarantine_count integer := 0;
  v_open_session_count integer := 0;
  v_blockers jsonb := '[]'::jsonb;
begin
  if p_organization_id is null or p_patient_id is null then
    raise exception 'ABA_V3_PILOT_SCOPE_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.patients patient
    where patient.id = p_patient_id
      and patient.clinic_id = p_organization_id
  ) then
    raise exception 'ABA_V3_PILOT_PATIENT_SCOPE_INVALID';
  end if;

  with target_scope as (
    select target.*
    from public.aba_targets target
    where target.patient_id = p_patient_id
      and target.clinic_id = p_organization_id::text
      and (p_program_id is null or target.program_id = p_program_id)
      and (p_target_id is null or target.id = p_target_id)
  )
  select count(*)::integer
    into v_target_count
  from target_scope;

  if p_target_id is not null and v_target_count = 0 then
    raise exception 'ABA_V3_PILOT_TARGET_SCOPE_INVALID';
  end if;

  if p_program_id is not null and v_target_count = 0 then
    raise exception 'ABA_V3_PILOT_PROGRAM_SCOPE_EMPTY';
  end if;

  with target_scope as (
    select target.id
    from public.aba_targets target
    where target.patient_id = p_patient_id
      and target.clinic_id = p_organization_id::text
      and (p_program_id is null or target.program_id = p_program_id)
      and (p_target_id is null or target.id = p_target_id)
  )
  select count(*)::integer
    into v_missing_definition
  from target_scope target
  where not exists (
    select 1
    from public.aba_collection_definition_versions_v3 definition
    where definition.organization_id = p_organization_id
      and definition.patient_id = p_patient_id
      and definition.target_id = target.id
      and definition.status = 'PUBLISHED'
      and definition.published_at <= now()
  );

  with target_scope as (
    select target.id
    from public.aba_targets target
    where target.patient_id = p_patient_id
      and target.clinic_id = p_organization_id::text
      and (p_program_id is null or target.program_id = p_program_id)
      and (p_target_id is null or target.id = p_target_id)
  )
  select count(*)::integer
    into v_missing_phase
  from target_scope target
  where not exists (
    select 1
    from public.aba_target_phase_assignments_v3 phase
    where phase.organization_id = p_organization_id
      and phase.patient_id = p_patient_id
      and phase.target_id = target.id
      and phase.effective_from <= now()
      and (
        phase.effective_until is null
        or phase.effective_until > now()
      )
  );

  with target_scope as (
    select
      target.id,
      lower(target.target_type) as target_type
    from public.aba_targets target
    where target.patient_id = p_patient_id
      and target.clinic_id = p_organization_id::text
      and (p_program_id is null or target.program_id = p_program_id)
      and (p_target_id is null or target.id = p_target_id)
  ),
  published_definition as (
    select distinct on (definition.target_id)
      definition.target_id,
      definition.id
    from public.aba_collection_definition_versions_v3 definition
    join target_scope target
      on target.id = definition.target_id
    where definition.organization_id = p_organization_id
      and definition.patient_id = p_patient_id
      and definition.status = 'PUBLISHED'
      and definition.published_at <= now()
    order by definition.target_id, definition.version desc
  )
  select count(*)::integer
    into v_missing_task_steps
  from target_scope target
  left join published_definition definition
    on definition.target_id = target.id
  where target.target_type = 'task_analysis'
    and (
      definition.id is null
      or not exists (
        select 1
        from public.aba_task_analysis_step_definitions_v3 step
        where step.collection_definition_version_id = definition.id
      )
    );

  with target_scope as (
    select target.id
    from public.aba_targets target
    where target.patient_id = p_patient_id
      and target.clinic_id = p_organization_id::text
      and (p_program_id is null or target.program_id = p_program_id)
      and (p_target_id is null or target.id = p_target_id)
  )
  select count(*)::integer
    into v_abc_binding_count
  from public.aba_behavior_target_bindings_v3 binding
  join target_scope target
    on target.id = binding.target_id
  join public.aba_behavior_definitions behavior
    on behavior.id = binding.behavior_id
   and behavior.patient_id = binding.patient_id
   and behavior.clinic_id = binding.organization_id::text
  where binding.organization_id = p_organization_id
    and binding.patient_id = p_patient_id
    and binding.status = 'ACTIVE'
    and lower(behavior.measurement_type) = 'abc';

  select count(*)::integer
    into v_quarantine_count
  from public.aba_sync_quarantine_v3 quarantine
  left join public.aba_targets quarantine_target
    on quarantine_target.id = quarantine.target_id
   and quarantine_target.patient_id = quarantine.patient_id
   and quarantine_target.clinic_id = quarantine.organization_id::text
  where quarantine.organization_id = p_organization_id
    and quarantine.patient_id = p_patient_id
    and quarantine.status in ('OPEN','READY_FOR_RETRY')
    and (
      p_program_id is null
      or quarantine_target.program_id = p_program_id
    )
    and (
      p_target_id is null
      or quarantine.target_id = p_target_id
    );

  select count(*)::integer
    into v_open_session_count
  from public.aba_sessions session_row
  where session_row.patient_id = p_patient_id
    and session_row.clinic_id = p_organization_id::text
    and lower(coalesce(session_row.status,'')) in ('active','in_progress');

  if v_target_count = 0 then
    v_blockers := v_blockers || jsonb_build_array('NO_TARGETS_IN_SCOPE');
  end if;

  if v_missing_definition > 0 then
    v_blockers := v_blockers || jsonb_build_array('MISSING_PUBLISHED_COLLECTION_DEFINITION');
  end if;

  if v_missing_phase > 0 then
    v_blockers := v_blockers || jsonb_build_array('MISSING_ACTIVE_TARGET_PHASE');
  end if;

  if v_missing_task_steps > 0 then
    v_blockers := v_blockers || jsonb_build_array('TASK_ANALYSIS_STEPS_MISSING');
  end if;

  if v_abc_binding_count > 0 then
    v_blockers := v_blockers || jsonb_build_array('ABC_V3_MAPPING_FORBIDDEN');
  end if;

  if v_quarantine_count > 0 then
    v_blockers := v_blockers || jsonb_build_array('UNRESOLVED_SYNC_QUARANTINE');
  end if;

  return jsonb_build_object(
    'ready', jsonb_array_length(v_blockers) = 0,
    'patient_id', p_patient_id,
    'program_id', p_program_id,
    'target_id', p_target_id,
    'abc_policy', 'LEGACY_V2_ONLY_FIRST_PILOT',
    'counts', jsonb_build_object(
      'targets', v_target_count,
      'missing_published_definition', v_missing_definition,
      'missing_active_phase', v_missing_phase,
      'missing_task_analysis_steps', v_missing_task_steps,
      'abc_v3_bindings', v_abc_binding_count,
      'unresolved_sync_quarantine', v_quarantine_count,
      'open_sessions', v_open_session_count
    ),
    'blockers', v_blockers
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_aba_v3_preflight_scope_snapshot(p_organization_id uuid, p_patient_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
 SET row_security TO 'off'
AS $function$
declare
  v_metrics jsonb;
  v_fingerprint text;
  v_enabled_rollout_count integer := 0;
begin
  if p_organization_id is null or p_patient_id is null then
    raise exception 'ABA_V3_PREFLIGHT_SNAPSHOT_SCOPE_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.patients patient
    where patient.id = p_patient_id
      and patient.clinic_id = p_organization_id
  ) then
    raise exception 'ABA_V3_PREFLIGHT_SNAPSHOT_PATIENT_SCOPE_INVALID';
  end if;

  -- Fixed-size aggregate set: one read per canonical surface, never one query per
  -- target/behavior. These values are evidence that a dark preflight did not mutate
  -- the selected patient scope. They intentionally exclude display-only V2 data.
  select jsonb_build_object(
    'target_bindings', jsonb_build_object(
      'count', count(*)::bigint,
      'v3_count', count(*) filter (
        where measurement_model_version = 'V3'
      )::bigint,
      'latest_created_at', max(created_at)
    )
  )
  into v_metrics
  from public.aba_session_target_measurement_bindings
  where organization_id = p_organization_id
    and patient_id = p_patient_id;

  v_metrics := v_metrics || jsonb_build_object(
    'collection_definitions', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'published_count', count(*) filter (
          where status = 'PUBLISHED'
        )::bigint,
        'deprecated_count', count(*) filter (
          where status in ('DEPRECATED','ARCHIVED')
        )::bigint,
        'latest_created_at', max(created_at),
        'latest_deprecated_at', max(deprecated_at)
      )
      from public.aba_collection_definition_versions_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'target_phases', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_count', count(*) filter (
          where effective_until is null
        )::bigint,
        'latest_created_at', max(created_at),
        'latest_effective_until', max(effective_until)
      )
      from public.aba_target_phase_assignments_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'task_analysis_definitions', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_created_at', max(created_at)
      )
      from public.aba_task_analysis_step_definitions_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'behavior_target_bindings', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'active_count', count(*) filter (
          where status = 'ACTIVE'
        )::bigint,
        'archived_count', count(*) filter (
          where status = 'ARCHIVED'
        )::bigint,
        'latest_created_at', max(created_at),
        'latest_archived_at', max(archived_at)
      )
      from public.aba_behavior_target_bindings_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'behavior_bindings', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_created_at', max(created_at)
      )
      from public.aba_session_behavior_collection_bindings_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'trials', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_created_at', max(created_at),
        'latest_occurred_at', max(occurred_at)
      )
      from public.aba_trials_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'behavior_events', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_duration_count', count(*) filter (
          where measurement_kind = 'DURATION'
            and ended_at is null
            and status = 'ACTIVE'
        )::bigint,
        'void_count', count(*) filter (
          where status = 'VOID'
        )::bigint,
        'latest_created_at', max(created_at),
        'latest_ended_at', max(ended_at)
      )
      from public.aba_behavior_events_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'behavior_observation_slices', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_count', count(*) filter (
          where ended_at is null
            and status = 'ACTIVE'
        )::bigint,
        'void_count', count(*) filter (
          where status = 'VOID'
        )::bigint,
        'latest_created_at', max(created_at),
        'latest_ended_at', max(ended_at)
      )
      from public.aba_behavior_observation_slices_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'interval_runs', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_count', count(*) filter (
          where lifecycle_status = 'OPEN'
        )::bigint,
        'latest_created_at', max(created_at),
        'latest_updated_at', max(updated_at),
        'latest_ended_at', max(ended_at)
      )
      from public.aba_interval_runs_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'interval_observations', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_created_at', max(created_at),
        'latest_interval_ended_at', max(interval_ended_at)
      )
      from public.aba_interval_observations_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'task_analysis_runs', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'complete_count', count(*) filter (
          where lifecycle_status = 'COMPLETE'
        )::bigint,
        'incomplete_count', count(*) filter (
          where lifecycle_status = 'INCOMPLETE'
        )::bigint,
        'cancelled_count', count(*) filter (
          where lifecycle_status = 'CANCELLED'
        )::bigint,
        'latest_created_at', max(created_at),
        'latest_completed_at', max(completed_at)
      )
      from public.aba_task_analysis_runs_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'maintenance_probes', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_count', count(*) filter (
          where lifecycle_status = 'OPEN'
        )::bigint,
        'review_count', count(*) filter (
          where requires_review
        )::bigint,
        'latest_created_at', max(created_at),
        'latest_updated_at', max(updated_at),
        'latest_closed_at', max(closed_at)
      )
      from public.aba_maintenance_probes_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'target_summaries', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_session_target_summaries_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'behavior_summaries', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_session_behavior_summaries_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'task_summaries', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_session_task_analysis_summaries_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'interval_summaries', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_interval_summaries_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'ioa_summaries', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_ioa_summaries_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'clinical_state', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'state_version_sum', coalesce(sum(state_version), 0)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_target_clinical_states_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'sync_quarantine', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'open_count', count(*) filter (
          where status in ('OPEN','READY_FOR_RETRY')
        )::bigint,
        'occurrence_sum', coalesce(sum(occurrence_count), 0)::bigint,
        'latest_last_seen_at', max(last_seen_at),
        'latest_resolved_at', max(resolved_at)
      )
      from public.aba_sync_quarantine_v3
      where organization_id = p_organization_id
        and patient_id = p_patient_id
    ),

    'rollout_state', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'enabled_count', count(*) filter (
          where allow_new_v3_sessions
             or accept_v3_sync
        )::bigint,
        'state_version_sum', coalesce(sum(state_version), 0)::bigint,
        'latest_updated_at', max(updated_at)
      )
      from public.aba_measurement_rollout_states_v3 state
      where state.organization_id = p_organization_id
        and (
          state.scope_type = 'CLINIC'
          or state.patient_id = p_patient_id
        )
    ),

    'rollout_events', (
      select jsonb_build_object(
        'count', count(*)::bigint,
        'max_state_version', max(event.state_version),
        'latest_occurred_at', max(event.occurred_at)
      )
      from public.aba_measurement_rollout_events_v3 event
      join public.aba_measurement_rollout_states_v3 state
        on state.id = event.rollout_state_id
      where event.organization_id = p_organization_id
        and (
          state.scope_type = 'CLINIC'
          or state.patient_id = p_patient_id
        )
    )
  );

  select count(*)::integer
    into v_enabled_rollout_count
  from public.aba_measurement_rollout_states_v3 state
  where state.organization_id = p_organization_id
    and (
      state.scope_type = 'CLINIC'
      or state.patient_id = p_patient_id
    )
    and (
      state.allow_new_v3_sessions
      or state.accept_v3_sync
    );

  v_fingerprint := encode(
    digest(
      convert_to(v_metrics::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  return jsonb_build_object(
    'snapshot_version', 'PR12_V1',
    'organization_id', p_organization_id,
    'patient_id', p_patient_id,
    'scope_fingerprint', v_fingerprint,
    'rollout_dark', v_enabled_rollout_count = 0,
    'enabled_rollout_count', v_enabled_rollout_count,
    'metrics', v_metrics
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_clinic_communication_unread_count_v1(p_clinic_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.get_verto_route_schema_capabilities()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with expected_tasks(column_name) as (
    values
      ('patient_email'::text),
      ('title'),
      ('description'),
      ('type'),
      ('icon'),
      ('color'),
      ('completed'),
      ('is_daily_reminder'),
      ('linked_task'),
      ('scheduled_at'),
      ('therapist_id'),
      ('pro_score'),
      ('max_score'),
      ('created_at'),
      ('updated_at'),
      ('is_active'),
      ('deleted_at')
  ), task_columns as (
    select
      expected_tasks.column_name,
      exists (
        select 1
          from information_schema.columns as actual
         where actual.table_schema = 'public'
           and actual.table_name = 'tasks'
           and actual.column_name = expected_tasks.column_name
      ) as is_available
      from expected_tasks
  )
  select jsonb_build_object(
    'schemaVersion', 2,
    'tasks', jsonb_build_object(
      'available', to_regclass('public.tasks') is not null,
      'columns', coalesce(
        (select jsonb_object_agg(column_name, is_available order by column_name) from task_columns),
        '{}'::jsonb
      )
    ),
    'patients', jsonb_build_object(
      'available', to_regclass('public.patients') is not null,
      'columns', coalesce((
        select jsonb_object_agg(actual.column_name, true order by actual.column_name)
          from information_schema.columns as actual
         where actual.table_schema = 'public'
           and actual.table_name = 'patients'
      ), '{}'::jsonb)
    ),
    'users', jsonb_build_object(
      'available', to_regclass('public.users') is not null,
      'columns', coalesce((
        select jsonb_object_agg(actual.column_name, true order by actual.column_name)
          from information_schema.columns as actual
         where actual.table_schema = 'public'
           and actual.table_name = 'users'
      ), '{}'::jsonb)
    ),
    'clinics', jsonb_build_object(
      'available', to_regclass('public.clinics') is not null,
      'columns', coalesce((
        select jsonb_object_agg(actual.column_name, true order by actual.column_name)
          from information_schema.columns as actual
         where actual.table_schema = 'public'
           and actual.table_name = 'clinics'
      ), '{}'::jsonb)
    ),
    'appointments', jsonb_build_object(
      'available', to_regclass('public.appointments') is not null,
      'columns', coalesce((
        select jsonb_object_agg(actual.column_name, true order by actual.column_name)
          from information_schema.columns as actual
         where actual.table_schema = 'public'
           and actual.table_name = 'appointments'
      ), '{}'::jsonb)
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.guard_aba_reinforcer_delivery_append_only_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  raise exception using errcode='P0001', message='ABA_REINFORCER_DELIVERY_APPEND_ONLY';
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_aba_session_specialty_isolation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
declare
  v_appointment_service text;
  v_appointment_approach text;
  v_appointment_source jsonb;
  v_legacy_appointment jsonb;
  v_appointment_key text;
  v_plan_specialty text;
  v_plan_key text;
  v_plan_status text;
  v_plan_mode text;
  v_organization_id text;
begin
  v_organization_id := coalesce(nullif(btrim(new.organization_id), ''), nullif(btrim(new.clinic_id), ''));

  if new.appointment_id is not null then
    select appointment.service_type, appointment.approach, appointment.source_payload
      into v_appointment_service, v_appointment_approach, v_appointment_source
    from public.appointments appointment
    where appointment.id = new.appointment_id
      and appointment.patient_id = new.patient_id
      and coalesce(appointment.organization_id::text, appointment.clinic_id::text) = v_organization_id
    limit 1;

    v_appointment_key := coalesce(
      public.clinical_specialty_scope_key_v1(v_appointment_source->>'specialty'),
      public.clinical_specialty_scope_key_v1(v_appointment_source->>'specialty_name'),
      public.clinical_specialty_scope_key_v1(v_appointment_source->>'specialtyName'),
      public.clinical_specialty_scope_key_v1(v_appointment_service),
      public.clinical_specialty_scope_key_v1(v_appointment_approach)
    );

    if v_appointment_key is null then
      select item
        into v_legacy_appointment
      from public.clinic_state state
      cross join lateral jsonb_array_elements(coalesce(state.appointments, '[]'::jsonb)) item
      where state.clinic_id::text = new.clinic_id
        and coalesce(
          nullif(btrim(item->>'id'), ''),
          nullif(btrim(item->>'appointment_id'), ''),
          nullif(btrim(item->>'appointmentId'), '')
        ) = new.appointment_id::text
        and coalesce(
          nullif(btrim(item->>'patient_id'), ''),
          nullif(btrim(item->>'patientId'), '')
        ) = new.patient_id::text
      limit 1;

      v_appointment_key := coalesce(
        public.clinical_specialty_scope_key_v1(v_legacy_appointment->>'specialty'),
        public.clinical_specialty_scope_key_v1(v_legacy_appointment->>'specialty_name'),
        public.clinical_specialty_scope_key_v1(v_legacy_appointment->>'specialtyName'),
        public.clinical_specialty_scope_key_v1(v_legacy_appointment->>'service_type'),
        public.clinical_specialty_scope_key_v1(v_legacy_appointment->>'serviceType'),
        public.clinical_specialty_scope_key_v1(v_legacy_appointment->>'type'),
        public.clinical_specialty_scope_key_v1(v_legacy_appointment->>'approach')
      );
    end if;
  else
    v_appointment_key := null;
  end if;

  if new.therapeutic_plan_id is null or v_appointment_key is null then
    return new;
  end if;

  select plan.specialty, plan.status, plan.mode
    into v_plan_specialty, v_plan_status, v_plan_mode
  from public.patient_therapeutic_plans plan
  where plan.id = new.therapeutic_plan_id
    and plan.patient_id = new.patient_id
    and plan.organization_id = v_organization_id
    and plan.clinic_id = new.clinic_id
  limit 1;

  if not found or v_plan_mode <> 'specialty' then
    raise exception 'ABA_SESSION_SPECIALTY_PLAN_SCOPE_INVALID';
  end if;

  if tg_op = 'INSERT' and v_plan_status <> 'active' then
    raise exception 'ABA_SESSION_SPECIALTY_PLAN_NOT_ACTIVE';
  end if;

  v_plan_key := public.clinical_specialty_scope_key_v1(v_plan_specialty);
  if v_plan_key is null or v_plan_key <> v_appointment_key then
    raise exception 'ABA_SESSION_SPECIALTY_PLAN_MISMATCH';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_aba_trial_specialty_isolation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
declare
  v_session_plan_id uuid;
  v_session_patient_id uuid;
  v_session_clinic_id text;
  v_target_program_id text;
  v_effective_program_id text;
  v_program_plan_id uuid;
begin
  if nullif(btrim(coalesce(new.session_id, '')), '') is null then
    return new;
  end if;

  select session_row.therapeutic_plan_id, session_row.patient_id, session_row.clinic_id
    into v_session_plan_id, v_session_patient_id, v_session_clinic_id
  from public.aba_sessions session_row
  where session_row.id = new.session_id
  limit 1;

  if not found or v_session_plan_id is null then
    return new;
  end if;

  if v_session_patient_id <> new.patient_id
     or nullif(btrim(coalesce(v_session_clinic_id, '')), '') <> nullif(btrim(coalesce(new.clinic_id, '')), '') then
    raise exception 'ABA_TRIAL_SESSION_CLINICAL_SCOPE_MISMATCH';
  end if;

  if nullif(btrim(coalesce(new.target_id, '')), '') is not null then
    select target.program_id into v_target_program_id
    from public.aba_targets target
    where target.id = new.target_id
      and target.patient_id = new.patient_id
      and target.clinic_id = new.clinic_id
    limit 1;

    if not found or nullif(btrim(coalesce(v_target_program_id, '')), '') is null then
      raise exception 'ABA_TRIAL_SPECIALTY_TARGET_NOT_FOUND';
    end if;
  end if;

  if nullif(btrim(coalesce(new.program_id, '')), '') is not null
     and v_target_program_id is not null
     and new.program_id <> v_target_program_id then
    raise exception 'ABA_TRIAL_TARGET_PROGRAM_MISMATCH';
  end if;

  v_effective_program_id := coalesce(nullif(btrim(coalesce(v_target_program_id, '')), ''), nullif(btrim(coalesce(new.program_id, '')), ''));
  if v_effective_program_id is null then
    raise exception 'ABA_TRIAL_SPECIALTY_PROGRAM_REQUIRED';
  end if;

  select program.therapeutic_plan_id into v_program_plan_id
  from public.aba_programs program
  where program.id = v_effective_program_id
    and program.patient_id = new.patient_id
    and program.clinic_id = new.clinic_id
  limit 1;

  if not found or v_program_plan_id is null or v_program_plan_id <> v_session_plan_id then
    raise exception 'ABA_TRIAL_SPECIALTY_PLAN_MISMATCH';
  end if;

  new.program_id := v_effective_program_id;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_platform_admin(target_user uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select target_user is not null and exists(select 1 from public.platform_admins pa where pa.user_id=target_user and pa.active=true)
$function$;

CREATE OR REPLACE FUNCTION public.list_clinic_communication_mention_targets_v1(p_clinic_id uuid, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.list_clinic_communication_messages_v1(p_thread_id uuid, p_limit integer DEFAULT 50, p_before_sequence bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.list_clinic_communication_notifications_v1(p_clinic_id uuid, p_limit integer DEFAULT 30, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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
  if not private.clinic_billing_communication_capability_v1(
    v_actor,p_clinic_id,'communication.billing_updates.view'
  ) then
    raise exception using errcode='42501', message='COMMUNICATION_ACCESS_DENIED';
  end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception using errcode='22023', message='COMMUNICATION_CURSOR_INVALID';
  end if;

  with page as (
    select m.*
    from public.clinic_communication_mentions m
    where m.mentioned_user_id=v_actor
      and m.clinic_id=p_clinic_id
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
    and m.clinic_id=p_clinic_id
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

CREATE OR REPLACE FUNCTION public.list_clinic_communication_threads_v1(p_clinic_id uuid, p_limit integer DEFAULT 30, p_before_activity_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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
      greatest(t.last_sequence-coalesce(rs.last_read_sequence,0),0) as unread_count,
      exists (
        select 1 from public.tiss_official_documents d
        where d.id=t.reference_id and d.clinic_id=t.clinic_id
      ) as reference_exists,
      private.clinic_billing_tiss_reference_access_v1(v_actor,t.clinic_id) as can_access_tiss
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
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',p.id,
        'clinicId',p.clinic_id,
        'subject',p.subject,
        'status',p.status,
        'referenceType',p.reference_type,
        'referenceId',case
          when p.reference_type='TISS_OFFICIAL_LOT' and p.reference_exists and p.can_access_tiss
            then p.reference_id
          else null
        end,
        'referenceState',case
          when p.reference_type is null then null
          when not p.reference_exists then 'UNAVAILABLE'
          when not p.can_access_tiss then 'RESTRICTED'
          else 'AVAILABLE'
        end,
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

  select p.last_activity_at,p.id into v_next_activity,v_next_id
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

CREATE OR REPLACE FUNCTION public.mark_clinic_communication_notification_read_v1(p_mention_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.mark_clinic_communication_read_v1(p_thread_id uuid, p_observed_sequence bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.mark_user_feature_accessed_v1(p_user_id uuid, p_feature_key text)
 RETURNS TABLE(feature_key text, first_accessed_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_feature_key text := lower(trim(coalesce(p_feature_key, '')));
begin
  if p_user_id is null then
    raise exception 'USER_FEATURE_ACCESS_USER_REQUIRED';
  end if;
  if v_feature_key !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'USER_FEATURE_ACCESS_KEY_INVALID';
  end if;

  insert into public.user_feature_access(user_id, feature_key)
  values (p_user_id, v_feature_key)
  on conflict (user_id, feature_key) do nothing;

  return query
  select access_row.feature_key, access_row.first_accessed_at
  from public.user_feature_access access_row
  where access_row.user_id = p_user_id
    and access_row.feature_key = v_feature_key
  limit 1;
end;
$function$;

CREATE OR REPLACE FUNCTION public.onboarding_actor_can_respond_v1(p_actor_id uuid, p_clinic_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
  select exists (
    select 1 from public.clinic_memberships membership
    where membership.user_id = p_actor_id and membership.clinic_id = p_clinic_id and lower(coalesce(membership.status, '')) = 'active'
      and (lower(coalesce(membership.role, '')) in ('director', 'coordinator') or exists (
        select 1 from public.clinic_membership_permission_overrides permission_override
        where permission_override.membership_id = membership.id and permission_override.permission_key = 'onboarding.respond' and permission_override.effect = 'allow'))
      and not exists (select 1 from public.clinic_membership_permission_overrides permission_override
        where permission_override.membership_id = membership.id and permission_override.permission_key = 'onboarding.respond' and permission_override.effect = 'deny')
  );
$function$;

CREATE OR REPLACE FUNCTION public.onboarding_current_actor_can_respond_v1(p_clinic_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$ select public.onboarding_actor_can_respond_v1(auth.uid(),p_clinic_id); $function$;

CREATE OR REPLACE FUNCTION public.onboarding_publication_snapshot_immutable_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
 if new.template_id is distinct from old.template_id or new.version is distinct from old.version or new.clinic_id is distinct from old.clinic_id or new.snapshot_title is distinct from old.snapshot_title or new.snapshot_message is distinct from old.snapshot_message or new.snapshot_topics is distinct from old.snapshot_topics or new.snapshot_participant_guidance is distinct from old.snapshot_participant_guidance or new.published_by is distinct from old.published_by or new.published_at is distinct from old.published_at then
  raise exception 'ONBOARDING_PUBLICATION_SNAPSHOT_IMMUTABLE' using errcode='P0001'; end if; return new; end; $function$;

CREATE OR REPLACE FUNCTION public.onboarding_slot_no_hard_delete_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$ begin raise exception 'ONBOARDING_SLOT_HARD_DELETE_FORBIDDEN' using errcode='P0001'; end; $function$;

CREATE OR REPLACE FUNCTION public.onboarding_text_array_valid_v1(p_values text[], p_min_count integer, p_max_count integer, p_max_length integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce(cardinality(p_values), 0) between p_min_count and p_max_count
    and not exists (select 1 from unnest(coalesce(p_values, '{}'::text[])) value where value is null or char_length(btrim(value)) < 1 or char_length(btrim(value)) > p_max_length);
$function$;

CREATE OR REPLACE FUNCTION public.patient_file_actor_has_patient_access_v1(p_actor_id uuid, p_clinic_id uuid, p_patient_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
  select exists (
    select 1
    from public.patients p
    where p.id = p_patient_id
      and p.clinic_id = p_clinic_id
      and (
        exists (
          select 1
          from public.clinics c
          where c.id = p_clinic_id
            and c.owner_user_id = p_actor_id
        )
        or exists (
          select 1
          from public.clinic_memberships cm
          where cm.user_id = p_actor_id
            and cm.clinic_id = p_clinic_id
            and cm.status = 'active'
            and lower(coalesce(cm.role, '')) in ('owner', 'admin', 'director', 'coordinator', 'receptionist')
        )
        or exists (
          select 1
          from public.users u
          where u.id = p_actor_id
            and u.clinic_id = p_clinic_id
            and lower(coalesce(u.role, '')) in ('owner', 'admin', 'director', 'coordinator', 'receptionist')
        )
        or p.therapist_id = p_actor_id
        or exists (
          select 1
          from public.patient_professional_links link
          where link.patient_id = p_patient_id
            and link.professional_id = p_actor_id::text
            and link.status = 'active'
            and lower(coalesce(link.permissions->>'read', 'true')) <> 'false'
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.record_aba_reinforcer_delivery_v1(p_organization_id uuid, p_patient_id uuid, p_session_id text, p_reinforcer_id uuid, p_client_event_id text, p_occurred_at timestamp with time zone, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.reissue_tiss_official_document_v1(p_organization_id uuid, p_replaced_document_id uuid, p_actor_id uuid, p_idempotency_key text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
 SET row_security TO 'off'
AS $function$
declare
  v_key text := btrim(coalesce(p_idempotency_key,''));
  v_payload jsonb := coalesce(p_payload,'{}'::jsonb);
  v_fingerprint text;
  v_old_document public.tiss_official_documents%rowtype;
  v_new_document public.tiss_official_documents%rowtype;
  v_old_tracking public.tiss_official_document_tracking%rowtype;
  v_new_tracking public.tiss_official_document_tracking%rowtype;
  v_existing_event public.tiss_official_tracking_events%rowtype;
  v_existing_document public.tiss_official_documents%rowtype;
  v_pre_guide_versions jsonb;
  v_xml_content text;
  v_xml_hash text;
  v_batch_number text;
  v_guide_count integer;
  v_total_amount integer;
  v_selected_count integer;
  v_invalid_count integer;
  v_old_previous_status text;
begin
  if p_organization_id is null or p_replaced_document_id is null or p_actor_id is null then
    raise exception using errcode='22023',message='TISS_REISSUE_SCOPE_INVALID';
  end if;
  if length(v_key)<16 or length(v_key)>200 or jsonb_typeof(v_payload)<>'object' then
    raise exception using errcode='22023',message='TISS_REISSUE_REQUEST_INVALID';
  end if;
  if not exists (select 1 from public.clinics c where c.id=p_organization_id
      and (c.owner_user_id=p_actor_id or public.is_platform_admin(p_actor_id)))
     and not exists (select 1 from public.clinic_memberships cm where cm.clinic_id=p_organization_id
      and cm.user_id=p_actor_id and lower(coalesce(cm.status,'active'))='active') then
    raise exception using errcode='42501',message='TISS_REISSUE_ACTOR_MEMBERSHIP_DENIED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_key,0));
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id',p_organization_id,'replaced_document_id',p_replaced_document_id,
    'actor_id',p_actor_id,'payload',v_payload)::text,'UTF8'),'sha256'),'hex');
  select e.* into v_existing_event from public.tiss_official_tracking_events e
  where e.clinic_id=p_organization_id and e.idempotency_key=v_key limit 1;
  if found then
    if v_existing_event.event_type<>'official_xml_replaced'
       or v_existing_event.official_document_id<>p_replaced_document_id
       or coalesce(v_existing_event.metadata->>'request_fingerprint','')<>v_fingerprint then
      raise exception using errcode='23505',message='TISS_REISSUE_IDEMPOTENCY_KEY_REUSED';
    end if;
    select d.* into v_existing_document from public.tiss_official_documents d
    where d.organization_id=p_organization_id
      and d.id=nullif(v_existing_event.metadata->>'replacement_document_id','')::uuid;
    return jsonb_build_object('ok',true,'idempotentReplay',true,'replacedDocumentId',p_replaced_document_id,
      'document',case when v_existing_document.id is null then null else to_jsonb(v_existing_document) end,
      'eventId',v_existing_event.id);
  end if;
  select d.* into v_old_document from public.tiss_official_documents d
  where d.id=p_replaced_document_id and d.organization_id=p_organization_id and d.status='validated' for update;
  if not found then raise exception using errcode='P0002',message='TISS_REISSUE_DOCUMENT_NOT_FOUND'; end if;
  select t.* into v_old_tracking from public.tiss_official_document_tracking t
  where t.organization_id=p_organization_id and t.official_document_id=p_replaced_document_id for update;
  if not found then raise exception using errcode='P0002',message='TISS_REISSUE_TRACKING_NOT_FOUND'; end if;
  if v_old_tracking.status in ('cancelled','replaced') then
    raise exception using errcode='P0001',message='TISS_REISSUE_TRACKING_TERMINAL';
  end if;
  v_xml_content:=coalesce(v_payload->>'xml_content','');
  v_xml_hash:=lower(btrim(coalesce(v_payload->>'xml_hash','')));
  v_batch_number:=btrim(coalesce(v_payload->>'batch_number',''));
  v_pre_guide_versions:=coalesce(v_payload->'pre_guide_versions','{}'::jsonb);
  if v_xml_content='' or v_xml_hash!~'^[a-f0-9]{64}$' or v_batch_number=''
     or jsonb_typeof(v_pre_guide_versions)<>'object' then
    raise exception using errcode='22023',message='TISS_REISSUE_REQUIRED_FIELDS_INVALID';
  end if;
  if encode(extensions.digest(convert_to(v_xml_content,'LATIN1'),'sha256'),'hex')<>v_xml_hash then
    raise exception using errcode='22023',message='TISS_REISSUE_XML_HASH_MISMATCH';
  end if;
  if v_batch_number=v_old_document.batch_number then
    raise exception using errcode='22023',message='TISS_REISSUE_BATCH_NUMBER_MUST_CHANGE';
  end if;
  perform 1 from public.appointment_tiss_pre_guides pg
  where pg.organization_id=p_organization_id and pg.id=any(v_old_document.generated_from_pre_guide_ids)
  order by pg.id for update;
  select count(*)::integer,count(*) filter(where pg.official_document_id is distinct from p_replaced_document_id
       or pg.status<>'valid' or coalesce(array_length(pg.validation_error_codes,1),0)>0
       or not (v_pre_guide_versions?pg.id::text)
       or pg.updated_at is distinct from (v_pre_guide_versions->>pg.id::text)::timestamptz)::integer
  into v_selected_count,v_invalid_count from public.appointment_tiss_pre_guides pg
  where pg.organization_id=p_organization_id and pg.id=any(v_old_document.generated_from_pre_guide_ids);
  if v_selected_count<>cardinality(v_old_document.generated_from_pre_guide_ids) or v_invalid_count>0 then
    raise exception using errcode='P0001',message='TISS_REISSUE_PRE_GUIDE_SCOPE_OR_VERSION_INVALID';
  end if;
  if exists(select 1 from public.tiss_official_documents d
    where d.organization_id=p_organization_id and d.idempotency_key=v_key) then
    raise exception using errcode='23505',message='TISS_REISSUE_IDEMPOTENCY_KEY_REUSED';
  end if;
  select count(*)::integer,coalesce(sum(coalesce(pg.total_amount_cents,0)),0)::integer
  into v_guide_count,v_total_amount from public.appointment_tiss_pre_guides pg
  where pg.organization_id=p_organization_id and pg.id=any(v_old_document.generated_from_pre_guide_ids);
  insert into public.tiss_official_documents(
    organization_id,clinic_id,payer_id,competence_month,guide_type,document_type,communication_version,
    content_structure_version,tuss_version,schema_root_file,schema_manifest_checksum,batch_number,status,
    xml_content,xml_hash,generated_from_pre_guide_ids,idempotency_key,validation_summary,metadata,
    guide_count,total_amount_cents,generated_by,generated_at)
  values(p_organization_id,p_organization_id,v_old_document.payer_id,v_old_document.competence_month,
    v_old_document.guide_type,v_old_document.document_type,v_old_document.communication_version,
    v_old_document.content_structure_version,v_old_document.tuss_version,v_old_document.schema_root_file,
    v_old_document.schema_manifest_checksum,v_batch_number,'validated',v_xml_content,v_xml_hash,
    v_old_document.generated_from_pre_guide_ids,v_key,coalesce(v_payload->'validation_summary','{}'::jsonb),
    coalesce(v_old_document.metadata,'{}'::jsonb)||jsonb_build_object('reissueOfOfficialDocumentId',p_replaced_document_id,
      'reissuedBy',p_actor_id,'reissuedAt',now(),'reissueReason',nullif(left(coalesce(v_payload->>'reason',''),1200),'')),
    v_guide_count,v_total_amount,p_actor_id,now()) returning * into v_new_document;
  insert into public.tiss_official_document_tracking(
    organization_id,clinic_id,official_document_id,payer_id,competence_month,batch_number,status,
    total_sent_amount_cents,total_paid_amount_cents,total_glossed_amount_cents,total_pending_amount_cents,
    metadata,created_by)
  values(p_organization_id,p_organization_id,v_new_document.id,v_new_document.payer_id,
    v_new_document.competence_month,v_new_document.batch_number,'generated',v_total_amount,0,0,v_total_amount,
    jsonb_build_object('initializedFromReissue',true,'reissueOfOfficialDocumentId',p_replaced_document_id),p_actor_id)
  returning * into v_new_tracking;
  insert into public.tiss_official_guide_tracking(
    organization_id,clinic_id,official_document_id,official_tracking_id,pre_guide_id,appointment_id,patient_id,payer_id,
    provider_guide_number,operator_guide_number,authorization_code,patient_name,scheduled_start,tuss_code,procedure_name,
    status,sent_amount_cents,paid_amount_cents,glossed_amount_cents,pending_amount_cents,metadata)
  select p_organization_id,p_organization_id,v_new_document.id,v_new_tracking.id,pg.id,pg.appointment_id,pg.patient_id,pg.payer_id,
    nullif(coalesce(pg.snapshot_data#>>'{authorization,providerGuideNumber}',pg.snapshot_data#>>'{authorization,provider_guide_number}',pg.guide_number),''),
    nullif(coalesce(pg.snapshot_data#>>'{authorization,operatorGuideNumber}',pg.snapshot_data#>>'{authorization,operator_guide_number}',pg.guide_number),''),
    nullif(pg.authorization_code,''),nullif(pg.patient_name_snapshot,''),pg.scheduled_start,
    nullif(coalesce(pg.tuss_code,pg.internal_procedure_code),''),nullif(coalesce(pg.tuss_description,pg.internal_procedure_name),''),
    'sent',coalesce(pg.total_amount_cents,0),0,0,coalesce(pg.total_amount_cents,0),
    jsonb_build_object('createdFromReissue',true,'reissueOfOfficialDocumentId',p_replaced_document_id)
  from public.appointment_tiss_pre_guides pg
  where pg.organization_id=p_organization_id and pg.id=any(v_old_document.generated_from_pre_guide_ids);
  update public.appointment_tiss_pre_guides pg set official_document_id=v_new_document.id,
    revenue_cycle_state='official_xml_validated',revenue_cycle_state_reason='XML TISS oficial reemitido como novo documento imutável.',
    updated_at=now(),updated_by=p_actor_id
  where pg.organization_id=p_organization_id and pg.id=any(v_old_document.generated_from_pre_guide_ids);
  insert into public.tiss_revenue_cycle_events(organization_id,clinic_id,patient_id,appointment_id,pre_guide_id,
    official_document_id,payer_id,event_type,previous_state,new_state,reason,performed_by,performed_at,metadata,idempotency_key)
  select p_organization_id,p_organization_id,pg.patient_id,pg.appointment_id,pg.id,v_new_document.id,v_new_document.payer_id,
    'TISS_OFFICIAL_XML_GENERATED','official_xml_validated','official_xml_validated',
    'XML TISS oficial reemitido como novo artefato; documento anterior preservado.',p_actor_id,now(),
    jsonb_build_object('officialDocumentId',v_new_document.id,'reissueOfOfficialDocumentId',p_replaced_document_id,
      'batchNumber',v_batch_number,'xmlHash',v_xml_hash,'notSentToPayer',true),v_key||':pg:'||pg.id::text
  from public.appointment_tiss_pre_guides pg
  where pg.organization_id=p_organization_id and pg.id=any(v_old_document.generated_from_pre_guide_ids);
  v_old_previous_status:=v_old_tracking.status;
  update public.tiss_official_document_tracking t set status='replaced',updated_at=now()
  where t.id=v_old_tracking.id returning t.* into v_old_tracking;
  insert into public.tiss_official_tracking_events(organization_id,clinic_id,official_document_id,official_tracking_id,
    user_id,event_type,previous_status,new_status,metadata,idempotency_key)
  values(p_organization_id,p_organization_id,p_replaced_document_id,v_old_tracking.id,p_actor_id,'official_xml_replaced',
    v_old_previous_status,'replaced',jsonb_build_object('replacement_document_id',v_new_document.id,
      'replacement_tracking_id',v_new_tracking.id,'replacement_batch_number',v_batch_number,
      'replacement_xml_hash',v_xml_hash,'request_fingerprint',v_fingerprint),v_key);
  insert into public.tiss_official_tracking_events(organization_id,clinic_id,official_document_id,official_tracking_id,
    user_id,event_type,previous_status,new_status,metadata,idempotency_key)
  values(p_organization_id,p_organization_id,v_new_document.id,v_new_tracking.id,p_actor_id,'official_xml_tracking_created',null,
    'generated',jsonb_build_object('reissueOfOfficialDocumentId',p_replaced_document_id,
      'totalSentAmountCents',v_total_amount,'guideCount',v_guide_count),v_key||':replacement_tracking');
  return jsonb_build_object('ok',true,'idempotentReplay',false,'replacedDocumentId',p_replaced_document_id,
    'document',to_jsonb(v_new_document),'tracking',to_jsonb(v_new_tracking),'eventId',(
      select e.id from public.tiss_official_tracking_events e where e.clinic_id=p_organization_id and e.idempotency_key=v_key limit 1));
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_clinic_protocol_grant_v1(p_actor_id uuid, p_request_id uuid)
 RETURNS clinic_protocol_grants
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request public.protocol_import_requests%rowtype;
  v_grant public.clinic_protocol_grants%rowtype;
  v_membership_id uuid;
  v_is_platform_admin boolean := false;
  v_event_type text;
  v_previous_value jsonb;
begin
  if p_actor_id is null then
    raise exception 'actor_required' using errcode = '22023';
  end if;
  if p_request_id is null then
    raise exception 'request_required' using errcode = '22023';
  end if;

  select *
    into v_request
  from public.protocol_import_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if v_request.clinic_id is null then
    raise exception 'request_clinic_required' using errcode = '23502';
  end if;
  if v_request.status <> 'approved' then
    raise exception 'approved_request_required' using errcode = '22023';
  end if;
  if nullif(lower(trim(coalesce(v_request.approved_canonical_key, ''))), '') is null then
    raise exception 'approved_canonical_key_required' using errcode = '22023';
  end if;

  v_is_platform_admin := public.is_platform_admin(p_actor_id);

  if not v_is_platform_admin then
    select cm.id
      into v_membership_id
    from public.clinic_memberships cm
    where cm.user_id = p_actor_id
      and cm.clinic_id = v_request.clinic_id
      and cm.status = 'active'
    limit 1;

    if v_membership_id is null then
      raise exception 'active_clinic_membership_required' using errcode = '42501';
    end if;

    if exists (
      select 1
      from public.clinic_membership_permission_overrides mpo
      where mpo.membership_id = v_membership_id
        and mpo.permission_key = 'aba.program.edit'
        and mpo.effect = 'deny'
    ) then
      raise exception 'protocol_edit_capability_denied' using errcode = '42501';
    end if;
  end if;

  select *
    into v_grant
  from public.clinic_protocol_grants
  where clinic_id = v_request.clinic_id
    and canonical_key = lower(trim(v_request.approved_canonical_key))
  for update;

  if not found then
    raise exception 'protocol_grant_not_found' using errcode = 'P0002';
  end if;

  if v_grant.revoked_at is not null then
    return v_grant;
  end if;

  v_previous_value := jsonb_build_object(
    'grant_id', v_grant.id,
    'request_id', v_request.id,
    'canonical_key', v_grant.canonical_key,
    'revoked_at', v_grant.revoked_at,
    'revoked_by', v_grant.revoked_by
  );

  update public.clinic_protocol_grants
  set revoked_at = now(),
      revoked_by = p_actor_id
  where id = v_grant.id
    and revoked_at is null
  returning * into v_grant;

  v_event_type := case
    when v_is_platform_admin then 'protocol_grant_admin_revoked'
    else 'protocol_grant_self_revoked'
  end;

  insert into public.authorization_audit_events (
    actor_user_id,
    clinic_id,
    event_type,
    permission_key,
    previous_value,
    new_value,
    reason
  ) values (
    p_actor_id,
    v_request.clinic_id,
    v_event_type,
    'aba.program.edit',
    v_previous_value,
    jsonb_build_object(
      'grant_id', v_grant.id,
      'request_id', v_request.id,
      'canonical_key', v_grant.canonical_key,
      'revoked_at', v_grant.revoked_at,
      'revoked_by', v_grant.revoked_by
    ),
    case
      when v_is_platform_admin then 'protocol grant revoked by platform admin'
      else 'protocol grant revoked by authorized clinic actor'
    end
  );

  return v_grant;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_aba_user_session_preferences_v1(p_clinic_id uuid, p_user_id uuid, p_quick_behavior_shortcuts jsonb)
 RETURNS aba_user_session_preferences
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_row public.aba_user_session_preferences%rowtype;
  v_shortcuts jsonb := coalesce(p_quick_behavior_shortcuts, '[]'::jsonb);
begin
  if p_clinic_id is null or p_user_id is null then
    raise exception using errcode = 'P0001', message = 'ABA_SESSION_PREFERENCES_SCOPE_REQUIRED';
  end if;
  if jsonb_typeof(v_shortcuts) <> 'array' or jsonb_array_length(v_shortcuts) > 6 then
    raise exception using errcode = 'P0001', message = 'ABA_SESSION_PREFERENCES_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('aba-session-preferences:' || p_clinic_id::text || ':' || p_user_id::text, 0)
  );

  insert into public.aba_user_session_preferences (
    clinic_id,
    user_id,
    quick_behavior_shortcuts,
    created_at,
    updated_at
  ) values (
    p_clinic_id,
    p_user_id,
    v_shortcuts,
    now(),
    now()
  )
  on conflict (clinic_id, user_id) do update
    set quick_behavior_shortcuts = excluded.quick_behavior_shortcuts,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.send_clinic_communication_message_v1(p_thread_id uuid, p_message text, p_mention_user_ids uuid[] DEFAULT ARRAY[]::uuid[], p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.set_clinic_communication_thread_archived_v1(p_thread_id uuid, p_archived boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.set_patient_file_access_v1(p_file_id uuid, p_patient_id uuid, p_clinic_id uuid, p_actor_id uuid, p_access_scope text, p_patient_portal_visible boolean, p_selected_user_ids uuid[] DEFAULT ARRAY[]::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
declare
  v_file public.patient_files%rowtype;
  v_scope text := upper(btrim(coalesce(p_access_scope, '')));
  v_selected uuid[] := coalesce(p_selected_user_ids, array[]::uuid[]);
  v_selected_count integer := 0;
  v_valid_count integer := 0;
begin
  if v_scope not in ('OWNER', 'CASE_TEAM', 'PATIENT_ACCESS', 'SELECTED') then
    raise exception 'PATIENT_FILE_ACCESS_SCOPE_INVALID';
  end if;

  select * into v_file
  from public.patient_files f
  where f.id = p_file_id
    and f.patient_id = p_patient_id
    and f.clinic_id = p_clinic_id
  for update;

  if not found then
    raise exception 'PATIENT_FILE_NOT_FOUND';
  end if;

  if v_file.uploaded_by is null or v_file.uploaded_by <> p_actor_id then
    raise exception 'PATIENT_FILE_ACCESS_OWNER_REQUIRED';
  end if;

  select count(distinct selected_id)
  into v_selected_count
  from unnest(v_selected) selected_id;

  if v_selected_count > 100 then
    raise exception 'PATIENT_FILE_ACCESS_GRANT_LIMIT';
  end if;

  if v_scope = 'SELECTED' and v_selected_count = 0 then
    raise exception 'PATIENT_FILE_ACCESS_SELECTED_EMPTY';
  end if;

  if v_scope = 'SELECTED' then
    select count(distinct selected_id)
    into v_valid_count
    from unnest(v_selected) selected_id
    where selected_id <> p_actor_id
      and exists (
        select 1
        from public.patient_professional_links link
        where link.patient_id = p_patient_id
          and link.professional_id = selected_id::text
          and link.status = 'active'
          and lower(coalesce(link.permissions->>'read', 'true')) <> 'false'
      );

    if v_valid_count <> (
      select count(distinct selected_id)
      from unnest(v_selected) selected_id
      where selected_id <> p_actor_id
    ) then
      raise exception 'PATIENT_FILE_ACCESS_GRANTEE_OUTSIDE_CASE_TEAM';
    end if;
  end if;

  update public.patient_files
  set access_scope = v_scope,
      patient_portal_visible = coalesce(p_patient_portal_visible, false),
      updated_at = now()
  where id = p_file_id;

  delete from public.patient_file_access_grants
  where file_id = p_file_id;

  if v_scope = 'SELECTED' then
    insert into public.patient_file_access_grants (
      file_id, patient_id, clinic_id, grantee_user_id, granted_by
    )
    select p_file_id, p_patient_id, p_clinic_id, selected_id, p_actor_id
    from (
      select distinct selected_id
      from unnest(v_selected) selected_id
      where selected_id <> p_actor_id
    ) selected;
  end if;

  return jsonb_build_object(
    'fileId', p_file_id,
    'accessScope', v_scope,
    'patientPortalVisible', coalesce(p_patient_portal_visible, false),
    'selectedUserIds', case
      when v_scope = 'SELECTED' then (
        select coalesce(jsonb_agg(grant_row.grantee_user_id order by grant_row.grantee_user_id::text), '[]'::jsonb)
        from public.patient_file_access_grants grant_row
        where grant_row.file_id = p_file_id
      )
      else '[]'::jsonb
    end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.snapshot_aba_session_target_history_context_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
declare
  v_target public.aba_targets%rowtype;
  v_program public.aba_programs%rowtype;
  v_program_version public.aba_program_versions%rowtype;
  v_measurement_type text;
begin
  if new.measurement_model_version <> 'V3' then
    return new;
  end if;

  select * into v_target
  from public.aba_targets target
  where target.id = new.target_id
    and target.patient_id = new.patient_id
    and target.clinic_id = new.organization_id::text
    and target.program_id = new.program_id;

  if not found then
    raise exception 'ABA_V3_HISTORY_SNAPSHOT_TARGET_SCOPE_INVALID';
  end if;

  select * into v_program
  from public.aba_programs program
  where program.id = new.program_id
    and program.patient_id = new.patient_id
    and program.organization_id = new.organization_id::text;

  if not found then
    raise exception 'ABA_V3_HISTORY_SNAPSHOT_PROGRAM_SCOPE_INVALID';
  end if;

  if v_target.program_version is null or v_target.program_version <= 0 then
    raise exception 'ABA_V3_HISTORY_SNAPSHOT_PROGRAM_VERSION_REQUIRED';
  end if;

  select * into v_program_version
  from public.aba_program_versions version_row
  where version_row.organization_id = new.organization_id::text
    and version_row.patient_id = new.patient_id
    and version_row.program_id = new.program_id
    and version_row.version = v_target.program_version
  limit 1;

  if not found then
    raise exception 'ABA_V3_HISTORY_SNAPSHOT_PROGRAM_VERSION_NOT_FOUND';
  end if;

  v_measurement_type := coalesce(
    nullif(btrim(v_target.measurement_type), ''),
    nullif(btrim(v_program.measurement_type), '')
  );

  if v_measurement_type is null then
    raise exception 'ABA_V3_HISTORY_SNAPSHOT_MEASUREMENT_TYPE_REQUIRED';
  end if;

  if nullif(btrim(v_target.phase), '') is null then
    raise exception 'ABA_V3_HISTORY_SNAPSHOT_TARGET_STATUS_REQUIRED';
  end if;

  new.program_version_id := v_program_version.id;
  new.program_version_snapshot := v_target.program_version;
  new.measurement_type_snapshot := v_measurement_type;
  new.target_status_snapshot := v_target.phase;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_onboarding_response_v1(p_publication_id uuid, p_slot_id uuid, p_participants text[], p_idempotency_key text, p_actor_id uuid)
 RETURNS TABLE(response_id uuid, publication_id uuid, slot_id uuid, clinic_id uuid, participants text[], responded_at timestamp with time zone, admin_ack_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
declare v_publication public.onboarding_publications%rowtype; v_slot public.onboarding_slots%rowtype; v_response public.onboarding_responses%rowtype; v_participants text[];
begin
 if p_actor_id is null or (p_actor_id <> auth.uid() and auth.role() <> 'service_role') then raise exception 'ONBOARDING_ACTOR_MISMATCH' using errcode='42501'; end if;
 if p_idempotency_key is null or char_length(p_idempotency_key) not between 12 and 160 then raise exception 'ONBOARDING_INVALID_IDEMPOTENCY_KEY' using errcode='22023'; end if;
 select array_agg(btrim(participant) order by ordinality) into v_participants from unnest(coalesce(p_participants,'{}'::text[])) with ordinality as input(participant,ordinality) where participant is not null and btrim(participant)<>'';
 if not public.onboarding_text_array_valid_v1(v_participants,1,20,120) then raise exception 'ONBOARDING_INVALID_PARTICIPANTS' using errcode='22023'; end if;
 select * into v_response from public.onboarding_responses response where response.publication_id=p_publication_id and response.idempotency_key=p_idempotency_key order by response.created_at desc limit 1;
 if found then return query select v_response.id,v_response.publication_id,v_response.slot_id,v_response.clinic_id,v_response.participants,v_response.responded_at,v_response.admin_ack_at; return; end if;
 select * into v_publication from public.onboarding_publications publication where publication.id=p_publication_id for update;
 if not found then raise exception 'ONBOARDING_PUBLICATION_NOT_FOUND' using errcode='P0002'; end if;
 if not public.onboarding_actor_can_respond_v1(p_actor_id,v_publication.clinic_id) then raise exception 'ONBOARDING_FORBIDDEN' using errcode='42501'; end if;
 if v_publication.status='responded' then raise exception 'ONBOARDING_ALREADY_RESPONDED' using errcode='P0001'; end if;
 if v_publication.status not in ('published','viewed') then raise exception 'ONBOARDING_PUBLICATION_NOT_RESPONDABLE' using errcode='P0001'; end if;
 select * into v_slot from public.onboarding_slots slot where slot.id=p_slot_id and slot.publication_id=p_publication_id for update;
 if not found or v_slot.status<>'available' then raise exception 'SLOT_TAKEN' using errcode='P0001'; end if;
 insert into public.onboarding_responses(publication_id,clinic_id,slot_id,participants,idempotency_key,responded_by) values(v_publication.id,v_publication.clinic_id,v_slot.id,v_participants,p_idempotency_key,p_actor_id) returning * into v_response;
 update public.onboarding_slots set status='reserved',reserved_at=v_response.responded_at,updated_at=now() where id=v_slot.id;
 update public.onboarding_publications set status='responded',responded_at=v_response.responded_at where id=v_publication.id;
 return query select v_response.id,v_response.publication_id,v_response.slot_id,v_response.clinic_id,v_response.participants,v_response.responded_at,v_response.admin_ack_at;
exception when unique_violation then
 select * into v_response from public.onboarding_responses response where response.publication_id=p_publication_id and response.idempotency_key=p_idempotency_key limit 1;
 if found then return query select v_response.id,v_response.publication_id,v_response.slot_id,v_response.clinic_id,v_response.participants,v_response.responded_at,v_response.admin_ack_at; return; end if;
 raise exception 'SLOT_TAKEN' using errcode='P0001';
end; $function$;

CREATE OR REPLACE FUNCTION public.validate_assigned_task_clinical_link_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_plan public.patient_therapeutic_plans%rowtype;
  v_program public.aba_programs%rowtype;
  v_target public.aba_targets%rowtype;
  v_objective public.patient_therapeutic_objectives%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.therapeutic_plan_id is distinct from old.therapeutic_plan_id
       or new.therapeutic_objective_id is distinct from old.therapeutic_objective_id
       or new.therapeutic_program_id is distinct from old.therapeutic_program_id
       or new.clinical_target_id is distinct from old.clinical_target_id
       or new.clinical_link_snapshot is distinct from old.clinical_link_snapshot
       or new.clinical_link_version is distinct from old.clinical_link_version then
      raise exception 'ASSIGNED_TASK_CLINICAL_LINK_IMMUTABLE';
    end if;
    return new;
  end if;

  if new.therapeutic_plan_id is null
     and new.therapeutic_objective_id is null
     and nullif(trim(new.therapeutic_program_id), '') is null
     and nullif(trim(new.clinical_target_id), '') is null then
    return new;
  end if;

  if new.therapeutic_plan_id is null then raise exception 'ASSIGNED_TASK_CLINICAL_PLAN_REQUIRED'; end if;
  if nullif(trim(new.therapeutic_program_id), '') is null then raise exception 'ASSIGNED_TASK_CLINICAL_PROGRAM_REQUIRED'; end if;
  if nullif(trim(new.clinical_target_id), '') is null then raise exception 'ASSIGNED_TASK_CLINICAL_TARGET_REQUIRED'; end if;

  select * into v_plan
  from public.patient_therapeutic_plans
  where id = new.therapeutic_plan_id
    and patient_id = new.patient_id
    and organization_id::text = new.clinic_id::text
    and clinic_id::text = new.clinic_id::text
    and status <> 'archived';
  if v_plan.id is null then raise exception 'ASSIGNED_TASK_CLINICAL_PLAN_SCOPE_INVALID'; end if;

  if new.therapeutic_objective_id is not null then
    select * into v_objective
    from public.patient_therapeutic_objectives
    where id = new.therapeutic_objective_id
      and patient_id = new.patient_id
      and organization_id::text = new.clinic_id::text
      and clinic_id::text = new.clinic_id::text
      and status <> 'ARCHIVED';
    if v_objective.id is null then raise exception 'ASSIGNED_TASK_CLINICAL_OBJECTIVE_SCOPE_INVALID'; end if;
  end if;

  select * into v_program
  from public.aba_programs
  where id = new.therapeutic_program_id
    and patient_id = new.patient_id
    and organization_id::text = new.clinic_id::text
    and clinic_id::text = new.clinic_id::text
    and therapeutic_plan_id = new.therapeutic_plan_id
    and status <> 'archived';
  if v_program.id is null then raise exception 'ASSIGNED_TASK_CLINICAL_PROGRAM_SCOPE_INVALID'; end if;
  if new.therapeutic_objective_id is not null
     and v_program.therapeutic_objective_id is not null
     and v_program.therapeutic_objective_id is distinct from new.therapeutic_objective_id then
    raise exception 'ASSIGNED_TASK_CLINICAL_OBJECTIVE_PROGRAM_MISMATCH';
  end if;

  select * into v_target
  from public.aba_targets
  where id = new.clinical_target_id
    and patient_id = new.patient_id
    and clinic_id::text = new.clinic_id::text
    and program_id = new.therapeutic_program_id;
  if v_target.id is null then raise exception 'ASSIGNED_TASK_CLINICAL_TARGET_SCOPE_INVALID'; end if;

  if jsonb_typeof(coalesce(new.clinical_link_snapshot, '{}'::jsonb)) <> 'object' then
    raise exception 'ASSIGNED_TASK_CLINICAL_SNAPSHOT_INVALID';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.verto_notification_idempotency_key_v1(p_deployment_env text, p_key text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select lower(trim(p_deployment_env)) || ':' || regexp_replace(coalesce(p_key, ''), '^(staging|production):', '', 'i')
$function$;

CREATE OR REPLACE FUNCTION public.verto_request_deployment_env_v1()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_claims jsonb;
  v_headers jsonb;
  v_env text;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if coalesce(v_claims->>'role', '') <> 'service_role' then
    return null;
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  v_env := lower(trim(coalesce(v_headers->>'x-verto-deployment-env', '')));
  if v_env in ('staging','production') then
    return v_env;
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.verto_require_notification_deployment_env_v1(p_deployment_env text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_env text := lower(trim(coalesce(p_deployment_env, '')));
  v_request_env text := public.verto_request_deployment_env_v1();
begin
  if v_env not in ('staging','production') then
    raise exception 'NOTIFICATION_DEPLOYMENT_ENV_INVALID';
  end if;
  if v_request_env is null then
    raise exception 'NOTIFICATION_DEPLOYMENT_ENV_REQUIRED';
  end if;
  if v_request_env <> v_env then
    raise exception 'NOTIFICATION_DEPLOYMENT_ENV_MISMATCH';
  end if;
  return v_env;
end;
$function$;

CREATE OR REPLACE FUNCTION public.aba_reinforcer_actor_can_read_v1(p_actor_id uuid, p_organization_id uuid, p_patient_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.aba_reinforcer_actor_can_write_v1(p_actor_id uuid, p_organization_id uuid, p_patient_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.ack_onboarding_response_current_v1(p_response_id uuid)
 RETURNS TABLE(response_id uuid, admin_ack_at timestamp with time zone, admin_ack_by uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$ select * from public.ack_onboarding_response_v1(p_response_id,auth.uid()); $function$;

CREATE OR REPLACE FUNCTION public.apply_tiss_official_tracking_mutation_v1(p_organization_id uuid, p_official_document_id uuid, p_actor_id uuid, p_operation text, p_idempotency_key text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
 SET row_security TO 'off'
AS $function$
declare
  v_operation text := lower(btrim(coalesce(p_operation, '')));
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_fingerprint text;
  v_existing public.tiss_official_tracking_events%rowtype;
  v_tracking public.tiss_official_document_tracking%rowtype;
  v_guide public.tiss_official_guide_tracking%rowtype;
  v_guide_id uuid;
  v_event_type text;
  v_previous_status text;
  v_new_status text;
  v_event_metadata jsonb := '{}'::jsonb;
  v_settlements jsonb := '[]'::jsonb;
  v_input_count integer := 0;
  v_distinct_count integer := 0;
  v_affected_count integer := 0;
  v_guide_count integer := 0;
  v_sent integer := 0;
  v_paid integer := 0;
  v_glossed integer := 0;
  v_pending integer := 0;
  v_any_rejected boolean := false;
  v_any_glossed boolean := false;
  v_all_paid boolean := false;
  v_doc_status text;
  v_return_status text;
  v_appeal_status text;
  v_changed_guide_ids jsonb := '[]'::jsonb;
  v_replay_guide jsonb := null;
begin
  if p_organization_id is null or p_official_document_id is null or p_actor_id is null then
    raise exception using errcode = '22023', message = 'TISS_ATOMIC_SCOPE_INVALID';
  end if;
  if v_operation not in ('mark_sent','register_return','guide_settlement','appeal_update') then
    raise exception using errcode = '22023', message = 'TISS_ATOMIC_OPERATION_INVALID';
  end if;
  if length(v_key) < 16 or length(v_key) > 200 or jsonb_typeof(v_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'TISS_ATOMIC_REQUEST_INVALID';
  end if;
  if not exists (
    select 1 from public.clinics c
    where c.id = p_organization_id
      and (c.owner_user_id = p_actor_id or public.is_platform_admin(p_actor_id))
  ) and not exists (
    select 1 from public.clinic_memberships cm
    where cm.clinic_id = p_organization_id
      and cm.user_id = p_actor_id
      and lower(coalesce(cm.status,'active')) = 'active'
  ) then
    raise exception using errcode = '42501', message = 'TISS_ATOMIC_ACTOR_MEMBERSHIP_DENIED';
  end if;
  if not exists (
    select 1 from public.tiss_official_documents d
    where d.id = p_official_document_id
      and d.organization_id = p_organization_id
      and d.status = 'validated'
  ) then
    raise exception using errcode = 'P0002', message = 'TISS_ATOMIC_DOCUMENT_NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || v_key, 0));
  v_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id',p_organization_id,
    'official_document_id',p_official_document_id,
    'actor_id',p_actor_id,
    'operation',v_operation,
    'payload',v_payload
  )::text,'UTF8'),'sha256'),'hex');
  select e.* into v_existing
  from public.tiss_official_tracking_events e
  where e.clinic_id = p_organization_id and e.idempotency_key = v_key
  limit 1;
  if found then
    if v_existing.official_document_id <> p_official_document_id
       or coalesce(v_existing.metadata->>'request_fingerprint','') <> v_fingerprint then
      raise exception using errcode = '23505', message = 'TISS_ATOMIC_IDEMPOTENCY_KEY_REUSED';
    end if;
    select t.* into v_tracking
    from public.tiss_official_document_tracking t
    where t.organization_id = p_organization_id and t.official_document_id = p_official_document_id;
    if v_existing.guide_tracking_id is not null then
      select to_jsonb(g) into v_replay_guide
      from public.tiss_official_guide_tracking g
      where g.organization_id = p_organization_id and g.id = v_existing.guide_tracking_id;
    end if;
    return jsonb_build_object('ok',true,'idempotentReplay',true,'operation',v_operation,
      'tracking',case when v_tracking.id is null then null else to_jsonb(v_tracking) end,
      'guide',v_replay_guide,'affectedGuideCount',0,'eventId',v_existing.id);
  end if;
  select t.* into v_tracking
  from public.tiss_official_document_tracking t
  where t.organization_id = p_organization_id and t.official_document_id = p_official_document_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'TISS_ATOMIC_TRACKING_NOT_FOUND';
  end if;
  if v_tracking.status in ('cancelled','replaced') then
    raise exception using errcode = 'P0001', message = 'TISS_ATOMIC_TRACKING_TERMINAL';
  end if;
  if v_operation = 'mark_sent' then
    if v_tracking.status not in ('generated','sent_to_operator','protocol_registered') then
      raise exception using errcode = 'P0001', message = 'TISS_ATOMIC_MARK_SENT_STATE_INVALID';
    end if;
    v_previous_status := v_tracking.status;
    v_new_status := case when nullif(btrim(coalesce(v_payload->>'operator_protocol','')),'') is null
      then 'sent_to_operator' else 'protocol_registered' end;
    update public.tiss_official_document_tracking t set
      status = v_new_status,
      sent_at = coalesce(nullif(v_payload->>'sent_at','')::timestamptz,now()),
      sent_channel = nullif(left(btrim(coalesce(v_payload->>'sent_channel','portal')),80),''),
      operator_protocol = nullif(left(btrim(coalesce(v_payload->>'operator_protocol','')),160),''),
      sent_registered_by = p_actor_id,
      expected_return_date = nullif(v_payload->>'expected_return_date','')::date,
      notes = case when v_payload ? 'notes' then nullif(left(v_payload->>'notes',1200),'') else t.notes end,
      updated_at = now()
    where t.id = v_tracking.id returning t.* into v_tracking;
    v_event_type := case when v_new_status = 'protocol_registered'
      then 'official_xml_protocol_registered' else 'official_xml_marked_sent' end;
    v_event_metadata := jsonb_build_object('sent_at',v_tracking.sent_at,'sent_channel',v_tracking.sent_channel,
      'operator_protocol',v_tracking.operator_protocol,'expected_return_date',v_tracking.expected_return_date);
  elsif v_operation = 'register_return' then
    if v_tracking.status not in ('sent_to_operator','protocol_registered','under_review','paid','partially_paid',
      'denied_or_rejected','glossed','appeal_prepared','appeal_sent','appeal_accepted','appeal_rejected') then
      raise exception using errcode = 'P0001', message = 'TISS_ATOMIC_RETURN_STATE_INVALID';
    end if;
    v_return_status := lower(btrim(coalesce(v_payload->>'return_status','')));
    if v_return_status not in ('paid','partially_paid','glossed','denied_or_rejected','under_review') then
      raise exception using errcode = '22023', message = 'TISS_ATOMIC_RETURN_STATUS_INVALID';
    end if;
    v_settlements := coalesce(v_payload->'guide_settlements','[]'::jsonb);
    if jsonb_typeof(v_settlements) <> 'array' then
      raise exception using errcode = '22023', message = 'TISS_ATOMIC_GUIDE_SETTLEMENTS_INVALID';
    end if;
    perform 1 from public.tiss_official_guide_tracking g
    where g.organization_id = p_organization_id and g.official_document_id = p_official_document_id
    order by g.id for update;
    select count(*)::integer,count(distinct guide_id)::integer into v_input_count,v_distinct_count
    from jsonb_to_recordset(v_settlements) as x(guide_id uuid,paid_amount_cents integer,glossed_amount_cents integer,
      status text,return_date date,payment_date date);
    if v_input_count <> v_distinct_count then
      raise exception using errcode = '22023', message = 'TISS_ATOMIC_GUIDE_DUPLICATE';
    end if;
    if v_return_status = 'partially_paid' and v_input_count = 0 then
      raise exception using errcode = '22023', message = 'TISS_ATOMIC_PARTIAL_RETURN_REQUIRES_GUIDES';
    end if;
    if v_input_count = 0 and v_return_status in ('paid','glossed','denied_or_rejected') then
      update public.tiss_official_guide_tracking g set
        status = case v_return_status when 'paid' then 'paid' when 'glossed' then 'glossed' else 'rejected' end,
        paid_amount_cents = case when v_return_status = 'paid' then g.sent_amount_cents else 0 end,
        glossed_amount_cents = case when v_return_status = 'paid' then 0 else g.sent_amount_cents end,
        pending_amount_cents = 0,
        return_date = coalesce(nullif(v_payload->>'returned_at','')::timestamptz::date,current_date),
        payment_date = case when v_return_status = 'paid'
          then coalesce(nullif(v_payload->>'returned_at','')::timestamptz::date,current_date) else g.payment_date end,
        updated_at = now()
      where g.organization_id = p_organization_id and g.official_document_id = p_official_document_id;
      get diagnostics v_affected_count = row_count;
    elsif v_input_count > 0 then
      if exists (
        with input as (select * from jsonb_to_recordset(v_settlements) as x(
          guide_id uuid,paid_amount_cents integer,glossed_amount_cents integer,status text,return_date date,payment_date date))
        select 1 from input i left join public.tiss_official_guide_tracking g
          on g.id=i.guide_id and g.organization_id=p_organization_id and g.official_document_id=p_official_document_id
        where i.guide_id is null or g.id is null
           or coalesce(i.paid_amount_cents,g.paid_amount_cents) < 0
           or coalesce(i.glossed_amount_cents,g.glossed_amount_cents) < 0
           or coalesce(i.paid_amount_cents,g.paid_amount_cents)+coalesce(i.glossed_amount_cents,g.glossed_amount_cents) > g.sent_amount_cents
           or (nullif(lower(btrim(coalesce(i.status,''))),'') is not null
               and lower(btrim(i.status)) not in ('under_review','paid','partially_paid','glossed','rejected'))
      ) then
        raise exception using errcode = '22023', message = 'TISS_ATOMIC_GUIDE_SETTLEMENT_INVALID';
      end if;
      with input as (select * from jsonb_to_recordset(v_settlements) as x(
        guide_id uuid,paid_amount_cents integer,glossed_amount_cents integer,status text,return_date date,payment_date date)),
      updated as (
        update public.tiss_official_guide_tracking g set
          paid_amount_cents = coalesce(i.paid_amount_cents,g.paid_amount_cents),
          glossed_amount_cents = coalesce(i.glossed_amount_cents,g.glossed_amount_cents),
          pending_amount_cents = g.sent_amount_cents-coalesce(i.paid_amount_cents,g.paid_amount_cents)-coalesce(i.glossed_amount_cents,g.glossed_amount_cents),
          status = case when nullif(lower(btrim(coalesce(i.status,''))),'') is not null then lower(btrim(i.status))
            when coalesce(i.glossed_amount_cents,g.glossed_amount_cents)>0 then 'glossed'
            when coalesce(i.paid_amount_cents,g.paid_amount_cents)>=g.sent_amount_cents then 'paid'
            when coalesce(i.paid_amount_cents,g.paid_amount_cents)>0 then 'partially_paid' else 'under_review' end,
          return_date = coalesce(i.return_date,nullif(v_payload->>'returned_at','')::timestamptz::date,g.return_date),
          payment_date = coalesce(i.payment_date,case when coalesce(i.paid_amount_cents,g.paid_amount_cents)>0
            then coalesce(nullif(v_payload->>'returned_at','')::timestamptz::date,current_date) else g.payment_date end),
          updated_at = now()
        from input i where g.id=i.guide_id and g.organization_id=p_organization_id and g.official_document_id=p_official_document_id
        returning g.id)
      select count(*)::integer into v_affected_count from updated;
    end if;
    select coalesce(jsonb_agg(to_jsonb(guide_id) order by guide_id::text),'[]'::jsonb)
      into v_changed_guide_ids from jsonb_to_recordset(v_settlements) as x(guide_id uuid);
    select count(*)::integer,coalesce(sum(sent_amount_cents),v_tracking.total_sent_amount_cents)::integer,
      coalesce(sum(paid_amount_cents),0)::integer,coalesce(sum(glossed_amount_cents),0)::integer,
      coalesce(bool_or(status='rejected'),false),coalesce(bool_or(status='glossed'),false),coalesce(bool_and(status='paid'),false)
    into v_guide_count,v_sent,v_paid,v_glossed,v_any_rejected,v_any_glossed,v_all_paid
    from public.tiss_official_guide_tracking where organization_id=p_organization_id and official_document_id=p_official_document_id;
    if v_guide_count=0 then v_sent:=v_tracking.total_sent_amount_cents; end if;
    v_pending:=greatest(0,v_sent-v_paid-v_glossed);
    v_doc_status:=case when v_guide_count>0 and v_all_paid then 'paid' when v_any_rejected then 'denied_or_rejected'
      when v_any_glossed and v_paid>0 then 'partially_paid' when v_any_glossed then 'glossed'
      when v_paid>0 then 'partially_paid' else 'under_review' end;
    if (v_return_status='paid' and v_doc_status<>'paid') or (v_return_status='glossed' and v_doc_status<>'glossed')
       or (v_return_status='denied_or_rejected' and v_doc_status<>'denied_or_rejected')
       or (v_return_status='partially_paid' and v_doc_status<>'partially_paid') then
      raise exception using errcode='22023',message='TISS_ATOMIC_RETURN_TOTALS_MISMATCH';
    end if;
    v_previous_status:=v_tracking.status;
    v_new_status:=case when v_return_status='under_review' then 'under_review' else v_doc_status end;
    update public.tiss_official_document_tracking t set status=v_new_status,
      returned_at=coalesce(nullif(v_payload->>'returned_at','')::timestamptz,now()),return_status=v_return_status,
      return_registered_by=p_actor_id,total_sent_amount_cents=v_sent,total_paid_amount_cents=v_paid,
      total_glossed_amount_cents=v_glossed,total_pending_amount_cents=v_pending,
      notes=case when v_payload?'notes' then nullif(left(v_payload->>'notes',1200),'') else t.notes end,updated_at=now()
    where t.id=v_tracking.id returning t.* into v_tracking;
    v_event_type:='official_xml_return_registered';
    v_event_metadata:=jsonb_build_object('returned_at',v_tracking.returned_at,'return_status',v_return_status,
      'affected_guide_count',v_affected_count,'guide_ids',v_changed_guide_ids,'total_sent_amount_cents',v_sent,
      'total_paid_amount_cents',v_paid,'total_glossed_amount_cents',v_glossed,'total_pending_amount_cents',v_pending);
  elsif v_operation='guide_settlement' then
    if v_tracking.status not in ('sent_to_operator','protocol_registered','under_review','paid','partially_paid',
      'denied_or_rejected','glossed','appeal_prepared','appeal_sent','appeal_accepted','appeal_rejected') then
      raise exception using errcode='P0001',message='TISS_ATOMIC_SETTLEMENT_STATE_INVALID'; end if;
    v_guide_id:=nullif(v_payload->>'guide_id','')::uuid;
    if v_guide_id is null then raise exception using errcode='22023',message='TISS_ATOMIC_GUIDE_ID_REQUIRED'; end if;
    select g.* into v_guide from public.tiss_official_guide_tracking g
    where g.id=v_guide_id and g.organization_id=p_organization_id and g.official_document_id=p_official_document_id for update;
    if not found then raise exception using errcode='P0002',message='TISS_ATOMIC_GUIDE_NOT_FOUND'; end if;
    v_paid:=coalesce(nullif(v_payload->>'paid_amount_cents','')::integer,v_guide.paid_amount_cents);
    v_glossed:=coalesce(nullif(v_payload->>'glossed_amount_cents','')::integer,v_guide.glossed_amount_cents);
    if v_paid<0 or v_glossed<0 or v_paid+v_glossed>v_guide.sent_amount_cents then
      raise exception using errcode='22023',message='TISS_ATOMIC_GUIDE_AMOUNTS_INVALID'; end if;
    v_previous_status:=v_guide.status; v_new_status:=nullif(lower(btrim(coalesce(v_payload->>'status',''))),'');
    if v_new_status is null then v_new_status:=case when v_glossed>0 then 'glossed'
      when v_paid>=v_guide.sent_amount_cents then 'paid' when v_paid>0 then 'partially_paid' else 'under_review' end; end if;
    if v_new_status not in ('under_review','paid','partially_paid','glossed','rejected') then
      raise exception using errcode='22023',message='TISS_ATOMIC_GUIDE_STATUS_INVALID'; end if;
    update public.tiss_official_guide_tracking g set status=v_new_status,paid_amount_cents=v_paid,glossed_amount_cents=v_glossed,
      pending_amount_cents=g.sent_amount_cents-v_paid-v_glossed,
      denial_reason=case when v_payload?'denial_reason' then nullif(left(v_payload->>'denial_reason',800),'') else g.denial_reason end,
      operator_reason_code=case when v_payload?'operator_reason_code' then nullif(left(v_payload->>'operator_reason_code',120),'') else g.operator_reason_code end,
      internal_note=case when v_payload?'internal_note' then nullif(left(v_payload->>'internal_note',1200),'') else g.internal_note end,
      return_date=case when v_payload?'return_date' then nullif(v_payload->>'return_date','')::date else g.return_date end,
      payment_date=case when v_payload?'payment_date' then nullif(v_payload->>'payment_date','')::date else g.payment_date end,
      appeal_deadline=case when v_payload?'appeal_deadline' then nullif(v_payload->>'appeal_deadline','')::date else g.appeal_deadline end,updated_at=now()
    where g.id=v_guide.id returning g.* into v_guide;
    select count(*)::integer,coalesce(sum(sent_amount_cents),v_tracking.total_sent_amount_cents)::integer,
      coalesce(sum(paid_amount_cents),0)::integer,coalesce(sum(glossed_amount_cents),0)::integer,
      coalesce(bool_or(status='rejected'),false),coalesce(bool_or(status='glossed'),false),coalesce(bool_and(status='paid'),false)
    into v_guide_count,v_sent,v_paid,v_glossed,v_any_rejected,v_any_glossed,v_all_paid from public.tiss_official_guide_tracking
    where organization_id=p_organization_id and official_document_id=p_official_document_id;
    v_pending:=greatest(0,v_sent-v_paid-v_glossed);
    v_doc_status:=case when v_guide_count>0 and v_all_paid then 'paid' when v_any_rejected then 'denied_or_rejected'
      when v_any_glossed and v_paid>0 then 'partially_paid' when v_any_glossed then 'glossed'
      when v_paid>0 then 'partially_paid' else 'under_review' end;
    update public.tiss_official_document_tracking t set status=v_doc_status,total_sent_amount_cents=v_sent,total_paid_amount_cents=v_paid,
      total_glossed_amount_cents=v_glossed,total_pending_amount_cents=v_pending,updated_at=now()
    where t.id=v_tracking.id returning t.* into v_tracking;
    v_event_type:=case v_new_status when 'paid' then 'official_xml_guide_paid' when 'partially_paid' then 'official_xml_guide_partially_paid'
      when 'glossed' then 'official_xml_guide_glossed' when 'rejected' then 'official_xml_guide_rejected' else 'official_xml_guide_updated' end;
    v_event_metadata:=jsonb_build_object('paid_amount_cents',v_guide.paid_amount_cents,'glossed_amount_cents',v_guide.glossed_amount_cents,
      'pending_amount_cents',v_guide.pending_amount_cents,'document_status',v_doc_status);
  elsif v_operation='appeal_update' then
    if v_tracking.status not in ('partially_paid','denied_or_rejected','glossed','appeal_prepared','appeal_sent','appeal_accepted','appeal_rejected') then
      raise exception using errcode='P0001',message='TISS_ATOMIC_APPEAL_STATE_INVALID'; end if;
    v_guide_id:=nullif(v_payload->>'guide_id','')::uuid;
    if v_guide_id is null then raise exception using errcode='22023',message='TISS_ATOMIC_GUIDE_ID_REQUIRED'; end if;
    select g.* into v_guide from public.tiss_official_guide_tracking g
    where g.id=v_guide_id and g.organization_id=p_organization_id and g.official_document_id=p_official_document_id for update;
    if not found then raise exception using errcode='P0002',message='TISS_ATOMIC_GUIDE_NOT_FOUND'; end if;
    if v_guide.status not in ('glossed','rejected','appeal_pending','appeal_sent','appeal_accepted','appeal_rejected') then
      raise exception using errcode='22023',message='TISS_ATOMIC_APPEAL_GUIDE_NOT_ELIGIBLE'; end if;
    v_appeal_status:=lower(btrim(coalesce(v_payload->>'appeal_status','appeal_prepared')));
    if v_appeal_status not in ('appeal_pending','appeal_prepared','appeal_sent','appeal_accepted','appeal_rejected') then
      raise exception using errcode='22023',message='TISS_ATOMIC_APPEAL_STATUS_INVALID'; end if;
    v_previous_status:=v_guide.status;
    v_new_status:=case v_appeal_status when 'appeal_sent' then 'appeal_sent' when 'appeal_accepted' then 'appeal_accepted'
      when 'appeal_rejected' then 'appeal_rejected' else 'appeal_pending' end;
    update public.tiss_official_guide_tracking g set status=v_new_status,appeal_status=v_appeal_status,
      appeal_deadline=case when v_payload?'appeal_deadline' then nullif(v_payload->>'appeal_deadline','')::date else g.appeal_deadline end,
      appeal_sent_at=case when v_appeal_status='appeal_sent' then coalesce(nullif(v_payload->>'appeal_sent_at','')::timestamptz,now()) else g.appeal_sent_at end,
      appeal_result=case when v_payload?'appeal_result' then nullif(left(v_payload->>'appeal_result',80),'') else g.appeal_result end,
      appeal_note=case when v_payload?'appeal_note' then nullif(left(v_payload->>'appeal_note',1200),'') else g.appeal_note end,updated_at=now()
    where g.id=v_guide.id returning g.* into v_guide;
    update public.tiss_official_document_tracking t set status=case v_appeal_status when 'appeal_sent' then 'appeal_sent'
      when 'appeal_accepted' then 'appeal_accepted' when 'appeal_rejected' then 'appeal_rejected' else 'appeal_prepared' end,updated_at=now()
    where t.id=v_tracking.id returning t.* into v_tracking;
    v_event_type:=case v_appeal_status when 'appeal_sent' then 'official_xml_appeal_sent'
      when 'appeal_accepted' then 'official_xml_appeal_resolved' when 'appeal_rejected' then 'official_xml_appeal_resolved'
      else 'official_xml_appeal_prepared' end;
    v_event_metadata:=jsonb_build_object('appeal_status',v_appeal_status,'appeal_deadline',v_guide.appeal_deadline,'appeal_result',v_guide.appeal_result);
  end if;
  v_event_metadata:=v_event_metadata||jsonb_build_object('operation',v_operation,'request_fingerprint',v_fingerprint);
  insert into public.tiss_official_tracking_events(organization_id,clinic_id,official_document_id,official_tracking_id,
    guide_tracking_id,pre_guide_id,user_id,event_type,previous_status,new_status,metadata,idempotency_key)
  values(p_organization_id,p_organization_id,p_official_document_id,v_tracking.id,v_guide_id,
    case when v_guide_id is null then null else v_guide.pre_guide_id end,p_actor_id,v_event_type,
    v_previous_status,v_new_status,v_event_metadata,v_key);
  return jsonb_build_object('ok',true,'idempotentReplay',false,'operation',v_operation,'tracking',to_jsonb(v_tracking),
    'guide',case when v_guide_id is null then null else to_jsonb(v_guide) end,'affectedGuideCount',v_affected_count,
    'eventId',(select e.id from public.tiss_official_tracking_events e where e.clinic_id=p_organization_id and e.idempotency_key=v_key limit 1));
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_protocol_import_request_v1(p_request_id uuid, p_canonical_key text)
 RETURNS clinic_protocol_grants
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_request public.protocol_import_requests%rowtype; v_grant public.clinic_protocol_grants%rowtype; v_key text:=lower(trim(coalesce(p_canonical_key,''))); begin if not public.is_platform_admin(auth.uid()) then raise exception 'platform_admin_required' using errcode='42501'; end if; if v_key='' then raise exception 'canonical_key_required'; end if; select * into v_request from public.protocol_import_requests where id=p_request_id for update; if not found then raise exception 'request_not_found'; end if; if v_request.clinic_id is null then raise exception 'request_clinic_required'; end if; if v_request.status not in ('pending','approved') then raise exception 'request_not_approvable'; end if; if v_request.status='approved' and lower(trim(coalesce(v_request.approved_canonical_key,''))) not in ('',v_key) then raise exception 'request_already_approved_with_different_key'; end if; insert into public.clinic_protocol_grants(clinic_id,canonical_key,source_request_id,granted_by) values(v_request.clinic_id,v_key,v_request.id,auth.uid()) on conflict (clinic_id,canonical_key) do update set source_request_id=excluded.source_request_id,revoked_at=null,revoked_by=null returning * into v_grant; update public.protocol_import_requests set status='approved',approved_canonical_key=v_key,reviewed_by=auth.uid(),reviewed_at=coalesce(reviewed_at,now()),updated_at=now() where id=v_request.id; return v_grant; end; $function$;

CREATE OR REPLACE FUNCTION public.claim_due_clinic_announcements_v1(p_deployment_env text, p_worker_id text, p_limit integer DEFAULT 20)
 RETURNS TABLE(announcement_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_env text;
begin
  v_env := public.verto_require_notification_deployment_env_v1(p_deployment_env);
  update public.clinic_announcements
     set status='SCHEDULED',scheduled_for=coalesce(scheduled_for,date_trunc('minute',now())),delivery_started_at=null,delivery_worker_id=null,updated_at=now()
   where deployment_env=v_env and status='SENDING' and sent_at is null and delivery_started_at is not null
     and delivery_started_at < now()-interval '5 minutes' and coalesce(scheduled_for,created_at) <= now();

  return query
  with candidates as (
    select ca.id from public.clinic_announcements ca
     where ca.deployment_env=v_env and ca.status='SCHEDULED' and ca.scheduled_for is not null and ca.scheduled_for <= now()
     order by ca.scheduled_for asc,ca.id asc
     for update skip locked
     limit greatest(1,least(coalesce(p_limit,20),100))
  )
  update public.clinic_announcements ca
     set status='SENDING',delivery_started_at=now(),delivery_worker_id=left(coalesce(p_worker_id,'worker'),200),
         delivery_attempt_count=coalesce(ca.delivery_attempt_count,0)+1,updated_at=now()
    from candidates c
   where ca.id=c.id and ca.deployment_env=v_env
  returning ca.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_due_notification_jobs_v1(p_deployment_env text, p_worker text, p_limit integer DEFAULT 100)
 RETURNS SETOF notification_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_env text;
begin
  v_env := public.verto_require_notification_deployment_env_v1(p_deployment_env);
  update public.notification_jobs
     set status='SCHEDULED', claimed_at=null, claimed_by=null, updated_at=now(), last_error=coalesce(last_error,'STALE_CLAIM_RECOVERED')
   where deployment_env=v_env and status='CLAIMED' and claimed_at < now() - interval '15 minutes';

  return query
  with due as (
    select id from public.notification_jobs
     where deployment_env=v_env and status='SCHEDULED' and scheduled_for <= now()
     order by scheduled_for,id
     for update skip locked
     limit greatest(1,least(coalesce(p_limit,100),500))
  ), claimed as (
    update public.notification_jobs j
       set status='CLAIMED', claimed_at=now(), claimed_by=left(coalesce(p_worker,'worker'),160), attempt_count=j.attempt_count+1, updated_at=now()
      from due where j.id=due.id and j.deployment_env=v_env
      returning j.*
  ) select * from claimed;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_clinic_announcement_delivery_v3(p_announcement_id uuid, p_organization_id uuid, p_clinic_id uuid, p_category text, p_title text, p_message text, p_event_date date, p_audience_mode text, p_idempotency_key text, p_created_by uuid, p_recipients jsonb, p_scheduled_for timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_env text := public.verto_request_deployment_env_v1();
  v_announcement_id uuid;
  v_input_count integer := 0;
  v_valid_count integer := 0;
  v_existing_count integer := 0;
  v_status text;
  v_scheduled_for timestamptz;
  v_local_hour integer;
  v_idempotency_key text;
begin
  if v_env is null then raise exception 'NOTIFICATION_DEPLOYMENT_ENV_REQUIRED'; end if;
  if p_clinic_id is null then raise exception 'INVALID_ANNOUNCEMENT_CLINIC'; end if;
  if jsonb_typeof(coalesce(p_recipients, '[]'::jsonb)) <> 'array' then raise exception 'INVALID_ANNOUNCEMENT_RECIPIENTS'; end if;

  v_input_count := jsonb_array_length(coalesce(p_recipients, '[]'::jsonb));
  if v_input_count <= 0 or v_input_count > 500 then raise exception 'INVALID_ANNOUNCEMENT_RECIPIENT_COUNT'; end if;

  select count(*) into v_valid_count
    from jsonb_to_recordset(p_recipients) as r(patient_id uuid,recipient_user_id uuid,recipient_email text)
    join public.patients p on p.id=r.patient_id
   where p.clinic_id=p_clinic_id and coalesce(p.is_active,true)=true and p.deleted_at is null;
  if v_valid_count <> v_input_count then raise exception 'ANNOUNCEMENT_RECIPIENT_SCOPE_MISMATCH'; end if;

  v_scheduled_for := case when p_scheduled_for is not null and p_scheduled_for > now()+interval '15 seconds' then date_trunc('minute',p_scheduled_for) else null end;
  if v_scheduled_for is not null then
    v_local_hour := extract(hour from (v_scheduled_for at time zone 'America/Sao_Paulo'))::integer;
    if v_local_hour >= 22 or v_local_hour < 6 then raise exception 'ANNOUNCEMENT_QUIET_HOURS'; end if;
  end if;
  v_status := case when v_scheduled_for is null then 'SENDING' else 'SCHEDULED' end;
  v_idempotency_key := public.verto_notification_idempotency_key_v1(v_env,p_idempotency_key);

  insert into public.clinic_announcements(
    deployment_env,id,organization_id,clinic_id,category,title,message,event_date,audience_mode,recipient_count,push_sent_count,push_failed_count,
    status,idempotency_key,created_by,scheduled_for,delivery_started_at,delivery_attempt_count,created_at,updated_at
  ) values (
    v_env,p_announcement_id,p_organization_id,p_clinic_id,p_category,p_title,p_message,p_event_date,p_audience_mode,v_input_count,0,0,
    v_status,v_idempotency_key,p_created_by,v_scheduled_for,case when v_status='SENDING' then now() else null end,case when v_status='SENDING' then 1 else 0 end,now(),now()
  )
  on conflict (deployment_env,clinic_id,idempotency_key) do nothing
  returning id into v_announcement_id;

  if v_announcement_id is null then
    select ca.id,ca.recipient_count into v_announcement_id,v_existing_count
      from public.clinic_announcements ca
     where ca.deployment_env=v_env and ca.clinic_id=p_clinic_id and ca.idempotency_key=v_idempotency_key
     limit 1;
    return jsonb_build_object('announcement_id',v_announcement_id,'recipient_count',v_existing_count,'created',false,'deployment_env',v_env);
  end if;

  insert into public.clinic_announcement_recipients(
    announcement_id,organization_id,clinic_id,patient_id,recipient_user_id,recipient_email,portal_notification_id,push_status,created_at,updated_at
  )
  select v_announcement_id,p_organization_id,p_clinic_id,r.patient_id,r.recipient_user_id,nullif(trim(r.recipient_email),''),null,'PENDING',now(),now()
    from jsonb_to_recordset(p_recipients) as r(patient_id uuid,recipient_user_id uuid,recipient_email text)
    join public.patients p on p.id=r.patient_id
   where p.clinic_id=p_clinic_id and coalesce(p.is_active,true)=true and p.deleted_at is null
  on conflict (announcement_id,patient_id) do update
    set recipient_user_id=excluded.recipient_user_id,recipient_email=excluded.recipient_email,updated_at=excluded.updated_at;

  return jsonb_build_object('announcement_id',v_announcement_id,'recipient_count',v_input_count,'created',true,'status',v_status,'scheduled_for',v_scheduled_for,'deployment_env',v_env);
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_notification_jobs_v1(p_deployment_env text, p_results jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_count integer:=0; v_env text;
begin
  v_env := public.verto_require_notification_deployment_env_v1(p_deployment_env);
  with input as (
    select * from jsonb_to_recordset(coalesce(p_results,'[]'::jsonb)) as x(id uuid, outcome text, error text)
  ), upd as (
    update public.notification_jobs j set
      status = case
        when upper(coalesce(i.outcome,''))='SENT' and j.recurrence_rule='DAILY_WHILE_PENDING' then 'SCHEDULED'
        when upper(coalesce(i.outcome,''))='SENT' then 'SENT'
        when upper(coalesce(i.outcome,''))='CANCELED' then 'CANCELED'
        else 'SCHEDULED' end,
      scheduled_for = case
        when upper(coalesce(i.outcome,''))='SENT' and j.recurrence_rule='DAILY_WHILE_PENDING' then public.verto_daily_notification_next_due_v1(j.scheduled_for,now(),public.verto_notification_clinic_timezone_v1(j.clinic_id))
        when upper(coalesce(i.outcome,'')) not in ('SENT','CANCELED') then now() + least(interval '60 minutes', interval '5 minutes' * greatest(j.attempt_count,1))
        else j.scheduled_for end,
      sent_at = case when upper(coalesce(i.outcome,''))='SENT' then now() else j.sent_at end,
      last_error = nullif(left(coalesce(i.error,''),1000),''), claimed_at=null, claimed_by=null, updated_at=now()
    from input i where j.id=i.id and j.deployment_env=v_env and j.status='CLAIMED'
    returning 1
  ) select count(*) into v_count from upd;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_aba_session_reinforcer_summary_v1(p_organization_id uuid, p_patient_id uuid, p_session_id text, p_actor_id uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(reinforcer_id uuid, label_snapshot text, category_snapshot text, delivery_count bigint, last_delivered_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.guard_aba_patient_reinforcer_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.list_aba_patient_reinforcers_v1(p_organization_id uuid, p_patient_id uuid, p_actor_id uuid, p_include_inactive boolean DEFAULT false, p_limit integer DEFAULT 100)
 RETURNS TABLE(reinforcer_id uuid, label text, category text, note text, is_active boolean, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.list_aba_session_reinforcer_events_v1(p_organization_id uuid, p_patient_id uuid, p_session_id text, p_actor_id uuid, p_limit integer DEFAULT 200)
 RETURNS TABLE(event_id uuid, reinforcer_id uuid, label_snapshot text, category_snapshot text, occurred_at timestamp with time zone, received_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.list_recent_aba_patient_reinforcers_v1(p_organization_id uuid, p_patient_id uuid, p_actor_id uuid, p_limit integer DEFAULT 6, p_lookback_days integer DEFAULT 90)
 RETURNS TABLE(reinforcer_id uuid, label text, category text, last_delivered_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.mark_onboarding_viewed_current_v1(p_publication_id uuid)
 RETURNS TABLE(publication_id uuid, status text, viewed_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$ declare v_clinic_id uuid; v_status text; v_viewed_at timestamptz; begin select publication.clinic_id,publication.status,publication.viewed_at into v_clinic_id,v_status,v_viewed_at from public.onboarding_publications publication where publication.id=p_publication_id for update; if not found then raise exception 'ONBOARDING_PUBLICATION_NOT_FOUND' using errcode='P0002'; end if; if not public.onboarding_actor_can_respond_v1(auth.uid(),v_clinic_id) then raise exception 'ONBOARDING_FORBIDDEN' using errcode='42501'; end if; if v_status='published' then update public.onboarding_publications publication set status='viewed',viewed_at=coalesce(publication.viewed_at,now()) where publication.id=p_publication_id returning publication.status,publication.viewed_at into v_status,v_viewed_at; end if; return query select p_publication_id,v_status,v_viewed_at; end; $function$;

CREATE OR REPLACE FUNCTION public.mark_sent_appointment_notification_jobs_v1(p_deployment_env text, p_job_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_env text;
  v_count integer := 0;
begin
  v_env := public.verto_require_notification_deployment_env_v1(p_deployment_env);

  with eligible as (
    select
      a.id,
      a.clinic_id,
      a.patient_id,
      a.scheduled_at,
      bool_or(j.notification_kind = 'APPOINTMENT_REMINDER_24H') as mark_24h,
      bool_or(j.notification_kind = 'APPOINTMENT_REMINDER_12H') as mark_12h
    from public.notification_jobs j
    join public.appointments a on a.id = j.source_id
    where j.id = any(coalesce(p_job_ids, array[]::uuid[]))
      and j.deployment_env = v_env
      and j.source_type = 'APPOINTMENT'
      and j.status = 'CLAIMED'
      and j.clinic_id = a.clinic_id
      and j.patient_id = a.patient_id
      and a.scheduled_at = nullif(j.payload->>'scheduledAt', '')::timestamptz
      and a.is_active is distinct from false
      and a.deleted_at is null
      and lower(coalesce(a.status, '')) not in ('cancelled', 'canceled', 'completed', 'no_show', 'missed')
    group by a.id, a.clinic_id, a.patient_id, a.scheduled_at
  )
  update public.appointments a
  set
    notification_24h_sent_at = case when e.mark_24h then now() else a.notification_24h_sent_at end,
    notification_12h_sent_at = case when e.mark_12h then now() else a.notification_12h_sent_at end
  from eligible e
  where a.id = e.id
    and a.clinic_id = e.clinic_id
    and a.patient_id = e.patient_id
    and a.scheduled_at = e.scheduled_at
    and a.is_active is distinct from false
    and a.deleted_at is null
    and lower(coalesce(a.status, '')) not in ('cancelled', 'canceled', 'completed', 'no_show', 'missed');

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.materialize_clinic_announcement_portal_notifications_v1(p_deployment_env text, p_announcement_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_count integer:=0; v_env text;
begin
  v_env := public.verto_require_notification_deployment_env_v1(p_deployment_env);
  with announcement as (
    select ca.* from public.clinic_announcements ca
     where ca.deployment_env=v_env and ca.id=p_announcement_id and ca.status in ('SENDING','SENT','PARTIAL')
     limit 1
  ), notification_rows as (
    insert into public.portal_notifications(
      deployment_env,id,organization_id,clinic_id,recipient_user_id,recipient_email,patient_id,appointment_id,type,title,message,sent_at,scheduled_for,idempotency_key,metadata,created_at,updated_at
    )
    select v_env,gen_random_uuid(),a.organization_id,a.clinic_id,r.recipient_user_id,r.recipient_email,r.patient_id,null,'clinic_announcement',a.title,
      left(a.title||': '||a.message,1000),now(),a.scheduled_for,
      public.verto_notification_idempotency_key_v1(v_env,'clinic-announcement:'||a.id::text||':'||r.patient_id::text),
      jsonb_build_object('deploymentEnv',v_env,'announcementId',a.id,'category',a.category,'eventDate',a.event_date,'title',a.title,'clinicId',a.clinic_id,'patientId',r.patient_id,'scheduledFor',a.scheduled_for),
      now(),now()
    from announcement a join public.clinic_announcement_recipients r on r.announcement_id=a.id
    on conflict (deployment_env,idempotency_key) do update set updated_at=excluded.updated_at
    returning id,patient_id
  )
  update public.clinic_announcement_recipients r
     set portal_notification_id=n.id,updated_at=now()
    from notification_rows n
   where r.announcement_id=p_announcement_id and r.patient_id=n.patient_id;
  get diagnostics v_count=row_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_aba_reinforcer_delivery_authenticated_v1(p_session_id text, p_reinforcer_id uuid, p_client_event_id text, p_occurred_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
declare v_actor_id uuid := auth.uid(); v_session public.aba_sessions%rowtype; v_organization_id uuid; v_patient_id uuid; v_reinforcer public.aba_patient_reinforcers%rowtype;
begin
 if v_actor_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_AUTH_REQUIRED'; end if;
 if p_session_id is null or length(trim(p_session_id))=0 or p_reinforcer_id is null or p_occurred_at is null then raise exception using errcode='P0001',message='ABA_REINFORCER_DELIVERY_SCOPE_REQUIRED'; end if;
 if length(trim(coalesce(p_client_event_id,'')))<1 or length(trim(coalesce(p_client_event_id,'')))>240 then raise exception using errcode='P0001',message='ABA_REINFORCER_CLIENT_EVENT_ID_INVALID'; end if;
 select * into v_session from public.aba_sessions s where s.id=trim(p_session_id) for share;
 if not found then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end if;
 begin v_organization_id:=v_session.clinic_id::uuid; exception when invalid_text_representation then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end;
 v_patient_id:=v_session.patient_id;
 if v_organization_id is null or v_patient_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end if;
 if lower(coalesce(v_session.status,''))<>'active' or v_session.ended_at is not null then raise exception using errcode='P0001',message='ABA_REINFORCER_DELIVERY_SESSION_CLOSED'; end if;
 if not public.aba_reinforcer_actor_can_write_v1(v_actor_id,v_organization_id,v_patient_id) then raise exception using errcode='P0001',message='ABA_REINFORCER_DELIVERY_ACTOR_FORBIDDEN'; end if;
 select * into v_reinforcer from public.aba_patient_reinforcers r where r.id=p_reinforcer_id and r.organization_id=v_organization_id and r.patient_id=v_patient_id for share;
 if not found then raise exception using errcode='P0001',message='ABA_REINFORCER_DELIVERY_CATALOG_SCOPE_INVALID'; end if;
 if not v_reinforcer.is_active then raise exception using errcode='P0001',message='ABA_REINFORCER_INACTIVE'; end if;
 return public.record_aba_reinforcer_delivery_v1(v_organization_id,v_patient_id,trim(p_session_id),p_reinforcer_id,trim(p_client_event_id),p_occurred_at,v_actor_id);
end;$function$;

CREATE OR REPLACE FUNCTION public.renew_push_subscription_v1(p_deployment_env text, p_renewal_token_hash text, p_next_renewal_token_hash text, p_new_endpoint text, p_p256dh text, p_auth text, p_subscription jsonb)
 RETURNS TABLE(success boolean, patient_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_env text;
  v_subscription public.push_subscriptions%rowtype;
  v_owner_id uuid;
  v_owner_patient_id uuid;
  v_now timestamptz := now();
begin
  v_env := public.verto_require_notification_deployment_env_v1(p_deployment_env);
  if p_renewal_token_hash is null
     or p_renewal_token_hash !~ '^[a-f0-9]{64}$'
     or p_next_renewal_token_hash is null
     or p_next_renewal_token_hash !~ '^[a-f0-9]{64}$'
     or coalesce(length(p_new_endpoint), 0) < 1
     or length(p_new_endpoint) > 2000
     or coalesce(length(p_p256dh), 0) < 1
     or length(p_p256dh) > 2000
     or coalesce(length(p_auth), 0) < 1
     or length(p_auth) > 2000
     or p_subscription is null
     or jsonb_typeof(p_subscription) <> 'object'
  then
    raise exception 'PUSH_RENEWAL_INVALID';
  end if;

  select ps.* into v_subscription
    from public.push_subscriptions ps
   where ps.deployment_env = v_env
     and ps.renewal_token_hash = p_renewal_token_hash
   for update;

  if not found or v_subscription.patient_id is null then
    raise exception 'PUSH_RENEWAL_TOKEN_INVALID';
  end if;

  select ps.id, ps.patient_id into v_owner_id, v_owner_patient_id
    from public.push_subscriptions ps
   where ps.deployment_env = v_env
     and ps.endpoint = p_new_endpoint
     and ps.id <> v_subscription.id
   for update;

  if found then
    if v_owner_patient_id is distinct from v_subscription.patient_id then
      raise exception 'PUSH_RENEWAL_ENDPOINT_OWNERSHIP_CONFLICT';
    end if;
    delete from public.push_subscriptions
     where id = v_owner_id
       and deployment_env = v_env
       and patient_id = v_subscription.patient_id;
  end if;

  update public.push_subscriptions
     set endpoint = p_new_endpoint,
         p256dh = p_p256dh,
         auth = p_auth,
         subscription = p_subscription,
         renewal_token_hash = p_next_renewal_token_hash,
         renewal_token_created_at = v_now,
         last_seen_at = v_now,
         invalidated_at = null,
         updated_at = v_now
   where id = v_subscription.id
     and deployment_env = v_env
     and renewal_token_hash = p_renewal_token_hash;

  if not found then raise exception 'PUSH_RENEWAL_RACE_LOST'; end if;
  return query select true, v_subscription.patient_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_aba_patient_reinforcer_v1(p_organization_id uuid, p_patient_id uuid, p_actor_id uuid, p_reinforcer_id uuid DEFAULT NULL::uuid, p_label text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_is_active boolean DEFAULT true)
 RETURNS aba_patient_reinforcers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.submit_onboarding_response_current_v1(p_publication_id uuid, p_slot_id uuid, p_participants text[], p_idempotency_key text)
 RETURNS TABLE(response_id uuid, publication_id uuid, slot_id uuid, clinic_id uuid, participants text[], responded_at timestamp with time zone, admin_ack_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$ select * from public.submit_onboarding_response_v1(p_publication_id,p_slot_id,p_participants,p_idempotency_key,auth.uid()); $function$;

CREATE OR REPLACE FUNCTION public.sync_appointment_notification_jobs_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_env text := public.verto_request_deployment_env_v1();
  v_status text := lower(coalesce(new.status, ''));
  v_active boolean := coalesce(new.is_active, true) and new.deleted_at is null and v_status not in ('cancelled','canceled','no_show','missed','completed');
  v_org uuid := new.clinic_id;
  v_clinic uuid := new.clinic_id;
  v_timezone text := public.verto_notification_clinic_timezone_v1(new.clinic_id);
begin
  if v_env is null then return new; end if;

  update public.notification_jobs
     set status='CANCELED', updated_at=now(), claimed_at=null, claimed_by=null
   where deployment_env=v_env
     and source_type='APPOINTMENT' and source_id=new.id and status in ('SCHEDULED','CLAIMED');

  if v_active and new.scheduled_at is not null and new.patient_id is not null then
    insert into public.notification_jobs(deployment_env,organization_id,clinic_id,patient_id,source_type,source_id,notification_kind,scheduled_for,idempotency_key,payload)
    values
      (v_env,v_org,v_clinic,new.patient_id,'APPOINTMENT',new.id,'APPOINTMENT_REMINDER_24H',public.verto_notification_delivery_due_v1(new.scheduled_at,24,v_timezone),
       public.verto_notification_idempotency_key_v1(v_env,'appointment:'||new.id::text||':24h:'||to_char(new.scheduled_at at time zone 'UTC','YYYYMMDDHH24MISS')),
       jsonb_build_object('deploymentEnv',v_env,'scheduledAt',new.scheduled_at)),
      (v_env,v_org,v_clinic,new.patient_id,'APPOINTMENT',new.id,'APPOINTMENT_REMINDER_12H',public.verto_notification_delivery_due_v1(new.scheduled_at,12,v_timezone),
       public.verto_notification_idempotency_key_v1(v_env,'appointment:'||new.id::text||':12h:'||to_char(new.scheduled_at at time zone 'UTC','YYYYMMDDHH24MISS')),
       jsonb_build_object('deploymentEnv',v_env,'scheduledAt',new.scheduled_at))
    on conflict (deployment_env,idempotency_key) do update set
      scheduled_for=excluded.scheduled_for,
      status=case when notification_jobs.status='SENT' then 'SENT' else 'SCHEDULED' end,
      attempt_count=case when notification_jobs.status='SENT' then notification_jobs.attempt_count else 0 end,
      last_error=case when notification_jobs.status='SENT' then notification_jobs.last_error else null end,
      claimed_at=case when notification_jobs.status='SENT' then notification_jobs.claimed_at else null end,
      claimed_by=case when notification_jobs.status='SENT' then notification_jobs.claimed_by else null end,
      sent_at=case when notification_jobs.status='SENT' then notification_jobs.sent_at else null end,
      payload=excluded.payload,
      updated_at=now();
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_assigned_task_notification_jobs_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_env text := public.verto_request_deployment_env_v1();
  v_data jsonb := coalesce(new.task_data, '{}'::jsonb);
  v_daily boolean := lower(coalesce(v_data->>'isDailyReminder', v_data->>'is_daily_reminder', 'false')) in ('true','1','yes','on');
  v_active boolean := lower(coalesce(new.status, 'pending')) not in ('completed','done','canceled','cancelled');
  v_clinic uuid;
  v_timezone text;
  v_scheduled_due timestamptz;
  v_daily_due timestamptz;
begin
  if v_env is null then return new; end if;
  begin
    v_clinic := nullif(new.clinic_id, '')::uuid;
  exception when invalid_text_representation then
    v_clinic := null;
  end;

  v_timezone := public.verto_notification_clinic_timezone_v1(v_clinic);
  v_scheduled_due := case when new.scheduled_at is null then null else public.verto_notification_delivery_due_v1(new.scheduled_at, 0, v_timezone) end;

  update public.notification_jobs
     set status='CANCELED', updated_at=now(), claimed_at=null, claimed_by=null
   where deployment_env=v_env
     and source_type='ASSIGNED_TASK' and source_id=new.id and status in ('SCHEDULED','CLAIMED');

  if v_active and new.patient_id is not null and new.scheduled_at is not null and new.scheduled_at >= now() - interval '6 hours' then
    insert into public.notification_jobs(
      deployment_env,organization_id,clinic_id,patient_id,source_type,source_id,notification_kind,scheduled_for,recurrence_rule,idempotency_key,payload
    ) values (
      v_env,v_clinic,v_clinic,new.patient_id,'ASSIGNED_TASK',new.id,'TASK_REMINDER',v_scheduled_due,null,
      public.verto_notification_idempotency_key_v1(v_env,'assigned-task:'||new.id::text||':scheduled:'||to_char(new.scheduled_at at time zone 'UTC','YYYYMMDDHH24MISS')),
      jsonb_build_object('deploymentEnv',v_env,'scheduledAt',new.scheduled_at,'daily',false,'deliveryMode','SCHEDULED_ONCE','title',coalesce(v_data->>'title','Tarefa'))
    )
    on conflict (deployment_env,idempotency_key) do update set
      organization_id=excluded.organization_id, clinic_id=excluded.clinic_id, patient_id=excluded.patient_id,
      scheduled_for=excluded.scheduled_for, recurrence_rule=null,
      status=case when notification_jobs.status='SENT' then 'SENT' else 'SCHEDULED' end,
      attempt_count=case when notification_jobs.status='SENT' then notification_jobs.attempt_count else 0 end,
      last_error=case when notification_jobs.status='SENT' then notification_jobs.last_error else null end,
      claimed_at=case when notification_jobs.status='SENT' then notification_jobs.claimed_at else null end,
      claimed_by=case when notification_jobs.status='SENT' then notification_jobs.claimed_by else null end,
      sent_at=case when notification_jobs.status='SENT' then notification_jobs.sent_at else null end,
      payload=excluded.payload, updated_at=now();
  end if;

  if v_active and v_daily and new.patient_id is not null and new.scheduled_at is not null then
    v_daily_due := public.verto_daily_notification_next_due_v1(new.scheduled_at,greatest(now(),coalesce(v_scheduled_due,now())),v_timezone);
    insert into public.notification_jobs(
      deployment_env,organization_id,clinic_id,patient_id,source_type,source_id,notification_kind,scheduled_for,recurrence_rule,idempotency_key,payload
    ) values (
      v_env,v_clinic,v_clinic,new.patient_id,'ASSIGNED_TASK',new.id,'TASK_REMINDER',v_daily_due,'DAILY_WHILE_PENDING',
      public.verto_notification_idempotency_key_v1(v_env,'assigned-task:'||new.id::text||':daily'),
      jsonb_build_object('deploymentEnv',v_env,'scheduledAt',new.scheduled_at,'daily',true,'deliveryMode','DAILY_WHILE_PENDING','title',coalesce(v_data->>'title','Tarefa'))
    )
    on conflict (deployment_env,idempotency_key) do update set
      organization_id=excluded.organization_id, clinic_id=excluded.clinic_id, patient_id=excluded.patient_id,
      scheduled_for=excluded.scheduled_for, recurrence_rule=excluded.recurrence_rule,
      status='SCHEDULED', attempt_count=0, last_error=null, claimed_at=null, claimed_by=null, sent_at=null,
      payload=excluded.payload, updated_at=now();
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_portal_notifications_batch_v1(p_deployment_env text, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_count integer:=0; v_env text;
begin
  v_env := public.verto_require_notification_deployment_env_v1(p_deployment_env);
  with input as (
    select * from jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as x(
      id uuid, organization_id uuid, clinic_id uuid, recipient_user_id uuid, recipient_email text, patient_id uuid, appointment_id uuid, type text, title text, message text,
      sent_at timestamptz, scheduled_for timestamptz, idempotency_key text, metadata jsonb
    )
  ), ins as (
    insert into public.portal_notifications(deployment_env,id,organization_id,clinic_id,recipient_user_id,recipient_email,patient_id,appointment_id,type,title,message,sent_at,scheduled_for,idempotency_key,metadata)
    select v_env,coalesce(id,gen_random_uuid()),organization_id,clinic_id,recipient_user_id,recipient_email,patient_id,appointment_id,type,title,message,sent_at,scheduled_for,
      public.verto_notification_idempotency_key_v1(v_env,idempotency_key),coalesce(metadata,'{}'::jsonb)||jsonb_build_object('deploymentEnv',v_env)
    from input
    on conflict (deployment_env,idempotency_key) do update set
      recipient_user_id=excluded.recipient_user_id,recipient_email=excluded.recipient_email,appointment_id=excluded.appointment_id,
      title=excluded.title,message=excluded.message,sent_at=excluded.sent_at,scheduled_for=excluded.scheduled_for,metadata=excluded.metadata
    returning 1
  ) select count(*) into v_count from ins;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.validate_aba_reinforcer_delivery_insert_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
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

CREATE OR REPLACE FUNCTION public.verto_apply_notification_deployment_env_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_request_env text;
begin
  if tg_op = 'UPDATE' then
    new.deployment_env := old.deployment_env;
    return new;
  end if;

  v_request_env := public.verto_request_deployment_env_v1();
  if v_request_env is null then
    new.deployment_env := null;
    return new;
  end if;
  if new.deployment_env is not null and lower(trim(new.deployment_env)) <> v_request_env then
    raise exception 'NOTIFICATION_DEPLOYMENT_ENV_MISMATCH';
  end if;
  new.deployment_env := v_request_env;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_aba_session_reinforcer_summary_authenticated_v1(p_session_id text, p_limit integer DEFAULT 100)
 RETURNS TABLE(reinforcer_id uuid, label_snapshot text, category_snapshot text, delivery_count bigint, last_delivered_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_session public.aba_sessions%rowtype;
  v_organization_id uuid;
  v_patient_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit,100), 200));
begin
  if v_actor_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_AUTH_REQUIRED'; end if;
  if p_session_id is null or length(trim(p_session_id))=0 then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_REQUIRED'; end if;
  select * into v_session from public.aba_sessions s where s.id=trim(p_session_id);
  if not found then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end if;
  begin v_organization_id:=v_session.clinic_id::uuid; exception when invalid_text_representation then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end;
  v_patient_id:=v_session.patient_id;
  if v_organization_id is null or v_patient_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end if;
  if not public.aba_reinforcer_actor_can_read_v1(v_actor_id,v_organization_id,v_patient_id) then raise exception using errcode='P0001',message='ABA_REINFORCER_READ_FORBIDDEN'; end if;
  return query select * from public.get_aba_session_reinforcer_summary_v1(v_organization_id,v_patient_id,trim(p_session_id),v_actor_id,v_limit);
end;$function$;

CREATE OR REPLACE FUNCTION public.list_aba_session_reinforcer_events_authenticated_v1(p_session_id text, p_limit integer DEFAULT 200)
 RETURNS TABLE(event_id uuid, reinforcer_id uuid, label_snapshot text, category_snapshot text, occurred_at timestamp with time zone, received_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_session public.aba_sessions%rowtype;
  v_organization_id uuid;
  v_patient_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit,200), 500));
begin
  if v_actor_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_AUTH_REQUIRED'; end if;
  if p_session_id is null or length(trim(p_session_id))=0 then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_REQUIRED'; end if;
  select * into v_session from public.aba_sessions s where s.id=trim(p_session_id);
  if not found then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end if;
  begin v_organization_id:=v_session.clinic_id::uuid; exception when invalid_text_representation then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end;
  v_patient_id:=v_session.patient_id;
  if v_organization_id is null or v_patient_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_SESSION_SCOPE_INVALID'; end if;
  if not public.aba_reinforcer_actor_can_read_v1(v_actor_id,v_organization_id,v_patient_id) then raise exception using errcode='P0001',message='ABA_REINFORCER_READ_FORBIDDEN'; end if;
  return query select * from public.list_aba_session_reinforcer_events_v1(v_organization_id,v_patient_id,trim(p_session_id),v_actor_id,v_limit);
end;$function$;

CREATE OR REPLACE FUNCTION public.list_recent_aba_patient_reinforcers_authenticated_v1(p_patient_id uuid, p_limit integer DEFAULT 6, p_lookback_days integer DEFAULT 90)
 RETURNS TABLE(reinforcer_id uuid, label text, category text, last_delivered_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_organization_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit,6), 20));
  v_lookback_days integer := greatest(1, least(coalesce(p_lookback_days,90), 365));
begin
  if v_actor_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_AUTH_REQUIRED'; end if;
  if p_patient_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_PATIENT_SCOPE_REQUIRED'; end if;
  select p.clinic_id into v_organization_id from public.patients p where p.id=p_patient_id;
  if not found or v_organization_id is null then raise exception using errcode='P0001',message='ABA_REINFORCER_PATIENT_SCOPE_INVALID'; end if;
  if not public.aba_reinforcer_actor_can_read_v1(v_actor_id,v_organization_id,p_patient_id) then raise exception using errcode='P0001',message='ABA_REINFORCER_READ_FORBIDDEN'; end if;
  return query select * from public.list_recent_aba_patient_reinforcers_v1(v_organization_id,p_patient_id,v_actor_id,v_limit,v_lookback_days);
end;$function$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.patient_files'::regclass AND conname='patient_files_access_scope_v1') THEN ALTER TABLE public."patient_files" ADD CONSTRAINT "patient_files_access_scope_v1" CHECK (access_scope = ANY (ARRAY['OWNER'::text, 'CASE_TEAM'::text, 'PATIENT_ACCESS'::text, 'SELECTED'::text])) NOT VALID; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinics'::regclass AND conname='clinics_patient_photo_policy_check') THEN ALTER TABLE public."clinics" ADD CONSTRAINT "clinics_patient_photo_policy_check" CHECK (patient_photo_policy = ANY (ARRAY['PORTAL'::text, 'CLINIC'::text])) NOT VALID; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tiss_official_document_tracking'::regclass AND conname='tiss_official_document_tracking_amount_balance_check') THEN ALTER TABLE public."tiss_official_document_tracking" ADD CONSTRAINT "tiss_official_document_tracking_amount_balance_check" CHECK ((total_paid_amount_cents + total_glossed_amount_cents) <= total_sent_amount_cents) NOT VALID; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tiss_official_guide_tracking'::regclass AND conname='tiss_official_guide_tracking_amount_balance_check') THEN ALTER TABLE public."tiss_official_guide_tracking" ADD CONSTRAINT "tiss_official_guide_tracking_amount_balance_check" CHECK ((paid_amount_cents + glossed_amount_cents) <= sent_amount_cents) NOT VALID; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_session_target_measurement_bindings'::regclass AND conname='aba_session_target_binding_history_snapshot_v1') THEN ALTER TABLE public."aba_session_target_measurement_bindings" ADD CONSTRAINT "aba_session_target_binding_history_snapshot_v1" CHECK (measurement_model_version <> 'V3'::text OR program_version_id IS NOT NULL AND program_version_snapshot IS NOT NULL AND program_version_snapshot > 0 AND NULLIF(btrim(measurement_type_snapshot), ''::text) IS NOT NULL AND NULLIF(btrim(target_status_snapshot), ''::text) IS NOT NULL) NOT VALID; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.assigned_tasks'::regclass AND conname='assigned_tasks_clinical_link_version_check') THEN ALTER TABLE public."assigned_tasks" ADD CONSTRAINT "assigned_tasks_clinical_link_version_check" CHECK (clinical_link_version >= 1 AND clinical_link_version <= 100) NOT VALID; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.adult_task_reviews'::regclass AND conname='adult_task_reviews_evidence_kind_check') THEN ALTER TABLE public."adult_task_reviews" ADD CONSTRAINT "adult_task_reviews_evidence_kind_check" CHECK (evidence_kind = 'contextual_task_review'::text) NOT VALID; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.push_subscriptions'::regclass AND conname='push_subscriptions_deployment_env_check') THEN ALTER TABLE public."push_subscriptions" ADD CONSTRAINT "push_subscriptions_deployment_env_check" CHECK (deployment_env IS NULL OR (deployment_env = ANY (ARRAY['staging'::text, 'production'::text]))) NOT VALID; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.portal_notifications'::regclass AND conname='portal_notifications_deployment_env_check') THEN ALTER TABLE public."portal_notifications" ADD CONSTRAINT "portal_notifications_deployment_env_check" CHECK (deployment_env IS NULL OR (deployment_env = ANY (ARRAY['staging'::text, 'production'::text]))) NOT VALID; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_session_locations'::regclass AND conname='aba_session_locations_clinic_id_fkey') THEN ALTER TABLE public."aba_session_locations" ADD CONSTRAINT "aba_session_locations_clinic_id_fkey" FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_session_locations'::regclass AND conname='aba_session_locations_created_by_fkey') THEN ALTER TABLE public."aba_session_locations" ADD CONSTRAINT "aba_session_locations_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_session_locations'::regclass AND conname='aba_session_locations_name_length_v1') THEN ALTER TABLE public."aba_session_locations" ADD CONSTRAINT "aba_session_locations_name_length_v1" CHECK (char_length(TRIM(BOTH FROM name)) >= 1 AND char_length(TRIM(BOTH FROM name)) <= 40); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_session_locations'::regclass AND conname='aba_session_locations_normalized_name_length_v1') THEN ALTER TABLE public."aba_session_locations" ADD CONSTRAINT "aba_session_locations_normalized_name_length_v1" CHECK (char_length(TRIM(BOTH FROM normalized_name)) >= 1 AND char_length(TRIM(BOTH FROM normalized_name)) <= 40); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_session_locations'::regclass AND conname='aba_session_locations_pkey') THEN ALTER TABLE public."aba_session_locations" ADD CONSTRAINT "aba_session_locations_pkey" PRIMARY KEY (id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_session_locations'::regclass AND conname='aba_session_locations_updated_by_fkey') THEN ALTER TABLE public."aba_session_locations" ADD CONSTRAINT "aba_session_locations_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_user_session_preferences'::regclass AND conname='aba_user_session_preferences_clinic_id_fkey') THEN ALTER TABLE public."aba_user_session_preferences" ADD CONSTRAINT "aba_user_session_preferences_clinic_id_fkey" FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_user_session_preferences'::regclass AND conname='aba_user_session_preferences_pkey') THEN ALTER TABLE public."aba_user_session_preferences" ADD CONSTRAINT "aba_user_session_preferences_pkey" PRIMARY KEY (clinic_id, user_id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_user_session_preferences'::regclass AND conname='aba_user_session_preferences_shortcuts_array_v1') THEN ALTER TABLE public."aba_user_session_preferences" ADD CONSTRAINT "aba_user_session_preferences_shortcuts_array_v1" CHECK (jsonb_typeof(quick_behavior_shortcuts) = 'array'::text AND jsonb_array_length(quick_behavior_shortcuts) <= 6); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_user_session_preferences'::regclass AND conname='aba_user_session_preferences_user_id_fkey') THEN ALTER TABLE public."aba_user_session_preferences" ADD CONSTRAINT "aba_user_session_preferences_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_announcements'::regclass AND conname='clinic_announcements_deployment_env_check') THEN ALTER TABLE public."clinic_announcements" ADD CONSTRAINT "clinic_announcements_deployment_env_check" CHECK (deployment_env IS NULL OR (deployment_env = ANY (ARRAY['staging'::text, 'production'::text]))) NOT VALID; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.patient_file_access_grants'::regclass AND conname='patient_file_access_grants_file_id_fkey') THEN ALTER TABLE public."patient_file_access_grants" ADD CONSTRAINT "patient_file_access_grants_file_id_fkey" FOREIGN KEY (file_id) REFERENCES patient_files(id) ON DELETE CASCADE; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.patient_file_access_grants'::regclass AND conname='patient_file_access_grants_file_id_grantee_user_id_key') THEN ALTER TABLE public."patient_file_access_grants" ADD CONSTRAINT "patient_file_access_grants_file_id_grantee_user_id_key" UNIQUE (file_id, grantee_user_id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.patient_file_access_grants'::regclass AND conname='patient_file_access_grants_granted_by_fkey') THEN ALTER TABLE public."patient_file_access_grants" ADD CONSTRAINT "patient_file_access_grants_granted_by_fkey" FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.patient_file_access_grants'::regclass AND conname='patient_file_access_grants_grantee_user_id_fkey') THEN ALTER TABLE public."patient_file_access_grants" ADD CONSTRAINT "patient_file_access_grants_grantee_user_id_fkey" FOREIGN KEY (grantee_user_id) REFERENCES users(id) ON DELETE CASCADE; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.patient_file_access_grants'::regclass AND conname='patient_file_access_grants_patient_id_fkey') THEN ALTER TABLE public."patient_file_access_grants" ADD CONSTRAINT "patient_file_access_grants_patient_id_fkey" FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.patient_file_access_grants'::regclass AND conname='patient_file_access_grants_pkey') THEN ALTER TABLE public."patient_file_access_grants" ADD CONSTRAINT "patient_file_access_grants_pkey" PRIMARY KEY (id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.user_feature_access'::regclass AND conname='user_feature_access_feature_key_v1') THEN ALTER TABLE public."user_feature_access" ADD CONSTRAINT "user_feature_access_feature_key_v1" CHECK (feature_key ~ '^[a-z0-9_]{1,80}$'::text); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.user_feature_access'::regclass AND conname='user_feature_access_pk_v1') THEN ALTER TABLE public."user_feature_access" ADD CONSTRAINT "user_feature_access_pk_v1" PRIMARY KEY (user_id, feature_key); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.user_feature_access'::regclass AND conname='user_feature_access_user_id_fkey') THEN ALTER TABLE public."user_feature_access" ADD CONSTRAINT "user_feature_access_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.notification_jobs'::regclass AND conname='notification_jobs_deployment_env_check') THEN ALTER TABLE public."notification_jobs" ADD CONSTRAINT "notification_jobs_deployment_env_check" CHECK (deployment_env IS NULL OR (deployment_env = ANY (ARRAY['staging'::text, 'production'::text]))) NOT VALID; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.patient_message_reads'::regclass AND conname='patient_message_reads_clinic_id_fkey') THEN ALTER TABLE public."patient_message_reads" ADD CONSTRAINT "patient_message_reads_clinic_id_fkey" FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.patient_message_reads'::regclass AND conname='patient_message_reads_clinic_id_patient_id_note_id_recipien_key') THEN ALTER TABLE public."patient_message_reads" ADD CONSTRAINT "patient_message_reads_clinic_id_patient_id_note_id_recipien_key" UNIQUE (clinic_id, patient_id, note_id, recipient_user_id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.patient_message_reads'::regclass AND conname='patient_message_reads_org_clinic_chk') THEN ALTER TABLE public."patient_message_reads" ADD CONSTRAINT "patient_message_reads_org_clinic_chk" CHECK (organization_id = clinic_id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.patient_message_reads'::regclass AND conname='patient_message_reads_organization_id_fkey') THEN ALTER TABLE public."patient_message_reads" ADD CONSTRAINT "patient_message_reads_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES clinics(id) ON DELETE CASCADE; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.patient_message_reads'::regclass AND conname='patient_message_reads_patient_id_fkey') THEN ALTER TABLE public."patient_message_reads" ADD CONSTRAINT "patient_message_reads_patient_id_fkey" FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.patient_message_reads'::regclass AND conname='patient_message_reads_pkey') THEN ALTER TABLE public."patient_message_reads" ADD CONSTRAINT "patient_message_reads_pkey" PRIMARY KEY (id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_protocol_grants'::regclass AND conname='clinic_protocol_grants_key_nonblank') THEN ALTER TABLE public."clinic_protocol_grants" ADD CONSTRAINT "clinic_protocol_grants_key_nonblank" CHECK (length(TRIM(BOTH FROM canonical_key)) > 0); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_protocol_grants'::regclass AND conname='clinic_protocol_grants_pkey') THEN ALTER TABLE public."clinic_protocol_grants" ADD CONSTRAINT "clinic_protocol_grants_pkey" PRIMARY KEY (id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_protocol_grants'::regclass AND conname='clinic_protocol_grants_source_request_id_fkey') THEN ALTER TABLE public."clinic_protocol_grants" ADD CONSTRAINT "clinic_protocol_grants_source_request_id_fkey" FOREIGN KEY (source_request_id) REFERENCES protocol_import_requests(id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_protocol_grants'::regclass AND conname='clinic_protocol_grants_unique') THEN ALTER TABLE public."clinic_protocol_grants" ADD CONSTRAINT "clinic_protocol_grants_unique" UNIQUE (clinic_id, canonical_key); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_billing_access_state'::regclass AND conname='organization_billing_access_state_access_state_check') THEN ALTER TABLE public."organization_billing_access_state" ADD CONSTRAINT "organization_billing_access_state_access_state_check" CHECK (access_state = ANY (ARRAY['ACTIVE'::text, 'GRACE_PERIOD'::text, 'SUSPENDED_BILLING'::text, 'SUSPENDED_CANCELED'::text])); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_billing_access_state'::regclass AND conname='organization_billing_access_state_check') THEN ALTER TABLE public."organization_billing_access_state" ADD CONSTRAINT "organization_billing_access_state_check" CHECK ((access_state = 'GRACE_PERIOD'::text) = (grace_ends_at IS NOT NULL)); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_billing_access_state'::regclass AND conname='organization_billing_access_state_check1') THEN ALTER TABLE public."organization_billing_access_state" ADD CONSTRAINT "organization_billing_access_state_check1" CHECK (grace_started_at IS NULL OR grace_ends_at IS NULL OR grace_started_at <= grace_ends_at); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_billing_access_state'::regclass AND conname='organization_billing_access_state_organization_id_fkey') THEN ALTER TABLE public."organization_billing_access_state" ADD CONSTRAINT "organization_billing_access_state_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES clinics(id) ON DELETE CASCADE; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.organization_billing_access_state'::regclass AND conname='organization_billing_access_state_pkey') THEN ALTER TABLE public."organization_billing_access_state" ADD CONSTRAINT "organization_billing_access_state_pkey" PRIMARY KEY (organization_id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_templates'::regclass AND conname='onboarding_templates_created_by_fkey') THEN ALTER TABLE public."onboarding_templates" ADD CONSTRAINT "onboarding_templates_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_templates'::regclass AND conname='onboarding_templates_guidance_length') THEN ALTER TABLE public."onboarding_templates" ADD CONSTRAINT "onboarding_templates_guidance_length" CHECK (char_length(btrim(participant_guidance)) >= 1 AND char_length(btrim(participant_guidance)) <= 1200); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_templates'::regclass AND conname='onboarding_templates_message_length') THEN ALTER TABLE public."onboarding_templates" ADD CONSTRAINT "onboarding_templates_message_length" CHECK (char_length(btrim(message)) >= 1 AND char_length(btrim(message)) <= 4000); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_templates'::regclass AND conname='onboarding_templates_pkey') THEN ALTER TABLE public."onboarding_templates" ADD CONSTRAINT "onboarding_templates_pkey" PRIMARY KEY (id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_templates'::regclass AND conname='onboarding_templates_status_check') THEN ALTER TABLE public."onboarding_templates" ADD CONSTRAINT "onboarding_templates_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'archived'::text])); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_templates'::regclass AND conname='onboarding_templates_title_length') THEN ALTER TABLE public."onboarding_templates" ADD CONSTRAINT "onboarding_templates_title_length" CHECK (char_length(btrim(title)) >= 1 AND char_length(btrim(title)) <= 160); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_templates'::regclass AND conname='onboarding_templates_topics_valid') THEN ALTER TABLE public."onboarding_templates" ADD CONSTRAINT "onboarding_templates_topics_valid" CHECK (onboarding_text_array_valid_v1(topics, 1, 20, 240)); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_templates'::regclass AND conname='onboarding_templates_updated_by_fkey') THEN ALTER TABLE public."onboarding_templates" ADD CONSTRAINT "onboarding_templates_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_publications'::regclass AND conname='onboarding_publications_cancelled_time') THEN ALTER TABLE public."onboarding_publications" ADD CONSTRAINT "onboarding_publications_cancelled_time" CHECK (cancelled_at IS NULL OR cancelled_at >= published_at); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_publications'::regclass AND conname='onboarding_publications_clinic_id_fkey') THEN ALTER TABLE public."onboarding_publications" ADD CONSTRAINT "onboarding_publications_clinic_id_fkey" FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_publications'::regclass AND conname='onboarding_publications_guidance_length') THEN ALTER TABLE public."onboarding_publications" ADD CONSTRAINT "onboarding_publications_guidance_length" CHECK (char_length(btrim(snapshot_participant_guidance)) >= 1 AND char_length(btrim(snapshot_participant_guidance)) <= 1200); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_publications'::regclass AND conname='onboarding_publications_message_length') THEN ALTER TABLE public."onboarding_publications" ADD CONSTRAINT "onboarding_publications_message_length" CHECK (char_length(btrim(snapshot_message)) >= 1 AND char_length(btrim(snapshot_message)) <= 4000); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_publications'::regclass AND conname='onboarding_publications_pkey') THEN ALTER TABLE public."onboarding_publications" ADD CONSTRAINT "onboarding_publications_pkey" PRIMARY KEY (id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_publications'::regclass AND conname='onboarding_publications_published_by_fkey') THEN ALTER TABLE public."onboarding_publications" ADD CONSTRAINT "onboarding_publications_published_by_fkey" FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_publications'::regclass AND conname='onboarding_publications_responded_time') THEN ALTER TABLE public."onboarding_publications" ADD CONSTRAINT "onboarding_publications_responded_time" CHECK (responded_at IS NULL OR responded_at >= published_at); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_publications'::regclass AND conname='onboarding_publications_status_check') THEN ALTER TABLE public."onboarding_publications" ADD CONSTRAINT "onboarding_publications_status_check" CHECK (status = ANY (ARRAY['published'::text, 'viewed'::text, 'responded'::text, 'cancelled'::text])); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_publications'::regclass AND conname='onboarding_publications_template_id_fkey') THEN ALTER TABLE public."onboarding_publications" ADD CONSTRAINT "onboarding_publications_template_id_fkey" FOREIGN KEY (template_id) REFERENCES onboarding_templates(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_publications'::regclass AND conname='onboarding_publications_template_id_version_key') THEN ALTER TABLE public."onboarding_publications" ADD CONSTRAINT "onboarding_publications_template_id_version_key" UNIQUE (template_id, version); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_publications'::regclass AND conname='onboarding_publications_title_length') THEN ALTER TABLE public."onboarding_publications" ADD CONSTRAINT "onboarding_publications_title_length" CHECK (char_length(btrim(snapshot_title)) >= 1 AND char_length(btrim(snapshot_title)) <= 160); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_publications'::regclass AND conname='onboarding_publications_topics_valid') THEN ALTER TABLE public."onboarding_publications" ADD CONSTRAINT "onboarding_publications_topics_valid" CHECK (onboarding_text_array_valid_v1(snapshot_topics, 1, 20, 240)); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_publications'::regclass AND conname='onboarding_publications_version_check') THEN ALTER TABLE public."onboarding_publications" ADD CONSTRAINT "onboarding_publications_version_check" CHECK (version > 0); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_publications'::regclass AND conname='onboarding_publications_viewed_time') THEN ALTER TABLE public."onboarding_publications" ADD CONSTRAINT "onboarding_publications_viewed_time" CHECK (viewed_at IS NULL OR viewed_at >= published_at); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_slots'::regclass AND conname='onboarding_slots_created_by_fkey') THEN ALTER TABLE public."onboarding_slots" ADD CONSTRAINT "onboarding_slots_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_slots'::regclass AND conname='onboarding_slots_pkey') THEN ALTER TABLE public."onboarding_slots" ADD CONSTRAINT "onboarding_slots_pkey" PRIMARY KEY (id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_slots'::regclass AND conname='onboarding_slots_publication_id_fkey') THEN ALTER TABLE public."onboarding_slots" ADD CONSTRAINT "onboarding_slots_publication_id_fkey" FOREIGN KEY (publication_id) REFERENCES onboarding_publications(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_slots'::regclass AND conname='onboarding_slots_publication_id_starts_at_key') THEN ALTER TABLE public."onboarding_slots" ADD CONSTRAINT "onboarding_slots_publication_id_starts_at_key" UNIQUE (publication_id, starts_at); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_slots'::regclass AND conname='onboarding_slots_reserved_time') THEN ALTER TABLE public."onboarding_slots" ADD CONSTRAINT "onboarding_slots_reserved_time" CHECK (reserved_at IS NULL OR reserved_at >= created_at); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_slots'::regclass AND conname='onboarding_slots_status_check') THEN ALTER TABLE public."onboarding_slots" ADD CONSTRAINT "onboarding_slots_status_check" CHECK (status = ANY (ARRAY['available'::text, 'inactive'::text, 'reserved'::text, 'cancelled'::text])); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_slots'::regclass AND conname='onboarding_slots_timezone_length') THEN ALTER TABLE public."onboarding_slots" ADD CONSTRAINT "onboarding_slots_timezone_length" CHECK (char_length(btrim(timezone)) >= 1 AND char_length(btrim(timezone)) <= 80); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_responses'::regclass AND conname='onboarding_responses_admin_ack_by_fkey') THEN ALTER TABLE public."onboarding_responses" ADD CONSTRAINT "onboarding_responses_admin_ack_by_fkey" FOREIGN KEY (admin_ack_by) REFERENCES users(id) ON DELETE SET NULL; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_responses'::regclass AND conname='onboarding_responses_cancelled_time') THEN ALTER TABLE public."onboarding_responses" ADD CONSTRAINT "onboarding_responses_cancelled_time" CHECK (cancelled_at IS NULL OR cancelled_at >= responded_at); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_responses'::regclass AND conname='onboarding_responses_clinic_id_fkey') THEN ALTER TABLE public."onboarding_responses" ADD CONSTRAINT "onboarding_responses_clinic_id_fkey" FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_responses'::regclass AND conname='onboarding_responses_idempotency_length') THEN ALTER TABLE public."onboarding_responses" ADD CONSTRAINT "onboarding_responses_idempotency_length" CHECK (char_length(idempotency_key) >= 12 AND char_length(idempotency_key) <= 160); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_responses'::regclass AND conname='onboarding_responses_participants_valid') THEN ALTER TABLE public."onboarding_responses" ADD CONSTRAINT "onboarding_responses_participants_valid" CHECK (onboarding_text_array_valid_v1(participants, 1, 20, 120)); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_responses'::regclass AND conname='onboarding_responses_pkey') THEN ALTER TABLE public."onboarding_responses" ADD CONSTRAINT "onboarding_responses_pkey" PRIMARY KEY (id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_responses'::regclass AND conname='onboarding_responses_previous_response_id_fkey') THEN ALTER TABLE public."onboarding_responses" ADD CONSTRAINT "onboarding_responses_previous_response_id_fkey" FOREIGN KEY (previous_response_id) REFERENCES onboarding_responses(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_responses'::regclass AND conname='onboarding_responses_publication_id_fkey') THEN ALTER TABLE public."onboarding_responses" ADD CONSTRAINT "onboarding_responses_publication_id_fkey" FOREIGN KEY (publication_id) REFERENCES onboarding_publications(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_responses'::regclass AND conname='onboarding_responses_responded_by_fkey') THEN ALTER TABLE public."onboarding_responses" ADD CONSTRAINT "onboarding_responses_responded_by_fkey" FOREIGN KEY (responded_by) REFERENCES users(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_responses'::regclass AND conname='onboarding_responses_slot_id_fkey') THEN ALTER TABLE public."onboarding_responses" ADD CONSTRAINT "onboarding_responses_slot_id_fkey" FOREIGN KEY (slot_id) REFERENCES onboarding_slots(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_responses'::regclass AND conname='onboarding_responses_status_check') THEN ALTER TABLE public."onboarding_responses" ADD CONSTRAINT "onboarding_responses_status_check" CHECK (status = ANY (ARRAY['responded'::text, 'cancelled'::text, 'superseded'::text])); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.onboarding_responses'::regclass AND conname='onboarding_responses_superseded_time') THEN ALTER TABLE public."onboarding_responses" ADD CONSTRAINT "onboarding_responses_superseded_time" CHECK (superseded_at IS NULL OR superseded_at >= responded_at); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.module_subscription_upgrade_intents'::regclass AND conname='module_subscription_upgrade_i_organization_id_idempotency_k_key') THEN ALTER TABLE public."module_subscription_upgrade_intents" ADD CONSTRAINT "module_subscription_upgrade_i_organization_id_idempotency_k_key" UNIQUE (organization_id, idempotency_key); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.module_subscription_upgrade_intents'::regclass AND conname='module_subscription_upgrade_intents_intent_status_check') THEN ALTER TABLE public."module_subscription_upgrade_intents" ADD CONSTRAINT "module_subscription_upgrade_intents_intent_status_check" CHECK (intent_status = ANY (ARRAY['claimed'::text, 'stripe_pending'::text, 'requires_action'::text, 'stripe_confirmed'::text, 'provisioned'::text, 'failed'::text, 'cancelled'::text, 'superseded'::text])); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.module_subscription_upgrade_intents'::regclass AND conname='module_subscription_upgrade_intents_organization_id_fkey') THEN ALTER TABLE public."module_subscription_upgrade_intents" ADD CONSTRAINT "module_subscription_upgrade_intents_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES clinics(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.module_subscription_upgrade_intents'::regclass AND conname='module_subscription_upgrade_intents_pkey') THEN ALTER TABLE public."module_subscription_upgrade_intents" ADD CONSTRAINT "module_subscription_upgrade_intents_pkey" PRIMARY KEY (id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.module_subscription_upgrade_intents'::regclass AND conname='module_subscription_upgrade_intents_sales_offer_id_fkey') THEN ALTER TABLE public."module_subscription_upgrade_intents" ADD CONSTRAINT "module_subscription_upgrade_intents_sales_offer_id_fkey" FOREIGN KEY (sales_offer_id) REFERENCES sales_offers(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_patient_reinforcers'::regclass AND conname='aba_patient_reinforcers_category_v1') THEN ALTER TABLE public."aba_patient_reinforcers" ADD CONSTRAINT "aba_patient_reinforcers_category_v1" CHECK (category IS NULL OR (category = ANY (ARRAY['SOCIAL'::text, 'ACTIVITY'::text, 'ITEM_OBJECT'::text, 'SENSORY'::text, 'FOOD'::text, 'OTHER'::text]))); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_patient_reinforcers'::regclass AND conname='aba_patient_reinforcers_id_organization_id_patient_id_key') THEN ALTER TABLE public."aba_patient_reinforcers" ADD CONSTRAINT "aba_patient_reinforcers_id_organization_id_patient_id_key" UNIQUE (id, organization_id, patient_id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_patient_reinforcers'::regclass AND conname='aba_patient_reinforcers_label_v1') THEN ALTER TABLE public."aba_patient_reinforcers" ADD CONSTRAINT "aba_patient_reinforcers_label_v1" CHECK (char_length(TRIM(BOTH FROM label)) >= 1 AND char_length(TRIM(BOTH FROM label)) <= 160); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_patient_reinforcers'::regclass AND conname='aba_patient_reinforcers_note_v1') THEN ALTER TABLE public."aba_patient_reinforcers" ADD CONSTRAINT "aba_patient_reinforcers_note_v1" CHECK (note IS NULL OR char_length(note) <= 500); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_patient_reinforcers'::regclass AND conname='aba_patient_reinforcers_organization_id_fkey') THEN ALTER TABLE public."aba_patient_reinforcers" ADD CONSTRAINT "aba_patient_reinforcers_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES clinics(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_patient_reinforcers'::regclass AND conname='aba_patient_reinforcers_patient_id_fkey') THEN ALTER TABLE public."aba_patient_reinforcers" ADD CONSTRAINT "aba_patient_reinforcers_patient_id_fkey" FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_patient_reinforcers'::regclass AND conname='aba_patient_reinforcers_pkey') THEN ALTER TABLE public."aba_patient_reinforcers" ADD CONSTRAINT "aba_patient_reinforcers_pkey" PRIMARY KEY (id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_reinforcer_delivery_events'::regclass AND conname='aba_reinforcer_delivery_catalog_scope_v1') THEN ALTER TABLE public."aba_reinforcer_delivery_events" ADD CONSTRAINT "aba_reinforcer_delivery_catalog_scope_v1" FOREIGN KEY (reinforcer_id, organization_id, patient_id) REFERENCES aba_patient_reinforcers(id, organization_id, patient_id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_reinforcer_delivery_events'::regclass AND conname='aba_reinforcer_delivery_category_snapshot_v1') THEN ALTER TABLE public."aba_reinforcer_delivery_events" ADD CONSTRAINT "aba_reinforcer_delivery_category_snapshot_v1" CHECK (category_snapshot IS NULL OR (category_snapshot = ANY (ARRAY['SOCIAL'::text, 'ACTIVITY'::text, 'ITEM_OBJECT'::text, 'SENSORY'::text, 'FOOD'::text, 'OTHER'::text]))); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_reinforcer_delivery_events'::regclass AND conname='aba_reinforcer_delivery_client_event_v1') THEN ALTER TABLE public."aba_reinforcer_delivery_events" ADD CONSTRAINT "aba_reinforcer_delivery_client_event_v1" CHECK (char_length(TRIM(BOTH FROM client_event_id)) >= 1 AND char_length(TRIM(BOTH FROM client_event_id)) <= 240); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_reinforcer_delivery_events'::regclass AND conname='aba_reinforcer_delivery_event_type_v1') THEN ALTER TABLE public."aba_reinforcer_delivery_events" ADD CONSTRAINT "aba_reinforcer_delivery_event_type_v1" CHECK (event_type = 'DELIVERED'::text); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_reinforcer_delivery_events'::regclass AND conname='aba_reinforcer_delivery_events_organization_id_fkey') THEN ALTER TABLE public."aba_reinforcer_delivery_events" ADD CONSTRAINT "aba_reinforcer_delivery_events_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES clinics(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_reinforcer_delivery_events'::regclass AND conname='aba_reinforcer_delivery_events_patient_id_fkey') THEN ALTER TABLE public."aba_reinforcer_delivery_events" ADD CONSTRAINT "aba_reinforcer_delivery_events_patient_id_fkey" FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_reinforcer_delivery_events'::regclass AND conname='aba_reinforcer_delivery_events_pkey') THEN ALTER TABLE public."aba_reinforcer_delivery_events" ADD CONSTRAINT "aba_reinforcer_delivery_events_pkey" PRIMARY KEY (id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_reinforcer_delivery_events'::regclass AND conname='aba_reinforcer_delivery_events_session_id_fkey') THEN ALTER TABLE public."aba_reinforcer_delivery_events" ADD CONSTRAINT "aba_reinforcer_delivery_events_session_id_fkey" FOREIGN KEY (session_id) REFERENCES aba_sessions(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_reinforcer_delivery_events'::regclass AND conname='aba_reinforcer_delivery_idempotency_v1') THEN ALTER TABLE public."aba_reinforcer_delivery_events" ADD CONSTRAINT "aba_reinforcer_delivery_idempotency_v1" UNIQUE (organization_id, session_id, client_event_id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_reinforcer_delivery_events'::regclass AND conname='aba_reinforcer_delivery_label_snapshot_v1') THEN ALTER TABLE public."aba_reinforcer_delivery_events" ADD CONSTRAINT "aba_reinforcer_delivery_label_snapshot_v1" CHECK (char_length(TRIM(BOTH FROM label_snapshot)) >= 1 AND char_length(TRIM(BOTH FROM label_snapshot)) <= 160); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.aba_reinforcer_delivery_events'::regclass AND conname='aba_reinforcer_delivery_payload_hash_v1') THEN ALTER TABLE public."aba_reinforcer_delivery_events" ADD CONSTRAINT "aba_reinforcer_delivery_payload_hash_v1" CHECK (payload_hash ~ '^[0-9a-f]{64}$'::text); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_threads'::regclass AND conname='clinic_communication_threads_archive_v1') THEN ALTER TABLE public."clinic_communication_threads" ADD CONSTRAINT "clinic_communication_threads_archive_v1" CHECK (status = 'open'::text AND archived_at IS NULL OR status = 'archived'::text AND archived_at IS NOT NULL); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_threads'::regclass AND conname='clinic_communication_threads_archived_by_fkey') THEN ALTER TABLE public."clinic_communication_threads" ADD CONSTRAINT "clinic_communication_threads_archived_by_fkey" FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_threads'::regclass AND conname='clinic_communication_threads_clinic_id_fkey') THEN ALTER TABLE public."clinic_communication_threads" ADD CONSTRAINT "clinic_communication_threads_clinic_id_fkey" FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_threads'::regclass AND conname='clinic_communication_threads_created_by_fkey') THEN ALTER TABLE public."clinic_communication_threads" ADD CONSTRAINT "clinic_communication_threads_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_threads'::regclass AND conname='clinic_communication_threads_id_clinic_id_key') THEN ALTER TABLE public."clinic_communication_threads" ADD CONSTRAINT "clinic_communication_threads_id_clinic_id_key" UNIQUE (id, clinic_id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_threads'::regclass AND conname='clinic_communication_threads_last_sequence_check') THEN ALTER TABLE public."clinic_communication_threads" ADD CONSTRAINT "clinic_communication_threads_last_sequence_check" CHECK (last_sequence >= 0); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_threads'::regclass AND conname='clinic_communication_threads_pkey') THEN ALTER TABLE public."clinic_communication_threads" ADD CONSTRAINT "clinic_communication_threads_pkey" PRIMARY KEY (id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_threads'::regclass AND conname='clinic_communication_threads_reference_v1') THEN ALTER TABLE public."clinic_communication_threads" ADD CONSTRAINT "clinic_communication_threads_reference_v1" CHECK (reference_type IS NULL AND reference_id IS NULL OR reference_type = 'TISS_OFFICIAL_LOT'::text AND reference_id IS NOT NULL); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_threads'::regclass AND conname='clinic_communication_threads_status_check') THEN ALTER TABLE public."clinic_communication_threads" ADD CONSTRAINT "clinic_communication_threads_status_check" CHECK (status = ANY (ARRAY['open'::text, 'archived'::text])); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_threads'::regclass AND conname='clinic_communication_threads_subject_v1') THEN ALTER TABLE public."clinic_communication_threads" ADD CONSTRAINT "clinic_communication_threads_subject_v1" CHECK (char_length(btrim(subject)) >= 1 AND char_length(btrim(subject)) <= 120); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_messages'::regclass AND conname='clinic_communication_messages_author_user_id_fkey') THEN ALTER TABLE public."clinic_communication_messages" ADD CONSTRAINT "clinic_communication_messages_author_user_id_fkey" FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_messages'::regclass AND conname='clinic_communication_messages_body_v1') THEN ALTER TABLE public."clinic_communication_messages" ADD CONSTRAINT "clinic_communication_messages_body_v1" CHECK (char_length(btrim(body)) >= 1 AND char_length(btrim(body)) <= 2000 AND body !~ '<[[:space:]]*/?[[:space:]]*[A-Za-z][^>]*>'::text); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_messages'::regclass AND conname='clinic_communication_messages_clinic_id_fkey') THEN ALTER TABLE public."clinic_communication_messages" ADD CONSTRAINT "clinic_communication_messages_clinic_id_fkey" FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_messages'::regclass AND conname='clinic_communication_messages_id_thread_id_clinic_id_key') THEN ALTER TABLE public."clinic_communication_messages" ADD CONSTRAINT "clinic_communication_messages_id_thread_id_clinic_id_key" UNIQUE (id, thread_id, clinic_id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_messages'::regclass AND conname='clinic_communication_messages_idempotency_v1') THEN ALTER TABLE public."clinic_communication_messages" ADD CONSTRAINT "clinic_communication_messages_idempotency_v1" CHECK (char_length(idempotency_key) >= 16 AND char_length(idempotency_key) <= 200 AND idempotency_key !~ '[[:space:]]'::text); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_messages'::regclass AND conname='clinic_communication_messages_operation_type_check') THEN ALTER TABLE public."clinic_communication_messages" ADD CONSTRAINT "clinic_communication_messages_operation_type_check" CHECK (operation_type = ANY (ARRAY['create_thread'::text, 'send_message'::text])); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_messages'::regclass AND conname='clinic_communication_messages_pkey') THEN ALTER TABLE public."clinic_communication_messages" ADD CONSTRAINT "clinic_communication_messages_pkey" PRIMARY KEY (id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_messages'::regclass AND conname='clinic_communication_messages_sequence_check') THEN ALTER TABLE public."clinic_communication_messages" ADD CONSTRAINT "clinic_communication_messages_sequence_check" CHECK (sequence > 0); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_messages'::regclass AND conname='clinic_communication_messages_thread_id_sequence_key') THEN ALTER TABLE public."clinic_communication_messages" ADD CONSTRAINT "clinic_communication_messages_thread_id_sequence_key" UNIQUE (thread_id, sequence); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_messages'::regclass AND conname='clinic_communication_messages_thread_v1') THEN ALTER TABLE public."clinic_communication_messages" ADD CONSTRAINT "clinic_communication_messages_thread_v1" FOREIGN KEY (thread_id, clinic_id) REFERENCES clinic_communication_threads(id, clinic_id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_mentions'::regclass AND conname='clinic_communication_mentions_clinic_id_fkey') THEN ALTER TABLE public."clinic_communication_mentions" ADD CONSTRAINT "clinic_communication_mentions_clinic_id_fkey" FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_mentions'::regclass AND conname='clinic_communication_mentions_mentioned_user_id_fkey') THEN ALTER TABLE public."clinic_communication_mentions" ADD CONSTRAINT "clinic_communication_mentions_mentioned_user_id_fkey" FOREIGN KEY (mentioned_user_id) REFERENCES users(id) ON DELETE SET NULL; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_mentions'::regclass AND conname='clinic_communication_mentions_message_v1') THEN ALTER TABLE public."clinic_communication_mentions" ADD CONSTRAINT "clinic_communication_mentions_message_v1" FOREIGN KEY (message_id, thread_id, clinic_id) REFERENCES clinic_communication_messages(id, thread_id, clinic_id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_mentions'::regclass AND conname='clinic_communication_mentions_pkey') THEN ALTER TABLE public."clinic_communication_mentions" ADD CONSTRAINT "clinic_communication_mentions_pkey" PRIMARY KEY (id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_read_states'::regclass AND conname='clinic_communication_read_states_clinic_id_fkey') THEN ALTER TABLE public."clinic_communication_read_states" ADD CONSTRAINT "clinic_communication_read_states_clinic_id_fkey" FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_read_states'::regclass AND conname='clinic_communication_read_states_last_read_sequence_check') THEN ALTER TABLE public."clinic_communication_read_states" ADD CONSTRAINT "clinic_communication_read_states_last_read_sequence_check" CHECK (last_read_sequence >= 0); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_read_states'::regclass AND conname='clinic_communication_read_states_pkey') THEN ALTER TABLE public."clinic_communication_read_states" ADD CONSTRAINT "clinic_communication_read_states_pkey" PRIMARY KEY (id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_read_states'::regclass AND conname='clinic_communication_read_states_thread_id_user_id_key') THEN ALTER TABLE public."clinic_communication_read_states" ADD CONSTRAINT "clinic_communication_read_states_thread_id_user_id_key" UNIQUE (thread_id, user_id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_read_states'::regclass AND conname='clinic_communication_read_states_thread_v1') THEN ALTER TABLE public."clinic_communication_read_states" ADD CONSTRAINT "clinic_communication_read_states_thread_v1" FOREIGN KEY (thread_id, clinic_id) REFERENCES clinic_communication_threads(id, clinic_id) ON DELETE CASCADE; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_read_states'::regclass AND conname='clinic_communication_read_states_user_id_fkey') THEN ALTER TABLE public."clinic_communication_read_states" ADD CONSTRAINT "clinic_communication_read_states_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_audit_events'::regclass AND conname='clinic_communication_audit_events_actor_user_id_fkey') THEN ALTER TABLE public."clinic_communication_audit_events" ADD CONSTRAINT "clinic_communication_audit_events_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_audit_events'::regclass AND conname='clinic_communication_audit_events_clinic_id_fkey') THEN ALTER TABLE public."clinic_communication_audit_events" ADD CONSTRAINT "clinic_communication_audit_events_clinic_id_fkey" FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_audit_events'::regclass AND conname='clinic_communication_audit_events_event_type_check') THEN ALTER TABLE public."clinic_communication_audit_events" ADD CONSTRAINT "clinic_communication_audit_events_event_type_check" CHECK (event_type = ANY (ARRAY['thread_created'::text, 'message_created'::text, 'thread_archived'::text, 'thread_reopened'::text])); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_audit_events'::regclass AND conname='clinic_communication_audit_events_message_id_fkey') THEN ALTER TABLE public."clinic_communication_audit_events" ADD CONSTRAINT "clinic_communication_audit_events_message_id_fkey" FOREIGN KEY (message_id) REFERENCES clinic_communication_messages(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_audit_events'::regclass AND conname='clinic_communication_audit_events_pkey') THEN ALTER TABLE public."clinic_communication_audit_events" ADD CONSTRAINT "clinic_communication_audit_events_pkey" PRIMARY KEY (id); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_audit_events'::regclass AND conname='clinic_communication_audit_events_thread_id_fkey') THEN ALTER TABLE public."clinic_communication_audit_events" ADD CONSTRAINT "clinic_communication_audit_events_thread_id_fkey" FOREIGN KEY (thread_id) REFERENCES clinic_communication_threads(id) ON DELETE RESTRICT; END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_audit_events'::regclass AND conname='clinic_communication_audit_metadata_no_content_v1') THEN ALTER TABLE public."clinic_communication_audit_events" ADD CONSTRAINT "clinic_communication_audit_metadata_no_content_v1" CHECK (NOT metadata ?| ARRAY['body'::text, 'message'::text, 'subject'::text, 'email'::text, 'patient'::text, 'patient_id'::text, 'guide'::text, 'xml'::text, 'amount'::text, 'value'::text, 'diagnosis'::text, 'card_number'::text]); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_communication_audit_events'::regclass AND conname='clinic_communication_audit_metadata_object_v1') THEN ALTER TABLE public."clinic_communication_audit_events" ADD CONSTRAINT "clinic_communication_audit_metadata_object_v1" CHECK (jsonb_typeof(metadata) = 'object'::text); END IF; END $ddl$;

CREATE INDEX IF NOT EXISTS idx_history_clinical_plan_context ON public.history USING btree (patient_id, therapeutic_plan_id, created_at DESC) WHERE ((therapeutic_plan_id IS NOT NULL) AND (deleted_at IS NULL));

CREATE INDEX IF NOT EXISTS patient_files_access_scope_idx ON public.patient_files USING btree (clinic_id, patient_id, access_scope, created_at DESC);

CREATE INDEX IF NOT EXISTS notes_patient_milestone_award_created_lookup_v1 ON public.notes USING btree (patient_id, created_at DESC, id DESC) WHERE ((subject = 'milestone_event'::text) AND (is_active = true) AND (deleted_at IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS idx_tiss_revenue_cycle_events_idempotency ON public.tiss_revenue_cycle_events USING btree (clinic_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tiss_official_tracking_events_idempotency ON public.tiss_official_tracking_events USING btree (clinic_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clinic_rooms_legacy_org_unique_active_name ON public.clinic_rooms USING btree (organization_id, lower(name)) WHERE ((is_active = true) AND (clinic_id IS NULL) AND (organization_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_aba_session_target_binding_history_snapshot_v1 ON public.aba_session_target_measurement_bindings USING btree (organization_id, patient_id, program_id, program_version_snapshot, target_id, decision_at DESC) WHERE ((measurement_model_version = 'V3'::text) AND (program_version_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_assigned_tasks_clinical_plan ON public.assigned_tasks USING btree (patient_id, therapeutic_plan_id, scheduled_at DESC) WHERE (therapeutic_plan_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_assigned_tasks_clinical_program ON public.assigned_tasks USING btree (patient_id, therapeutic_program_id, scheduled_at DESC) WHERE (therapeutic_program_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_assigned_tasks_clinical_target ON public.assigned_tasks USING btree (patient_id, clinical_target_id, scheduled_at DESC) WHERE (clinical_target_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_adult_task_reviews_clinical_plan ON public.adult_task_reviews USING btree (patient_id, therapeutic_plan_id, reviewed_at DESC) WHERE (therapeutic_plan_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_adult_task_reviews_clinical_program ON public.adult_task_reviews USING btree (patient_id, therapeutic_program_id, reviewed_at DESC) WHERE (therapeutic_program_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_protocol_import_requests_one_pending_per_key ON public.protocol_import_requests USING btree (clinic_id, canonical_request_key) WHERE (status = 'pending'::text);

CREATE INDEX IF NOT EXISTS idx_patient_financial_plans_conference_filters ON public.patient_financial_plans USING btree (organization_id, patient_id, payer_id, billing_mode, insurance_plan_name) WHERE ((status = 'ACTIVE'::text) AND (valid_until IS NULL));

CREATE INDEX IF NOT EXISTS idx_patient_financial_plans_plan_name_normalized ON public.patient_financial_plans USING btree (organization_id, lower(btrim(insurance_plan_name))) WHERE ((status = 'ACTIVE'::text) AND (valid_until IS NULL) AND (insurance_plan_name IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_invalidated_at ON public.push_subscriptions USING btree (invalidated_at) WHERE (invalidated_at IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_env_endpoint ON public.push_subscriptions USING btree (deployment_env, endpoint) WHERE (endpoint IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_env_renewal_token_hash ON public.push_subscriptions USING btree (deployment_env, renewal_token_hash) WHERE (renewal_token_hash IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_env_patient_active ON public.push_subscriptions USING btree (deployment_env, patient_id, updated_at DESC) WHERE (invalidated_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_env_user_active ON public.push_subscriptions USING btree (deployment_env, user_id, updated_at DESC) WHERE (invalidated_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_env_email_active ON public.push_subscriptions USING btree (deployment_env, lower(user_email), updated_at DESC) WHERE (invalidated_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS portal_notifications_env_idempotency_uidx ON public.portal_notifications USING btree (deployment_env, idempotency_key);

CREATE INDEX IF NOT EXISTS portal_notifications_env_patient_created_idx ON public.portal_notifications USING btree (deployment_env, patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS portal_notifications_env_recipient_read_created_idx ON public.portal_notifications USING btree (deployment_env, recipient_user_id, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS portal_notifications_env_recipient_email_read_created_idx ON public.portal_notifications USING btree (deployment_env, recipient_email, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS portal_notifications_env_appointment_type_patient_idx ON public.portal_notifications USING btree (deployment_env, appointment_id, type, patient_id);

CREATE INDEX IF NOT EXISTS portal_notifications_env_clinic_type_created_idx ON public.portal_notifications USING btree (deployment_env, clinic_id, type, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS aba_session_locations_active_name_unique_v1 ON public.aba_session_locations USING btree (clinic_id, normalized_name) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS aba_session_locations_clinic_active_v1 ON public.aba_session_locations USING btree (clinic_id, is_active, name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clinic_announcements_env_clinic_idempotency ON public.clinic_announcements USING btree (deployment_env, clinic_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_clinic_announcements_env_due ON public.clinic_announcements USING btree (deployment_env, scheduled_for, id) WHERE (status = 'SCHEDULED'::text);

CREATE INDEX IF NOT EXISTS idx_clinic_announcements_env_scope_created ON public.clinic_announcements USING btree (deployment_env, clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS patient_file_access_grants_grantee_idx ON public.patient_file_access_grants USING btree (grantee_user_id, file_id);

CREATE INDEX IF NOT EXISTS patient_file_access_grants_patient_idx ON public.patient_file_access_grants USING btree (patient_id, file_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_jobs_env_idempotency_v1 ON public.notification_jobs USING btree (deployment_env, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_notification_jobs_env_due_v1 ON public.notification_jobs USING btree (deployment_env, scheduled_for, id) WHERE (status = 'SCHEDULED'::text);

CREATE INDEX IF NOT EXISTS idx_notification_jobs_env_source_v1 ON public.notification_jobs USING btree (deployment_env, source_type, source_id, status);

CREATE INDEX IF NOT EXISTS idx_notification_jobs_env_patient_v1 ON public.notification_jobs USING btree (deployment_env, patient_id, scheduled_for DESC);

CREATE INDEX IF NOT EXISTS idx_patient_message_reads_recipient ON public.patient_message_reads USING btree (clinic_id, patient_id, recipient_user_id, read_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinic_protocol_grants_clinic_active ON public.clinic_protocol_grants USING btree (clinic_id, canonical_key) WHERE (revoked_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS ux_organization_billing_access_source_event ON public.organization_billing_access_state USING btree (source_event_id);

CREATE INDEX IF NOT EXISTS idx_organization_billing_access_deadline ON public.organization_billing_access_state USING btree (grace_ends_at, organization_id) WHERE (access_state = 'GRACE_PERIOD'::text);

CREATE INDEX IF NOT EXISTS onboarding_templates_created_by_idx ON public.onboarding_templates USING btree (created_by);

CREATE INDEX IF NOT EXISTS onboarding_templates_updated_by_idx ON public.onboarding_templates USING btree (updated_by);

CREATE INDEX IF NOT EXISTS onboarding_publications_clinic_status_idx ON public.onboarding_publications USING btree (clinic_id, status, published_at DESC);

CREATE INDEX IF NOT EXISTS onboarding_publications_published_by_idx ON public.onboarding_publications USING btree (published_by);

CREATE INDEX IF NOT EXISTS onboarding_slots_publication_status_starts_idx ON public.onboarding_slots USING btree (publication_id, status, starts_at);

CREATE INDEX IF NOT EXISTS onboarding_slots_created_by_idx ON public.onboarding_slots USING btree (created_by);

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_responses_current_publication_uidx ON public.onboarding_responses USING btree (publication_id) WHERE is_current;

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_responses_slot_uidx ON public.onboarding_responses USING btree (slot_id) WHERE (status = 'responded'::text);

CREATE INDEX IF NOT EXISTS onboarding_responses_clinic_responded_idx ON public.onboarding_responses USING btree (clinic_id, responded_at DESC);

CREATE INDEX IF NOT EXISTS onboarding_responses_admin_inbox_idx ON public.onboarding_responses USING btree (responded_at DESC) WHERE (is_current AND (status = 'responded'::text) AND (admin_ack_at IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS onboarding_responses_idempotency_publication_uidx ON public.onboarding_responses USING btree (idempotency_key, publication_id);

CREATE INDEX IF NOT EXISTS onboarding_responses_previous_response_idx ON public.onboarding_responses USING btree (previous_response_id) WHERE (previous_response_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS onboarding_responses_responded_by_idx ON public.onboarding_responses USING btree (responded_by);

CREATE INDEX IF NOT EXISTS onboarding_responses_admin_ack_by_idx ON public.onboarding_responses USING btree (admin_ack_by) WHERE (admin_ack_by IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS module_subscription_upgrade_one_live_per_subscription ON public.module_subscription_upgrade_intents USING btree (organization_id, stripe_subscription_id) WHERE (intent_status = ANY (ARRAY['claimed'::text, 'stripe_pending'::text, 'requires_action'::text, 'stripe_confirmed'::text]));

CREATE INDEX IF NOT EXISTS module_subscription_upgrade_offer_idx ON public.module_subscription_upgrade_intents USING btree (sales_offer_id);

CREATE INDEX IF NOT EXISTS module_subscription_upgrade_recovery_idx ON public.module_subscription_upgrade_intents USING btree (intent_status, claim_expires_at);

CREATE INDEX IF NOT EXISTS aba_patient_reinforcers_patient_active_v1 ON public.aba_patient_reinforcers USING btree (organization_id, patient_id, is_active, updated_at DESC, id);

CREATE INDEX IF NOT EXISTS aba_reinforcer_delivery_session_timeline_v1 ON public.aba_reinforcer_delivery_events USING btree (organization_id, patient_id, session_id, occurred_at, id);

CREATE INDEX IF NOT EXISTS aba_reinforcer_delivery_patient_recent_v1 ON public.aba_reinforcer_delivery_events USING btree (organization_id, patient_id, occurred_at DESC, id);

CREATE INDEX IF NOT EXISTS aba_reinforcer_delivery_patient_item_recent_v1 ON public.aba_reinforcer_delivery_events USING btree (organization_id, patient_id, reinforcer_id, occurred_at DESC, id);

CREATE INDEX IF NOT EXISTS clinic_communication_threads_clinic_activity_idx ON public.clinic_communication_threads USING btree (clinic_id, last_activity_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS clinic_communication_threads_clinic_status_activity_idx ON public.clinic_communication_threads USING btree (clinic_id, status, last_activity_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS clinic_communication_messages_thread_sequence_idx ON public.clinic_communication_messages USING btree (thread_id, sequence DESC);

CREATE UNIQUE INDEX IF NOT EXISTS clinic_communication_messages_idempotency_uq ON public.clinic_communication_messages USING btree (clinic_id, author_user_id, operation_type, idempotency_key) WHERE (author_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS clinic_communication_mentions_target_notification_idx ON public.clinic_communication_mentions USING btree (mentioned_user_id, notification_read_at, created_at DESC, id DESC) WHERE (mentioned_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS clinic_communication_mentions_message_idx ON public.clinic_communication_mentions USING btree (message_id);

CREATE UNIQUE INDEX IF NOT EXISTS clinic_communication_mentions_message_target_uq ON public.clinic_communication_mentions USING btree (message_id, mentioned_user_id) WHERE (mentioned_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS clinic_communication_mentions_target_clinic_created_idx ON public.clinic_communication_mentions USING btree (mentioned_user_id, clinic_id, created_at DESC, id DESC) WHERE (mentioned_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS clinic_communication_read_states_user_clinic_idx ON public.clinic_communication_read_states USING btree (user_id, clinic_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS clinic_communication_audit_clinic_created_idx ON public.clinic_communication_audit_events USING btree (clinic_id, created_at DESC, id DESC);

ALTER TABLE public."aba_session_locations" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."aba_session_locations" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."aba_session_locations" TO service_role;

ALTER TABLE public."aba_user_session_preferences" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."aba_user_session_preferences" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."aba_user_session_preferences" TO service_role;

ALTER TABLE public."patient_file_access_grants" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."patient_file_access_grants" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."patient_file_access_grants" TO service_role;

GRANT SELECT ON TABLE public."patient_file_access_grants" TO "anon";

GRANT SELECT ON TABLE public."patient_file_access_grants" TO "authenticated";

ALTER TABLE public."user_feature_access" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."user_feature_access" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."user_feature_access" TO service_role;

GRANT SELECT, INSERT ON TABLE public."user_feature_access" TO "authenticated";

ALTER TABLE public."patient_message_reads" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."patient_message_reads" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."patient_message_reads" TO service_role;

ALTER TABLE public."clinic_protocol_grants" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."clinic_protocol_grants" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."clinic_protocol_grants" TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."clinic_protocol_grants" TO "anon";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."clinic_protocol_grants" TO "authenticated";

ALTER TABLE public."organization_billing_access_state" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."organization_billing_access_state" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."organization_billing_access_state" TO service_role;

ALTER TABLE public."onboarding_templates" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."onboarding_templates" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."onboarding_templates" TO service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public."onboarding_templates" TO "authenticated";

ALTER TABLE public."onboarding_publications" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."onboarding_publications" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."onboarding_publications" TO service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public."onboarding_publications" TO "authenticated";

ALTER TABLE public."onboarding_slots" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."onboarding_slots" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."onboarding_slots" TO service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public."onboarding_slots" TO "authenticated";

ALTER TABLE public."onboarding_responses" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."onboarding_responses" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."onboarding_responses" TO service_role;

GRANT SELECT ON TABLE public."onboarding_responses" TO "authenticated";

ALTER TABLE public."module_subscription_upgrade_intents" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."module_subscription_upgrade_intents" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."module_subscription_upgrade_intents" TO service_role;

ALTER TABLE public."aba_patient_reinforcers" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."aba_patient_reinforcers" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."aba_patient_reinforcers" TO service_role;

ALTER TABLE public."aba_reinforcer_delivery_events" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."aba_reinforcer_delivery_events" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."aba_reinforcer_delivery_events" TO service_role;

ALTER TABLE public."clinic_communication_threads" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."clinic_communication_threads" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."clinic_communication_threads" TO service_role;

ALTER TABLE public."clinic_communication_messages" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."clinic_communication_messages" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."clinic_communication_messages" TO service_role;

ALTER TABLE public."clinic_communication_mentions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."clinic_communication_mentions" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."clinic_communication_mentions" TO service_role;

ALTER TABLE public."clinic_communication_read_states" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."clinic_communication_read_states" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."clinic_communication_read_states" TO service_role;

ALTER TABLE public."clinic_communication_audit_events" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."clinic_communication_audit_events" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public."clinic_communication_audit_events" TO service_role;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.patient_file_access_grants'::regclass AND polname='patient_file_access_grants_select_v1') THEN CREATE POLICY "patient_file_access_grants_select_v1" ON public."patient_file_access_grants" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM patient_files f
  WHERE ((f.id = patient_file_access_grants.file_id) AND (f.uploaded_by = auth.uid()))))); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.user_feature_access'::regclass AND polname='user_feature_access_insert_own_v1') THEN CREATE POLICY "user_feature_access_insert_own_v1" ON public."user_feature_access" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((user_id = auth.uid())); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.user_feature_access'::regclass AND polname='user_feature_access_select_own_v1') THEN CREATE POLICY "user_feature_access_select_own_v1" ON public."user_feature_access" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((user_id = auth.uid())); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.clinic_protocol_grants'::regclass AND polname='clinic_protocol_grants_platform_admin_all') THEN CREATE POLICY "clinic_protocol_grants_platform_admin_all" ON public."clinic_protocol_grants" AS PERMISSIVE FOR ALL TO PUBLIC USING (is_platform_admin(auth.uid())) WITH CHECK (is_platform_admin(auth.uid())); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.clinic_protocol_grants'::regclass AND polname='clinic_protocol_grants_tenant_read') THEN CREATE POLICY "clinic_protocol_grants_tenant_read" ON public."clinic_protocol_grants" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM clinic_memberships cm
  WHERE ((cm.user_id = auth.uid()) AND (cm.clinic_id = clinic_protocol_grants.clinic_id) AND (cm.status = 'active'::text))))); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.onboarding_templates'::regclass AND polname='onboarding_templates_platform_insert') THEN CREATE POLICY "onboarding_templates_platform_insert" ON public."onboarding_templates" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (is_platform_sales_admin()); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.onboarding_templates'::regclass AND polname='onboarding_templates_platform_select') THEN CREATE POLICY "onboarding_templates_platform_select" ON public."onboarding_templates" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_platform_sales_admin()); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.onboarding_templates'::regclass AND polname='onboarding_templates_platform_update') THEN CREATE POLICY "onboarding_templates_platform_update" ON public."onboarding_templates" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_platform_sales_admin()) WITH CHECK (is_platform_sales_admin()); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.onboarding_publications'::regclass AND polname='onboarding_publications_platform_insert') THEN CREATE POLICY "onboarding_publications_platform_insert" ON public."onboarding_publications" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (is_platform_sales_admin()); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.onboarding_publications'::regclass AND polname='onboarding_publications_platform_update') THEN CREATE POLICY "onboarding_publications_platform_update" ON public."onboarding_publications" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_platform_sales_admin()) WITH CHECK (is_platform_sales_admin()); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.onboarding_publications'::regclass AND polname='onboarding_publications_select') THEN CREATE POLICY "onboarding_publications_select" ON public."onboarding_publications" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_platform_sales_admin() OR onboarding_current_actor_can_respond_v1(clinic_id))); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.onboarding_slots'::regclass AND polname='onboarding_slots_platform_insert') THEN CREATE POLICY "onboarding_slots_platform_insert" ON public."onboarding_slots" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_platform_sales_admin() AND (EXISTS ( SELECT 1
   FROM onboarding_publications publication
  WHERE (publication.id = onboarding_slots.publication_id))))); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.onboarding_slots'::regclass AND polname='onboarding_slots_platform_update') THEN CREATE POLICY "onboarding_slots_platform_update" ON public."onboarding_slots" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_platform_sales_admin()) WITH CHECK (is_platform_sales_admin()); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.onboarding_slots'::regclass AND polname='onboarding_slots_select') THEN CREATE POLICY "onboarding_slots_select" ON public."onboarding_slots" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_platform_sales_admin() OR (EXISTS ( SELECT 1
   FROM onboarding_publications publication
  WHERE ((publication.id = onboarding_slots.publication_id) AND onboarding_current_actor_can_respond_v1(publication.clinic_id)))))); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.onboarding_responses'::regclass AND polname='onboarding_responses_select') THEN CREATE POLICY "onboarding_responses_select" ON public."onboarding_responses" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_platform_sales_admin() OR onboarding_current_actor_can_respond_v1(clinic_id))); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.aba_patient_reinforcers'::regclass AND polname='aba_patient_reinforcers_read_scope_v1') THEN CREATE POLICY "aba_patient_reinforcers_read_scope_v1" ON public."aba_patient_reinforcers" AS PERMISSIVE FOR SELECT TO "authenticated" USING (aba_reinforcer_actor_can_read_v1(( SELECT auth.uid() AS uid), organization_id, patient_id)); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.aba_patient_reinforcers'::regclass AND polname='aba_patient_reinforcers_write_scope_v1') THEN CREATE POLICY "aba_patient_reinforcers_write_scope_v1" ON public."aba_patient_reinforcers" AS PERMISSIVE FOR ALL TO "authenticated" USING (aba_reinforcer_actor_can_write_v1(( SELECT auth.uid() AS uid), organization_id, patient_id)) WITH CHECK (aba_reinforcer_actor_can_write_v1(( SELECT auth.uid() AS uid), organization_id, patient_id)); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.aba_reinforcer_delivery_events'::regclass AND polname='aba_reinforcer_delivery_events_read_scope_v1') THEN CREATE POLICY "aba_reinforcer_delivery_events_read_scope_v1" ON public."aba_reinforcer_delivery_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (aba_reinforcer_actor_can_read_v1(( SELECT auth.uid() AS uid), organization_id, patient_id)); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.aba_reinforcer_delivery_events'::regclass AND polname='aba_reinforcer_delivery_events_write_scope_v1') THEN CREATE POLICY "aba_reinforcer_delivery_events_write_scope_v1" ON public."aba_reinforcer_delivery_events" AS PERMISSIVE FOR ALL TO "authenticated" USING (aba_reinforcer_actor_can_write_v1(( SELECT auth.uid() AS uid), organization_id, patient_id)) WITH CHECK (aba_reinforcer_actor_can_write_v1(( SELECT auth.uid() AS uid), organization_id, patient_id)); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.patient_files'::regclass AND tgname='patient_file_acl_write_guard_v1') THEN CREATE TRIGGER patient_file_acl_write_guard_v1 BEFORE UPDATE OF uploaded_by, access_scope, patient_portal_visible ON patient_files FOR EACH ROW EXECUTE FUNCTION enforce_patient_file_acl_write_v1(); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.aba_trials'::regclass AND tgname='trg_guard_aba_trial_specialty_isolation_v1') THEN CREATE TRIGGER trg_guard_aba_trial_specialty_isolation_v1 BEFORE INSERT OR UPDATE OF session_id, patient_id, clinic_id, target_id, program_id ON aba_trials FOR EACH ROW EXECUTE FUNCTION guard_aba_trial_specialty_isolation_v1(); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.aba_sessions'::regclass AND tgname='trg_00_aba_session_specialty_isolation_v1') THEN CREATE TRIGGER trg_00_aba_session_specialty_isolation_v1 BEFORE INSERT OR UPDATE OF appointment_id, therapeutic_plan_id, organization_id, clinic_id, patient_id ON aba_sessions FOR EACH ROW EXECUTE FUNCTION guard_aba_session_specialty_isolation_v1(); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.aba_session_target_measurement_bindings'::regclass AND tgname='snapshot_aba_session_target_history_context_v1') THEN CREATE TRIGGER snapshot_aba_session_target_history_context_v1 BEFORE INSERT ON aba_session_target_measurement_bindings FOR EACH ROW EXECUTE FUNCTION snapshot_aba_session_target_history_context_v1(); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.assigned_tasks'::regclass AND tgname='trg_validate_assigned_task_clinical_link_v1') THEN CREATE TRIGGER trg_validate_assigned_task_clinical_link_v1 BEFORE INSERT OR UPDATE ON assigned_tasks FOR EACH ROW EXECUTE FUNCTION validate_assigned_task_clinical_link_v1(); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.push_subscriptions'::regclass AND tgname='trg_push_subscriptions_deployment_env_v1') THEN CREATE TRIGGER trg_push_subscriptions_deployment_env_v1 BEFORE INSERT OR UPDATE ON push_subscriptions FOR EACH ROW EXECUTE FUNCTION verto_apply_notification_deployment_env_v1(); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.portal_notifications'::regclass AND tgname='trg_portal_notifications_deployment_env_v1') THEN CREATE TRIGGER trg_portal_notifications_deployment_env_v1 BEFORE INSERT OR UPDATE ON portal_notifications FOR EACH ROW EXECUTE FUNCTION verto_apply_notification_deployment_env_v1(); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.clinic_announcements'::regclass AND tgname='trg_clinic_announcements_deployment_env_v1') THEN CREATE TRIGGER trg_clinic_announcements_deployment_env_v1 BEFORE INSERT OR UPDATE ON clinic_announcements FOR EACH ROW EXECUTE FUNCTION verto_apply_notification_deployment_env_v1(); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.notification_jobs'::regclass AND tgname='trg_notification_jobs_deployment_env_v1') THEN CREATE TRIGGER trg_notification_jobs_deployment_env_v1 BEFORE INSERT OR UPDATE ON notification_jobs FOR EACH ROW EXECUTE FUNCTION verto_apply_notification_deployment_env_v1(); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.onboarding_publications'::regclass AND tgname='onboarding_publication_snapshot_immutable') THEN CREATE TRIGGER onboarding_publication_snapshot_immutable BEFORE UPDATE ON onboarding_publications FOR EACH ROW EXECUTE FUNCTION onboarding_publication_snapshot_immutable_v1(); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.onboarding_slots'::regclass AND tgname='onboarding_slot_no_hard_delete') THEN CREATE TRIGGER onboarding_slot_no_hard_delete BEFORE DELETE ON onboarding_slots FOR EACH ROW EXECUTE FUNCTION onboarding_slot_no_hard_delete_v1(); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.aba_patient_reinforcers'::regclass AND tgname='trg_guard_aba_patient_reinforcer_v1') THEN CREATE TRIGGER trg_guard_aba_patient_reinforcer_v1 BEFORE INSERT OR DELETE OR UPDATE ON aba_patient_reinforcers FOR EACH ROW EXECUTE FUNCTION guard_aba_patient_reinforcer_v1(); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.aba_reinforcer_delivery_events'::regclass AND tgname='trg_guard_aba_reinforcer_delivery_append_only_v1') THEN CREATE TRIGGER trg_guard_aba_reinforcer_delivery_append_only_v1 BEFORE DELETE OR UPDATE ON aba_reinforcer_delivery_events FOR EACH ROW EXECUTE FUNCTION guard_aba_reinforcer_delivery_append_only_v1(); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.aba_reinforcer_delivery_events'::regclass AND tgname='trg_validate_aba_reinforcer_delivery_insert_v1') THEN CREATE TRIGGER trg_validate_aba_reinforcer_delivery_insert_v1 BEFORE INSERT ON aba_reinforcer_delivery_events FOR EACH ROW EXECUTE FUNCTION validate_aba_reinforcer_delivery_insert_v1(); END IF; END $ddl$;

DO $ddl$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.clinic_communication_threads'::regclass AND tgname='clinic_communication_threads_tiss_reference_guard_v1') THEN CREATE TRIGGER clinic_communication_threads_tiss_reference_guard_v1 BEFORE INSERT OR UPDATE OF reference_type, reference_id, clinic_id ON clinic_communication_threads FOR EACH ROW EXECUTE FUNCTION private.guard_clinic_communication_tiss_reference_v1(); END IF; END $ddl$;

REVOKE ALL ON FUNCTION public.aba_reinforcer_actor_can_read_v1(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.aba_reinforcer_actor_can_read_v1(uuid,uuid,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.aba_reinforcer_actor_can_write_v1(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.aba_reinforcer_actor_can_write_v1(uuid,uuid,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.ack_onboarding_response_current_v1(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ack_onboarding_response_current_v1(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.ack_onboarding_response_current_v1(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.ack_onboarding_response_v1(uuid,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ack_onboarding_response_v1(uuid,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.acquire_module_subscription_upgrade_intent_v1(uuid,uuid,text,bigint,text,text,integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.acquire_module_subscription_upgrade_intent_v1(uuid,uuid,text,bigint,text,text,integer) TO "service_role";

REVOKE ALL ON FUNCTION public.advance_module_subscription_upgrade_intent_v1(uuid,uuid,text,text,text,text,text,timestamp with time zone,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.advance_module_subscription_upgrade_intent_v1(uuid,uuid,text,text,text,text,text,timestamp with time zone,text) TO "service_role";

REVOKE ALL ON FUNCTION public.apply_billing_payment_failure_v1(uuid,uuid,text,text,timestamp with time zone) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_billing_payment_failure_v1(uuid,uuid,text,text,timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION public.apply_tiss_official_tracking_mutation_v1(uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_tiss_official_tracking_mutation_v1(uuid,uuid,uuid,text,text,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.approve_protocol_import_request_v1(uuid,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.approve_protocol_import_request_v1(uuid,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.approve_protocol_import_request_v1(uuid,text) TO "service_role";

REVOKE ALL ON FUNCTION public.claim_due_clinic_announcements_v1(text,text,integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_due_clinic_announcements_v1(text,text,integer) TO "service_role";

REVOKE ALL ON FUNCTION public.claim_due_notification_jobs_v1(text,text,integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_due_notification_jobs_v1(text,text,integer) TO "service_role";

REVOKE ALL ON FUNCTION public.clinical_specialty_scope_key_v1(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.clinical_specialty_scope_key_v1(text) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.clinical_specialty_scope_key_v1(text) TO "anon";

GRANT EXECUTE ON FUNCTION public.clinical_specialty_scope_key_v1(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.clinical_specialty_scope_key_v1(text) TO "service_role";

REVOKE ALL ON FUNCTION public.complete_patient_assigned_task_v2(uuid,uuid,uuid,integer,text,text,text,text,timestamp with time zone,uuid,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_patient_assigned_task_v2(uuid,uuid,uuid,integer,text,text,text,text,timestamp with time zone,uuid,text) TO "service_role";

REVOKE ALL ON FUNCTION public.complete_patient_legacy_task_v1(text,uuid,uuid,uuid,uuid,text,text,text,jsonb,timestamp with time zone,integer,text,text,text,text,timestamp with time zone,uuid,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_patient_legacy_task_v1(text,uuid,uuid,uuid,uuid,text,text,text,jsonb,timestamp with time zone,integer,text,text,text,text,timestamp with time zone,uuid,text) TO "service_role";

REVOKE ALL ON FUNCTION public.create_clinic_announcement_delivery_v3(uuid,uuid,uuid,text,text,text,date,text,text,uuid,jsonb,timestamp with time zone) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_clinic_announcement_delivery_v3(uuid,uuid,uuid,text,text,text,date,text,text,uuid,jsonb,timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION public.create_clinic_communication_thread_v1(uuid,text,text,uuid[],text,uuid,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_clinic_communication_thread_v1(uuid,text,text,uuid[],text,uuid,text) TO "authenticated";

REVOKE ALL ON FUNCTION public.create_tiss_official_document(uuid,uuid,date,text,text,text,text,text,text,text,text,text,text,uuid[],text,jsonb,jsonb,integer,integer,jsonb,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_tiss_official_document(uuid,uuid,date,text,text,text,text,text,text,text,text,text,text,uuid[],text,jsonb,jsonb,integer,integer,jsonb,uuid) TO "anon";

GRANT EXECUTE ON FUNCTION public.create_tiss_official_document(uuid,uuid,date,text,text,text,text,text,text,text,text,text,text,uuid[],text,jsonb,jsonb,integer,integer,jsonb,uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.create_tiss_official_document(uuid,uuid,date,text,text,text,text,text,text,text,text,text,text,uuid[],text,jsonb,jsonb,integer,integer,jsonb,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.enforce_patient_file_acl_write_v1() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enforce_patient_file_acl_write_v1() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.enforce_patient_file_acl_write_v1() TO "anon";

GRANT EXECUTE ON FUNCTION public.enforce_patient_file_acl_write_v1() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.enforce_patient_file_acl_write_v1() TO "service_role";

REVOKE ALL ON FUNCTION public.finalize_notification_jobs_v1(text,jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.finalize_notification_jobs_v1(text,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.get_aba_patient_overview_v3(uuid,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_aba_patient_overview_v3(uuid,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.get_aba_session_reinforcer_summary_authenticated_v1(text,integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_aba_session_reinforcer_summary_authenticated_v1(text,integer) TO "authenticated";

REVOKE ALL ON FUNCTION public.get_aba_session_reinforcer_summary_v1(uuid,uuid,text,uuid,integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_aba_session_reinforcer_summary_v1(uuid,uuid,text,uuid,integer) TO "service_role";

REVOKE ALL ON FUNCTION public.get_aba_v3_pilot_readiness(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_aba_v3_pilot_readiness(uuid,uuid,text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.get_aba_v3_preflight_scope_snapshot(uuid,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_aba_v3_preflight_scope_snapshot(uuid,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.get_clinic_communication_unread_count_v1(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_clinic_communication_unread_count_v1(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION public.get_verto_route_schema_capabilities() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_verto_route_schema_capabilities() TO "service_role";

REVOKE ALL ON FUNCTION public.guard_aba_patient_reinforcer_v1() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.guard_aba_patient_reinforcer_v1() TO "service_role";

REVOKE ALL ON FUNCTION public.guard_aba_reinforcer_delivery_append_only_v1() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.guard_aba_reinforcer_delivery_append_only_v1() TO "service_role";

REVOKE ALL ON FUNCTION public.guard_aba_session_specialty_isolation_v1() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.guard_aba_session_specialty_isolation_v1() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.guard_aba_session_specialty_isolation_v1() TO "anon";

GRANT EXECUTE ON FUNCTION public.guard_aba_session_specialty_isolation_v1() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.guard_aba_session_specialty_isolation_v1() TO "service_role";

REVOKE ALL ON FUNCTION public.guard_aba_trial_specialty_isolation_v1() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.guard_aba_trial_specialty_isolation_v1() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.guard_aba_trial_specialty_isolation_v1() TO "anon";

GRANT EXECUTE ON FUNCTION public.guard_aba_trial_specialty_isolation_v1() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.guard_aba_trial_specialty_isolation_v1() TO "service_role";

REVOKE ALL ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO "anon";

GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.list_aba_patient_reinforcers_v1(uuid,uuid,uuid,boolean,integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_aba_patient_reinforcers_v1(uuid,uuid,uuid,boolean,integer) TO "service_role";

REVOKE ALL ON FUNCTION public.list_aba_session_reinforcer_events_authenticated_v1(text,integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_aba_session_reinforcer_events_authenticated_v1(text,integer) TO "authenticated";

REVOKE ALL ON FUNCTION public.list_aba_session_reinforcer_events_v1(uuid,uuid,text,uuid,integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_aba_session_reinforcer_events_v1(uuid,uuid,text,uuid,integer) TO "service_role";

REVOKE ALL ON FUNCTION public.list_clinic_communication_mention_targets_v1(uuid,text,integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_clinic_communication_mention_targets_v1(uuid,text,integer) TO "authenticated";

REVOKE ALL ON FUNCTION public.list_clinic_communication_messages_v1(uuid,integer,bigint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_clinic_communication_messages_v1(uuid,integer,bigint) TO "authenticated";

REVOKE ALL ON FUNCTION public.list_clinic_communication_notifications_v1(uuid,integer,timestamp with time zone,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_clinic_communication_notifications_v1(uuid,integer,timestamp with time zone,uuid) TO "authenticated";

REVOKE ALL ON FUNCTION public.list_clinic_communication_threads_v1(uuid,integer,timestamp with time zone,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_clinic_communication_threads_v1(uuid,integer,timestamp with time zone,uuid) TO "authenticated";

REVOKE ALL ON FUNCTION public.list_recent_aba_patient_reinforcers_authenticated_v1(uuid,integer,integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_recent_aba_patient_reinforcers_authenticated_v1(uuid,integer,integer) TO "authenticated";

REVOKE ALL ON FUNCTION public.list_recent_aba_patient_reinforcers_v1(uuid,uuid,uuid,integer,integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_recent_aba_patient_reinforcers_v1(uuid,uuid,uuid,integer,integer) TO "service_role";

REVOKE ALL ON FUNCTION public.mark_clinic_communication_notification_read_v1(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mark_clinic_communication_notification_read_v1(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION public.mark_clinic_communication_read_v1(uuid,bigint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mark_clinic_communication_read_v1(uuid,bigint) TO "authenticated";

REVOKE ALL ON FUNCTION public.mark_onboarding_viewed_current_v1(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mark_onboarding_viewed_current_v1(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.mark_onboarding_viewed_current_v1(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.mark_sent_appointment_notification_jobs_v1(text,uuid[]) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mark_sent_appointment_notification_jobs_v1(text,uuid[]) TO "service_role";

REVOKE ALL ON FUNCTION public.mark_user_feature_accessed_v1(uuid,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mark_user_feature_accessed_v1(uuid,text) TO "service_role";

REVOKE ALL ON FUNCTION public.materialize_clinic_announcement_portal_notifications_v1(text,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.materialize_clinic_announcement_portal_notifications_v1(text,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.onboarding_actor_can_respond_v1(uuid,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.onboarding_actor_can_respond_v1(uuid,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.onboarding_current_actor_can_respond_v1(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.onboarding_current_actor_can_respond_v1(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.onboarding_current_actor_can_respond_v1(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.onboarding_publication_snapshot_immutable_v1() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.onboarding_publication_snapshot_immutable_v1() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.onboarding_publication_snapshot_immutable_v1() TO "anon";

GRANT EXECUTE ON FUNCTION public.onboarding_publication_snapshot_immutable_v1() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.onboarding_publication_snapshot_immutable_v1() TO "service_role";

REVOKE ALL ON FUNCTION public.onboarding_slot_no_hard_delete_v1() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.onboarding_slot_no_hard_delete_v1() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.onboarding_slot_no_hard_delete_v1() TO "anon";

GRANT EXECUTE ON FUNCTION public.onboarding_slot_no_hard_delete_v1() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.onboarding_slot_no_hard_delete_v1() TO "service_role";

REVOKE ALL ON FUNCTION public.onboarding_text_array_valid_v1(text[],integer,integer,integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.onboarding_text_array_valid_v1(text[],integer,integer,integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.onboarding_text_array_valid_v1(text[],integer,integer,integer) TO "service_role";

REVOKE ALL ON FUNCTION public.patient_file_actor_has_patient_access_v1(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.patient_file_actor_has_patient_access_v1(uuid,uuid,uuid) TO "anon";

GRANT EXECUTE ON FUNCTION public.patient_file_actor_has_patient_access_v1(uuid,uuid,uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.patient_file_actor_has_patient_access_v1(uuid,uuid,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.record_aba_reinforcer_delivery_authenticated_v1(text,uuid,text,timestamp with time zone) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_aba_reinforcer_delivery_authenticated_v1(text,uuid,text,timestamp with time zone) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.record_aba_reinforcer_delivery_authenticated_v1(text,uuid,text,timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION public.record_aba_reinforcer_delivery_v1(uuid,uuid,text,uuid,text,timestamp with time zone,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_aba_reinforcer_delivery_v1(uuid,uuid,text,uuid,text,timestamp with time zone,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.reissue_tiss_official_document_v1(uuid,uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reissue_tiss_official_document_v1(uuid,uuid,uuid,text,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.renew_push_subscription_v1(text,text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.renew_push_subscription_v1(text,text,text,text,text,text,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.revoke_clinic_protocol_grant_v1(uuid,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.revoke_clinic_protocol_grant_v1(uuid,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.save_aba_patient_reinforcer_v1(uuid,uuid,uuid,uuid,text,text,text,boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_aba_patient_reinforcer_v1(uuid,uuid,uuid,uuid,text,text,text,boolean) TO "service_role";

REVOKE ALL ON FUNCTION public.save_aba_user_session_preferences_v1(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_aba_user_session_preferences_v1(uuid,uuid,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.send_clinic_communication_message_v1(uuid,text,uuid[],text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.send_clinic_communication_message_v1(uuid,text,uuid[],text) TO "authenticated";

REVOKE ALL ON FUNCTION public.set_clinic_communication_thread_archived_v1(uuid,boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_clinic_communication_thread_archived_v1(uuid,boolean) TO "authenticated";

REVOKE ALL ON FUNCTION public.set_patient_file_access_v1(uuid,uuid,uuid,uuid,text,boolean,uuid[]) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_patient_file_access_v1(uuid,uuid,uuid,uuid,text,boolean,uuid[]) TO "service_role";

REVOKE ALL ON FUNCTION public.snapshot_aba_session_target_history_context_v1() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.snapshot_aba_session_target_history_context_v1() TO "service_role";

REVOKE ALL ON FUNCTION public.submit_onboarding_response_current_v1(uuid,uuid,text[],text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_onboarding_response_current_v1(uuid,uuid,text[],text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.submit_onboarding_response_current_v1(uuid,uuid,text[],text) TO "service_role";

REVOKE ALL ON FUNCTION public.submit_onboarding_response_v1(uuid,uuid,text[],text,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_onboarding_response_v1(uuid,uuid,text[],text,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.sync_appointment_notification_jobs_v1() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sync_appointment_notification_jobs_v1() TO "service_role";

REVOKE ALL ON FUNCTION public.sync_assigned_task_notification_jobs_v1() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sync_assigned_task_notification_jobs_v1() TO "service_role";

REVOKE ALL ON FUNCTION public.upsert_portal_notifications_batch_v1(text,jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_portal_notifications_batch_v1(text,jsonb) TO "service_role";

REVOKE ALL ON FUNCTION public.validate_aba_reinforcer_delivery_insert_v1() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.validate_aba_reinforcer_delivery_insert_v1() TO "service_role";

REVOKE ALL ON FUNCTION public.validate_assigned_task_clinical_link_v1() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.validate_assigned_task_clinical_link_v1() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.validate_assigned_task_clinical_link_v1() TO "anon";

GRANT EXECUTE ON FUNCTION public.validate_assigned_task_clinical_link_v1() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.validate_assigned_task_clinical_link_v1() TO "service_role";

REVOKE ALL ON FUNCTION public.verto_apply_notification_deployment_env_v1() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.verto_apply_notification_deployment_env_v1() TO "service_role";

REVOKE ALL ON FUNCTION public.verto_notification_idempotency_key_v1(text,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.verto_notification_idempotency_key_v1(text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.verto_request_deployment_env_v1() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.verto_request_deployment_env_v1() TO "service_role";

REVOKE ALL ON FUNCTION public.verto_require_notification_deployment_env_v1(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.verto_require_notification_deployment_env_v1(text) TO "service_role";

NOTIFY pgrst, 'reload schema';

commit;
