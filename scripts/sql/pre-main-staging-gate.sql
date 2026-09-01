-- Verto pre-main staging gate (READ-ONLY against persistent application data).
-- Creates only a temporary table for this SQL session. No clinical rows mutate.

create temp table if not exists _verto_pre_main_gate (
  check_name text primary key,
  status text not null check (status in ('PASS','FAIL','WARN')),
  detail text not null default ''
) on commit preserve rows;

truncate table _verto_pre_main_gate;

do $gate$
declare
  v_count bigint := 0;
  v_missing text[] := '{}'::text[];
  v_version text;
  v_required_versions text[] := array[
    '20260826143000',
    '20260826152500',
    '20260826154500',
    '20260826174500',
    '20260826183000',
    '20260826190000',
    '20260826200000',
    '20260826211500'
  ];
  v_function text;
  v_required_functions text[] := array[
    'therapeutic_patient_actor_has_link_permission_v1',
    'therapeutic_plan_current_actor_can_access_v2',
    'create_patient_pts_draft_v2',
    'save_patient_pts_draft_v2',
    'activate_patient_pts_draft_v3',
    'bind_patient_pts_collection_contexts_v1',
    'resolve_patient_pts_plan_version_v1',
    'patient_case_team_actor_can_manage_v1',
    'end_patient_professional_link_v1'
  ];
