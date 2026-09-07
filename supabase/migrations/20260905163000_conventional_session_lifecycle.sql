-- Verto: ciclo operacional persistente para atendimentos convencionais.
-- Aditiva e idempotente. Reutiliza appointments como lifecycle, notes como fonte clínica
-- e appointment_attendance_audit_events como auditoria/idempotência.
-- Não cria motor financeiro paralelo; o UPDATE canônico de appointments continua acionando
-- os triggers financeiros já instalados (AT_SESSION ou MONTHLY_SESSION).

begin;

DO $$
DECLARE
  v_missing text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.appointments') IS NULL THEN v_missing := array_append(v_missing, 'appointments'); END IF;
  IF to_regclass('public.notes') IS NULL THEN v_missing := array_append(v_missing, 'notes'); END IF;
  IF to_regclass('public.appointment_attendance_audit_events') IS NULL THEN v_missing := array_append(v_missing, 'appointment_attendance_audit_events'); END IF;
  IF to_regprocedure('public.verto_clinic_actor_role_v1(uuid,uuid)') IS NULL THEN v_missing := array_append(v_missing, 'verto_clinic_actor_role_v1(uuid,uuid)'); END IF;
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'CONVENTIONAL_SESSION_PREFLIGHT_MISSING_DEPENDENCIES:%', array_to_string(v_missing, ',');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments' AND column_name='id' AND udt_name='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments' AND column_name='clinic_id' AND udt_name='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments' AND column_name='patient_id' AND udt_name='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments' AND column_name='actual_start_at' AND udt_name='timestamptz'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments' AND column_name='actual_end_at' AND udt_name='timestamptz'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments' AND column_name='status'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments' AND column_name='organization_id' AND udt_name='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments' AND column_name='attendance_status'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments' AND column_name='actual_duration_minutes'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments' AND column_name='active_aba_session_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments' AND column_name='session_start_previous_status'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments' AND column_name='is_active'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments' AND column_name='deleted_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments' AND column_name='updated_at'
  ) THEN
    RAISE EXCEPTION 'CONVENTIONAL_SESSION_PREFLIGHT_APPOINTMENTS_DRIFT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='id' AND udt_name='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='patient_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='content'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='source'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='created_by' AND udt_name='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='subject'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='visibility'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='type'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='portability_scope'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='is_portable'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='shared_with_patient'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='shared_with_professionals'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='original_author_id' AND udt_name='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='created_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='is_active'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notes' AND column_name='deleted_at'
  ) THEN
    RAISE EXCEPTION 'CONVENTIONAL_SESSION_PREFLIGHT_NOTES_DRIFT';
  END IF;
