-- Reconcile the already-homologated production CRM consent contract in Staging.
-- Production already has this constraint. The guard prevents duplicate DDL
-- if this migration is ever included in a future release to Main.
-- Do NOT copy production-only sales_crm_import_* tables or import records.
--
-- Staging application recorded as migration 20261116205810.
-- The initial Staging execution used the same ALTER TABLE without this
-- portability guard because preflight confirmed the constraint was absent.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.sales_leads'::regclass
       and conname = 'sales_leads_consent_required_except_owner_manual_v1'
  ) then
    alter table public.sales_leads
      add constraint sales_leads_consent_required_except_owner_manual_v1
      check (
        contact_consent_at is not null
        or (
          acquisition_channel = 'manual_kanban'
          and contact_consent_origin = 'owner_manual_no_consent'
          and contact_consent_version = 'not_collected'
        )
      );
  end if;
end
$$;

commit;
