-- Issue #174 / RLS-H18-A1
-- Forward-only authority quarantine: preserve historical tenant identifiers,
-- but never authorize an actor because auth/user UUID equals tenant UUID.

do $$ begin
  if to_regprocedure('public.can_access_clinic(uuid,uuid)') is null or to_regprocedure('public.can_manage_clinic(uuid,uuid)') is null then
    raise exception 'canonical clinic authority helpers missing';
  end if;
end $$;

alter policy appointment_closure_audit_logs_clinic_scope_rw on public.appointment_closure_audit_logs using (public.can_access_clinic(organization_id,auth.uid())) with check (public.can_access_clinic(organization_id,auth.uid()));
alter policy appointment_closure_checks_clinic_scope_rw on public.appointment_closure_checks using (public.can_access_clinic(organization_id,auth.uid())) with check (public.can_access_clinic(organization_id,auth.uid()));
alter policy appointment_conference_statuses_admin_rw on public.appointment_conference_statuses using (public.can_manage_clinic(organization_id,auth.uid())) with check (public.can_manage_clinic(organization_id,auth.uid()));
alter policy appointment_tiss_pre_guides_admin_rw on public.appointment_tiss_pre_guides using (public.can_manage_clinic(clinic_id,auth.uid())) with check (public.can_manage_clinic(clinic_id,auth.uid()));
alter policy clinic_closure_requirements_admin_rw on public.clinic_closure_requirements using (public.can_manage_clinic(organization_id,auth.uid())) with check (public.can_manage_clinic(organization_id,auth.uid()));
alter policy clinic_tiss_profiles_admin_rw on public.clinic_tiss_profiles using (public.can_manage_clinic(clinic_id,auth.uid())) with check (public.can_manage_clinic(clinic_id,auth.uid()));
alter policy operational_closure_exports_admin_rw on public.operational_closure_exports using (public.can_manage_clinic(organization_id,auth.uid())) with check (public.can_manage_clinic(organization_id,auth.uid()));
alter policy patient_access_grants_clinic_rw on public.patient_access_grants using (public.can_manage_clinic(organization_id,auth.uid())) with check (public.can_manage_clinic(organization_id,auth.uid()));
alter policy patient_anamnesis_requests_clinic_rw on public.patient_anamnesis_requests using (public.can_access_clinic(organization_id,auth.uid())) with check (public.can_access_clinic(organization_id,auth.uid()));
alter policy patient_anamnesis_responses_clinic_rw on public.patient_anamnesis_responses using (public.can_access_clinic(organization_id,auth.uid())) with check (public.can_access_clinic(organization_id,auth.uid()));
alter policy patient_history_imports_clinic_rw on public.patient_history_imports using (public.can_manage_clinic(organization_id,auth.uid())) with check (public.can_manage_clinic(organization_id,auth.uid()));
alter policy patient_longitudinal_timeline_items_clinic_rw on public.patient_longitudinal_timeline_items using (public.can_access_clinic(organization_id,auth.uid())) with check (public.can_access_clinic(organization_id,auth.uid()));
alter policy patient_payer_authorizations_admin_rw on public.patient_payer_authorizations using (public.can_manage_clinic(clinic_id,auth.uid())) with check (public.can_manage_clinic(clinic_id,auth.uid()));
alter policy patient_portability_requests_clinic_admin_rw on public.patient_portability_requests using (public.can_manage_clinic(organization_id_requesting,auth.uid())) with check (public.can_manage_clinic(organization_id_requesting,auth.uid()));
alter policy patient_portability_snapshots_clinic_rw on public.patient_portability_snapshots using (public.can_access_clinic(organization_id_source,auth.uid()) or public.can_access_clinic(organization_id_target,auth.uid())) with check (public.can_access_clinic(organization_id_source,auth.uid()) or public.can_access_clinic(organization_id_target,auth.uid()));
alter policy patient_relationship_confirmations_clinic_rw on public.patient_relationship_confirmations using (public.can_manage_clinic(organization_id_requesting,auth.uid())) with check (public.can_manage_clinic(organization_id_requesting,auth.uid()));
alter policy patient_shared_history_snapshots_clinic_read on public.patient_shared_history_snapshots using (public.can_access_clinic(organization_id_target,auth.uid()));
alter policy patient_therapeutic_objectives_scope on public.patient_therapeutic_objectives using (public.can_access_clinic(organization_id::uuid,auth.uid()) and exists(select 1 from public.patients p where p.id=patient_therapeutic_objectives.patient_id and p.clinic_id::text=patient_therapeutic_objectives.organization_id and (public.can_manage_clinic(p.clinic_id,auth.uid()) or p.therapist_id=auth.uid()))) with check (public.can_access_clinic(organization_id::uuid,auth.uid()) and exists(select 1 from public.patients p where p.id=patient_therapeutic_objectives.patient_id and p.clinic_id::text=patient_therapeutic_objectives.organization_id and (public.can_manage_clinic(p.clinic_id,auth.uid()) or p.therapist_id=auth.uid())));
alter policy payer_procedure_prices_admin_rw on public.payer_procedure_prices using (public.can_manage_clinic(clinic_id,auth.uid())) with check (public.can_manage_clinic(clinic_id,auth.uid()));
alter policy payer_tiss_profiles_admin_rw on public.payer_tiss_profiles using (public.can_manage_clinic(clinic_id,auth.uid())) with check (public.can_manage_clinic(clinic_id,auth.uid()));
alter policy professional_billing_profiles_admin_rw on public.professional_billing_profiles using (public.can_manage_clinic(clinic_id,auth.uid())) with check (public.can_manage_clinic(clinic_id,auth.uid()));
alter policy professional_payments_clinic_finance_rw on public.professional_payments using (public.can_manage_clinic(public.try_uuid(clinic_id),auth.uid())) with check (public.can_manage_clinic(public.try_uuid(clinic_id),auth.uid()));
alter policy tiss_billing_batch_drafts_admin_rw on public.tiss_billing_batch_drafts using (public.can_manage_clinic(clinic_id,auth.uid())) with check (public.can_manage_clinic(clinic_id,auth.uid()));
alter policy tiss_official_document_tracking_admin_rw on public.tiss_official_document_tracking using (public.can_manage_clinic(clinic_id,auth.uid())) with check (public.can_manage_clinic(clinic_id,auth.uid()));
alter policy tiss_official_documents_admin_read on public.tiss_official_documents using (public.can_manage_clinic(clinic_id,auth.uid()));
alter policy tiss_official_guide_tracking_admin_rw on public.tiss_official_guide_tracking using (public.can_manage_clinic(clinic_id,auth.uid())) with check (public.can_manage_clinic(clinic_id,auth.uid()));
alter policy tiss_official_tracking_events_admin_rw on public.tiss_official_tracking_events using (public.can_manage_clinic(clinic_id,auth.uid())) with check (public.can_manage_clinic(clinic_id,auth.uid()));
alter policy tiss_revenue_cycle_events_admin_rw on public.tiss_revenue_cycle_events using (public.can_manage_clinic(clinic_id,auth.uid())) with check (public.can_manage_clinic(clinic_id,auth.uid()));
alter policy tiss_xml_drafts_admin_rw on public.tiss_xml_drafts using (public.can_manage_clinic(clinic_id,auth.uid())) with check (public.can_manage_clinic(clinic_id,auth.uid()));