END
$$;

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notes_appointment_created_v1
  ON public.notes (appointment_id, created_at DESC)
  WHERE appointment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_conventional_session_one_per_appointment_v1
  ON public.notes (appointment_id)
  WHERE appointment_id IS NOT NULL
    AND lower(coalesce(source, '')) = 'conventional_session'
    AND coalesce(is_active, true) = true
    AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.start_conventional_appointment_session_v1(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_idempotency_key text,
  p_payload_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_appointment public.appointments%rowtype;
  v_existing public.appointment_attendance_audit_events%rowtype;
  v_now timestamptz := now();
  v_started_at timestamptz;
  v_response jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'CONVENTIONAL_SESSION_ACTOR_MISMATCH';
  END IF;
  IF p_actor_id IS NULL OR p_clinic_id IS NULL OR p_patient_id IS NULL OR p_appointment_id IS NULL THEN
    RAISE EXCEPTION 'CONVENTIONAL_SESSION_REQUIRED';
  END IF;
  IF nullif(trim(coalesce(p_idempotency_key, '')), '') IS NULL OR length(p_idempotency_key) > 180
     OR nullif(trim(coalesce(p_payload_hash, '')), '') IS NULL OR length(p_payload_hash) > 128 THEN
    RAISE EXCEPTION 'CONVENTIONAL_SESSION_IDEMPOTENCY_REQUIRED';
  END IF;

  v_role := public.verto_clinic_actor_role_v1(p_actor_id, p_clinic_id);
  IF nullif(trim(coalesce(v_role, '')), '') IS NULL THEN
    RAISE EXCEPTION 'CONVENTIONAL_SESSION_ACCESS_DENIED';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('conventional-session:' || p_clinic_id::text || ':' || p_appointment_id::text, 0));

  SELECT audit.* INTO v_existing
  FROM public.appointment_attendance_audit_events audit
  WHERE audit.clinic_id = p_clinic_id
    AND audit.idempotency_key = p_idempotency_key
  LIMIT 1;
  IF found THEN
    IF v_existing.payload_hash <> p_payload_hash THEN
      RAISE EXCEPTION 'CONVENTIONAL_SESSION_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN coalesce(v_existing.metadata->'response', '{}'::jsonb)
      || jsonb_build_object('success', true, 'idempotentReplay', true);
  END IF;

  SELECT appointment.* INTO v_appointment
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.patient_id = p_patient_id
    AND coalesce(appointment.organization_id, appointment.clinic_id) = p_clinic_id
    AND coalesce(appointment.is_active, true) = true
    AND appointment.deleted_at IS NULL
  FOR UPDATE;
  IF NOT found THEN RAISE EXCEPTION 'CONVENTIONAL_SESSION_APPOINTMENT_NOT_FOUND'; END IF;

  IF lower(coalesce(v_appointment.status, '')) IN ('no_show','missed') OR v_appointment.attendance_status = 'NO_SHOW' THEN
    RAISE EXCEPTION 'CONVENTIONAL_SESSION_NO_SHOW_REOPEN_REQUIRED';
  END IF;
  IF lower(coalesce(v_appointment.status, '')) IN ('cancelled','canceled','cancelada','deleted','archived') THEN
    RAISE EXCEPTION 'CONVENTIONAL_SESSION_APPOINTMENT_CANCELLED';
  END IF;
  IF lower(coalesce(v_appointment.status, '')) IN ('completed','concluida','concluido') OR v_appointment.actual_end_at IS NOT NULL THEN
    RAISE EXCEPTION 'CONVENTIONAL_SESSION_APPOINTMENT_COMPLETED';
  END IF;
  IF nullif(trim(coalesce(v_appointment.active_aba_session_id, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'CONVENTIONAL_SESSION_ABA_ACTIVE';
  END IF;

  IF v_appointment.actual_start_at IS NOT NULL
     AND lower(coalesce(v_appointment.status, '')) IN ('in_progress','active') THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotentReplay', true,
      'data', jsonb_build_object(
        'appointmentId', p_appointment_id,
        'patientId', p_patient_id,
        'status', 'IN_PROGRESS',
        'startedAt', v_appointment.actual_start_at,
        'endedAt', v_appointment.actual_end_at
      )
    );
  END IF;

  IF lower(coalesce(v_appointment.status, '')) NOT IN ('scheduled','pending','pending_confirmation','confirmed','rescheduled','reschedule') THEN
    RAISE EXCEPTION 'CONVENTIONAL_SESSION_APPOINTMENT_STATUS_INVALID';
  END IF;

  v_started_at := coalesce(v_appointment.actual_start_at, v_now);
  UPDATE public.appointments
  SET
    session_start_previous_status = coalesce(session_start_previous_status, status),
    status = 'in_progress',
    actual_start_at = v_started_at,
    actual_end_at = NULL,
    attendance_status = NULL,
    updated_at = v_now
  WHERE id = p_appointment_id;

  v_response := jsonb_build_object(
    'success', true,
    'idempotentReplay', false,
    'data', jsonb_build_object(
      'appointmentId', p_appointment_id,
      'patientId', p_patient_id,
      'status', 'IN_PROGRESS',
      'startedAt', v_started_at,
      'endedAt', null
    )
  );

  INSERT INTO public.appointment_attendance_audit_events (
    clinic_id, appointment_id, patient_id, actor_id, action,
    previous_status, new_status, attendance_status,
    idempotency_key, payload_hash, metadata
  ) VALUES (
    p_clinic_id, p_appointment_id, p_patient_id, p_actor_id,
    'CONVENTIONAL_SESSION_STARTED', upper(coalesce(v_appointment.status, 'SCHEDULED')),
    'IN_PROGRESS', null, p_idempotency_key, p_payload_hash,
    jsonb_build_object('response', v_response, 'source', 'conventional_session')
  );

  RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_conventional_appointment_session_v1(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_ended_at timestamptz,
  p_session_note text,
  p_idempotency_key text,
  p_payload_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_appointment public.appointments%rowtype;
  v_existing public.appointment_attendance_audit_events%rowtype;
  v_existing_note public.notes%rowtype;
  v_note_id uuid;
  v_now timestamptz := now();
  v_started_at timestamptz;
  v_ended_at timestamptz := coalesce(p_ended_at, now());
  v_duration_seconds integer;
  v_response jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RAISE EXCEPTION 'CONVENTIONAL_SESSION_ACTOR_MISMATCH';
  END IF;
  IF p_actor_id IS NULL OR p_clinic_id IS NULL OR p_patient_id IS NULL OR p_appointment_id IS NULL THEN
    RAISE EXCEPTION 'CONVENTIONAL_SESSION_REQUIRED';
  END IF;
  IF length(coalesce(p_session_note, '')) > 12000 THEN RAISE EXCEPTION 'CONVENTIONAL_SESSION_NOTE_TOO_LARGE'; END IF;
  IF nullif(trim(coalesce(p_idempotency_key, '')), '') IS NULL OR length(p_idempotency_key) > 180
     OR nullif(trim(coalesce(p_payload_hash, '')), '') IS NULL OR length(p_payload_hash) > 128 THEN
    RAISE EXCEPTION 'CONVENTIONAL_SESSION_IDEMPOTENCY_REQUIRED';
  END IF;

  v_role := public.verto_clinic_actor_role_v1(p_actor_id, p_clinic_id);
  IF nullif(trim(coalesce(v_role, '')), '') IS NULL THEN RAISE EXCEPTION 'CONVENTIONAL_SESSION_ACCESS_DENIED'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('conventional-session:' || p_clinic_id::text || ':' || p_appointment_id::text, 0));

  SELECT audit.* INTO v_existing
  FROM public.appointment_attendance_audit_events audit
  WHERE audit.clinic_id = p_clinic_id
    AND audit.idempotency_key = p_idempotency_key
  LIMIT 1;
  IF found THEN
    IF v_existing.payload_hash <> p_payload_hash THEN RAISE EXCEPTION 'CONVENTIONAL_SESSION_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN coalesce(v_existing.metadata->'response', '{}'::jsonb)
      || jsonb_build_object('success', true, 'idempotentReplay', true);
  END IF;

  SELECT appointment.* INTO v_appointment
  FROM public.appointments appointment
  WHERE appointment.id = p_appointment_id
    AND appointment.patient_id = p_patient_id
    AND coalesce(appointment.organization_id, appointment.clinic_id) = p_clinic_id
    AND coalesce(appointment.is_active, true) = true
    AND appointment.deleted_at IS NULL
  FOR UPDATE;
  IF NOT found THEN RAISE EXCEPTION 'CONVENTIONAL_SESSION_APPOINTMENT_NOT_FOUND'; END IF;

  IF lower(coalesce(v_appointment.status, '')) IN ('no_show','missed') OR v_appointment.attendance_status = 'NO_SHOW' THEN
    RAISE EXCEPTION 'CONVENTIONAL_SESSION_NO_SHOW_REOPEN_REQUIRED';
  END IF;

  IF lower(coalesce(v_appointment.status, '')) IN ('completed','concluida','concluido') AND v_appointment.actual_end_at IS NOT NULL THEN
    SELECT note_row.* INTO v_existing_note
    FROM public.notes note_row
    WHERE note_row.appointment_id = p_appointment_id
      AND lower(coalesce(note_row.source, '')) = 'conventional_session'
      AND coalesce(note_row.is_active, true) = true
      AND note_row.deleted_at IS NULL
    ORDER BY note_row.created_at ASC NULLS LAST, note_row.id ASC
    LIMIT 1;
    RETURN jsonb_build_object(
      'success', true,
      'idempotentReplay', true,
      'data', jsonb_build_object(
        'appointmentId', p_appointment_id,
        'patientId', p_patient_id,
        'status', 'COMPLETED',
        'startedAt', v_appointment.actual_start_at,
        'endedAt', v_appointment.actual_end_at,
        'durationSeconds', greatest(0, floor(extract(epoch from (v_appointment.actual_end_at - v_appointment.actual_start_at)))::integer),
        'noteId', v_existing_note.id
      )
    );
  END IF;

  IF v_appointment.actual_start_at IS NULL OR lower(coalesce(v_appointment.status, '')) NOT IN ('in_progress','active') THEN
    RAISE EXCEPTION 'CONVENTIONAL_SESSION_NOT_STARTED';
  END IF;
  IF v_ended_at > v_now + interval '5 minutes' THEN RAISE EXCEPTION 'CONVENTIONAL_SESSION_END_TIME_INVALID'; END IF;
  IF v_ended_at < v_appointment.actual_start_at THEN RAISE EXCEPTION 'CONVENTIONAL_SESSION_END_BEFORE_START'; END IF;

  v_started_at := v_appointment.actual_start_at;
  v_duration_seconds := greatest(0, floor(extract(epoch from (v_ended_at - v_started_at)))::integer);

  SELECT note_row.* INTO v_existing_note
  FROM public.notes note_row
  WHERE note_row.appointment_id = p_appointment_id
    AND lower(coalesce(note_row.source, '')) = 'conventional_session'
    AND coalesce(note_row.is_active, true) = true
    AND note_row.deleted_at IS NULL
  ORDER BY note_row.created_at ASC NULLS LAST, note_row.id ASC
  LIMIT 1
  FOR UPDATE;

  IF found THEN
    v_note_id := v_existing_note.id;
    UPDATE public.notes
    SET
      content = left(coalesce(p_session_note, ''), 12000),
      subject = 'Evolução da sessão',
      visibility = 'shared_clinic',
      type = 'professional',
      portability_scope = 'PROFESSIONALS',
      shared_with_professionals = true
    WHERE id = v_note_id;
  ELSE
    v_note_id := gen_random_uuid();
    INSERT INTO public.notes (
      id, patient_id, appointment_id, content, visibility, type, subject, source,
      portability_scope, is_portable, shared_with_patient, shared_with_professionals,
      original_author_id, created_by, created_at, is_active
    ) VALUES (
      v_note_id, p_patient_id, p_appointment_id, left(coalesce(p_session_note, ''), 12000),
      'shared_clinic', 'professional', 'Evolução da sessão', 'conventional_session',
      'PROFESSIONALS', false, false, true,
      p_actor_id, p_actor_id, v_now, true
    );
  END IF;

  UPDATE public.appointments
  SET
    status = 'completed',
    attendance_status = 'ATTENDED',
    actual_start_at = v_started_at,
    actual_end_at = v_ended_at,
    actual_duration_minutes = ceil(v_duration_seconds / 60.0)::integer,
    updated_at = v_now
  WHERE id = p_appointment_id;

  v_response := jsonb_build_object(
    'success', true,
    'idempotentReplay', false,
    'data', jsonb_build_object(
      'appointmentId', p_appointment_id,
      'patientId', p_patient_id,
      'status', 'COMPLETED',
      'attendanceStatus', 'ATTENDED',
      'startedAt', v_started_at,
      'endedAt', v_ended_at,
      'durationSeconds', v_duration_seconds,
      'noteId', v_note_id
    )
  );

  INSERT INTO public.appointment_attendance_audit_events (
    clinic_id, appointment_id, patient_id, actor_id, action,
    previous_status, new_status, attendance_status, reason,
    idempotency_key, payload_hash, metadata
  ) VALUES (
    p_clinic_id, p_appointment_id, p_patient_id, p_actor_id,
    'CONVENTIONAL_SESSION_COMPLETED', upper(coalesce(v_appointment.status, 'IN_PROGRESS')),
    'COMPLETED', 'ATTENDED', left(nullif(trim(coalesce(p_session_note, '')), ''), 1000),
    p_idempotency_key, p_payload_hash,
    jsonb_build_object('response', v_response, 'source', 'conventional_session', 'durationSeconds', v_duration_seconds, 'noteId', v_note_id)
  );

  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.start_conventional_appointment_session_v1(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_conventional_appointment_session_v1(uuid,uuid,uuid,uuid,timestamptz,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_conventional_appointment_session_v1(uuid,uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_conventional_appointment_session_v1(uuid,uuid,uuid,uuid,timestamptz,text,text,text) TO service_role;

commit;
