import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261115222728_ia05_restrict_anon_helpers_and_table_trigger_grants.sql'), 'utf8');
const rpcNames = [
  "is_admin_or_owner",
  "is_platform_sales_admin",
  "patient_file_current_actor_can_read_v1",
  "school_actor_can_access_patient",
  "school_actor_has_role",
  "therapeutic_plan_version_current_actor_can_read_v1",
  "therapeutic_program_row_actor_can_access_v1"
];
const tableNames = [
  "aba_behavior_events",
  "aba_clinical_recommendation_audit_logs",
  "aba_interval_summaries",
  "aba_maintenance_probe_results",
  "aba_maintenance_schedules",
  "aba_regression_alerts",
  "aba_sessions",
  "aba_target_status_audit_logs",
  "aba_targets",
  "aba_trials",
  "appointments",
  "clinics",
  "patient_files",
  "patient_therapeutic_plans",
  "payment_appointment_items",
  "payment_audit_events",
  "payment_transactions",
  "payments"
];
const protectedRlsHelpers = ['can_access_clinic','can_manage_clinic','is_platform_admin'];

test('IA-05 restricts exactly seven anon callable SECDEF helpers, preserves authenticated', () => {
  assert.equal(rpcNames.length, 7);
  assert.equal(new Set(rpcNames).size, 7);
  for (const name of rpcNames) {
    assert.match(sql, new RegExp("'"+name+"'"));
  }
  for (const name of protectedRlsHelpers) {
    assert.ok(!rpcNames.includes(name), name+' depends on public-scoped RLS');
  }
  assert.match(sql, /IA05_ANON_SECDEF_BASELINE_DRIFT/);
  assert.match(sql, /IA05_PUBLIC_RLS_DEPENDENCY/);
  assert.match(sql, /IA05_INVOKER_OR_VIEW_DEPENDENCY/);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.%I\(%s\) FROM PUBLIC, anon/);
  assert.match(sql, /has_function_privilege\('authenticated',v_oid,'EXECUTE'\)/);
  assert.match(sql, /has_function_privilege\('service_role',v_oid,'EXECUTE'\)/);
});

test('IA-05 restricts TRIGGER privilege on exact reviewed eighteen existing tables', () => {
  assert.equal(tableNames.length,18);
  assert.equal(new Set(tableNames).size,18);
  for (const name of tableNames) assert.match(sql,new RegExp("'"+name+"'"));
  assert.match(sql,/REVOKE TRIGGER ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/pg_catalog\.pg_trigger t/);
  assert.match(sql,/IA05_TABLE_TRIGGER_BASELINE_DRIFT/);
  assert.match(sql,/IA05_TABLE_ACL_VERIFICATION_FAILED/);
});

test('IA-05 modifies ACL only: no RLS, trigger, function definitions, records or payment changes', () => {
  const executable=sql.replace(/--[^\n]*/g,'');
  assert.doesNotMatch(executable,/\b(?:CREATE|ALTER|DROP)\s+(?:OR REPLACE\s+)?(?:FUNCTION|TRIGGER|TABLE|POLICY)\b/i);
  assert.doesNotMatch(executable,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?public\./i);
  assert.doesNotMatch(executable,/\b(?:DISABLE|ENABLE)\s+ROW\s+LEVEL\s+SECURITY\b/i);
  assert.doesNotMatch(executable,/REVOKE (?:ALL|SELECT|INSERT|UPDATE|DELETE) ON TABLE/i);
});

