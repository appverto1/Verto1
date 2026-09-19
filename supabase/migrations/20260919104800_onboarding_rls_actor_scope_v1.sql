-- Verto #211 follow-up: keep actor-id capability helper server-only.
-- Authenticated RLS callers receive only a current-session predicate.

begin;

revoke all on function public.onboarding_actor_can_respond_v1(uuid, uuid) from authenticated;
grant execute on function public.onboarding_actor_can_respond_v1(uuid, uuid) to service_role;

create or replace function public.onboarding_current_actor_can_respond_v1(
  p_clinic_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select public.onboarding_actor_can_respond_v1(auth.uid(), p_clinic_id);
$$;

revoke all on function public.onboarding_current_actor_can_respond_v1(uuid) from public, anon;
grant execute on function public.onboarding_current_actor_can_respond_v1(uuid) to authenticated, service_role;

drop policy if exists onboarding_publications_select on public.onboarding_publications;
create policy onboarding_publications_select on public.onboarding_publications
  for select to authenticated using (
    public.is_platform_sales_admin()
    or public.onboarding_current_actor_can_respond_v1(clinic_id)
  );

drop policy if exists onboarding_slots_select on public.onboarding_slots;
create policy onboarding_slots_select on public.onboarding_slots
  for select to authenticated using (
    public.is_platform_sales_admin()
    or exists (
      select 1
      from public.onboarding_publications publication
      where publication.id = onboarding_slots.publication_id
        and public.onboarding_current_actor_can_respond_v1(publication.clinic_id)
    )
  );

drop policy if exists onboarding_responses_select on public.onboarding_responses;
create policy onboarding_responses_select on public.onboarding_responses
  for select to authenticated using (
    public.is_platform_sales_admin()
    or public.onboarding_current_actor_can_respond_v1(clinic_id)
  );

notify pgrst, 'reload schema';

commit;
