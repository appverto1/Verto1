import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Isolated PostgreSQL 17 smoke of the actual candidate migration. No network,
// Railway, Staging DB or clinical data. v2 stub models canonical reconciliation;
// full real v2 financial regressions remain a separate CI gate.
const db=new PGlite();
const id=(n)=>`60000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const clinic=id(1),other=id(2),patient=id(3),professional=id(4),otherProfessional=id(5),actor=id(6);
const query=async(text,params=[])=>(await db.query(text,params)).rows;
try {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(`
    create table public.clinic_memberships (
      clinic_id uuid not null,user_id uuid not null,role text not null,
      status text not null,specialty text
    );
    create table public.patient_financial_plans (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,patient_id uuid not null,
      client_plan_key text,logical_plan_id uuid not null default gen_random_uuid(),
      version integer not null default 1,service_type text not null,
      service_name_snapshot text,custom_service_name text,status text not null default 'ACTIVE',
      created_at timestamptz not null default now(),
      supersedes_plan_id uuid
    );
    create unique index finance_plan_key_fixture
      on public.patient_financial_plans (organization_id,patient_id,client_plan_key);
    create or replace function public.appointment_financial_service_key_v1(p text)
    returns text language sql immutable as $$
      select case
        when p in ('Fonoaudiólogo','Fonoaudiologia','SPEECH_THERAPY') then 'SPEECH_THERAPY'
        when p in ('Terapeuta Ocupacional','OCCUPATIONAL_THERAPY') then 'OCCUPATIONAL_THERAPY'
        else p end;
    $$;
    create or replace function public.reconcile_patient_financial_plans_v2(
      p_organization_id uuid,p_patient_id uuid,p_actor_id uuid,p_plans jsonb,
      p_preserve_insurance_context boolean default false)
    returns jsonb language plpgsql as $$
    declare item jsonb;
    begin
      for item in select value from jsonb_array_elements(p_plans) loop
        insert into public.patient_financial_plans(
          organization_id,patient_id,client_plan_key,service_type,service_name_snapshot)
        values(p_organization_id,p_patient_id,item->>'client_plan_key',
          item->>'service_type',item->>'service_name_snapshot')
        on conflict(organization_id,patient_id,client_plan_key)
        do update set service_type=excluded.service_type,
          service_name_snapshot=excluded.service_name_snapshot;
      end loop;
      return jsonb_build_object('success',true,'data','[]'::jsonb);
    end;
    $$;
  `);
  await db.exec(fs.readFileSync('supabase/operations/promotion_staging_sources/20261021223000_patient_financial_plan_professional_binding_v3.sql','utf8'));
  await query('insert into clinic_memberships(clinic_id,user_id,role,status,specialty) values ($1,$2,\'therapist\',\'active\',\'Fonoaudiólogo\'),($3,$4,\'therapist\',\'active\',\'Fonoaudiólogo\')',
    [clinic,professional,other,otherProfessional]);
  const call=async(key,prof,service='SPEECH_THERAPY',snapshot=service)=>
    (await query('select public.reconcile_patient_financial_plans_v3($1,$2,$3,$4::jsonb,false) as output',
      [clinic,patient,actor,JSON.stringify([{client_plan_key:key,service_type:service,
        service_name_snapshot:snapshot,professional_user_id:prof}])]))[0].output;
  let result=await call('first',professional);
  assert.equal(result.success,true);
  assert.equal(result.data[0].professional_user_id,professional);
  assert.equal((await query('select count(*)::int as n from patient_financial_plans'))[0].n,1);
  result=await call('first',professional);
  assert.equal(result.data[0].professional_user_id,professional);
  assert.equal((await query('select count(*)::int as n from patient_financial_plans'))[0].n,1,
    'idempotent replay must not duplicate the plan');
  const rejection=async (key,prof,service='SPEECH_THERAPY',snapshot=service)=>{
    await assert.rejects(()=>call(key,prof,service,snapshot));
    assert.equal((await query('select count(*)::int as n from patient_financial_plans'))[0].n,1,
      'denied write must not leave a partial financial row');
  };
  await rejection('no-member',null);
  await rejection('other-clinic',otherProfessional);
  await rejection('wrong-specialty',professional,'OCCUPATIONAL_THERAPY');
  // A forged snapshot must not override the canonical specialty or bind a
  // Fono specialist to a Psychology financial plan (direct RPC payload).
  await rejection('spoofed-snapshot',professional,'PSYCHOLOGY','SPEECH_THERAPY');
  await query("update clinic_memberships set status='inactive' where clinic_id=$1 and user_id=$2",
    [clinic,professional]);
  await rejection('revoked',professional);
  // Historical unbound plan is compatible with an unchanged legacy save.
  await query("insert into patient_financial_plans(organization_id,patient_id,client_plan_key,service_type,service_name_snapshot) values($1,$2,'legacy','SPEECH_THERAPY','Fonoaudiólogo')",
    [clinic,patient]);
  const prior=await call('legacy',null);
  assert.equal(prior.success,true);
  assert.equal(prior.data.find(row=>row.client_plan_key==='legacy').professional_user_id,null);
  assert.equal((await query(`select has_function_privilege('anon',
    'public.reconcile_patient_financial_plans_v3(uuid,uuid,uuid,jsonb,boolean)','EXECUTE') as allowed`))[0].allowed,false);
  assert.equal((await query(`select has_function_privilege('authenticated',
    'public.reconcile_patient_financial_plans_v3(uuid,uuid,uuid,jsonb,boolean)','EXECUTE') as allowed`))[0].allowed,false);
  assert.equal((await query(`select has_function_privilege('service_role',
    'public.reconcile_patient_financial_plans_v3(uuid,uuid,uuid,jsonb,boolean)','EXECUTE') as allowed`))[0].allowed,true);
  console.log('p0FinancialProfessionalBindingSql: PostgreSQL 17 transaction/security regressions PASS');
} finally {
  await db.close();
}
