import assert from 'node:assert/strict';
import { registerGroupSessionFinancialRateRoutes } from '../services/groupSessions/groupSessionFinancialRateRoutes';

const clinic='b138ce3b-e24e-4c26-918b-6b72f8c51f47';
const actor='8ca32b47-a4c2-4766-a068-84d8c1b5c43d';
const patient='5502e3c5-f4c1-4a18-ae65-714180e38b92';
const plan='98100c4d-23f4-4a5c-87ad-2778df202d9d';
const moduleNames:string[]=[];const capabilities:string[]=[];const calls:any[]=[];
const noop=()=>{};
let handler:any;
const app:any={patch(url:string,...handlers:any[]){calls.push(['route',url,handlers.length]);handler=handlers.at(-1)}};
const deps={
  supabase:{async rpc(name:string,payload:any){calls.push(['rpc',name,payload]);return {data:{success:true,financial_plan_id:plan,group_amount_cents:8000,version:2},error:null}}},
  checkAuth:noop,noStoreDynamicResponse:noop,portalActionLimiter:noop,
  requireClinicCapability(cap:string){capabilities.push(cap);return noop},
  requireClinicModule(module:string){moduleNames.push(module);return noop},
  currentClinicId(){return clinic},
  enforcePayloadLimit(){return true}
};
registerGroupSessionFinancialRateRoutes(app,deps);
assert.deepEqual(moduleNames,['appointments_communication']);
assert.deepEqual(capabilities,['patient.demographics.edit','finance.entries.manage']);
assert.equal(calls[0][1],'/api/patients/:patientId/financial-plans/:planId/group-rate');
assert.equal(calls[0][2],7,'rate route has limiter/cache/auth/module/capabilities + handler');
const res=()=>({statusCode:200,body:null as any,status(code:number){this.statusCode=code;return this;},json(value:any){this.body=value;return this;}});
const req=(changes:any={})=>({
  session:{user:{id:actor}},params:{patientId:patient,planId:plan},
  body:{groupAmountCents:8000},...changes
});
const output=res();
await handler(req(),output);
assert.equal(output.statusCode,200);
assert.equal(output.body.group_amount_cents,8000);
assert.equal(calls.length,2);
assert.equal(calls[1][1],'update_patient_specialty_group_rate_v1');
assert.equal(calls[1][2].p_organization_id,clinic);
assert.equal(calls[1][2].p_actor_id,actor);
assert.equal(calls[1][2].p_group_amount_cents,8000);
for (const invalid of [{body:{groupAmountCents:-1}},{body:{groupAmountCents:'8000'}},{body:{groupAmountCents:NaN}},{params:{patientId:'other',planId:plan}}]) {
  const before=calls.length;const response=res();
  await handler(req(invalid),response);
  assert.ok([400,422].includes(response.statusCode));
  assert.equal(calls.length,before,'invalid or forged payload never reaches database');
}
const off=res();await handler(req({body:{groupAmountCents:0}}),off);
assert.equal(off.statusCode,200,'explicit zero can disable group rate');
const stale:any={...deps,supabase:{async rpc(){return {data:{success:false,code:'GROUP_RATE_STALE_PLAN'},error:null}}}};
const registered:any={patch(_url:string,...fns:any[]){handler=fns.at(-1)}};
registerGroupSessionFinancialRateRoutes(registered,stale);
const response=res();await handler(req(),response);
assert.equal(response.statusCode,409,'concurrent stale editor cannot overwrite rate');
console.log('groupSessionFinancialRateRoutes.test.ts: ok');
