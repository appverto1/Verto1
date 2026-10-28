-- Production-only compatibility for the owner-entered CRM leads of staging.
-- Public leads retain mandatory, factual consent evidence. No fabricated consent timestamps.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table public.sales_leads alter column contact_consent_at drop not null;
alter table public.sales_leads add constraint sales_leads_consent_required_except_owner_manual_v1
 check (
   contact_consent_at is not null
   or (acquisition_channel='manual_kanban'
       and contact_consent_origin='owner_manual_no_consent'
       and contact_consent_version='not_collected')
 );

create table public.sales_crm_import_lead_map (
 source_environment text not null default 'staging'
    check (source_environment='staging'),
 source_lead_id uuid not null,
 target_lead_id uuid not null references public.sales_leads(id),
 source_phone_conflict boolean not null default false,
 source_status text,
 source_conflict_snapshot jsonb,
 source_hidden boolean not null default false,
 source_deleted boolean not null default false,
 source_converted_user_id uuid,
 source_converted_clinic_id uuid,
 source_updated_at timestamptz,
 imported_at timestamptz not null default clock_timestamp(),
 primary key(source_environment,source_lead_id)
);
create index sales_crm_import_lead_map_target_idx on public.sales_crm_import_lead_map(target_lead_id);
alter table public.sales_crm_import_lead_map enable row level security;
revoke all on public.sales_crm_import_lead_map from public,anon,authenticated;
grant select,insert,update on public.sales_crm_import_lead_map to service_role;

-- Prevent unprivileged clients from inferring import identities via direct SQL.
-- The bridge is for deterministic operator reconciliation and is never used as
-- financial/customer identity authority.
notify pgrst,'reload schema';
commit;
