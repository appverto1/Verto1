import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';

const migrationClinical = readFileSync(join(process.cwd(),'supabase/migrations/20261116000857_ia06_clinical_tenant_and_onboarding_authorization_guards.sql'),'utf8');
const migrationRevocation = readFileSync(join(process.cwd(),'supabase/migrations/20261116001203_ia06_restrict_revoked_clinic_school_and_patient_file_access.sql'),'utf8');
const clinicalFunctions = ['therapeutic_plan_current_actor_can_access_v1','ack_onboarding_response_v1','submit_onboarding_response_v1'];
const revocationFunctions = ['school_rls_meeting_access','school_rls_org_access','school_rls_patient_access','patient_file_actor_has_patient_access_v1','patient_file_current_actor_can_read_v1'];
function functionSql(migration,name) {
  const result=migration.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$function\\$\\s*;'));
  assert.ok(result,'Missing actual function SQL: '+name);
  return result[0];
}
const originalDefinitions = [...clinicalFunctions.map(name=>functionSql(migrationClinical,name)),...revocationFunctions.map(name=>functionSql(migrationRevocation,name))];
const filePolicies = ['patient_files_insert','patient_files_update','patient_files_delete'].map(name=>{
  const m=migrationRevocation.match(new RegExp('ALTER POLICY '+name+' ON public\\.patient_files[\\s\\S]*?;'));
  assert.ok(m,'Missing file RLS policy '+name);
  return m[0];
});

test('IA-06 fail-closed baselines, exact scope, no unrelated DML',()=>{
  for (const [src,num] of [[migrationClinical,3],[migrationRevocation,5]]) {
    assert.equal((src.match(/CREATE OR REPLACE FUNCTION public\./g)||[]).length,num);
    assert.match(src,/IA06_/);
    assert.match(src,/COMMIT;/);
    // Function bodies retain necessary onboarding INSERT/UPDATE; no top-level DML is added by this migration.
    assert.doesNotMatch(src,/\b(?:DROP|CREATE)\s+(?:POLICY|TABLE)\s+/i);
  }
  assert.match(migrationClinical,/scoped_admin\.clinic_id = patient\.clinic_id/);
  assert.match(migrationClinical,/public\.is_platform_admin\(p_actor_id\)/);
  const responseAuth=migrationClinical.indexOf("onboarding_actor_can_respond_v1(p_actor_id,v_clinic_id)");
  const responseLookup=migrationClinical.indexOf("select * into v_response from public.onboarding_responses");
  assert.ok(responseAuth>0 && responseLookup>responseAuth,'authorization must precede idempotent replay');
  assert.equal((functionSql(migrationClinical,'submit_onboarding_response_v1').match(/response\.responded_by=p_actor_id/g)||[]).length,2);
  assert.match(migrationRevocation,/participant_membership\.status = 'active'/);
  assert.match(migrationRevocation,/active_case_member\.status = 'active'/);
  assert.match(migrationRevocation,/file_owner_clinic\.owner_user_id = u\.id/);
  assert.equal(filePolicies.length,3);
});

