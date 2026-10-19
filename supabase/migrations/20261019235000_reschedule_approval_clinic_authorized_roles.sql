-- Align the atomic approval RPCs with the canonical clinic capability
-- calendar.requests.manage: director, coordinator and receptionist (secretaria).
-- Legacy owner/admin remain accepted. The application middleware checks that
-- capability before calling these functions; each RPC independently verifies
-- membership in the same persisted clinic, preserving tenant isolation.
--
-- Rebuild from each exact installed function definition so business/financial
-- checks, locking, notification markers, auditing, and grants stay unchanged.
-- Fail closed if the installed functions differ from the reviewed baseline.
DO $reschedule_approval_roles$
DECLARE
  v_row record;
  v_definition text;
  v_old_roles text := '(''owner'', ''admin'', ''coordinator'')';
  v_new_roles text := '(''owner'', ''admin'', ''coordinator'', ''director'', ''receptionist'')';
  v_occurrences integer;
  v_functions_updated integer := 0;
BEGIN
  FOR v_row IN
    SELECT p.oid, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('approve_appointment_reschedule',
                        'approve_appointment_reschedule_v2')
  LOOP
    v_definition := pg_get_functiondef(v_row.oid);
    v_occurrences := (
      length(v_definition) - length(replace(v_definition, v_old_roles, ''))
    ) / length(v_old_roles);

    IF v_occurrences <> 3 THEN
      RAISE EXCEPTION
        'RESCHEDULE_ROLE_GUARD_UNEXPECTED: %, expected 3 guard occurrences, found %',
        v_row.proname, v_occurrences;
    END IF;

    -- Changes the role allowlist in (1) the authenticated actor check,
    -- (2) same-clinic users check, (3) active clinic-membership check.
    -- No clinical/financial/notification condition is changed.
    EXECUTE replace(v_definition, v_old_roles, v_new_roles);
    v_functions_updated := v_functions_updated + 1;
  END LOOP;

  IF v_functions_updated <> 2 THEN
    RAISE EXCEPTION
      'RESCHEDULE_APPROVAL_FUNCTIONS_MISSING: expected 2, found %',
      v_functions_updated;
  END IF;
END;
$reschedule_approval_roles$;
