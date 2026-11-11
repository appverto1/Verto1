-- Parcerias: avaliacoes imutaveis (maximo duas por clinica/parceiro), historico
-- apos encerramento e imagens privadas de ate 10 MiB.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.verto_partner_marketplace_reviews
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists review_number smallint default 1;
update public.verto_partner_marketplace_reviews
  set id=coalesce(id,gen_random_uuid()), review_number=coalesce(review_number,1)
  where id is null or review_number is null;
alter table public.verto_partner_marketplace_reviews
  alter column id set not null,
  alter column review_number set not null;
alter table public.verto_partner_marketplace_reviews
  drop constraint if exists verto_partner_marketplace_reviews_pkey;
alter table public.verto_partner_marketplace_reviews
  add constraint verto_partner_marketplace_reviews_pkey primary key(id),
  add constraint verto_partner_marketplace_reviews_review_number_check check(review_number in (1,2)),
  add constraint verto_partner_marketplace_reviews_clinic_partner_number_key unique(clinic_id,partner_id,review_number);
create index if not exists verto_marketplace_reviews_partner_idx
  on public.verto_partner_marketplace_reviews(partner_id,created_at desc);
create index if not exists verto_marketplace_reviews_lead_idx
  on public.verto_partner_marketplace_reviews(lead_id,created_at desc);

create or replace function public.verto_marketplace_reviews_immutable_v1()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public as $$
begin
  raise exception 'PARTNER_REVIEW_IMMUTABLE' using errcode='23514';
end $$;
drop trigger if exists verto_marketplace_reviews_immutable on public.verto_partner_marketplace_reviews;
create trigger verto_marketplace_reviews_immutable before update or delete
  on public.verto_partner_marketplace_reviews for each row
  execute function public.verto_marketplace_reviews_immutable_v1();

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
  -- Serializa duas avaliacoes concorrentes para a mesma clinica/parceiro.
  perform pg_advisory_xact_lock(hashtextextended(v_lead.clinic_id::text||':'||v_lead.partner_id::text,0));
  select (coalesce(max(review_number),0)+1)::smallint into v_number
    from public.verto_partner_marketplace_reviews
    where clinic_id=v_lead.clinic_id and partner_id=v_lead.partner_id;
  if v_number>2 then return false; end if;
  insert into public.verto_partner_marketplace_reviews
    (lead_id,partner_id,clinic_id,author_id,rating,comment,review_number)
  values (v_lead.id,v_lead.partner_id,v_lead.clinic_id,p_user_id,p_rating,p_comment,v_number);
  return true;
exception when unique_violation then
  return false;
end $$;

revoke all on function public.verto_marketplace_reviews_immutable_v1() from public,anon,authenticated;
revoke all on function public.verto_marketplace_save_review_v1(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.verto_marketplace_save_review_v1(uuid,uuid,integer,text) to service_role;
revoke update,delete on public.verto_partner_marketplace_reviews from service_role;

-- Conteudo da vitrine e privado; URLs assinadas apenas para clinicas autorizadas.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('verto-partner-images','verto-partner-images',false,10485760,
       array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
notify pgrst,'reload schema';
commit;
