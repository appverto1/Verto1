-- Issue #366: structure, namespace authority and denial probes. No durable test data.

begin;

DO $verify$ BEGIN

IF to_regclass('public.aba_patient_reinforcers') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:aba_patient_reinforcers'; END IF;

IF to_regclass('public.aba_reinforcer_delivery_events') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:aba_reinforcer_delivery_events'; END IF;

IF to_regclass('public.aba_session_locations') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:aba_session_locations'; END IF;

IF to_regclass('public.aba_user_session_preferences') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:aba_user_session_preferences'; END IF;

IF to_regclass('public.clinic_communication_audit_events') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:clinic_communication_audit_events'; END IF;

IF to_regclass('public.clinic_communication_mentions') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:clinic_communication_mentions'; END IF;

IF to_regclass('public.clinic_communication_messages') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:clinic_communication_messages'; END IF;

IF to_regclass('public.clinic_communication_read_states') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:clinic_communication_read_states'; END IF;

IF to_regclass('public.clinic_communication_threads') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:clinic_communication_threads'; END IF;

IF to_regclass('public.clinic_protocol_grants') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:clinic_protocol_grants'; END IF;

IF to_regclass('public.module_subscription_upgrade_intents') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:module_subscription_upgrade_intents'; END IF;

IF to_regclass('public.onboarding_publications') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:onboarding_publications'; END IF;

IF to_regclass('public.onboarding_responses') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:onboarding_responses'; END IF;

IF to_regclass('public.onboarding_slots') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:onboarding_slots'; END IF;

IF to_regclass('public.onboarding_templates') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:onboarding_templates'; END IF;

IF to_regclass('public.organization_billing_access_state') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:organization_billing_access_state'; END IF;

IF to_regclass('public.patient_file_access_grants') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:patient_file_access_grants'; END IF;

IF to_regclass('public.patient_message_reads') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:patient_message_reads'; END IF;

