-- ABA catalog and all pinned shortcuts. Additive to clinical data; no event deletes.
BEGIN;

-- Avoid creating duplicate definitions when two clinicians save simultaneously.
CREATE UNIQUE INDEX IF NOT EXISTS aba_behavior_definitions_patient_active_name_unique
  ON public.aba_behavior_definitions (clinic_id, patient_id, lower(btrim(name)))
  WHERE status = 'active' AND is_active = true;

-- The original 3-button dock imposed a six-shortcut storage cap. Allow the
-- horizontally scrollable dock to keep all patient behaviors (bounded at 200).
ALTER TABLE public.aba_user_session_preferences
  DROP CONSTRAINT IF EXISTS aba_user_session_preferences_shortcuts_array_v1;

ALTER TABLE public.aba_user_session_preferences
  ADD CONSTRAINT aba_user_session_preferences_shortcuts_array_v1
  CHECK (
    jsonb_typeof(quick_behavior_shortcuts) = 'array'
    AND jsonb_array_length(quick_behavior_shortcuts) <= 200
  );

-- Preserve the existing RPC contract, advisory lock, scope and service-only grant.
CREATE OR REPLACE FUNCTION public.save_aba_user_session_preferences_v1(
  p_clinic_id uuid,
  p_user_id uuid,
  p_quick_behavior_shortcuts jsonb
)
RETURNS public.aba_user_session_preferences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_row public.aba_user_session_preferences%rowtype;
  v_shortcuts jsonb := coalesce(p_quick_behavior_shortcuts, '[]'::jsonb);
BEGIN
  IF p_clinic_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ABA_SESSION_PREFERENCES_SCOPE_REQUIRED';
  END IF;
  IF jsonb_typeof(v_shortcuts) <> 'array' OR jsonb_array_length(v_shortcuts) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ABA_SESSION_PREFERENCES_INVALID';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('aba-session-preferences:' || p_clinic_id::text || ':' || p_user_id::text, 0)
  );

  INSERT INTO public.aba_user_session_preferences (
    clinic_id, user_id, quick_behavior_shortcuts, created_at, updated_at
  ) VALUES (
    p_clinic_id, p_user_id, v_shortcuts, now(), now()
  )
  ON CONFLICT (clinic_id, user_id) DO UPDATE
    SET quick_behavior_shortcuts = EXCLUDED.quick_behavior_shortcuts,
        updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_aba_user_session_preferences_v1(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_aba_user_session_preferences_v1(uuid, uuid, jsonb)
  TO service_role;

COMMIT;
