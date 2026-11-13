-- Contract confirmation records the agreement, never the negotiated service price.
-- Existing monetary history is preserved; no data cleanup or invoice generation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.verto_partner_marketplace_leads
  drop constraint marketplace_active_requires_mutual_confirmation,
  add constraint marketplace_active_requires_mutual_confirmation
  check (status <> 'active'
    or (partner_confirmed_at is not null and clinic_confirmed_at is not null));

-- New signature keeps the old 3-arg RPC functional during deployment,
-- but the new endpoint cannot accept or save a deal amount.
create function public.verto_marketplace_partner_confirm_no_price_v1(
  p_lead_id uuid, p_partner_id uuid
) returns boolean
language plpgsql security invoker
set search_path = pg_catalog, public
as $function$
declare v_id uuid;
begin
  if p_lead_id is null or p_partner_id is null
    or not exists (
      select 1 from public.verto_partner_accounts p
      where p.id = p_partner_id
        and p.status = 'approved' and p.compliance_approved is true
    ) then return false; end if;

  update public.verto_partner_marketplace_leads
    set status = 'awaiting_clinic', partner_confirmed_at = now(), updated_at = now()
    where id = p_lead_id and partner_id = p_partner_id and status = 'interested'
    returning id into v_id;
  return v_id is not null;
end $function$;

revoke all on function public.verto_marketplace_partner_confirm_no_price_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.verto_marketplace_partner_confirm_no_price_v1(uuid,uuid)
  to service_role;

-- The clinic still independently confirms the same partner/lead under its
-- canonical active director/coordinator membership.
create or replace function public.verto_marketplace_clinic_confirm_v1(
  p_lead_id uuid, p_clinic_id uuid, p_user_id uuid
) returns boolean
language plpgsql security invoker
set search_path = pg_catalog, public
as $function$
declare v_id uuid;
begin
  if p_lead_id is null or p_clinic_id is null or p_user_id is null
    or not exists (
      select 1 from public.clinic_memberships m
      where m.user_id = p_user_id and m.clinic_id = p_clinic_id
        and m.status = 'active' and m.role in ('director','coordinator')
    ) then return false; end if;

  update public.verto_partner_marketplace_leads
    set status = 'active', clinic_confirmed_at = now(),
        clinic_confirmed_by = p_user_id, updated_at = now()
    where id = p_lead_id and clinic_id = p_clinic_id
      and status = 'awaiting_clinic' and partner_confirmed_at is not null
      and exists (
        select 1 from public.verto_partner_accounts p
        where p.id = partner_id and p.status = 'approved'
          and p.compliance_approved is true
      )
    returning id into v_id;
  return v_id is not null;
end $function$;

-- Only the monetary precondition changes: contract verification,
-- clinic roles, serialization and the max-two-review constraint remain.
create or replace function public.verto_marketplace_save_review_v1(
  p_lead_id uuid, p_user_id uuid, p_rating integer, p_comment text
) returns boolean
language plpgsql security invoker
set search_path = pg_catalog, public
as $function$
declare v_lead record; v_number smallint;
begin
  if p_lead_id is null or p_user_id is null or p_rating not between 1 and 5
    or p_comment is null or char_length(p_comment)>1000 then return false; end if;

  select l.id,l.clinic_id,l.partner_id into v_lead
  from public.verto_partner_marketplace_leads l
  where l.id = p_lead_id
    and l.status in ('active','declined')
    and l.partner_confirmed_at is not null and l.clinic_confirmed_at is not null
    and exists (
      select 1 from public.clinic_memberships m
      where m.user_id = p_user_id and m.clinic_id = l.clinic_id
        and m.status = 'active' and m.role in ('director','coordinator')
    );
  if not found then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_lead.clinic_id::text||':'||v_lead.partner_id::text,0));
  select (coalesce(max(review_number),0)+1)::smallint into v_number
    from public.verto_partner_marketplace_reviews
    where clinic_id = v_lead.clinic_id and partner_id = v_lead.partner_id;
  if v_number > 2 then return false; end if;

  insert into public.verto_partner_marketplace_reviews
    (lead_id,partner_id,clinic_id,author_id,rating,comment,review_number)
  values (v_lead.id,v_lead.partner_id,v_lead.clinic_id,
    p_user_id,p_rating,p_comment,v_number);
  return true;
exception when unique_violation then
  return false;
end $function$;

-- Existing function grants are intentionally preserved by CREATE OR REPLACE.
notify pgrst, 'reload schema';
commit;
