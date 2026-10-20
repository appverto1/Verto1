-- Align the DB's atomic reschedule approval with the backend capability
-- calendar.requests.manage. The route already enforces this capability and
-- clinic scope; this function independently verifies the actor's persisted
-- SAME-clinic membership and respects per-member grant/deny overrides.
-- Standard director/coordinator/receptionist (secretaria) keep their access.
-- Explicitly delegated staff can approve only with an active clinic membership.
-- Unrelated billing/patient/clinical roles receive no implicit authority.
--
-- This patch touches ONLY the actor authorization prologue of the two
-- installed approval RPCs. The appointment transaction, financial checks,
-- collision locks, notifications, and reminder markers remain verbatim.

create or replace function public.verto_can_approve_reschedule_for_clinic_v1(
  p_actor_id text,
  p_actor_role text,
  p_clinic_id uuid
)
returns boolean
language sql stable security invoker
set search_path = pg_catalog, public
as $capability$
  select
    nullif(btrim(coalesce(p_actor_id, '')), '') is not null
    and nullif(btrim(coalesce(p_actor_role, '')), '') is not null
    and p_clinic_id is not null
    and (
      exists (
        select 1
        from public.clinic_memberships cm
        left join public.clinic_membership_permission_overrides o
          on o.membership_id = cm.id
         and o.permission_key = 'calendar.requests.manage'
        where cm.user_id::text = p_actor_id
          and cm.clinic_id = p_clinic_id
          and lower(coalesce(cm.status, 'active')) = 'active'
          and (
            o.effect = 'allow'
            or (
              lower(coalesce(cm.role, '')) in
                ('owner', 'admin', 'coordinator', 'director', 'receptionist')
              and o.effect is distinct from 'deny'
            )
          )
      )
      -- Older single-clinic accounts may have no clinic_memberships entry.
      -- Keep only their existing default-role compatibility; never use the
      -- legacy users table to bypass a deactivated or denied membership.
      or (
        not exists (
          select 1 from public.clinic_memberships cm
          where cm.user_id::text = p_actor_id and cm.clinic_id = p_clinic_id
        )
        and exists (
          select 1 from public.users u
          where u.id::text = p_actor_id
            and u.clinic_id = p_clinic_id
            and lower(coalesce(u.role, '')) in
              ('owner', 'admin', 'coordinator', 'director', 'receptionist')
        )
      )
    );
$capability$;

-- This helper is only called from the secured, service-role RPCs. Do not
-- expose a new public API entrypoint.
revoke all on function public.verto_can_approve_reschedule_for_clinic_v1(text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.verto_can_approve_reschedule_for_clinic_v1(text,text,uuid)
  to service_role;

DO $reschedule_capability$
DECLARE
  v_row record;
  v_definition text;
  v_old_guard text;
  v_begin integer;
  v_end integer;
  v_end_marker text;
  v_new_guard text := $guard$
  if not public.verto_can_approve_reschedule_for_clinic_v1(
    p_actor_id, p_actor_role, p_clinic_id
  ) then
    raise exception using errcode = '42501', message = 'RESCHEDULE_APPROVAL_FORBIDDEN';
  end if;

$guard$;
  v_updated integer := 0;
BEGIN
  FOR v_row IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'approve_appointment_reschedule',
        'approve_appointment_reschedule_v2'
      )
  LOOP
    v_definition := pg_get_functiondef(v_row.oid);
    -- A retry of this migration is safe if the installed function already
    -- delegates to the new capability helper.
    IF strpos(v_definition,
      'if not public.verto_can_approve_reschedule_for_clinic_v1(') > 0 THEN
      v_updated := v_updated + 1;
      CONTINUE;
    END IF;
    v_begin := strpos(
      v_definition,
      $needle$  if lower(coalesce(p_actor_role, '')) not in$needle$
    );
    v_end_marker := CASE v_row.proname
      WHEN 'approve_appointment_reschedule_v2'
        THEN '  select a.* into v_appointment'
      ELSE '  select request_row.*'
    END;
    v_end := strpos(v_definition, v_end_marker);
    IF v_begin < 1 OR v_end <= v_begin THEN
      RAISE EXCEPTION 'RESCHEDULE_CAPABILITY_GUARD_MISSING: %', v_row.proname;
    END IF;
    v_old_guard := substring(v_definition from v_begin for v_end-v_begin);
    IF (
      length(v_old_guard) - length(replace(v_old_guard,
        'RESCHEDULE_APPROVAL_FORBIDDEN', ''))
    ) / length('RESCHEDULE_APPROVAL_FORBIDDEN') <> 2
      OR (
        length(v_old_guard) - length(replace(v_old_guard,
          $roles$('owner', 'admin', 'coordinator', 'director', 'receptionist')$roles$, ''))
      ) / length($roles$('owner', 'admin', 'coordinator', 'director', 'receptionist')$roles$) <> 3
    THEN
      RAISE EXCEPTION 'RESCHEDULE_CAPABILITY_GUARD_CHANGED: %', v_row.proname;
    END IF;
    EXECUTE
      substring(v_definition from 1 for v_begin-1)
      || v_new_guard
      || substring(v_definition from v_end);
    v_updated := v_updated + 1;
  END LOOP;
  IF v_updated <> 2 THEN
    RAISE EXCEPTION
      'RESCHEDULE_CAPABILITY_FUNCTIONS_MISSING: expected 2, found %', v_updated;
  END IF;
END;
$reschedule_capability$;
