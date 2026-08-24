-- Therapeutic Plan / Program creation production schema diagnostic.
-- READ ONLY. Does not mutate schema or clinical data.

with required_relations(name) as (
  values
    ('patient_therapeutic_objectives'),
    ('aba_program_templates'),
    ('aba_program_versions'),
    ('aba_program_audit_events'),
    ('patient_therapeutic_plans'),
    ('aba_programs'),
    ('aba_targets')
), relation_state as (
  select
    name,
    to_regclass(format('public.%I', name)) is not null as exists
  from required_relations
), required_columns(table_name, column_name) as (
  values
    -- create_therapeutic_program + current server select contract
    ('aba_programs','organization_id'),
    ('aba_programs','clinic_id'),
    ('aba_programs','patient_id'),
    ('aba_programs','therapeutic_objective_id'),
    ('aba_programs','objective'),
    ('aba_programs','category'),
    ('aba_programs','measurement_type'),
    ('aba_programs','mastery_criteria'),
    ('aba_programs','advanced_settings'),
    ('aba_programs','origin_type'),
    ('aba_programs','origin_id'),
    ('aba_programs','protocol_id'),
    ('aba_programs','protocol_title'),
    ('aba_programs','domain_id'),
    ('aba_programs','domain_name'),
    ('aba_programs','review_due_date'),
    ('aba_programs','responsible_professional_ids'),
    ('aba_programs','version'),
    ('aba_programs','idempotency_key'),
    ('aba_programs','therapeutic_plan_id'),
    ('aba_programs','source_template_id'),
    ('aba_programs','source_template_version'),
    ('aba_programs','activated_at'),
    ('aba_programs','approved_at'),
    ('aba_programs','completed_at'),
    ('aba_targets','organization_id'),
    ('aba_targets','clinic_id'),
    ('aba_targets','patient_id'),
    ('aba_targets','program_id'),
    ('aba_targets','target_type'),
    ('aba_targets','phase'),
    ('aba_targets','sort_order'),
    ('aba_targets','program_version'),
    ('aba_targets','objective_snapshot'),
    ('aba_targets','measurement_type'),
    ('aba_targets','clinical_status'),
    ('patient_therapeutic_plans','id'),
    ('patient_therapeutic_plans','organization_id'),
    ('patient_therapeutic_plans','patient_id'),
    ('patient_therapeutic_plans','responsible_professional_id'),
    ('patient_therapeutic_plans','participant_professional_ids'),
    ('patient_therapeutic_plans','status')
), missing_columns as (
  select rc.table_name, rc.column_name
  from required_columns rc
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = rc.table_name
      and c.column_name = rc.column_name
  )
), function_state as (
  select * from (values
    (
      'create_therapeutic_program',
      to_regprocedure('public.create_therapeutic_program(text,uuid,text,text,text,text,jsonb,jsonb,jsonb,text,text,text,text,text,text,date,text,text,text)') is not null
    ),
    (
      'therapeutic_program_payload',
      to_regprocedure('public.therapeutic_program_payload(text)') is not null
    ),
    (
      'attach_aba_program_scope_v1',
      to_regprocedure('public.attach_aba_program_scope_v1()') is not null
    )
  ) as f(name, exists)
), trigger_state as (
  select exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'aba_programs'
      and t.tgname = 'attach_aba_program_scope_v1'
      and not t.tgisinternal
  ) as attach_scope_trigger_exists
), summary as (
  select
    (select count(*) from relation_state where not exists)::int as missing_relation_count,
    (select count(*) from missing_columns)::int as missing_column_count,
    (select count(*) from function_state where not exists)::int as missing_function_count,
    (select attach_scope_trigger_exists from trigger_state) as attach_scope_trigger_exists
)
select jsonb_build_object(
  'gate', case
    when s.missing_relation_count = 0
     and s.missing_column_count = 0
     and s.missing_function_count = 0
     and s.attach_scope_trigger_exists
      then 'THERAPEUTIC_PLAN_SCHEMA_BASELINE_PRESENT'
    else 'THERAPEUTIC_PLAN_SCHEMA_REPAIR_REQUIRED'
  end,
  'writes', false,
  'relations', (
    select jsonb_object_agg(name, exists order by name)
    from relation_state
  ),
  'functions', (
    select jsonb_object_agg(name, exists order by name)
    from function_state
  ),
  'attach_scope_trigger_exists', s.attach_scope_trigger_exists,
  'missing_columns', coalesce((
    select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name) order by table_name,column_name)
    from missing_columns
  ), '[]'::jsonb),
  'likely_missing_migrations', (
    select jsonb_strip_nulls(jsonb_build_object(
      '20260716160000_therapeutic_plan_programs.sql', case
        when exists (select 1 from relation_state where name in ('patient_therapeutic_objectives','aba_program_templates','aba_program_versions','aba_program_audit_events') and not exists)
          or exists (select 1 from function_state where name in ('create_therapeutic_program','therapeutic_program_payload') and not exists)
          or exists (select 1 from missing_columns where table_name in ('aba_programs','aba_targets') and column_name in (
            'therapeutic_objective_id','objective','category','measurement_type','mastery_criteria','advanced_settings','origin_type','origin_id','domain_id','domain_name','review_due_date','responsible_professional_ids','version','idempotency_key','sort_order','program_version','objective_snapshot'
          ))
        then true else null end,
      '20260728010000_sales_multidisciplinary_commercial_evolution.sql', case
        when exists (select 1 from relation_state where name = 'patient_therapeutic_plans' and not exists)
          or exists (select 1 from missing_columns where table_name = 'aba_programs' and column_name in ('therapeutic_plan_id','source_template_id','source_template_version'))
          or not s.attach_scope_trigger_exists
          or exists (select 1 from function_state where name = 'attach_aba_program_scope_v1' and not exists)
        then true else null end
    ))
  ),
  'note', 'The failed POST is atomic at the database statement level. If program creation failed, the new program/target should not be treated as successfully created.'
) as therapeutic_plan_production_schema_diagnostic
from summary s;