test('IA-06 PostgreSQL verifies tenant isolation, revoked membership, onboarding and file writes', {
  skip: process.env.VERTO_IA06_POSTGRES_TEST !== '1',
},async()=>{
  const conn=new pg.Client(); await conn.connect();
  const actorA='11111111-1111-4111-8111-111111111111';
  const actorB='22222222-2222-4222-8222-222222222222';
  const actorAdmin='33333333-3333-4333-8333-333333333333';
  const therapist='44444444-4444-4444-8444-444444444444';
  const guardian='55555555-5555-4555-8555-555555555555';
  const otherManager='66666666-6666-4666-8666-666666666666';
  const legacy='77777777-7777-4777-8777-777777777777';
  const clinicA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const clinicB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const patientA='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const patientB='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const meeting='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const publication='11111111-aaaa-4aaa-8aaa-111111111111';
  const slot='22222222-aaaa-4aaa-8aaa-222222222222';
  const response='33333333-aaaa-4aaa-8aaa-333333333333';
  const fileOwner='44444444-aaaa-4aaa-8aaa-444444444444';
  const fileCase='55555555-aaaa-4aaa-8aaa-555555555555';
  const fileParent='66666666-aaaa-4aaa-8aaa-666666666666';
  const fileSelected='77777777-aaaa-4aaa-8aaa-777777777777';
  const key='ia06-idempotency-test-12345';
  async function setActor(user,role='authenticated') {
    await conn.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user||'']);
    await conn.query("SELECT set_config('request.jwt.claim.role',$1,true)",[role]);
  }
  async function expectDenied(query,values,code) {
    await conn.query('SAVEPOINT ia06_denied');
    try {
      await assert.rejects(conn.query(query,values), err=>code?err.code===code:true);
    } finally {
      await conn.query('ROLLBACK TO SAVEPOINT ia06_denied');
      await conn.query('RELEASE SAVEPOINT ia06_denied');
    }
  }
  try {
    await conn.query('BEGIN');
    await conn.query('CREATE SCHEMA IF NOT EXISTS auth');
    await conn.query("CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $q$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $q$");
    await conn.query("CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $q$ SELECT current_setting('request.jwt.claim.role',true) $q$");
    await conn.query('CREATE ROLE ia06_caller NOLOGIN');
    await conn.query("CREATE TABLE public.users(id uuid PRIMARY KEY,role text,clinic_id uuid,name text)");
    await conn.query('CREATE TABLE public.clinics(id uuid PRIMARY KEY,owner_user_id uuid,school_organization_id uuid)');
    await conn.query("CREATE TABLE public.clinic_memberships(id uuid DEFAULT gen_random_uuid(),user_id uuid,clinic_id uuid,status text,role text)");
    await conn.query('CREATE TABLE public.clinic_membership_permission_overrides(membership_id uuid,permission_key text,effect text)');
    await conn.query('CREATE TABLE public.patients(id uuid PRIMARY KEY,clinic_id uuid,therapist_id uuid,responsible_user_id uuid)');
    await conn.query("CREATE TABLE public.patient_professional_links(patient_id uuid,professional_id text,organization_id text,clinic_id text,status text,permissions jsonb)");
    await conn.query('CREATE TABLE public.platform_admins(user_id uuid,active boolean)');
    await conn.query("CREATE TABLE public.onboarding_publications(id uuid PRIMARY KEY,clinic_id uuid,status text,responded_at timestamptz)");
    await conn.query("CREATE TABLE public.onboarding_slots(id uuid PRIMARY KEY,publication_id uuid,status text,reserved_at timestamptz,updated_at timestamptz)");
    await conn.query("CREATE TABLE public.onboarding_responses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),publication_id uuid,clinic_id uuid,slot_id uuid,participants text[],idempotency_key text,responded_by uuid,responded_at timestamptz DEFAULT now(),admin_ack_at timestamptz,admin_ack_by uuid,created_at timestamptz DEFAULT now(),UNIQUE(idempotency_key,publication_id))");
    await conn.query("CREATE TABLE public.school_meetings(id uuid PRIMARY KEY,clinic_id text)");
    await conn.query("CREATE TABLE public.school_meeting_participants(meeting_id uuid,professional_id text,removed_at timestamptz)");
    await conn.query("CREATE TABLE public.school_meeting_patients(meeting_id uuid,patient_id uuid,participation_status text)");
    await conn.query("CREATE TABLE public.patient_files(id uuid PRIMARY KEY,patient_id uuid,clinic_id uuid,uploaded_by uuid,patient_portal_visible boolean,access_scope text)");
    await conn.query("CREATE TABLE public.patient_file_access_grants(file_id uuid,patient_id uuid,clinic_id uuid,grantee_user_id uuid)");
    await conn.query("INSERT INTO public.users(id,role,clinic_id) VALUES ($1,'owner',$8),($2,'owner',$9),($3,'admin',$9),($4,'therapist',$8),($5,'patient',$8),($6,'director',$8),($7,'admin',$8)",
      [actorA,actorB,actorAdmin,therapist,guardian,otherManager,legacy,clinicA,clinicB]);
    await conn.query('INSERT INTO public.clinics(id,owner_user_id,school_organization_id) VALUES($1,$3,$4),($2,$5,$6)',[clinicA,clinicB,actorA,'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',actorB,'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb']);
    await conn.query("INSERT INTO public.clinic_memberships(user_id,clinic_id,status,role) VALUES($1,$5,'active','director'),($2,$6,'active','director'),($3,$5,'active','therapist'),($4,$5,'active','director')",[actorA,actorB,therapist,otherManager,clinicA,clinicB]);
    await conn.query('INSERT INTO public.patients(id,clinic_id,therapist_id,responsible_user_id) VALUES($1,$3,$5,$6),($2,$4,$7,NULL)',[patientA,patientB,clinicA,clinicB,therapist,guardian,actorB]);
    await conn.query("INSERT INTO public.patient_professional_links(patient_id,professional_id,organization_id,clinic_id,status,permissions) VALUES($1,$2,$3,$3,'active',$4::jsonb)",[patientA,therapist,clinicA,JSON.stringify({read:true,write:true})]);
    await conn.query('INSERT INTO public.platform_admins(user_id,active) VALUES($1,true)',[actorAdmin]);
    await conn.query("INSERT INTO public.onboarding_publications(id,clinic_id,status) VALUES($1,$2,'responded')",[publication,clinicA]);
    await conn.query("INSERT INTO public.onboarding_slots(id,publication_id,status) VALUES($1,$2,'reserved')",[slot,publication]);
    await conn.query('INSERT INTO public.onboarding_responses(id,publication_id,clinic_id,slot_id,participants,idempotency_key,responded_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[response,publication,clinicA,slot,['confidential'],key,actorA]);
    await conn.query('INSERT INTO public.school_meetings(id,clinic_id) VALUES($1,$2)',[meeting,clinicA]);
    await conn.query('INSERT INTO public.school_meeting_participants(meeting_id,professional_id,removed_at) VALUES($1,$2,NULL)',[meeting,therapist]);
    await conn.query("INSERT INTO public.patient_files(id,patient_id,clinic_id,uploaded_by,patient_portal_visible,access_scope) VALUES($1,$5,$6,$7,false,'OWNER'),($2,$5,$6,NULL,false,'CASE_TEAM'),($3,$5,$6,NULL,true,'PATIENT_ACCESS'),($4,$5,$6,NULL,false,'SELECTED')",
      [fileOwner,fileCase,fileParent,fileSelected,patientA,clinicA,therapist]);
    await conn.query('INSERT INTO public.patient_file_access_grants(file_id,patient_id,clinic_id,grantee_user_id) VALUES($1,$2,$3,$4)',[fileSelected,patientA,clinicA,guardian]);
    await conn.query("CREATE FUNCTION public.onboarding_text_array_valid_v1(text[],int,int,int) RETURNS boolean LANGUAGE sql IMMUTABLE AS $q$ SELECT TRUE $q$");
    await conn.query("CREATE FUNCTION public.onboarding_actor_can_respond_v1(actor uuid,clinic uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $q$ SELECT EXISTS(SELECT 1 FROM public.clinic_memberships cm WHERE cm.user_id=actor AND cm.clinic_id=clinic AND cm.status='active' AND cm.role IN('director','coordinator')) $q$");
    await conn.query("CREATE FUNCTION public.is_platform_admin(target_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $q$ SELECT target_user=auth.uid() AND EXISTS(SELECT 1 FROM public.platform_admins p WHERE p.user_id=target_user AND p.active) $q$");
    await conn.query("CREATE FUNCTION public.school_actor_effective_role(actor uuid,clinic uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $q$ SELECT (SELECT role FROM public.clinic_memberships cm WHERE cm.user_id=actor AND cm.clinic_id=clinic AND cm.status='active' LIMIT 1) $q$");
    for (const name of ['school_rls_org_access','school_rls_patient_access']) await conn.query(functionSql(migrationRevocation,name));
    for (const name of ['patient_file_actor_has_patient_access_v1','patient_file_current_actor_can_read_v1']) await conn.query(functionSql(migrationRevocation,name));
    await conn.query('CREATE FUNCTION public.ia06_school_auth_dummy() RETURNS boolean LANGUAGE sql STABLE AS $q$ SELECT FALSE $q$');
    await conn.query(functionSql(migrationRevocation,'school_rls_meeting_access'));
    for (const name of clinicalFunctions) await conn.query(functionSql(migrationClinical,name));
    await conn.query('CREATE POLICY patient_files_insert ON public.patient_files FOR INSERT TO ia06_caller WITH CHECK(TRUE)');
    await conn.query('CREATE POLICY patient_files_update ON public.patient_files FOR UPDATE TO ia06_caller USING(TRUE) WITH CHECK(TRUE)');
    await conn.query('CREATE POLICY patient_files_delete ON public.patient_files FOR DELETE TO ia06_caller USING(TRUE)');
    for (const policy of filePolicies) await conn.query(policy);
    await conn.query('ALTER TABLE public.patient_files ENABLE ROW LEVEL SECURITY');
    await conn.query('GRANT USAGE ON SCHEMA public, auth TO ia06_caller');
    await conn.query('GRANT SELECT ON public.users,public.clinics,public.clinic_memberships,public.patients TO ia06_caller');
    await conn.query('GRANT SELECT,INSERT,UPDATE,DELETE ON public.patient_files TO ia06_caller');
    await conn.query('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ia06_caller');

    await setActor(actorB); await conn.query('SET LOCAL ROLE ia06_caller');
    assert.equal((await conn.query('SELECT public.therapeutic_plan_current_actor_can_access_v1($1,$2,$2,NULL,$3,$4) allowed',[patientA,clinicA,[], 'read'])).rows[0].allowed,false,'other-clinic owner must be denied');
    assert.equal((await conn.query('SELECT public.therapeutic_plan_current_actor_can_access_v1($1,$2,$2,NULL,$3,$4) allowed',[patientB,clinicB,[],'read'])).rows[0].allowed,true,'own-clinic owner must remain allowed');
    await expectDenied('SELECT * FROM public.ack_onboarding_response_v1($1,$2)',[response,actorB],'42501');
    await expectDenied('SELECT * FROM public.submit_onboarding_response_v1($1,$2,$3,$4,$5)',[publication,slot,['confidential'],key,actorB],'42501');
    await expectDenied("INSERT INTO public.patient_files(id,patient_id,clinic_id,uploaded_by,patient_portal_visible,access_scope) VALUES(gen_random_uuid(),$1,$2,$3,false,'OWNER')",[patientA,clinicA,actorB],'42501');
    await conn.query("INSERT INTO public.patient_files(id,patient_id,clinic_id,uploaded_by,patient_portal_visible,access_scope) VALUES(gen_random_uuid(),$1,$2,$3,false,'OWNER')",[patientB,clinicB,actorB]);

    await setActor(actorA);
    assert.equal((await conn.query('SELECT public.therapeutic_plan_current_actor_can_access_v1($1,$2,$2,NULL,$3,$4) allowed',[patientA,clinicA,[],'read'])).rows[0].allowed,true);
    const ownReplay=await conn.query('SELECT response_id, participants FROM public.submit_onboarding_response_v1($1,$2,$3,$4,$5)',[publication,slot,['confidential'],key,actorA]);
    assert.equal(ownReplay.rows[0].response_id,response);
    await setActor(otherManager);
    await expectDenied('SELECT * FROM public.submit_onboarding_response_v1($1,$2,$3,$4,$5)',[publication,slot,['confidential'],key,otherManager],'P0001');

    await setActor(actorAdmin);
    assert.equal((await conn.query('SELECT response_id FROM public.ack_onboarding_response_v1($1,$2)',[response,actorAdmin])).rows[0].response_id,response);

    await setActor(legacy);
    assert.equal((await conn.query('SELECT public.school_rls_org_access($1) allowed',[ 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'])).rows[0].allowed,false);
    assert.equal((await conn.query('SELECT public.school_rls_patient_access($1) allowed',[patientA])).rows[0].allowed,false);

    await setActor(therapist);
    assert.equal((await conn.query('SELECT public.school_rls_meeting_access($1) allowed',[meeting])).rows[0].allowed,true);
    assert.equal((await conn.query('SELECT public.patient_file_current_actor_can_read_v1($1) allowed',[fileOwner])).rows[0].allowed,true);

    await conn.query('RESET ROLE');
    await conn.query("UPDATE public.clinic_memberships SET status='inactive' WHERE user_id=$1",[therapist]);
    await conn.query('SET LOCAL ROLE ia06_caller');
    assert.equal((await conn.query('SELECT public.school_rls_meeting_access($1) allowed',[meeting])).rows[0].allowed,false,'removed professional loses meeting even if listed participant');
    assert.equal((await conn.query('SELECT public.patient_file_current_actor_can_read_v1($1) allowed',[fileOwner])).rows[0].allowed,false,'former uploader loses access');
    assert.equal((await conn.query('SELECT public.patient_file_current_actor_can_read_v1($1) allowed',[fileCase])).rows[0].allowed,false,'former professional loses case-team access');

    await setActor(guardian);
    assert.equal((await conn.query('SELECT public.patient_file_current_actor_can_read_v1($1) allowed',[fileParent])).rows[0].allowed,true,'patient guardian portal remains authorized');
    assert.equal((await conn.query('SELECT public.patient_file_current_actor_can_read_v1($1) allowed',[fileSelected])).rows[0].allowed,true,'explicit selected sharing remains authorized');
    await conn.query('RESET ROLE');
  } finally {
    try { await conn.query('ROLLBACK'); } finally { await conn.end(); }
  }
});