test('IA-05 PostgreSQL: revoking TRIGGER blocks privilege while existing trigger still runs', {
  skip: process.env.VERTO_IA05_POSTGRES_TEST!=='1',
},async()=>{
  const client=new pg.Client();
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE ROLE ia05_ci_actor NOLOGIN');
    await client.query('CREATE TABLE public.ia05_ci_probe (value integer NOT NULL)');
    await client.query(`
      CREATE FUNCTION public.ia05_ci_trigger() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
      AS $$ BEGIN NEW.value := NEW.value + 1; RETURN NEW; END $$;
    `);
    await client.query(`
      CREATE TRIGGER ia05_ci_before_insert BEFORE INSERT ON public.ia05_ci_probe
      FOR EACH ROW EXECUTE FUNCTION public.ia05_ci_trigger();
    `);
    await client.query('GRANT INSERT,TRIGGER ON public.ia05_ci_probe TO ia05_ci_actor');
    await client.query('GRANT EXECUTE ON FUNCTION public.ia05_ci_trigger() TO ia05_ci_actor');
    const before=await client.query("SELECT has_table_privilege('ia05_ci_actor','public.ia05_ci_probe','TRIGGER') allowed");
    assert.equal(before.rows[0].allowed,true);
    await client.query('REVOKE TRIGGER ON public.ia05_ci_probe FROM PUBLIC,ia05_ci_actor');
    const after=await client.query("SELECT has_table_privilege('ia05_ci_actor','public.ia05_ci_probe','TRIGGER') allowed");
    assert.equal(after.rows[0].allowed,false);
    await client.query('SET LOCAL ROLE ia05_ci_actor');
    await client.query('INSERT INTO public.ia05_ci_probe(value) VALUES(1)');
    await client.query('RESET ROLE');
    const rows=await client.query('SELECT value FROM public.ia05_ci_probe');
    assert.deepEqual(rows.rows.map(r=>r.value),[2]);
  } finally {
    try { await client.query('ROLLBACK'); }
    finally { await client.end(); }
  }
});

const policySql=readFileSync(join(process.cwd(),'supabase/migrations/20261115223227_ia05_scope_public_policies_to_authenticated.sql'),'utf8');
const reviewedPolicies=[
  {
    "table": "aba_session_summaries",
    "policy": "aba_session_summaries_patient_scope_rw",
    "digest": "93582460a01507cfd5a6dd34272fa46e"
  },
  {
    "table": "clinic_protocol_grants",
    "policy": "clinic_protocol_grants_platform_admin_all",
    "digest": "105dd33abf541e30d503a5a810c5eea7"
  },
  {
    "table": "operational_closure_exports",
    "policy": "operational_closure_exports_admin_rw",
    "digest": "c0b4f388e1db7f22b9bfa043d4ca928d"
  },
  {
    "table": "patient_access_grants",
    "policy": "patient_access_grants_clinic_rw",
    "digest": "c0b4f388e1db7f22b9bfa043d4ca928d"
  },
  {
    "table": "patient_anamnesis_requests",
    "policy": "patient_anamnesis_requests_clinic_rw",
    "digest": "58a7b687a9c52140d521fed4d5d17036"
  },
  {
    "table": "patient_anamnesis_responses",
    "policy": "patient_anamnesis_responses_clinic_rw",
    "digest": "58a7b687a9c52140d521fed4d5d17036"
  },
  {
    "table": "patient_history_imports",
    "policy": "patient_history_imports_clinic_rw",
    "digest": "c0b4f388e1db7f22b9bfa043d4ca928d"
  },
  {
    "table": "patient_longitudinal_timeline_items",
    "policy": "patient_longitudinal_timeline_items_clinic_rw",
    "digest": "58a7b687a9c52140d521fed4d5d17036"
  },
  {
    "table": "patient_portability_requests",
    "policy": "patient_portability_requests_clinic_admin_rw",
    "digest": "9aa915e921e1f27c92792d416aef805f"
  },
  {
    "table": "patient_portability_snapshots",
    "policy": "patient_portability_snapshots_clinic_rw",
    "digest": "fe29e0e5ab61c42e7cb19c25239e641c"
  },
  {
    "table": "patient_relationship_confirmations",
    "policy": "patient_relationship_confirmations_clinic_rw",
    "digest": "9aa915e921e1f27c92792d416aef805f"
  },
  {
    "table": "patient_shared_history_snapshots",
    "policy": "patient_shared_history_snapshots_clinic_read",
    "digest": "01f0c03269c9dba3865621ce1975ac24"
  },
  {
    "table": "protocol_import_requests",
    "policy": "protocol_import_requests_owner_all",
    "digest": "105dd33abf541e30d503a5a810c5eea7"
  },
  {
    "table": "record_read_audit",
    "policy": "record_read_audit_select_internal",
    "digest": "a82e6d1036391f6290f1435b87b29e45"
  },
  {
    "table": "verto_canonical_protocols",
    "policy": "verto_canonical_protocols_owner_all",
    "digest": "105dd33abf541e30d503a5a810c5eea7"
  }
];

