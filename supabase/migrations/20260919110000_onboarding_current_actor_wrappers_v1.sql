-- Verto #211 integration wrappers: derive tenant actor from the authenticated DB session.

begin;

create or replace function public.submit_onboarding_response_current_v1(
  p_publication_id uuid,
  p_slot_id uuid,
  p_participants text[],
  p_idempotency_key text
)
returns table (
  response_id uuid,
  publication_id uuid,
  slot_id uuid,
  clinic_id uuid,
  participants text[],
  responded_at timestamptz,
  admin_ack_at timestamptz
)
language sql
volatile
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select *
  from public.submit_onboarding_response_v1(
    p_publication_id,
    p_slot_id,
    p_participants,
    p_idempotency_key,
    auth.uid()
  );
$$;

revoke all on function public.submit_onboarding_response_current_v1(uuid, uuid, text[], text) from public, anon;
grant execute on function public.submit_onboarding_response_current_v1(uuid, uuid, text[], text) to authenticated;

create or replace function public.mark_onboarding_viewed_current_v1(
  p_publication_id uuid
)
returns table (publication_id uuid, status text, viewed_at timestamptz)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_clinic_id uuid;
  v_status text;
  v_viewed_at timestamptz;
begin
  select publication.clinic_id, publication.status, publication.viewed_at
  into v_clinic_id, v_status, v_viewed_at
  from public.onboarding_publications publication
  where publication.id = p_publication_id
  for update;

  if not found then
    raise exception 'ONBOARDING_PUBLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not public.onboarding_actor_can_respond_v1(auth.uid(), v_clinic_id) then
    raise exception 'ONBOARDING_FORBIDDEN' using errcode = '42501';
  end if;

  if v_status = 'published' then
    update public.onboarding_publications publication
    set status = 'viewed', viewed_at = coalesce(publication.viewed_at, now())
    where publication.id = p_publication_id
    returning publication.status, publication.viewed_at into v_status, v_viewed_at;
  end if;

  return query select p_publication_id, v_status, v_viewed_at;
end;
$$;

revoke all on function public.mark_onboarding_viewed_current_v1(uuid) from public, anon;
grant execute on function public.mark_onboarding_viewed_current_v1(uuid) to authenticated;

create or replace function public.ack_onboarding_response_current_v1(
  p_response_id uuid
)
returns table (response_id uuid, admin_ack_at timestamptz, admin_ack_by uuid)
language sql
volatile
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
  select * from public.ack_onboarding_response_v1(p_response_id, auth.uid());
$$;

revoke all on function public.ack_onboarding_response_current_v1(uuid) from public, anon;
grant execute on function public.ack_onboarding_response_current_v1(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
