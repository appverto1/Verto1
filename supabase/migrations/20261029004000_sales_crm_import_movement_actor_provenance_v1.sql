-- Preserve source actor provenance for historical Kanban movements imported
-- from staging into production without creating/changing Auth users.
-- No patient, clinic, billing, Stripe, or auth records are updated.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
begin
  -- This private mapping table is created only where the isolated CRM
  -- import compatibility migration has been applied.
  if to_regclass('public.sales_crm_import_actor_refs') is not null then
    alter table public.sales_crm_import_actor_refs
      drop constraint if exists sales_crm_import_actor_refs_source_table_check;
    alter table public.sales_crm_import_actor_refs
      add constraint sales_crm_import_actor_refs_source_table_check
      check (source_table in
        ('sales_prospecting_attempts','sales_script_versions',
         'sales_lead_acquisition_channels','sales_kanban_movements'));
  end if;
end $migration$;
commit;
