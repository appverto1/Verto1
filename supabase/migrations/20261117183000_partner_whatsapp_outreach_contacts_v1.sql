-- Partner outreach drafts. These contacts are not sales leads or referral attributions.
-- A contact becomes a commission-eligible referral ONLY after the existing public-interest flow.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table if not exists public.verto_partner_whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.verto_partner_accounts(id) on delete restrict,
  clinic_name text not null check (char_length(btrim(clinic_name)) between 2 and 180),
  phone_e164 text not null check (phone_e164 ~ '^55[1-9][0-9][2-9][0-9]{7,8}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint verto_partner_whatsapp_contact_unique unique(partner_id,phone_e164)
);
create index if not exists verto_partner_whatsapp_contacts_recent_idx
  on public.verto_partner_whatsapp_contacts(partner_id,created_at desc);
alter table public.verto_partner_whatsapp_contacts enable row level security;
revoke all on public.verto_partner_whatsapp_contacts from public,anon,authenticated;
grant select,insert,update on public.verto_partner_whatsapp_contacts to service_role;
comment on table public.verto_partner_whatsapp_contacts is
  'Partner-owned commercial contact drafts only; cannot create leads, claim attribution, or imply a sent WhatsApp.';
notify pgrst, 'reload schema';
commit;
