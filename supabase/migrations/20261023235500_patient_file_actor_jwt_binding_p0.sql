-- P0 #477: retain the same authorization rules while preventing callers
-- from using this SECURITY DEFINER function as an actor-identity oracle.
-- Authenticated invokers are bound to their JWT subject; only the server's
-- signed service_role credential may validate a different actor id.
-- Existing SELECT RLS policy invokes this function with auth.uid().
create or replace function public.patient_file_actor_has_patient_access_v1(
  p_actor_id uuid,
  p_clinic_id uuid,
  p_patient_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select
    (
      current_setting('request.jwt.claim.role', true) = 'service_role'
      or (
        current_setting('request.jwt.claim.role', true) = 'authenticated'
        and (select auth.uid()) is not null
        and p_actor_id = (select auth.uid())
      )
    )
    and exists (
      select 1
      from public.patients p
      where p.id = p_patient_id
        and p.clinic_id = p_clinic_id
        and (
          exists (
            select 1 from public.clinics c
            where c.id = p_clinic_id and c.owner_user_id = p_actor_id
          )
          or exists (
            select 1 from public.clinic_memberships cm
            where cm.user_id = p_actor_id and cm.clinic_id = p_clinic_id
              and cm.status = 'active'
              and lower(coalesce(cm.role, '')) in ('owner', 'admin', 'director', 'coordinator', 'receptionist')
          )
          or exists (
            select 1 from public.users u
            where u.id = p_actor_id and u.clinic_id = p_clinic_id
              and lower(coalesce(u.role, '')) in ('owner', 'admin', 'director', 'coordinator', 'receptionist')
          )
          or p.therapist_id = p_actor_id
          or exists (
            select 1 from public.patient_professional_links link
            where link.patient_id = p_patient_id
              and link.professional_id = p_actor_id::text
              and link.status = 'active'
              and lower(coalesce(link.permissions->>'read', 'true')) <> 'false'
          )
        )
    );
$$;

-- Do not revoke authenticated: existing RLS SELECT policy relies on it.
-- Anon cannot satisfy the JWT-subject requirement and should not have EXECUTE.
revoke execute on function public.patient_file_actor_has_patient_access_v1(uuid,uuid,uuid) from public, anon;
grant execute on function public.patient_file_actor_has_patient_access_v1(uuid,uuid,uuid) to authenticated, service_role;