-- ABA patient-scoped residual: active clinic membership plus coordinator authority or assigned therapist.
do $body$
declare t text;
begin
  foreach t in array array['aba_abc_events','aba_audit_events','aba_behavior_daily_summaries','aba_behavior_definitions','aba_behavior_events','aba_graph_annotations','aba_interval_records','aba_interval_summaries','aba_maintenance_probe_results','aba_maintenance_schedules','aba_mastery_evaluations','aba_next_session_focuses','aba_next_session_plan_items','aba_patient_aba_summaries','aba_programs','aba_regression_alerts','aba_session_live_summaries','aba_session_metric_snapshots','aba_session_summaries','aba_sessions','aba_target_live_summaries','aba_target_status_audit_logs','aba_targets','aba_trials'] loop
    execute format('alter policy %I_patient_scope_rw on public.%I using (public.can_access_clinic(public.try_uuid(clinic_id),auth.uid()) and exists(select 1 from public.patients p where p.id=%I.patient_id and (public.can_manage_clinic(p.clinic_id,auth.uid()) or p.therapist_id=auth.uid()))) with check (public.can_access_clinic(public.try_uuid(clinic_id),auth.uid()) and exists(select 1 from public.patients p where p.id=%I.patient_id and (public.can_manage_clinic(p.clinic_id,auth.uid()) or p.therapist_id=auth.uid())))',t,t,t,t);
  end loop;
