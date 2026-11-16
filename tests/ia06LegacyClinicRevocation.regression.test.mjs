import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import pg from 'pg';

const migration = readFileSync('supabase/migrations/20261116023300_ia06_remove_legacy_profile_clinic_revocation_bypass.sql','utf8');
function extract(name) {
  const match = migration.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$function\\$\\s*;'));
  assert.ok(match, 'missing function SQL: '+name);
  return match[0];
}
const aba = extract('aba_can_read_recommendation_scope_v3');
const clinical = extract('therapeutic_plan_current_actor_can_access_v1');

test('IA-06 legacy users.clinic_id never authorizes stale clinical RLS', () => {
  assert.match(migration,/IA06_LEGACY_SCOPE_FUNCTION_DRIFT/);
  assert.match(migration,/IA06_ABA_POLICY_SCOPE_DRIFT/);
  assert.match(migration,/IA06_LEGACY_SCOPE_POSTCHECK/);
  assert.doesNotMatch(aba,/actor\.clinic_id/);
  assert.doesNotMatch(clinical,/actor\.clinic_id/);
  assert.match(aba,/membership\.role in \('owner', 'admin', 'director'\)/);
  assert.match(clinical,/scoped_admin\.status = 'active'/);
  assert.match(clinical,/scope_clinic\.owner_user_id = actor\.id/);
});

test('IA-06 real PostgreSQL: revoked and downgraded membership cannot read ABA/clinical across clinics', {
  skip: process.env.VERTO_IA06_POSTGRES_TEST !== '1',
}, async () => {
  const conn = new pg.Client(); await conn.connect();
  const clinicA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const clinicB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const patientA='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const patientB='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const admin='11111111-1111-4111-8111-111111111111';
  const therapist='22222222-2222-4222-8222-222222222222';
  const setActor = async id => conn.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);
  const readAba = async patient => (await conn.query(
    'select public.aba_can_read_recommendation_scope_v3($1::text,$2::text,$3::uuid) as allowed',
    [clinicA,clinicA,patient])).rows[0].allowed;
  const readClinical = async patient => (await conn.query(
    "select public.therapeutic_plan_current_actor_can_access_v1($1::uuid,$2::text,$3::text,$4::text,$5::text[],$6::text) as allowed",
    [patient,clinicA,clinicA,'',[],'read'])).rows[0].allowed;
  try {
    await conn.query('BEGIN');
    await conn.query('CREATE SCHEMA IF NOT EXISTS auth');
    await conn.query("CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $q$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $q$");
    await conn.query('CREATE TABLE public.users(id uuid PRIMARY KEY, role text, clinic_id uuid)');
    await conn.query('CREATE TABLE public.clinics(id uuid PRIMARY KEY, owner_user_id uuid)');
    await conn.query('CREATE TABLE public.clinic_memberships(user_id uuid, clinic_id uuid, status text, role text)');
    await conn.query('CREATE TABLE public.patients(id uuid PRIMARY KEY, clinic_id uuid, therapist_id uuid)');
    await conn.query('CREATE TABLE public.patient_professional_links(patient_id uuid,professional_id text,organization_id text,clinic_id text,status text,permissions jsonb)');
    await conn.query(aba);
    await conn.query(clinical);
    await conn.query('INSERT INTO public.clinics(id) VALUES($1),($2)',[clinicA,clinicB]);
    await conn.query('INSERT INTO public.patients(id,clinic_id,therapist_id) VALUES($1,$2,$3),($4,$5,$3)',[patientA,clinicA,therapist,patientB,clinicB]);
    await conn.query("INSERT INTO public.users(id,role,clinic_id) VALUES($1,'admin',$3),($2,'therapist',$3)",[admin,therapist,clinicA]);
    await setActor(admin);
    assert.equal(await readAba(patientA),false,'stale users.clinic_id is not an active membership');
    assert.equal(await readClinical(patientA),false,'stale users.clinic_id cannot grant plan access');
    await conn.query("INSERT INTO public.clinic_memberships(user_id,clinic_id,status,role) VALUES($1,$2,'active','therapist')",[admin,clinicA]);
    assert.equal(await readAba(patientA),false,'downgraded admin cannot retain ABA admin access');
    assert.equal(await readClinical(patientA),false,'downgraded admin cannot retain clinical admin access');
    await conn.query("UPDATE public.clinic_memberships SET role='director' WHERE user_id=$1",[admin]);
    assert.equal(await readAba(patientA),true,'active director membership can read');
    assert.equal(await readClinical(patientA),true,'active director membership can read clinical plan');
    assert.equal(await readAba(patientB),false,'clinic A membership does not read clinic B ABA data');
    assert.equal(await readClinical(patientB),false,'clinic A membership does not read clinic B clinical plan');
    await conn.query("UPDATE public.clinic_memberships SET status='revoked' WHERE user_id=$1",[admin]);
    assert.equal(await readAba(patientA),false,'revoked membership loses ABA access');
    assert.equal(await readClinical(patientA),false,'revoked membership loses clinical plan access');
    await conn.query('UPDATE public.clinics SET owner_user_id=$1 WHERE id=$2',[admin,clinicA]);
    assert.equal(await readAba(patientA),true,'registered clinic owner remains authorized');
    assert.equal(await readClinical(patientA),true,'registered clinic owner remains authorized');
    await setActor(therapist);
    assert.equal(await readAba(patientA),false,'former direct therapist without active membership denied');
    await conn.query("INSERT INTO public.clinic_memberships(user_id,clinic_id,status,role) VALUES($1,$2,'active','therapist')",[therapist,clinicA]);
    assert.equal(await readAba(patientA),true,'active direct therapist still permitted');
  } finally {
    try { await conn.query('ROLLBACK'); } finally { await conn.end(); }
  }
});
