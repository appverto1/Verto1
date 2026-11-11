-- Marketplace Verto -> parceiros. Independente das comissoes de indicacao para a Verto.
-- Dados de contato somente apos autorizacao explicita; nenhum dado clinico.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.verto_partner_marketplace_services (
  partner_id uuid primary key references public.verto_partner_accounts(id) on delete restrict,
  service_name text not null check (char_length(btrim(service_name)) between 2 and 120),
  category text not null check (char_length(btrim(category)) between 2 and 70),
  description text not null check (char_length(btrim(description)) between 20 and 2000),
  logo_url text check (logo_url is null or char_length(logo_url) <= 500),
  photo_url text check (photo_url is null or char_length(photo_url) <= 500),
  is_published boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.verto_partner_marketplace_leads (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  partner_id uuid not null references public.verto_partner_accounts(id) on delete restrict,
  requested_by uuid not null references public.users(id) on delete restrict,
  contact_name text not null check (char_length(contact_name) between 2 and 180),
  contact_email text not null check (char_length(contact_email) between 3 and 254),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 32),
  consent_version text not null check (consent_version = 'marketplace-2026-11-v1'),
  consented_at timestamptz not null default now(),
  status text not null default 'interested' check (status in ('interested','awaiting_clinic','active','declined')),
  agreed_monthly_cents bigint check (agreed_monthly_cents between 1 and 100000000),
  partner_confirmed_at timestamptz,
  clinic_confirmed_at timestamptz,
  clinic_confirmed_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, partner_id),
  constraint marketplace_active_requires_mutual_confirmation check (
    status <> 'active' or
    (partner_confirmed_at is not null and clinic_confirmed_at is not null and agreed_monthly_cents is not null)
  )
);
create index if not exists verto_marketplace_leads_partner_idx
  on public.verto_partner_marketplace_leads(partner_id,created_at desc);
create index if not exists verto_marketplace_leads_clinic_idx
  on public.verto_partner_marketplace_leads(clinic_id,created_at desc);