end $body$;

alter policy aba_mastery_criteria_clinic_rw on public.aba_mastery_criteria using (public.can_access_clinic(public.try_uuid(clinic_id),auth.uid()) and public.try_uuid(clinic_id)=public.try_uuid(organization_id)) with check (public.can_access_clinic(public.try_uuid(clinic_id),auth.uid()) and public.try_uuid(clinic_id)=public.try_uuid(organization_id));
alter policy aba_prompt_levels_clinic_rw on public.aba_prompt_levels using (public.can_access_clinic(public.try_uuid(clinic_id),auth.uid())) with check (public.can_access_clinic(public.try_uuid(clinic_id),auth.uid()));
alter policy aba_prompt_types_clinic_read on public.aba_prompt_types using (public.can_access_clinic(public.try_uuid(organization_id::text),auth.uid()));
alter policy aba_prompt_types_clinic_write on public.aba_prompt_types using (public.can_manage_clinic(public.try_uuid(organization_id::text),auth.uid())) with check (public.can_manage_clinic(public.try_uuid(organization_id::text),auth.uid()));
alter policy aba_program_audit_events_read on public.aba_program_audit_events using (exists(select 1 from public.patients p where p.id=aba_program_audit_events.patient_id and p.clinic_id::text=aba_program_audit_events.organization_id and public.can_access_clinic(p.clinic_id,auth.uid()) and (public.can_manage_clinic(p.clinic_id,auth.uid()) or p.therapist_id=auth.uid())));
alter policy aba_program_versions_read on public.aba_program_versions using (exists(select 1 from public.patients p where p.id=aba_program_versions.patient_id and p.clinic_id::text=aba_program_versions.organization_id and public.can_access_clinic(p.clinic_id,auth.uid()) and (public.can_manage_clinic(p.clinic_id,auth.uid()) or p.therapist_id=auth.uid())));
alter policy aba_program_templates_read on public.aba_program_templates using ((source_scope='VERTO' and status='PUBLISHED') or (source_scope='PERSONAL' and visibility='private' and owner_user_id=auth.uid()::text) or (source_scope='CLINIC' and visibility='clinic' and public.can_access_clinic(public.try_uuid(organization_id),auth.uid()) and (status='PUBLISHED' or public.can_manage_clinic(public.try_uuid(organization_id),auth.uid()))));
alter policy aba_program_templates_manage on public.aba_program_templates using (source_scope<>'VERTO' and ((source_scope='PERSONAL' and visibility='private' and owner_user_id=auth.uid()::text) or (source_scope='CLINIC' and visibility='clinic' and public.can_manage_clinic(public.try_uuid(organization_id),auth.uid())))) with check (source_scope<>'VERTO' and ((source_scope='PERSONAL' and visibility='private' and owner_user_id=auth.uid()::text and organization_id=auth.uid()::text) or (source_scope='CLINIC' and visibility='clinic' and public.can_manage_clinic(public.try_uuid(organization_id),auth.uid()))));
alter policy aba_program_template_versions_tenant_select on public.aba_program_template_versions using (exists(select 1 from public.aba_program_templates t where t.id=aba_program_template_versions.template_id and ((t.source_scope='PERSONAL' and t.owner_user_id=auth.uid()::text) or (t.source_scope='CLINIC' and public.can_access_clinic(public.try_uuid(t.organization_id),auth.uid())))));