begin
  -- Required tables.
  insert into _verto_pre_main_gate values
    ('table: patient_pts_documents_v2', case when to_regclass('public.patient_pts_documents_v2') is not null then 'PASS' else 'FAIL' end, ''),
    ('table: patient_pts_versions_v2', case when to_regclass('public.patient_pts_versions_v2') is not null then 'PASS' else 'FAIL' end, ''),
    ('table: patient_pts_events_v2', case when to_regclass('public.patient_pts_events_v2') is not null then 'PASS' else 'FAIL' end, ''),
    ('table: patient_pts_collection_contexts_v1', case when to_regclass('public.patient_pts_collection_contexts_v1') is not null then 'PASS' else 'FAIL' end, ''),
    ('table: patient_professional_links', case when to_regclass('public.patient_professional_links') is not null then 'PASS' else 'FAIL' end, ''),
    ('table: clinical_supervision_links', case when to_regclass('public.clinical_supervision_links') is not null then 'PASS' else 'FAIL' end, ''),
    ('table: aba_sessions', case when to_regclass('public.aba_sessions') is not null then 'PASS' else 'FAIL' end, ''),
    ('table: clinics', case when to_regclass('public.clinics') is not null then 'PASS' else 'FAIL' end, '')
  on conflict (check_name) do update set status = excluded.status, detail = excluded.detail;

  -- Required functions: name check is intentional; signatures evolved additively.
  foreach v_function in array v_required_functions loop
    select count(*) into v_count
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
    where ns.nspname = 'public' and proc.proname = v_function;

    insert into _verto_pre_main_gate(check_name, status, detail)
    values (
      'function: ' || v_function,
      case when v_count > 0 then 'PASS' else 'FAIL' end,
      case when v_count > 0 then '' else 'função ausente' end
    )
    on conflict (check_name) do update set status = excluded.status, detail = excluded.detail;
  end loop;

  -- Required columns added by this release train.
  insert into _verto_pre_main_gate(check_name, status, detail)
  select 'column: clinics.timezone',
         case when exists (
           select 1 from information_schema.columns
           where table_schema='public' and table_name='clinics' and column_name='timezone'
         ) then 'PASS' else 'FAIL' end,
         ''
  on conflict (check_name) do update set status = excluded.status, detail = excluded.detail;

  insert into _verto_pre_main_gate(check_name, status, detail)
  select 'column: aba_sessions.therapeutic_plan_id',
         case when exists (
           select 1 from information_schema.columns
           where table_schema='public' and table_name='aba_sessions' and column_name='therapeutic_plan_id'
         ) then 'PASS' else 'FAIL' end,
         ''
  on conflict (check_name) do update set status = excluded.status, detail = excluded.detail;

  insert into _verto_pre_main_gate(check_name, status, detail)
  select 'column: patient_pts_collection_contexts_v1.specialty_plan_id',
         case when exists (
           select 1 from information_schema.columns
           where table_schema='public' and table_name='patient_pts_collection_contexts_v1' and column_name='specialty_plan_id'
         ) then 'PASS' else 'FAIL' end,
         ''
  on conflict (check_name) do update set status = excluded.status, detail = excluded.detail;

  insert into _verto_pre_main_gate(check_name, status, detail)
  select 'column: patients.therapist_id nullable',
         case when exists (
           select 1 from information_schema.columns
           where table_schema='public'
             and table_name='patients'
             and column_name='therapist_id'
             and is_nullable='YES'
         ) then 'PASS' else 'FAIL' end,
         case when exists (
           select 1 from information_schema.columns
           where table_schema='public'
             and table_name='patients'
             and column_name='therapist_id'
             and is_nullable='YES'
         ) then '' else 'patients.therapist_id ainda está NOT NULL e bloqueia a remoção do responsável primário' end
  on conflict (check_name) do update set status = excluded.status, detail = excluded.detail;

  -- Migration history, when available in a Supabase-managed database.
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    foreach v_version in array v_required_versions loop
      execute 'select count(*) from supabase_migrations.schema_migrations where version = $1'
        into v_count using v_version;
      if v_count = 0 then
        v_missing := array_append(v_missing, v_version);
      end if;
    end loop;
    insert into _verto_pre_main_gate(check_name, status, detail)
    values (
      'migration history: release train',
      case when cardinality(v_missing)=0 then 'PASS' else 'FAIL' end,
      case when cardinality(v_missing)=0 then '' else 'faltando: ' || array_to_string(v_missing, ', ') end
    )
    on conflict (check_name) do update set status=excluded.status, detail=excluded.detail;
  else
    insert into _verto_pre_main_gate(check_name, status, detail)
    values ('migration history: release train','WARN','supabase_migrations.schema_migrations não está visível neste contexto')
    on conflict (check_name) do update set status=excluded.status, detail=excluded.detail;
  end if;

  -- Data invariants are checked only when the backing relations exist.
  if to_regclass('public.patient_pts_versions_v2') is not null then
    execute $sql$
      select count(*) from (
        select document_id
        from public.patient_pts_versions_v2
        where lifecycle_status='ACTIVE'
        group by document_id
        having count(*) > 1
      ) duplicated
    $sql$ into v_count;
    insert into _verto_pre_main_gate values
      ('invariant: at most one ACTIVE PTS per document', case when v_count=0 then 'PASS' else 'FAIL' end, v_count || ' documento(s) inválido(s)')
    on conflict (check_name) do update set status=excluded.status, detail=excluded.detail;

    execute $sql$
      select count(*) from (
        select document_id
        from public.patient_pts_versions_v2
        where lifecycle_status='DRAFT'
        group by document_id
        having count(*) > 1
      ) duplicated
    $sql$ into v_count;
    insert into _verto_pre_main_gate values
      ('invariant: at most one DRAFT PTS per document', case when v_count=0 then 'PASS' else 'FAIL' end, v_count || ' documento(s) inválido(s)')
    on conflict (check_name) do update set status=excluded.status, detail=excluded.detail;
  end if;

  if to_regclass('public.patient_pts_documents_v2') is not null
     and to_regclass('public.patient_pts_versions_v2') is not null then
    execute $sql$
      select count(*)
      from public.patient_pts_documents_v2 document
      where document.active_version_id is not null
        and not exists (
          select 1
          from public.patient_pts_versions_v2 version
          where version.id = document.active_version_id
            and version.document_id = document.id
            and version.lifecycle_status = 'ACTIVE'
        )
    $sql$ into v_count;
    insert into _verto_pre_main_gate values
      ('invariant: PTS active_version_id points to ACTIVE version', case when v_count=0 then 'PASS' else 'FAIL' end, v_count || ' documento(s) inválido(s)')
    on conflict (check_name) do update set status=excluded.status, detail=excluded.detail;
  end if;

  if to_regclass('public.clinics') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='clinics' and column_name='timezone'
     ) then
    execute $sql$
      select count(*)
      from public.clinics clinic
      where nullif(btrim(clinic.timezone), '') is null
         or not exists (
           select 1 from pg_catalog.pg_timezone_names zone
           where zone.name = btrim(clinic.timezone)
         )
    $sql$ into v_count;
    insert into _verto_pre_main_gate values
      ('invariant: clinic timezone is valid IANA', case when v_count=0 then 'PASS' else 'FAIL' end, v_count || ' clínica(s) inválida(s)')
    on conflict (check_name) do update set status=excluded.status, detail=excluded.detail;
  end if;

  if to_regclass('public.patient_professional_links') is not null then
    execute $sql$
      select count(*) from (
        select patient_id, professional_id
        from public.patient_professional_links
        where status='active'
        group by patient_id, professional_id
        having count(*) > 1
      ) duplicated
    $sql$ into v_count;
    insert into _verto_pre_main_gate values
      ('invariant: no duplicate active professional link per patient', case when v_count=0 then 'PASS' else 'FAIL' end, v_count || ' vínculo(s) duplicado(s)')
    on conflict (check_name) do update set status=excluded.status, detail=excluded.detail;

    execute $sql$
      select count(*) from (
        select patient_id
        from public.patient_professional_links
        where status='active' and relationship_type='primary'
        group by patient_id
        having count(*) > 1
      ) duplicated
    $sql$ into v_count;
    insert into _verto_pre_main_gate values
      ('invariant: at most one primary professional per patient', case when v_count=0 then 'PASS' else 'FAIL' end, v_count || ' paciente(s) inválido(s)')
    on conflict (check_name) do update set status=excluded.status, detail=excluded.detail;
  end if;

  if to_regclass('public.aba_sessions') is not null
     and to_regclass('public.patient_therapeutic_plans') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='aba_sessions' and column_name='therapeutic_plan_id'
     ) then
    execute $sql$
      select count(*)
      from public.aba_sessions session
      join public.patient_therapeutic_plans plan on plan.id = session.therapeutic_plan_id
      where session.therapeutic_plan_id is not null
        and (
          plan.patient_id is distinct from session.patient_id
          or plan.clinic_id is distinct from session.clinic_id
          or plan.mode = 'interdisciplinary'
        )
    $sql$ into v_count;
    insert into _verto_pre_main_gate values
      ('invariant: session specialty-plan binding scope', case when v_count=0 then 'PASS' else 'FAIL' end, v_count || ' sessão(ões) inválida(s)')
    on conflict (check_name) do update set status=excluded.status, detail=excluded.detail;
  end if;
end;
$gate$;

select check_name, status, detail
from _verto_pre_main_gate
order by
  case status when 'FAIL' then 0 when 'WARN' then 1 else 2 end,
  check_name;

select jsonb_build_object(
  'gate', case when count(*) filter (where status='FAIL') = 0 then 'PASS' else 'FAIL' end,
  'failures', count(*) filter (where status='FAIL'),
  'warnings', count(*) filter (where status='WARN'),
  'passes', count(*) filter (where status='PASS')
) as pre_main_summary
from _verto_pre_main_gate;
