import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// PostgreSQL contract test with synthetic UUIDs only. No live patient data.
const db = new PGlite();
const uuid = (n) => `9f000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const org=uuid(1), patient=uuid(2), fono=uuid(3), other=uuid(4);
const old=uuid(10), future=uuid(11), anotherFuture=uuid(12), pts=uuid(13), session=uuid(21);

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as 'select null::uuid';
    create table public.patient_therapeutic_plans (
      id uuid primary key, organization_id text not null, clinic_id text not null,
      patient_id uuid not null, mode text not null, specialty text,
      status text not null, responsible_professional_id text not null,
      edit_version integer not null default 1, common_objectives jsonb not null default '[]'::jsonb,
      specialty_objectives jsonb not null default '{}'::jsonb,
      pts_payload jsonb not null default '{}'::jsonb,
      review_due_date date, last_reviewed_at timestamptz, updated_at timestamptz default now()
    );
    create unique index idx_therapeutic_plan_active_specialty
      on public.patient_therapeutic_plans (organization_id,patient_id,lower(specialty))
      where mode='specialty' and status in ('draft','active','paused');
    create table public.plan_versions_audit (id uuid, version int, status text);
    create function public.clinical_specialty_scope_key_v1(p text)
      returns text language sql immutable as $key$
        select case when lower(btrim(p)) in ('fonoaudiologia','fonoaudiólogo') then 'speech_therapy'
                    when lower(btrim(p)) in ('terapia ocupacional','to') then 'occupational_therapy'
                    else null end;
      $key$;
    create function public.therapeutic_plan_current_actor_can_access_v2(
      p_patient_id uuid, p_organization_id text, p_clinic_id text, p_mode text,
      p_responsible_professional_id text, p_participant_professional_ids text[],
      p_required_permission text
    ) returns boolean language sql stable as 'select false';
    create function public.update_patient_therapeutic_plan_v3(
      p_plan_id uuid, p_organization_id text, p_patient_id uuid,
      p_expected_version integer, p_common_objectives jsonb, p_specialty_objectives jsonb,
      p_pts_payload jsonb, p_review_due_date date, p_last_reviewed_at timestamptz,
      p_status text,p_actor_id text,p_now timestamptz default now()
    ) returns setof public.patient_therapeutic_plans
    language plpgsql as $f$
    declare v public.patient_therapeutic_plans%rowtype;
    begin
      select * into v from public.patient_therapeutic_plans
        where id=p_plan_id and patient_id=p_patient_id and organization_id=p_organization_id
        for update;
      if not found or v.edit_version<>p_expected_version then
        raise exception 'THERAPEUTIC_PLAN_VERSION_CONFLICT';
      end if;
      insert into public.plan_versions_audit values(v.id,v.edit_version,v.status);
      return query update public.patient_therapeutic_plans
        set status=p_status,edit_version=edit_version+1,common_objectives=p_common_objectives,
            specialty_objectives=p_specialty_objectives,pts_payload=p_pts_payload,
            review_due_date=p_review_due_date,last_reviewed_at=p_last_reviewed_at,updated_at=p_now
        where id=p_plan_id and edit_version=p_expected_version
        returning *;
    end;
    $f$;
    insert into public.patient_therapeutic_plans
      (id,organization_id,clinic_id,patient_id,mode,specialty,status,responsible_professional_id)
    values
      ('${old}','${org}','${org}','${patient}','specialty','Fonoaudiólogo','active','${fono}'),
      ('${pts}','${org}','${org}','${patient}','interdisciplinary',null,'active','${fono}');
  `);
  const migration = fs.readFileSync(
    'supabase/migrations/20261023143000_parallel_specialty_plan_drafts_and_atomic_activation.sql','utf8'
  );
  assert.match(migration,/coalesce\(public\.clinical_specialty_scope_key_v1\(specialty\)/);
  assert.match(migration,/where mode = 'specialty' and status = 'active'/);
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/update_patient_therapeutic_plan_v3/);
  assert.match(migration,/plan\.status = 'active'/);
  assert.match(migration,/revoke all on function public\.activate_patient_specialty_plan_v1/);
  await db.exec(migration);
  const sql = (query, params=[])=>db.query(query,params);
  // Active Fono continues to own sessions while multiple distinct drafts are authored.
  await sql(`insert into public.patient_therapeutic_plans
    (id,organization_id,clinic_id,patient_id,mode,specialty,status,responsible_professional_id)
    values ($1,$2,$2,$3,'specialty','Fonoaudiologia','draft',$4),
           ($5,$2,$2,$3,'specialty','Fonoaudiólogo','draft',$4)`,
    [future,org,patient,fono,anotherFuture]);
  assert.equal((await sql("select count(*)::int as n from patient_therapeutic_plans where mode='specialty' and status='draft'")).rows[0].n,2);
  await assert.rejects(
    sql(`insert into patient_therapeutic_plans
      (id,organization_id,clinic_id,patient_id,mode,specialty,status,responsible_professional_id)
      values ($1,$2,$2,$3,'specialty','Fonoaudiologia','active',$4)`,
      [uuid(30),org,patient,fono]),
    /duplicate key value violates unique constraint/
  );
  await db.exec(`
    create table public.aba_sessions(
      id uuid primary key,organization_id text,clinic_id text,patient_id uuid,
      therapeutic_plan_id uuid,status text not null default 'completed',note text
    );
    create trigger test_aba_session_plan_guard before insert or update
      on public.aba_sessions for each row
      execute function public.guard_aba_session_therapeutic_plan_binding_v1();
  `);
  await sql('insert into aba_sessions(id,organization_id,clinic_id,patient_id,therapeutic_plan_id) values ($1,$2,$2,$3,$4)',
    [session,org,patient,old]);
  await assert.rejects(
    sql('insert into aba_sessions(id,organization_id,clinic_id,patient_id,therapeutic_plan_id) values ($1,$2,$2,$3,$4)',
      [uuid(22),org,patient,future]),
    /ABA_SESSION_SPECIALTY_PLAN_NOT_ACTIVE/
  );
  const activate = `select id,status,edit_version from
    public.activate_patient_specialty_plan_v1(
      $1,$2,$3,$4,'[]'::jsonb,'{}'::jsonb,'{}'::jsonb,null,null,$5,$6)`;
  await assert.rejects(sql(activate,[future,org,patient,1,other,false]),/SPECIALTY_PLAN_SCOPE_DENIED/);
  assert.equal((await sql('select status from patient_therapeutic_plans where id=$1',[old])).rows[0].status,'active');
  const activated = (await sql(activate,[future,org,patient,1,fono,false])).rows[0];
  assert.equal(activated.id,future);
  assert.equal(activated.status,'active');
  assert.equal(activated.edit_version,2);
  assert.equal((await sql('select status from patient_therapeutic_plans where id=$1',[old])).rows[0].status,'completed');
  assert.equal((await sql('select status from patient_therapeutic_plans where id=$1',[anotherFuture])).rows[0].status,'draft');
  assert.equal((await sql('select status from patient_therapeutic_plans where id=$1',[pts])).rows[0].status,'active');
  assert.equal((await sql('select count(*)::int n from plan_versions_audit')).rows[0].n,2,
    'both old and new plan version histories must be preserved');
  await assert.rejects(sql(activate,[anotherFuture,org,patient,1,other,false]),/SPECIALTY_PLAN_SCOPE_DENIED/);
  await assert.rejects(sql(activate,[anotherFuture,org,patient,0,fono,false]),/THERAPEUTIC_PLAN_VERSION_CONFLICT/);
  assert.equal((await sql('select status from patient_therapeutic_plans where id=$1',[future])).rows[0].status,'active',
    'failed switch cannot partially close active plan');
  await assert.rejects(
    sql('insert into aba_sessions(id,organization_id,clinic_id,patient_id,therapeutic_plan_id) values ($1,$2,$2,$3,$4)',
      [uuid(23),org,patient,old]),/ABA_SESSION_SPECIALTY_PLAN_NOT_ACTIVE/,
    'past cycle cannot be selected for new sessions'
  );
  await sql('update aba_sessions set note=$2 where id=$1',[session,'historical session preserved']);
  assert.equal((await sql('select therapeutic_plan_id from aba_sessions where id=$1',[session])).rows[0].therapeutic_plan_id,old);
  await sql('insert into aba_sessions(id,organization_id,clinic_id,patient_id,therapeutic_plan_id) values ($1,$2,$2,$3,$4)',
    [uuid(24),org,patient,future]);
  await sql("update aba_sessions set status='active' where id=$1",[uuid(24)]);
  await assert.rejects(sql(activate,[anotherFuture,org,patient,1,fono,false]),
    /SPECIALTY_PLAN_NOT_ACTIVATABLE/,
    'switching must be refused while an active session uses the current cycle');
  assert.equal((await sql('select status from patient_therapeutic_plans where id=$1',[future])).rows[0].status,'active');
  console.log('parallelSpecialtyPlanCycles: multiple drafts, atomic switch and immutable session binding PASS');
} finally {
  await db.close();
}
