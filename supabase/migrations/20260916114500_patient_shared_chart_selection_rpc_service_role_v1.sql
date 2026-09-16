-- Issue #171 hardening: mutations must pass the server capability gate.
-- Authenticated clients may read rows allowed by RLS, but cannot invoke mutation RPCs directly.

revoke execute on function public.set_patient_shared_chart_selection_v1(uuid, uuid, text, text, integer, jsonb) from authenticated;
revoke execute on function public.clear_patient_shared_chart_selection_v1(uuid, uuid) from authenticated;

grant execute on function public.set_patient_shared_chart_selection_v1(uuid, uuid, text, text, integer, jsonb) to service_role;
grant execute on function public.clear_patient_shared_chart_selection_v1(uuid, uuid) to service_role;
