-- Issue #208 — forward-fix privilege hardening for patient-scoped ABA reinforcers v1.
-- Keep trigger/helper functions out of the exposed RPC surface; server-owned RPCs remain service_role-only.

begin;

revoke all on function public.aba_reinforcer_actor_can_read_v1(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.aba_reinforcer_actor_can_write_v1(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.aba_reinforcer_actor_can_read_v1(uuid,uuid,uuid) to service_role;
grant execute on function public.aba_reinforcer_actor_can_write_v1(uuid,uuid,uuid) to service_role;

revoke all on function public.guard_aba_patient_reinforcer_v1() from public, anon, authenticated;
revoke all on function public.guard_aba_reinforcer_delivery_append_only_v1() from public, anon, authenticated;
revoke all on function public.validate_aba_reinforcer_delivery_insert_v1() from public, anon, authenticated;

commit;
