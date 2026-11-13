-- Amplia o limite de avaliacoes por clinica/parceiro de duas para cinco.
-- Mantem registros imutaveis, autorizacao por clinica e serializacao de escritas.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.verto_partner_marketplace_reviews
  drop constraint if exists verto_partner_marketplace_reviews_review_number_check;
alter table public.verto_partner_marketplace_reviews
  add constraint verto_partner_marketplace_reviews_review_number_check
    check(review_number between 1 and 5);

create or replace function public.verto_marketplace_save_review_v1(
  p_lead_id uuid,p_user_id uuid,p_rating integer,p_comment text
) returns boolean
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_lead record; v_number smallint;
begin
  if p_lead_id is null or p_user_id is null or p_rating not between 1 and 5
    or p_comment is null or char_length(p_comment)>1000 then return false; end if;
  select l.id,l.clinic_id,l.partner_id into v_lead
  from public.verto_partner_marketplace_leads l
  where l.id=p_lead_id
    and l.status in ('active','declined')
    and l.partner_confirmed_at is not null and l.clinic_confirmed_at is not null
    and l.agreed_monthly_cents is not null
    and exists (select 1 from public.clinic_memberships m
      where m.user_id=p_user_id and m.clinic_id=l.clinic_id and m.status='active'
        and m.role in ('director','coordinator'));
  if not found then return false; end if;
  -- Serializa ate cinco avaliacoes concorrentes para a mesma clinica/parceiro.
  perform pg_advisory_xact_lock(hashtextextended(v_lead.clinic_id::text||':'||v_lead.partner_id::text,0));
  select (coalesce(max(review_number),0)+1)::smallint into v_number
    from public.verto_partner_marketplace_reviews
    where clinic_id=v_lead.clinic_id and partner_id=v_lead.partner_id;
  if v_number>5 then return false; end if;
  insert into public.verto_partner_marketplace_reviews
    (lead_id,partner_id,clinic_id,author_id,rating,comment,review_number)
  values (v_lead.id,v_lead.partner_id,v_lead.clinic_id,p_user_id,p_rating,p_comment,v_number);
  return true;
exception when unique_violation then
  return false;
end $$;

revoke all on function public.verto_marketplace_save_review_v1(uuid,uuid,integer,text)
  from public,anon,authenticated;
grant execute on function public.verto_marketplace_save_review_v1(uuid,uuid,integer,text) to service_role;
notify pgrst,'reload schema';
commit;