create table if not exists public.verto_partner_marketplace_reviews (
  lead_id uuid primary key references public.verto_partner_marketplace_leads(id) on delete restrict,
  partner_id uuid not null references public.verto_partner_accounts(id) on delete restrict,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  author_id uuid not null references public.users(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists verto_marketplace_reviews_partner_idx
  on public.verto_partner_marketplace_reviews(partner_id,created_at desc);

alter table public.verto_partner_marketplace_services enable row level security;
alter table public.verto_partner_marketplace_leads enable row level security;
alter table public.verto_partner_marketplace_reviews enable row level security;
revoke all on public.verto_partner_marketplace_services from public,anon,authenticated;
revoke all on public.verto_partner_marketplace_leads from public,anon,authenticated;
revoke all on public.verto_partner_marketplace_reviews from public,anon,authenticated;
grant select,insert,update on public.verto_partner_marketplace_services to service_role;
grant select,insert,update on public.verto_partner_marketplace_leads to service_role;
grant select,insert,update on public.verto_partner_marketplace_reviews to service_role;

-- Protecao transacional, mesmo que um endpoint esqueça de validar a membresia.
create or replace function public.verto_marketplace_request_v1(
  p_clinic_id uuid,p_partner_id uuid,p_user_id uuid,p_contact_name text,
  p_contact_email text,p_contact_phone text,p_consent_version text
) returns uuid
language plpgsql security invoker set search_path = pg_catalog,public as $$
declare v_id uuid;
begin
  if p_clinic_id is null or p_partner_id is null or p_user_id is null
    or p_consent_version <> 'marketplace-2026-11-v1'
    or char_length(btrim(coalesce(p_contact_name,''))) not between 2 and 180
    or char_length(btrim(coalesce(p_contact_email,''))) not between 3 and 254
    or char_length(coalesce(p_contact_phone,''))>32
    or not exists (
      select 1 from public.clinic_memberships m
      where m.user_id=p_user_id and m.clinic_id=p_clinic_id
        and m.status='active' and m.role in ('director','coordinator')
    ) or not exists (
      select 1 from public.verto_partner_accounts p
      join public.verto_partner_marketplace_services s on s.partner_id=p.id
      where p.id=p_partner_id and p.status='approved'
        and p.compliance_approved is true and s.is_published is true
    )
  then return null; end if;

  insert into public.verto_partner_marketplace_leads
    (clinic_id,partner_id,requested_by,contact_name,contact_email,contact_phone,consent_version)
  values (p_clinic_id,p_partner_id,p_user_id,btrim(p_contact_name),
          lower(btrim(p_contact_email)),nullif(btrim(coalesce(p_contact_phone,'')),''),p_consent_version)
  on conflict(clinic_id,partner_id) do nothing returning id into v_id;
  if v_id is not null then return v_id; end if;
  -- Exact same request is idempotent, but other attempts cannot overwrite consent.
  select id into v_id from public.verto_partner_marketplace_leads
    where clinic_id=p_clinic_id and partner_id=p_partner_id and requested_by=p_user_id
      and consent_version=p_consent_version and status='interested';
  return v_id;
end $$;

create or replace function public.verto_marketplace_partner_confirm_v1(
  p_lead_id uuid,p_partner_id uuid,p_monthly_cents bigint
) returns boolean
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_id uuid;
begin
  if p_lead_id is null or p_partner_id is null or p_monthly_cents not between 1 and 100000000
    or not exists(select 1 from public.verto_partner_accounts p where p.id=p_partner_id
      and p.status='approved' and p.compliance_approved is true)
  then return false; end if;
  update public.verto_partner_marketplace_leads
    set status='awaiting_clinic',agreed_monthly_cents=p_monthly_cents,
        partner_confirmed_at=now(),updated_at=now()
    where id=p_lead_id and partner_id=p_partner_id and status='interested'
    returning id into v_id;
  return v_id is not null;
end $$;

create or replace function public.verto_marketplace_clinic_confirm_v1(
  p_lead_id uuid,p_clinic_id uuid,p_user_id uuid
) returns boolean
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_id uuid;
begin
  if p_lead_id is null or p_clinic_id is null or p_user_id is null
    or not exists (
      select 1 from public.clinic_memberships m
      where m.user_id=p_user_id and m.clinic_id=p_clinic_id and m.status='active'
        and m.role in ('director','coordinator')
    ) then return false; end if;
  update public.verto_partner_marketplace_leads
    set status='active',clinic_confirmed_at=now(),clinic_confirmed_by=p_user_id,updated_at=now()
    where id=p_lead_id and clinic_id=p_clinic_id and status='awaiting_clinic'
      and agreed_monthly_cents is not null and partner_confirmed_at is not null
      and exists(select 1 from public.verto_partner_accounts p
        where p.id=partner_id and p.status='approved' and p.compliance_approved is true)
    returning id into v_id;
  return v_id is not null;
end $$;

create or replace function public.verto_marketplace_save_review_v1(
  p_lead_id uuid,p_user_id uuid,p_rating integer,p_comment text
) returns boolean
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_lead record;v_id uuid;
begin
  if p_lead_id is null or p_user_id is null or p_rating not between 1 and 5
    or p_comment is null or char_length(p_comment)>1000 then return false; end if;
  select l.id,l.clinic_id,l.partner_id into v_lead
  from public.verto_partner_marketplace_leads l
  where l.id=p_lead_id and l.status='active'
    and exists (select 1 from public.clinic_memberships m
      where m.user_id=p_user_id and m.clinic_id=l.clinic_id and m.status='active'
        and m.role in ('director','coordinator'));
  if not found then return false; end if;
  insert into public.verto_partner_marketplace_reviews
    (lead_id,partner_id,clinic_id,author_id,rating,comment)
  values (p_lead_id,v_lead.partner_id,v_lead.clinic_id,p_user_id,p_rating,p_comment)
  on conflict(lead_id) do update
    set rating=excluded.rating,comment=excluded.comment,updated_at=now()
    where public.verto_partner_marketplace_reviews.author_id=excluded.author_id
  returning lead_id into v_id;
  return v_id is not null;
end $$;

revoke all on function public.verto_marketplace_request_v1(uuid,uuid,uuid,text,text,text,text)
  from public,anon,authenticated;
revoke all on function public.verto_marketplace_partner_confirm_v1(uuid,uuid,bigint)
  from public,anon,authenticated;
revoke all on function public.verto_marketplace_clinic_confirm_v1(uuid,uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.verto_marketplace_save_review_v1(uuid,uuid,integer,text)
  from public,anon,authenticated;
grant execute on function public.verto_marketplace_request_v1(uuid,uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.verto_marketplace_partner_confirm_v1(uuid,uuid,bigint) to service_role;
grant execute on function public.verto_marketplace_clinic_confirm_v1(uuid,uuid,uuid) to service_role;
grant execute on function public.verto_marketplace_save_review_v1(uuid,uuid,integer,text) to service_role;

comment on table public.verto_partner_marketplace_leads is
  'CRM B2B Verto-to-partner, requires explicit contact consent. No medical or patient data.';
notify pgrst,'reload schema';
commit;