test('IA-05 final phase narrows exactly 15 RLS public roles without rewriting expressions',()=>{
  assert.equal(reviewedPolicies.length,15);
  assert.equal(new Set(reviewedPolicies.map(p=>p.table+':'+p.policy)).size,15);
  for(const p of reviewedPolicies) {
    assert.match(policySql,new RegExp("'"+p.table+"'"));
    assert.match(policySql,new RegExp("'"+p.policy+"'"));
    assert.match(policySql,new RegExp("'"+p.digest+"'"));
  }
  assert.match(policySql,/IA05_PUBLIC_POLICY_BASELINE_DRIFT/);
  assert.match(policySql,/IA05_POLICY_EXPRESSION_OR_OWNER_DRIFT/);
  assert.match(policySql,/md5\(coalesce\(pol\.qual,''\)\|\|'\|'\|\|coalesce\(pol\.with_check,''\)\)/);
  assert.match(policySql,/ALTER POLICY %I ON public\.%I TO authenticated/);
  assert.match(policySql,/REVOKE EXECUTE ON FUNCTION public\.%I\(%s\) FROM PUBLIC, anon/);
  assert.doesNotMatch(policySql,/\b(?:DROP|CREATE)\s+POLICY\b/i);
  assert.doesNotMatch(policySql,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?public\./i);
});

test('IA-05 PG: scoping public policy to authenticated keeps anon SELECT deny-only', {
  skip:process.env.VERTO_IA05_POSTGRES_TEST!=='1',
},async()=>{
  const client=new pg.Client();
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE ROLE ia05_ci_public NOLOGIN');
    await client.query('CREATE ROLE ia05_ci_authenticated NOLOGIN');
    await client.query('CREATE TABLE public.ia05_rls_probe(value integer NOT NULL)');
    await client.query('INSERT INTO public.ia05_rls_probe VALUES (1)');
    await client.query(`
      CREATE FUNCTION public.ia05_rls_eligible() RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
      AS $$ SELECT current_setting('ia05.actor',true)='valid'; $$;
    `);
    await client.query('GRANT SELECT ON public.ia05_rls_probe TO ia05_ci_public,ia05_ci_authenticated');
    await client.query('GRANT EXECUTE ON FUNCTION public.ia05_rls_eligible() TO ia05_ci_public,ia05_ci_authenticated');
    await client.query('ALTER TABLE public.ia05_rls_probe ENABLE ROW LEVEL SECURITY');
    await client.query(`CREATE POLICY ia05_scope_probe ON public.ia05_rls_probe
      TO PUBLIC USING(public.ia05_rls_eligible());`);
    await client.query('SET LOCAL ROLE ia05_ci_public');
    const before=await client.query('SELECT count(*)::int AS n FROM public.ia05_rls_probe');
    assert.equal(before.rows[0].n,0);
    await client.query('RESET ROLE');
    await client.query('ALTER POLICY ia05_scope_probe ON public.ia05_rls_probe TO ia05_ci_authenticated');
    await client.query('REVOKE EXECUTE ON FUNCTION public.ia05_rls_eligible() FROM PUBLIC,ia05_ci_public');
    await client.query('SET LOCAL ROLE ia05_ci_public');
    const after=await client.query('SELECT count(*)::int AS n FROM public.ia05_rls_probe');
    assert.equal(after.rows[0].n,0);
    await client.query('RESET ROLE');
    await client.query("SET LOCAL ia05.actor='valid'");
    await client.query('SET LOCAL ROLE ia05_ci_authenticated');
    const permitted=await client.query('SELECT count(*)::int AS n FROM public.ia05_rls_probe');
    assert.equal(permitted.rows[0].n,1);
    await client.query('RESET ROLE');
  } finally {
    try{await client.query('ROLLBACK')}finally{await client.end()}
  }
});
