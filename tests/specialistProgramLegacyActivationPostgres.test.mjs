import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

// Isolated PostgreSQL integration: no live patients, network or service keys.
// Use a minimal fake versioned-status RPC to verify that the migration invokes
// the canonical status route only for authorized specialist-authored programs.
const db = new PGlite();
const uuid = n => `80000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const clinic=uuid(1),patient=uuid(2),specialist=uuid(3),manager=uuid(4);
try {
  await db.exec(`
    create table public.patient_therapeutic_plans(
      id text primary key,organization_id text,patient_id uuid,clinic_id text,
      responsible_professional_id text, mode text,status text,specialty text
    );
    create table public.aba_programs(
      id text primary key,organization_id text,patient_id uuid,
      therapeutic_plan_id text,created_by text,status text,version integer
    );
    create table public.clinic_memberships(
      clinic_id text,user_id text,role text,status text,specialty text
    );
    create table public.patient_professional_links(
      organization_id text,patient_id uuid,professional_id text,status text,
      permissions jsonb
    );
    create table public.activation_audit(program_id text,reason text,actor text);
    create function public.update_therapeutic_program_status(
      p_organization_id text,p_patient_id uuid,p_program_id text,p_status text,
      p_expected_version integer,p_reason text,p_idempotency_key text,p_actor_id text
    ) returns jsonb language plpgsql as $fn$
    declare v jsonb;
    begin
      update public.aba_programs
        set status=p_status, version=version+1
        where id=p_program_id and organization_id=p_organization_id
          and patient_id=p_patient_id and version=p_expected_version
        returning to_jsonb(aba_programs.*) into v;
      if v is null then raise exception 'VERSION_CONFLICT'; end if;
      insert into activation_audit values(p_program_id,p_reason,p_actor_id);
      return v;
    end;
    $fn$;
  `);
  const run = (sql,params=[]) => db.query(sql,params);
  await run('insert into clinic_memberships values ($1,$2,\'therapist\',\'active\',\'Fonoaudiólogo\')',
    [clinic,specialist]);
  await run('insert into patient_professional_links values ($1,$2,$3,\'active\',\'{"write":true}\'::jsonb)',
    [clinic,patient,specialist]);
  await run(`insert into patient_therapeutic_plans values
    ('scope-active',$1,$2,$1,$3,'specialty','active','Fonoaudiólogo'),
    ('scope-draft',$1,$2,$1,$3,'specialty','draft','Fonoaudiólogo'),
    ('scope-pts',$1,$2,$1,$3,'interdisciplinary','active','Fonoaudiólogo')`,
    [clinic,patient,specialist]);
  await run(`insert into aba_programs values
    ('self-authored',$1,$2,'scope-active',$3,'awaiting_approval',2),
    ('manager-authored',$1,$2,'scope-active',$4,'awaiting_approval',1),
    ('draft-scope',$1,$2,'scope-draft',$3,'awaiting_approval',1),
    ('pts-scope',$1,$2,'scope-pts',$3,'awaiting_approval',1)`,
    [clinic,patient,specialist,manager]);
  const migration=fs.readFileSync('supabase/migrations/20261022130000_specialist_authored_programs_no_approval.sql','utf8');
  await db.exec(migration);
  let rows=(await run('select id,status,version from aba_programs order by id')).rows;
  assert.deepEqual(rows,[
    {id:'draft-scope',status:'awaiting_approval',version:1},
    {id:'manager-authored',status:'awaiting_approval',version:1},
    {id:'pts-scope',status:'awaiting_approval',version:1},
    {id:'self-authored',status:'teaching',version:3}
  ]);
  assert.deepEqual((await run('select program_id,actor from activation_audit')).rows,
    [{program_id:'self-authored',actor:specialist}]);
  await db.exec(migration);
  assert.equal((await run('select count(*)::int as n from activation_audit')).rows[0].n,1,
    're-running migration must not add audit records');
  console.log('specialistProgramLegacyActivationPostgres: PASS');
} finally {
  await db.close();
}
