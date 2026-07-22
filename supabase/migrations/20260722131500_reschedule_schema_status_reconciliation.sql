-- Reconciles the server-only schema capability probe after the physical
-- appointments contract has already been applied. This migration reads only
-- PostgreSQL catalogs and does not modify appointments or clinical data.

create or replace function public.get_verto_critical_schema_status()
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_reschedule_signature text :=
    'public.approve_appointment_reschedule_v2(uuid,uuid,uuid,uuid,uuid,integer,timestamp with time zone,timestamp with time zone,integer,uuid,text,text,text,text,integer,text,text,text,jsonb)';
  v_reschedule_regprocedure regprocedure;
  v_service_role_execute boolean := false;
  v_anon_execute boolean := false;
  v_authenticated_execute boolean := false;
begin
  v_reschedule_regprocedure := to_regprocedure(v_reschedule_signature);
  if v_reschedule_regprocedure is not null then
    v_service_role_execute := has_function_privilege('service_role', v_reschedule_regprocedure, 'EXECUTE');
    v_anon_execute := has_function_privilege('anon', v_reschedule_regprocedure, 'EXECUTE');
    v_authenticated_execute := has_function_privilege('authenticated', v_reschedule_regprocedure, 'EXECUTE');
  end if;

  return jsonb_build_object(
    'reschedule', jsonb_build_object(
      'version', public.get_reschedule_schema_version(),
      'approve_rpc', v_reschedule_regprocedure is not null,
      'service_role_execute', v_service_role_execute,
      'anon_execute', v_anon_execute,
      'authenticated_execute', v_authenticated_execute,
      -- Kept for older deploy auditors. The operation-specific groups below
      -- are authoritative for the current backend guard.
      'appointment_columns', (
        select jsonb_object_agg(required.column_name, required.present order by required.column_name)
          from (
            select name as column_name,
                   exists (
                     select 1
                       from information_schema.columns c
                      where c.table_schema = 'public'
                        and c.table_name = 'appointments'
                        and c.column_name = name
                   ) as present
              from unnest(array[
                'id', 'organization_id', 'clinic_id', 'patient_id', 'status',
                'scheduled_at', 'scheduled_start_at', 'scheduled_end_at',
                'scheduled_duration_minutes', 'therapist_id', 'therapist_name',
                'room_id', 'room_name', 'location_type', 'patient_response',
                'patient_responded_at', 'patient_confirmation_status',
                'patient_confirmation_at', 'patient_confirmation_by',
                'patient_confirmation_source', 'source_payload',
                'reschedule_requested_at', 'reschedule_requested_by',
                'notification_24h_sent_at', 'notification_12h_sent_at',
                'notification_sent', 'notification_sent_at',
                'notification_12h_sent'
              ]::text[]) as name
          ) required
      ),
      -- Read-only availability needs only the appointment identity used by
      -- the scheduler and its canonical time window. Tenant/patient scope is
      -- also validated from the persisted action request by the backend.
      'availability_columns', (
        select jsonb_object_agg(required.column_name, required.present order by required.column_name)
          from (
            select name as column_name,
                   exists (
                     select 1
                       from information_schema.columns c
                      where c.table_schema = 'public'
                        and c.table_name = 'appointments'
                        and c.column_name = name
                   ) as present
              from unnest(array[
                'id', 'scheduled_at', 'scheduled_start_at', 'scheduled_end_at',
                'scheduled_duration_minutes', 'therapist_id'
              ]::text[]) as name
          ) required
      ),
      -- Approval remains blocked unless every column written by the atomic
      -- RPC is physically present.
      'approval_columns', (
        select jsonb_object_agg(required.column_name, required.present order by required.column_name)
          from (
            select name as column_name,
                   exists (
                     select 1
                       from information_schema.columns c
                      where c.table_schema = 'public'
                        and c.table_name = 'appointments'
                        and c.column_name = name
                   ) as present
              from unnest(array[
                'id', 'organization_id', 'clinic_id', 'patient_id', 'status',
                'scheduled_at', 'scheduled_start_at', 'scheduled_end_at',
                'scheduled_duration_minutes', 'therapist_id', 'therapist_name',
                'room_id', 'room_name', 'location_type', 'patient_response',
                'patient_responded_at', 'patient_confirmation_status',
                'patient_confirmation_at', 'patient_confirmation_by',
                'patient_confirmation_source', 'source_payload',
                'reschedule_requested_at', 'reschedule_requested_by',
                'notification_24h_sent_at', 'notification_12h_sent_at',
                'notification_sent', 'notification_sent_at',
                'notification_12h_sent'
              ]::text[]) as name
          ) required
      ),
      'optional_columns', (
        select jsonb_object_agg(required.column_name, required.present order by required.column_name)
          from (
            select name as column_name,
                   exists (
                     select 1
                       from information_schema.columns c
                      where c.table_schema = 'public'
                        and c.table_name = 'appointments'
                        and c.column_name = name
                   ) as present
              from unnest(array[
                'patient_email', 'date', 'time', 'duration_minutes', 'approach',
                'service_type', 'location_notes', 'call_link', 'confirmed_at',
                'confirmed_by', 'confirmed_by_role', 'cancel_requested_at',
                'cancel_requested_by', 'recurrence_group_id', 'recurrence_index',
                'notes', 'created_at', 'updated_at'
              ]::text[]) as name
          ) required
      ),
      'legacy_columns', (
        select jsonb_object_agg(required.column_name, required.present order by required.column_name)
          from (
            select name as column_name,
                   exists (
                     select 1
                       from information_schema.columns c
                      where c.table_schema = 'public'
                        and c.table_name = 'appointments'
                        and c.column_name = name
                   ) as present
              from unnest(array['date', 'time', 'duration_minutes']::text[]) as name
          ) required
      )
    ),
    'tasks', jsonb_build_object(
      'columns', (
        select jsonb_object_agg(required.column_name, required.present order by required.column_name)
          from (
            select name as column_name,
                   exists (
                     select 1
                       from information_schema.columns c
                      where c.table_schema = 'public'
                        and c.table_name = 'tasks'
                        and c.column_name = name
                   ) as present
              from unnest(array['max_score', 'is_active', 'deleted_at']::text[]) as name
          ) required
      )
    ),
    'invitations', jsonb_build_object(
      'columns', (
        select jsonb_object_agg(required.column_name, required.present order by required.column_name)
          from (
            select name as column_name,
                   exists (
                     select 1
                       from information_schema.columns c
                      where c.table_schema = 'public'
                        and c.table_name = 'invitations'
                        and c.column_name = name
                   ) as present
              from unnest(array[
                'clinic_name', 'invited_by', 'updated_at', 'accepted_at',
                'canceled_at', 'canceled_by'
              ]::text[]) as name
          ) required
      )
    )
  );
end;
$$;

revoke all on function public.get_verto_critical_schema_status() from public, anon, authenticated;
grant execute on function public.get_verto_critical_schema_status() to service_role;

comment on function public.get_verto_critical_schema_status() is
  'Server-only catalog audit with separate reschedule availability and approval contracts.';

notify pgrst, 'reload schema';
