import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';

const migration=readFileSync(join(process.cwd(),'supabase/migrations/20261116002542_ia06_block_authenticated_users_role_clinic_payment_mfa_mutation.sql'),'utf8');
const definition=migration.match(/CREATE FUNCTION public\.users_privileged_field_update_guard_v1\(\)[\s\S]*?\$ia06_guard\$;/)?.[0];
const trigger=migration.match(/CREATE TRIGGER trg_users_privileged_fields_guard_v1[\s\S]*?;/)?.[0];
const fields=[...migration.matchAll(/NEW\.(\w+) IS DISTINCT FROM OLD\.\1/g)].map(m=>m[1]);

test('IA-06 user privileges stay backend-authoritative with narrow RLS-compatible trigger',()=>{
  assert.ok(definition,'Guard function must be present in migration');
  assert.ok(trigger,'Guard binding must be present in migration');
  assert.equal(fields.length,38,'Unexpected protected-fields inventory');
  assert.equal(new Set(fields).size,38,'Duplicate fields detected');
  for(const col of ['id','email','role','clinic_id','subscription_status','stripe_customer_id','two_factor_enabled','two_factor_secret','type','first_login_completed','is_demo_user','complimentary_plan_granted_at']){
    assert.ok(fields.includes(col),'Privileged field not protected: '+col);
  }
  for(const col of ['name','profile_picture','age','updated_at']) assert.ok(!fields.includes(col),'Legitimate profile field inadvertently guarded: '+col);
  assert.match(migration,/IA06_USERS_SELF_UPDATE_POLICY_DRIFT/);
  assert.match(definition,/SECURITY INVOKER/);
  assert.match(definition,/USER_PRIVILEGED_FIELD_UPDATE_DENIED/);
  assert.match(migration,/REVOKE EXECUTE ON FUNCTION public\.users_privileged_field_update_guard_v1\(\) FROM PUBLIC,anon,authenticated/);
  assert.match(migration,/IA06_USERS_GUARD_ACL_FAILURE/);
  assert.doesNotMatch(migration,/\b(?:INSERT INTO|DELETE FROM|UPDATE)\s+public\.users\b/i);
});

test('IA-06 PostgreSQL refuses forged role, clinic, billing and MFA, permits ordinary profile Save and backend', {
  skip:process.env.VERTO_IA06_POSTGRES_TEST!=='1',
},async()=>{
  const db=new pg.Client();await db.connect();
  const user='11111111-1111-4111-8111-111111111111';
  const clinicA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const clinicB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const typeOf=col=>{
    if(['id','clinic_id','pending_billing_requested_by','complimentary_plan_granted_by'].includes(col))return 'uuid';
    if(['is_demo_user','two_factor_enabled','first_login_completed'].includes(col))return 'boolean';
    if(col==='plan_price')return 'numeric';
    if(['current_active_patient_count','current_active_patient_limit','pending_billing_quantity'].includes(col))return 'integer';
    if(['created_at','demo_expires_at','stripe_payment_failed_at','stripe_access_block_at','pending_effective_date','pending_billing_requested_at','complimentary_plan_granted_at'].includes(col))return 'timestamptz';
    return 'text';
  };
  const expectDenied=async(sql,values)=>{
    await db.query('SAVEPOINT denied_profile');
    try{await assert.rejects(db.query(sql,values),err=>err.code==='42501');}
    finally{await db.query('ROLLBACK TO SAVEPOINT denied_profile');await db.query('RELEASE SAVEPOINT denied_profile');}
  };
  try{
    await db.query('BEGIN');
    await db.query('CREATE SCHEMA IF NOT EXISTS auth');
    await db.query("CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $q$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $q$");
    await db.query('CREATE ROLE ia06_users_client NOLOGIN');
    await db.query('CREATE TABLE public.users('+fields.map(col=>'"'+col+'" '+typeOf(col)).join(',')+',name text,profile_picture text,age integer,updated_at timestamptz)');
    await db.query('INSERT INTO public.users(id,email,role,clinic_id,name,subscription_status) VALUES($1,$2,$3,$4,$5,$6)',[user,'ci@example.test','therapist',clinicA,'Original','pending']);
    await db.query(definition);
    await db.query(trigger);
    await db.query('REVOKE EXECUTE ON FUNCTION public.users_privileged_field_update_guard_v1() FROM PUBLIC');
    await db.query('GRANT USAGE ON SCHEMA public,auth TO ia06_users_client');
    await db.query('GRANT SELECT,UPDATE ON public.users TO ia06_users_client');
    await db.query('ALTER TABLE public.users ENABLE ROW LEVEL SECURITY');
    await db.query('CREATE POLICY user_self_select ON public.users FOR SELECT TO ia06_users_client USING(id=auth.uid())');
    await db.query('CREATE POLICY user_self_update ON public.users FOR UPDATE TO ia06_users_client USING(id=auth.uid()) WITH CHECK(id=auth.uid())');
    await db.query("SELECT set_config('request.jwt.claim.role','authenticated',true)");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user]);
    await db.query('SET LOCAL ROLE ia06_users_client');
    await expectDenied('UPDATE public.users SET role=$1 WHERE id=$2',['owner',user]);
    await expectDenied('UPDATE public.users SET clinic_id=$1 WHERE id=$2',[clinicB,user]);
    await expectDenied('UPDATE public.users SET subscription_status=$1 WHERE id=$2',['active',user]);
    await expectDenied('UPDATE public.users SET stripe_customer_id=$1 WHERE id=$2',['cus_forged',user]);
    await expectDenied('UPDATE public.users SET two_factor_enabled=$1 WHERE id=$2',[true,user]);
    await expectDenied('UPDATE public.users SET first_login_completed=$1 WHERE id=$2',[true,user]);
    await expectDenied('UPDATE public.users SET type=$1 WHERE id=$2',['director',user]);
    await db.query('UPDATE public.users SET name=$1,profile_picture=$2 WHERE id=$3',['Allowed','avatar-test',user]);
    const self=(await db.query('SELECT name,profile_picture,role,clinic_id,subscription_status FROM public.users WHERE id=$1',[user])).rows[0];
    assert.equal(self.name,'Allowed');
    assert.equal(self.profile_picture,'avatar-test');
    assert.equal(self.role,'therapist');
    assert.equal(self.clinic_id,clinicA);
    assert.equal(self.subscription_status,'pending');
    await db.query('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.role','service_role',true)");
    await db.query('UPDATE public.users SET role=$1 WHERE id=$2',['director',user]);
    const backend=(await db.query('SELECT role FROM public.users WHERE id=$1',[user])).rows[0];
    assert.equal(backend.role,'director');
  }finally{try{await db.query('ROLLBACK');}finally{await db.end();}}
});