IF to_regclass('public.user_feature_access') IS NULL THEN RAISE EXCEPTION 'MISSING_TABLE:user_feature_access'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='aba_session_target_measurement_bindings' AND column_name='program_version_id') THEN RAISE EXCEPTION 'MISSING_COLUMN:aba_session_target_measurement_bindings.program_version_id'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='aba_session_target_measurement_bindings' AND column_name='program_version_snapshot') THEN RAISE EXCEPTION 'MISSING_COLUMN:aba_session_target_measurement_bindings.program_version_snapshot'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='aba_session_target_measurement_bindings' AND column_name='measurement_type_snapshot') THEN RAISE EXCEPTION 'MISSING_COLUMN:aba_session_target_measurement_bindings.measurement_type_snapshot'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='aba_session_target_measurement_bindings' AND column_name='target_status_snapshot') THEN RAISE EXCEPTION 'MISSING_COLUMN:aba_session_target_measurement_bindings.target_status_snapshot'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='adult_task_reviews' AND column_name='therapeutic_plan_id') THEN RAISE EXCEPTION 'MISSING_COLUMN:adult_task_reviews.therapeutic_plan_id'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='adult_task_reviews' AND column_name='therapeutic_objective_id') THEN RAISE EXCEPTION 'MISSING_COLUMN:adult_task_reviews.therapeutic_objective_id'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='adult_task_reviews' AND column_name='therapeutic_program_id') THEN RAISE EXCEPTION 'MISSING_COLUMN:adult_task_reviews.therapeutic_program_id'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='adult_task_reviews' AND column_name='clinical_target_id') THEN RAISE EXCEPTION 'MISSING_COLUMN:adult_task_reviews.clinical_target_id'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='adult_task_reviews' AND column_name='clinical_link_snapshot') THEN RAISE EXCEPTION 'MISSING_COLUMN:adult_task_reviews.clinical_link_snapshot'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='adult_task_reviews' AND column_name='evidence_kind') THEN RAISE EXCEPTION 'MISSING_COLUMN:adult_task_reviews.evidence_kind'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assigned_tasks' AND column_name='therapeutic_plan_id') THEN RAISE EXCEPTION 'MISSING_COLUMN:assigned_tasks.therapeutic_plan_id'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assigned_tasks' AND column_name='therapeutic_objective_id') THEN RAISE EXCEPTION 'MISSING_COLUMN:assigned_tasks.therapeutic_objective_id'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assigned_tasks' AND column_name='therapeutic_program_id') THEN RAISE EXCEPTION 'MISSING_COLUMN:assigned_tasks.therapeutic_program_id'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assigned_tasks' AND column_name='clinical_target_id') THEN RAISE EXCEPTION 'MISSING_COLUMN:assigned_tasks.clinical_target_id'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assigned_tasks' AND column_name='clinical_link_snapshot') THEN RAISE EXCEPTION 'MISSING_COLUMN:assigned_tasks.clinical_link_snapshot'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assigned_tasks' AND column_name='clinical_link_version') THEN RAISE EXCEPTION 'MISSING_COLUMN:assigned_tasks.clinical_link_version'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clinic_announcements' AND column_name='deployment_env') THEN RAISE EXCEPTION 'MISSING_COLUMN:clinic_announcements.deployment_env'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clinics' AND column_name='patient_photo_policy') THEN RAISE EXCEPTION 'MISSING_COLUMN:clinics.patient_photo_policy'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='history' AND column_name='therapeutic_plan_id') THEN RAISE EXCEPTION 'MISSING_COLUMN:history.therapeutic_plan_id'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='history' AND column_name='therapeutic_objective_id') THEN RAISE EXCEPTION 'MISSING_COLUMN:history.therapeutic_objective_id'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='history' AND column_name='therapeutic_program_id') THEN RAISE EXCEPTION 'MISSING_COLUMN:history.therapeutic_program_id'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='history' AND column_name='clinical_target_id') THEN RAISE EXCEPTION 'MISSING_COLUMN:history.clinical_target_id'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='history' AND column_name='clinical_link_snapshot') THEN RAISE EXCEPTION 'MISSING_COLUMN:history.clinical_link_snapshot'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notification_jobs' AND column_name='deployment_env') THEN RAISE EXCEPTION 'MISSING_COLUMN:notification_jobs.deployment_env'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patient_files' AND column_name='access_scope') THEN RAISE EXCEPTION 'MISSING_COLUMN:patient_files.access_scope'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patient_files' AND column_name='patient_portal_visible') THEN RAISE EXCEPTION 'MISSING_COLUMN:patient_files.patient_portal_visible'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patients' AND column_name='portal_profile_picture') THEN RAISE EXCEPTION 'MISSING_COLUMN:patients.portal_profile_picture'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patients' AND column_name='portal_profile_picture_path') THEN RAISE EXCEPTION 'MISSING_COLUMN:patients.portal_profile_picture_path'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='portal_notifications' AND column_name='deployment_env') THEN RAISE EXCEPTION 'MISSING_COLUMN:portal_notifications.deployment_env'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='protocol_import_requests' AND column_name='canonical_request_key') THEN RAISE EXCEPTION 'MISSING_COLUMN:protocol_import_requests.canonical_request_key'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='protocol_import_requests' AND column_name='quarantine_status') THEN RAISE EXCEPTION 'MISSING_COLUMN:protocol_import_requests.quarantine_status'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='protocol_import_requests' AND column_name='scan_status') THEN RAISE EXCEPTION 'MISSING_COLUMN:protocol_import_requests.scan_status'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='protocol_import_requests' AND column_name='safe_preview_status') THEN RAISE EXCEPTION 'MISSING_COLUMN:protocol_import_requests.safe_preview_status'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='protocol_import_requests' AND column_name='raw_file_access') THEN RAISE EXCEPTION 'MISSING_COLUMN:protocol_import_requests.raw_file_access'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='protocol_import_requests' AND column_name='safe_preview_text') THEN RAISE EXCEPTION 'MISSING_COLUMN:protocol_import_requests.safe_preview_text'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='protocol_import_requests' AND column_name='scan_report') THEN RAISE EXCEPTION 'MISSING_COLUMN:protocol_import_requests.scan_report'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='push_subscriptions' AND column_name='renewal_token_hash') THEN RAISE EXCEPTION 'MISSING_COLUMN:push_subscriptions.renewal_token_hash'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='push_subscriptions' AND column_name='renewal_token_created_at') THEN RAISE EXCEPTION 'MISSING_COLUMN:push_subscriptions.renewal_token_created_at'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='push_subscriptions' AND column_name='last_seen_at') THEN RAISE EXCEPTION 'MISSING_COLUMN:push_subscriptions.last_seen_at'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='push_subscriptions' AND column_name='invalidated_at') THEN RAISE EXCEPTION 'MISSING_COLUMN:push_subscriptions.invalidated_at'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='push_subscriptions' AND column_name='deployment_env') THEN RAISE EXCEPTION 'MISSING_COLUMN:push_subscriptions.deployment_env'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tiss_official_tracking_events' AND column_name='idempotency_key') THEN RAISE EXCEPTION 'MISSING_COLUMN:tiss_official_tracking_events.idempotency_key'; END IF;

IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tiss_revenue_cycle_events' AND column_name='idempotency_key') THEN RAISE EXCEPTION 'MISSING_COLUMN:tiss_revenue_cycle_events.idempotency_key'; END IF;

IF to_regprocedure('public.aba_reinforcer_actor_can_read_v1(uuid,uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:aba_reinforcer_actor_can_read_v1(uuid,uuid,uuid)'; END IF;

IF to_regprocedure('public.aba_reinforcer_actor_can_write_v1(uuid,uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:aba_reinforcer_actor_can_write_v1(uuid,uuid,uuid)'; END IF;

IF to_regprocedure('public.ack_onboarding_response_current_v1(uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:ack_onboarding_response_current_v1(uuid)'; END IF;

IF to_regprocedure('public.ack_onboarding_response_v1(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:ack_onboarding_response_v1(uuid,uuid)'; END IF;

IF to_regprocedure('public.acquire_module_subscription_upgrade_intent_v1(uuid,uuid,text,bigint,text,text,integer)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:acquire_module_subscription_upgrade_intent_v1(uuid,uuid,text,bigint,text,text,integer)'; END IF;

IF to_regprocedure('public.advance_module_subscription_upgrade_intent_v1(uuid,uuid,text,text,text,text,text,timestamp with time zone,text)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:advance_module_subscription_upgrade_intent_v1(uuid,uuid,text,text,text,text,text,timestamp with time zone,text)'; END IF;

IF to_regprocedure('public.apply_billing_payment_failure_v1(uuid,uuid,text,text,timestamp with time zone)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:apply_billing_payment_failure_v1(uuid,uuid,text,text,timestamp with time zone)'; END IF;

IF to_regprocedure('public.apply_tiss_official_tracking_mutation_v1(uuid,uuid,uuid,text,text,jsonb)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:apply_tiss_official_tracking_mutation_v1(uuid,uuid,uuid,text,text,jsonb)'; END IF;

IF to_regprocedure('public.approve_protocol_import_request_v1(uuid,text)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:approve_protocol_import_request_v1(uuid,text)'; END IF;

IF to_regprocedure('public.claim_due_clinic_announcements_v1(text,text,integer)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:claim_due_clinic_announcements_v1(text,text,integer)'; END IF;

IF to_regprocedure('public.claim_due_notification_jobs_v1(text,text,integer)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:claim_due_notification_jobs_v1(text,text,integer)'; END IF;

IF to_regprocedure('public.clinical_specialty_scope_key_v1(text)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:clinical_specialty_scope_key_v1(text)'; END IF;

IF to_regprocedure('public.complete_patient_assigned_task_v2(uuid,uuid,uuid,integer,text,text,text,text,timestamp with time zone,uuid,text)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:complete_patient_assigned_task_v2(uuid,uuid,uuid,integer,text,text,text,text,timestamp with time zone,uuid,text)'; END IF;

IF to_regprocedure('public.complete_patient_legacy_task_v1(text,uuid,uuid,uuid,uuid,text,text,text,jsonb,timestamp with time zone,integer,text,text,text,text,timestamp with time zone,uuid,text)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:complete_patient_legacy_task_v1(text,uuid,uuid,uuid,uuid,text,text,text,jsonb,timestamp with time zone,integer,text,text,text,text,timestamp with time zone,uuid,text)'; END IF;

IF to_regprocedure('public.create_clinic_announcement_delivery_v3(uuid,uuid,uuid,text,text,text,date,text,text,uuid,jsonb,timestamp with time zone)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:create_clinic_announcement_delivery_v3(uuid,uuid,uuid,text,text,text,date,text,text,uuid,jsonb,timestamp with time zone)'; END IF;

IF to_regprocedure('public.create_clinic_communication_thread_v1(uuid,text,text,uuid[],text,uuid,text)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:create_clinic_communication_thread_v1(uuid,text,text,uuid[],text,uuid,text)'; END IF;

IF to_regprocedure('public.create_tiss_official_document(uuid,uuid,date,text,text,text,text,text,text,text,text,text,text,uuid[],text,jsonb,jsonb,integer,integer,jsonb,uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:create_tiss_official_document(uuid,uuid,date,text,text,text,text,text,text,text,text,text,text,uuid[],text,jsonb,jsonb,integer,integer,jsonb,uuid)'; END IF;

IF to_regprocedure('public.enforce_patient_file_acl_write_v1()') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:enforce_patient_file_acl_write_v1()'; END IF;

IF to_regprocedure('public.finalize_notification_jobs_v1(text,jsonb)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:finalize_notification_jobs_v1(text,jsonb)'; END IF;

IF to_regprocedure('public.get_aba_patient_overview_v3(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:get_aba_patient_overview_v3(uuid,uuid)'; END IF;

IF to_regprocedure('public.get_aba_session_reinforcer_summary_authenticated_v1(text,integer)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:get_aba_session_reinforcer_summary_authenticated_v1(text,integer)'; END IF;

IF to_regprocedure('public.get_aba_session_reinforcer_summary_v1(uuid,uuid,text,uuid,integer)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:get_aba_session_reinforcer_summary_v1(uuid,uuid,text,uuid,integer)'; END IF;

IF to_regprocedure('public.get_aba_v3_pilot_readiness(uuid,uuid,text,text)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:get_aba_v3_pilot_readiness(uuid,uuid,text,text)'; END IF;

IF to_regprocedure('public.get_aba_v3_preflight_scope_snapshot(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:get_aba_v3_preflight_scope_snapshot(uuid,uuid)'; END IF;

IF to_regprocedure('public.get_clinic_communication_unread_count_v1(uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:get_clinic_communication_unread_count_v1(uuid)'; END IF;

IF to_regprocedure('public.get_verto_route_schema_capabilities()') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:get_verto_route_schema_capabilities()'; END IF;

IF to_regprocedure('public.guard_aba_patient_reinforcer_v1()') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:guard_aba_patient_reinforcer_v1()'; END IF;

IF to_regprocedure('public.guard_aba_reinforcer_delivery_append_only_v1()') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:guard_aba_reinforcer_delivery_append_only_v1()'; END IF;

IF to_regprocedure('public.guard_aba_session_specialty_isolation_v1()') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:guard_aba_session_specialty_isolation_v1()'; END IF;

IF to_regprocedure('public.guard_aba_trial_specialty_isolation_v1()') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:guard_aba_trial_specialty_isolation_v1()'; END IF;

IF to_regprocedure('public.is_platform_admin(uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:is_platform_admin(uuid)'; END IF;

IF to_regprocedure('public.list_aba_patient_reinforcers_v1(uuid,uuid,uuid,boolean,integer)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:list_aba_patient_reinforcers_v1(uuid,uuid,uuid,boolean,integer)'; END IF;

IF to_regprocedure('public.list_aba_session_reinforcer_events_authenticated_v1(text,integer)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:list_aba_session_reinforcer_events_authenticated_v1(text,integer)'; END IF;

IF to_regprocedure('public.list_aba_session_reinforcer_events_v1(uuid,uuid,text,uuid,integer)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:list_aba_session_reinforcer_events_v1(uuid,uuid,text,uuid,integer)'; END IF;

IF to_regprocedure('public.list_clinic_communication_mention_targets_v1(uuid,text,integer)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:list_clinic_communication_mention_targets_v1(uuid,text,integer)'; END IF;

IF to_regprocedure('public.list_clinic_communication_messages_v1(uuid,integer,bigint)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:list_clinic_communication_messages_v1(uuid,integer,bigint)'; END IF;

IF to_regprocedure('public.list_clinic_communication_notifications_v1(uuid,integer,timestamp with time zone,uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:list_clinic_communication_notifications_v1(uuid,integer,timestamp with time zone,uuid)'; END IF;

IF to_regprocedure('public.list_clinic_communication_threads_v1(uuid,integer,timestamp with time zone,uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:list_clinic_communication_threads_v1(uuid,integer,timestamp with time zone,uuid)'; END IF;

IF to_regprocedure('public.list_recent_aba_patient_reinforcers_authenticated_v1(uuid,integer,integer)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:list_recent_aba_patient_reinforcers_authenticated_v1(uuid,integer,integer)'; END IF;

IF to_regprocedure('public.list_recent_aba_patient_reinforcers_v1(uuid,uuid,uuid,integer,integer)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:list_recent_aba_patient_reinforcers_v1(uuid,uuid,uuid,integer,integer)'; END IF;

IF to_regprocedure('public.mark_clinic_communication_notification_read_v1(uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:mark_clinic_communication_notification_read_v1(uuid)'; END IF;

IF to_regprocedure('public.mark_clinic_communication_read_v1(uuid,bigint)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:mark_clinic_communication_read_v1(uuid,bigint)'; END IF;

IF to_regprocedure('public.mark_onboarding_viewed_current_v1(uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:mark_onboarding_viewed_current_v1(uuid)'; END IF;

IF to_regprocedure('public.mark_sent_appointment_notification_jobs_v1(text,uuid[])') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:mark_sent_appointment_notification_jobs_v1(text,uuid[])'; END IF;

IF to_regprocedure('public.mark_user_feature_accessed_v1(uuid,text)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:mark_user_feature_accessed_v1(uuid,text)'; END IF;

IF to_regprocedure('public.materialize_clinic_announcement_portal_notifications_v1(text,uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:materialize_clinic_announcement_portal_notifications_v1(text,uuid)'; END IF;

IF to_regprocedure('public.onboarding_actor_can_respond_v1(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:onboarding_actor_can_respond_v1(uuid,uuid)'; END IF;

IF to_regprocedure('public.onboarding_current_actor_can_respond_v1(uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:onboarding_current_actor_can_respond_v1(uuid)'; END IF;

IF to_regprocedure('public.onboarding_publication_snapshot_immutable_v1()') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:onboarding_publication_snapshot_immutable_v1()'; END IF;

IF to_regprocedure('public.onboarding_slot_no_hard_delete_v1()') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:onboarding_slot_no_hard_delete_v1()'; END IF;

IF to_regprocedure('public.onboarding_text_array_valid_v1(text[],integer,integer,integer)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:onboarding_text_array_valid_v1(text[],integer,integer,integer)'; END IF;

IF to_regprocedure('public.patient_file_actor_has_patient_access_v1(uuid,uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:patient_file_actor_has_patient_access_v1(uuid,uuid,uuid)'; END IF;

IF to_regprocedure('public.record_aba_reinforcer_delivery_authenticated_v1(text,uuid,text,timestamp with time zone)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:record_aba_reinforcer_delivery_authenticated_v1(text,uuid,text,timestamp with time zone)'; END IF;

IF to_regprocedure('public.record_aba_reinforcer_delivery_v1(uuid,uuid,text,uuid,text,timestamp with time zone,uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:record_aba_reinforcer_delivery_v1(uuid,uuid,text,uuid,text,timestamp with time zone,uuid)'; END IF;

IF to_regprocedure('public.reissue_tiss_official_document_v1(uuid,uuid,uuid,text,jsonb)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:reissue_tiss_official_document_v1(uuid,uuid,uuid,text,jsonb)'; END IF;

IF to_regprocedure('public.renew_push_subscription_v1(text,text,text,text,text,text,jsonb)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:renew_push_subscription_v1(text,text,text,text,text,text,jsonb)'; END IF;

IF to_regprocedure('public.revoke_clinic_protocol_grant_v1(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:revoke_clinic_protocol_grant_v1(uuid,uuid)'; END IF;

IF to_regprocedure('public.save_aba_patient_reinforcer_v1(uuid,uuid,uuid,uuid,text,text,text,boolean)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:save_aba_patient_reinforcer_v1(uuid,uuid,uuid,uuid,text,text,text,boolean)'; END IF;

IF to_regprocedure('public.save_aba_user_session_preferences_v1(uuid,uuid,jsonb)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:save_aba_user_session_preferences_v1(uuid,uuid,jsonb)'; END IF;

IF to_regprocedure('public.send_clinic_communication_message_v1(uuid,text,uuid[],text)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:send_clinic_communication_message_v1(uuid,text,uuid[],text)'; END IF;

IF to_regprocedure('public.set_clinic_communication_thread_archived_v1(uuid,boolean)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:set_clinic_communication_thread_archived_v1(uuid,boolean)'; END IF;

IF to_regprocedure('public.set_patient_file_access_v1(uuid,uuid,uuid,uuid,text,boolean,uuid[])') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:set_patient_file_access_v1(uuid,uuid,uuid,uuid,text,boolean,uuid[])'; END IF;

IF to_regprocedure('public.snapshot_aba_session_target_history_context_v1()') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:snapshot_aba_session_target_history_context_v1()'; END IF;

IF to_regprocedure('public.submit_onboarding_response_current_v1(uuid,uuid,text[],text)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:submit_onboarding_response_current_v1(uuid,uuid,text[],text)'; END IF;

IF to_regprocedure('public.submit_onboarding_response_v1(uuid,uuid,text[],text,uuid)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:submit_onboarding_response_v1(uuid,uuid,text[],text,uuid)'; END IF;

IF to_regprocedure('public.sync_appointment_notification_jobs_v1()') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:sync_appointment_notification_jobs_v1()'; END IF;

IF to_regprocedure('public.sync_assigned_task_notification_jobs_v1()') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:sync_assigned_task_notification_jobs_v1()'; END IF;

IF to_regprocedure('public.upsert_portal_notifications_batch_v1(text,jsonb)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:upsert_portal_notifications_batch_v1(text,jsonb)'; END IF;

IF to_regprocedure('public.validate_aba_reinforcer_delivery_insert_v1()') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:validate_aba_reinforcer_delivery_insert_v1()'; END IF;

IF to_regprocedure('public.validate_assigned_task_clinical_link_v1()') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:validate_assigned_task_clinical_link_v1()'; END IF;

IF to_regprocedure('public.verto_apply_notification_deployment_env_v1()') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:verto_apply_notification_deployment_env_v1()'; END IF;

IF to_regprocedure('public.verto_notification_idempotency_key_v1(text,text)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:verto_notification_idempotency_key_v1(text,text)'; END IF;

IF to_regprocedure('public.verto_request_deployment_env_v1()') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:verto_request_deployment_env_v1()'; END IF;

IF to_regprocedure('public.verto_require_notification_deployment_env_v1(text)') IS NULL THEN RAISE EXCEPTION 'MISSING_RPC:verto_require_notification_deployment_env_v1(text)'; END IF;

IF has_function_privilege('anon','public.save_aba_patient_reinforcer_v1(uuid,uuid,uuid,uuid,text,text,text,boolean)','EXECUTE') OR has_function_privilege('authenticated','public.save_aba_patient_reinforcer_v1(uuid,uuid,uuid,uuid,text,text,text,boolean)','EXECUTE') THEN RAISE EXCEPTION 'RPC_PUBLIC_MUTATION_ACCESS:save_aba_patient_reinforcer_v1(uuid,uuid,uuid,uuid,text,text,text,boolean)'; END IF;

IF has_function_privilege('anon','public.record_aba_reinforcer_delivery_v1(uuid,uuid,text,uuid,text,timestamp with time zone,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.record_aba_reinforcer_delivery_v1(uuid,uuid,text,uuid,text,timestamp with time zone,uuid)','EXECUTE') THEN RAISE EXCEPTION 'RPC_PUBLIC_MUTATION_ACCESS:record_aba_reinforcer_delivery_v1(uuid,uuid,text,uuid,text,timestamp with time zone,uuid)'; END IF;

IF has_function_privilege('anon','public.set_patient_file_access_v1(uuid,uuid,uuid,uuid,text,boolean,uuid[])','EXECUTE') OR has_function_privilege('authenticated','public.set_patient_file_access_v1(uuid,uuid,uuid,uuid,text,boolean,uuid[])','EXECUTE') THEN RAISE EXCEPTION 'RPC_PUBLIC_MUTATION_ACCESS:set_patient_file_access_v1(uuid,uuid,uuid,uuid,text,boolean,uuid[])'; END IF;

IF has_function_privilege('anon','public.apply_billing_payment_failure_v1(uuid,uuid,text,text,timestamp with time zone)','EXECUTE') OR has_function_privilege('authenticated','public.apply_billing_payment_failure_v1(uuid,uuid,text,text,timestamp with time zone)','EXECUTE') THEN RAISE EXCEPTION 'RPC_PUBLIC_MUTATION_ACCESS:apply_billing_payment_failure_v1(uuid,uuid,text,text,timestamp with time zone)'; END IF;

IF has_function_privilege('anon','public.verto_require_notification_deployment_env_v1(text)','EXECUTE') OR has_function_privilege('authenticated','public.verto_require_notification_deployment_env_v1(text)','EXECUTE') THEN RAISE EXCEPTION 'RPC_PUBLIC_MUTATION_ACCESS:verto_require_notification_deployment_env_v1(text)'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.aba_patient_reinforcers'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:aba_patient_reinforcers'; END IF;

IF has_table_privilege('anon','public.aba_patient_reinforcers','TRUNCATE') OR has_table_privilege('authenticated','public.aba_patient_reinforcers','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:aba_patient_reinforcers'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.aba_reinforcer_delivery_events'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:aba_reinforcer_delivery_events'; END IF;

IF has_table_privilege('anon','public.aba_reinforcer_delivery_events','TRUNCATE') OR has_table_privilege('authenticated','public.aba_reinforcer_delivery_events','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:aba_reinforcer_delivery_events'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.aba_session_locations'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:aba_session_locations'; END IF;

IF has_table_privilege('anon','public.aba_session_locations','TRUNCATE') OR has_table_privilege('authenticated','public.aba_session_locations','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:aba_session_locations'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.aba_user_session_preferences'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:aba_user_session_preferences'; END IF;

IF has_table_privilege('anon','public.aba_user_session_preferences','TRUNCATE') OR has_table_privilege('authenticated','public.aba_user_session_preferences','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:aba_user_session_preferences'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.clinic_communication_audit_events'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:clinic_communication_audit_events'; END IF;

IF has_table_privilege('anon','public.clinic_communication_audit_events','TRUNCATE') OR has_table_privilege('authenticated','public.clinic_communication_audit_events','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:clinic_communication_audit_events'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.clinic_communication_mentions'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:clinic_communication_mentions'; END IF;

IF has_table_privilege('anon','public.clinic_communication_mentions','TRUNCATE') OR has_table_privilege('authenticated','public.clinic_communication_mentions','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:clinic_communication_mentions'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.clinic_communication_messages'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:clinic_communication_messages'; END IF;

IF has_table_privilege('anon','public.clinic_communication_messages','TRUNCATE') OR has_table_privilege('authenticated','public.clinic_communication_messages','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:clinic_communication_messages'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.clinic_communication_read_states'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:clinic_communication_read_states'; END IF;

IF has_table_privilege('anon','public.clinic_communication_read_states','TRUNCATE') OR has_table_privilege('authenticated','public.clinic_communication_read_states','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:clinic_communication_read_states'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.clinic_communication_threads'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:clinic_communication_threads'; END IF;

IF has_table_privilege('anon','public.clinic_communication_threads','TRUNCATE') OR has_table_privilege('authenticated','public.clinic_communication_threads','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:clinic_communication_threads'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.clinic_protocol_grants'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:clinic_protocol_grants'; END IF;

IF has_table_privilege('anon','public.clinic_protocol_grants','TRUNCATE') OR has_table_privilege('authenticated','public.clinic_protocol_grants','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:clinic_protocol_grants'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.module_subscription_upgrade_intents'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:module_subscription_upgrade_intents'; END IF;

IF has_table_privilege('anon','public.module_subscription_upgrade_intents','TRUNCATE') OR has_table_privilege('authenticated','public.module_subscription_upgrade_intents','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:module_subscription_upgrade_intents'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.onboarding_publications'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:onboarding_publications'; END IF;

IF has_table_privilege('anon','public.onboarding_publications','TRUNCATE') OR has_table_privilege('authenticated','public.onboarding_publications','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:onboarding_publications'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.onboarding_responses'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:onboarding_responses'; END IF;

IF has_table_privilege('anon','public.onboarding_responses','TRUNCATE') OR has_table_privilege('authenticated','public.onboarding_responses','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:onboarding_responses'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.onboarding_slots'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:onboarding_slots'; END IF;

IF has_table_privilege('anon','public.onboarding_slots','TRUNCATE') OR has_table_privilege('authenticated','public.onboarding_slots','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:onboarding_slots'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.onboarding_templates'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:onboarding_templates'; END IF;

IF has_table_privilege('anon','public.onboarding_templates','TRUNCATE') OR has_table_privilege('authenticated','public.onboarding_templates','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:onboarding_templates'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.organization_billing_access_state'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:organization_billing_access_state'; END IF;

IF has_table_privilege('anon','public.organization_billing_access_state','TRUNCATE') OR has_table_privilege('authenticated','public.organization_billing_access_state','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:organization_billing_access_state'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.patient_file_access_grants'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:patient_file_access_grants'; END IF;

IF has_table_privilege('anon','public.patient_file_access_grants','TRUNCATE') OR has_table_privilege('authenticated','public.patient_file_access_grants','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:patient_file_access_grants'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.patient_message_reads'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:patient_message_reads'; END IF;

IF has_table_privilege('anon','public.patient_message_reads','TRUNCATE') OR has_table_privilege('authenticated','public.patient_message_reads','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:patient_message_reads'; END IF;

IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.user_feature_access'::regclass) THEN RAISE EXCEPTION 'RLS_DISABLED:user_feature_access'; END IF;

IF has_table_privilege('anon','public.user_feature_access','TRUNCATE') OR has_table_privilege('authenticated','public.user_feature_access','TRUNCATE') THEN RAISE EXCEPTION 'UNSAFE_TRUNCATE:user_feature_access'; END IF;

END $verify$;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}', true);

select set_config('request.headers', '{"x-verto-deployment-env":"production"}', true);

DO $verify$ BEGIN IF public.verto_request_deployment_env_v1() IS NOT NULL THEN RAISE EXCEPTION 'UNTRUSTED_ENV_MARKER'; END IF; END $verify$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $verify$ BEGIN IF public.verto_request_deployment_env_v1() <> 'production' THEN RAISE EXCEPTION 'TRUSTED_ENV_MISSING'; END IF; BEGIN PERFORM public.verto_require_notification_deployment_env_v1('staging'); RAISE EXCEPTION 'NAMESPACE_MISMATCH_ACCEPTED'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%NOTIFICATION_DEPLOYMENT_ENV_MISMATCH%' THEN RAISE; END IF; END; END $verify$;

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}', true);

DO $verify$ BEGIN BEGIN PERFORM public.approve_protocol_import_request_v1(gen_random_uuid(),'synthetic-denial-probe'); RAISE EXCEPTION 'DENIAL_PROBE_UNEXPECTEDLY_ALLOWED'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%platform_admin_required%' THEN RAISE; END IF; END; END $verify$;

DO $verify$ BEGIN BEGIN PERFORM public.list_aba_patient_reinforcers_v1(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),false,10); RAISE EXCEPTION 'DENIAL_PROBE_UNEXPECTEDLY_ALLOWED'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%ABA_REINFORCER_READ_FORBIDDEN%' THEN RAISE; END IF; END; END $verify$;

DO $verify$ BEGIN BEGIN PERFORM public.save_aba_patient_reinforcer_v1(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null,'synthetic-denial-probe',null,null,true); RAISE EXCEPTION 'DENIAL_PROBE_UNEXPECTEDLY_ALLOWED'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%ABA_REINFORCER_ACTOR_FORBIDDEN%' THEN RAISE; END IF; END; END $verify$;


DO $private_verify$ BEGIN
 IF to_regnamespace('private') IS NULL OR to_regprocedure('private.clinic_billing_communication_capability_v1(uuid,uuid,text)') IS NULL OR to_regprocedure('private.clinic_billing_tiss_reference_access_v1(uuid,uuid)') IS NULL OR to_regprocedure('private.guard_clinic_communication_tiss_reference_v1()') IS NULL THEN RAISE EXCEPTION 'Missing private communication dependency'; END IF;
 IF has_schema_privilege('anon','private','USAGE') OR has_schema_privilege('authenticated','private','USAGE') OR has_function_privilege('authenticated','private.clinic_billing_communication_capability_v1(uuid,uuid,text)','EXECUTE') OR has_function_privilege('anon','private.clinic_billing_tiss_reference_access_v1(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Private communication exposed to clients'; END IF;
END $private_verify$;

rollback;

select jsonb_build_object('schema_union','PASS','required_tables',19,'required_columns',43,'required_functions',74,'namespace_authority','PASS','denial_probes','PASS') verification;
