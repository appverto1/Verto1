import assert from 'node:assert/strict';
import { registerGroupSessionBookingPreviewRoute } from '../services/groupSessions/groupSessionBookingPreviewRoute';

const clinic = 'b138ce3b-e24e-4c26-918b-6b72f8c51f47';
const patientA = '5502e3c5-f4c1-4a18-ae65-714180e38b92';
const patientB = '46b81ab1-d910-4b87-90d3-30d0f0d5886f';
const professional = '9128fd0a-9e77-42f9-98c9-d86403d6f7b0';
const room = 'a87b5cd6-4493-4f25-a5ea-48901fe0fe39';
const dbRows: Record<string,any[]> = {
  patients: [{id:patientA,clinic_id:clinic},{id:patientB,clinic_id:clinic}],
  clinic_memberships: [{user_id:professional,clinic_id:clinic,role:'therapist',status:'active',specialty:'Fonoaudiologia'}],
  clinic_rooms: [{id:room,clinic_id:clinic,organization_id:clinic,is_active:true,capacity:4}],
  clinics: [{id:clinic,timezone:'America/Sao_Paulo'}],
  appointments: [],
  patient_financial_plans: [
    {id:'98100c4d-23f4-4a5c-87ad-2778df202d9d',organization_id:clinic,patient_id:patientA,status:'ACTIVE',billing_mode:'PRIVATE',service_type:'SPEECH_THERAPY',group_amount_cents:8000},
    {id:'ab64e1e1-9aba-4287-822a-038539d9fb95',organization_id:clinic,patient_id:patientB,status:'ACTIVE',billing_mode:'PRIVATE',service_type:'SPEECH_THERAPY',group_amount_cents:7000},
  ]
};
const reads: string[]=[];
const supabase = {
  from(table: string) {
    reads.push(table);
    const query = {
      select(_columns:string){return query;},
      eq(_column:string,_value:unknown){return query;},
      in(_column:string,_values:unknown[]){return query;},
      is(_column:string,_value:unknown){return query;},
      or(_condition:string){return query;},
      limit(_count:number){return table === 'clinics' ? query : Promise.resolve({data:dbRows[table] || [],error:null});},
      maybeSingle(){return Promise.resolve({data:dbRows[table]?.[0] || null,error:null});},
    };
    return query;
  }
};
let handler: any;
let middlewares: any[] = [];
const caps:string[]=[];
const mods:string[]=[];
const app:any = { post(route:string,...handlers:any[]) {
  assert.equal(route,'/api/appointments/groups/booking-preview');
  handler=handlers.at(-1);
  middlewares=handlers;
}};
const noop=()=>{};
registerGroupSessionBookingPreviewRoute(app,{
  supabase, portalActionLimiter:noop, noStoreDynamicResponse:noop, checkAuth:noop,
  requireClinicModule(module:string){mods.push(module);return noop;},
  requireClinicCapability(cap:string){caps.push(cap);return noop;},
  currentClinicId(){return clinic;},
  enforcePayloadLimit(){return true;},
});
assert.deepEqual(mods,['appointments_communication']);
assert.deepEqual(caps,['calendar.appointment.create','patient.demographics.edit','finance.entries.view']);
assert.equal(middlewares.length,8);
const req=(body:any)=>({session:{user:{id:'authenticated-user'}},body});
const response=()=>({
  statusCode:200, body:null as any,
  status(code:number){this.statusCode=code;return this;},
  json(value:any){this.body=value;return this;}
});
const payload={
  patientIds:[patientA,patientB],professionalIds:[professional],specialty:'Fonoaudiologia',
  roomId:room,date:'2026-10-16',startTime:'21:45',durationMinutes:50,
  idempotencyKey:'group-preview:abcdefghijkl',scheduledStartAt:'2026-10-17T00:45:00Z',
};
const valid=response();
await handler(req(payload),valid);
assert.equal(valid.statusCode,200);
assert.equal(valid.body.success,true);
assert.equal(valid.body.reserved,false);
assert.equal(valid.body.availabilityConfirmed,false);
assert.deepEqual(valid.body.patientRates,[{patientId:patientA,amountCents:8000},{patientId:patientB,amountCents:7000}]);
assert.ok(!JSON.stringify(valid.body).includes('groupId'),'preview must not return an authorization-bearing group ID');
assert.deepEqual(reads,['patients','clinic_memberships','clinic_rooms','patient_financial_plans','clinics','appointments']);
reads.length=0;
const invalid=response();
await handler(req({...payload,patientIds:[patientA,patientA]}),invalid);
assert.equal(invalid.statusCode,422);
assert.equal(invalid.body.success,false);
assert.equal(reads.length,0,'invalid request must not spend DB queries');
const foreign=response();
await handler(req({...payload,patientIds:[patientA,'d745a2f6-3e82-455c-b7bb-5853bf53e15b']}),foreign);
assert.equal(foreign.statusCode,404);
assert.equal(foreign.body.success,false);
assert.ok(!JSON.stringify(foreign.body).includes('amountCents'));
const originalPlans = dbRows.patient_financial_plans;
dbRows.patient_financial_plans = originalPlans.filter(row => row.patient_id !== patientA);
const planMissing=response();
await handler(req(payload),planMissing);
assert.equal(planMissing.statusCode,409);
assert.equal(planMissing.body.code,'GROUP_PRICING_PLAN_MISSING');
assert.equal(planMissing.body.patientId,patientA,'only requested, clinic-scoped patient may be identified');
assert.match(planMissing.body.error,/plano financeiro particular ativo/i);
assert.doesNotMatch(planMissing.body.error,/HTTP 409/i);
dbRows.patient_financial_plans = originalPlans;
const originalCapacity = dbRows.clinic_rooms[0].capacity;
const extraPatient='ad658a23-1e5a-4c3b-9ac2-6fc66e8c580a';
dbRows.patients.push({id:extraPatient,clinic_id:clinic});
dbRows.clinic_rooms[0].capacity=2;
const capacityExceeded=response();
await handler(req({...payload,patientIds:[patientA,patientB,extraPatient]}),capacityExceeded);
assert.equal(capacityExceeded.statusCode,409);
assert.equal(capacityExceeded.body.code,'GROUP_ROOM_CAPACITY_EXCEEDED');
assert.match(capacityExceeded.body.error,/sala selecionada não comporta/i);
assert.equal(capacityExceeded.body.patientId,undefined);
dbRows.patients.pop();
dbRows.clinic_rooms[0].capacity=originalCapacity;
console.log('groupSessionBookingPreviewRoute.test.ts: ok');
