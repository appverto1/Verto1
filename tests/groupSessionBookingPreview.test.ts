import assert from 'node:assert/strict';
import { previewNewGroupBooking } from '../services/groupSessions/groupSessionBookingPreview';

const clinic='b138ce3b-e24e-4c26-918b-6b72f8c51f47';
const other='d745a2f6-3e82-455c-b7bb-5853bf53e15b';
const patient1='5502e3c5-f4c1-4a18-ae65-714180e38b92';
const patient2='46b81ab1-d910-4b87-90d3-30d0f0d5886f';
const professional='9128fd0a-9e77-42f9-98c9-d86403d6f7b0';
const room='a87b5cd6-4493-4f25-a5ea-48901fe0fe39';
const rows:Record<string,any[]> = {
  patients:[{id:patient1,clinic_id:clinic},{id:patient2,clinic_id:clinic}],
  clinic_memberships:[{user_id:professional,clinic_id:clinic,role:'therapist',status:'active',specialty:'Fonoaudiólogo'}],
  clinic_rooms:[{id:room,clinic_id:clinic,organization_id:clinic,is_active:true,capacity:3,prevent_overlapping_appointments:true}],
  clinics:[{id:clinic,timezone:'America/Sao_Paulo'}],
  appointments:[],
  patient_financial_plans:[
    {id:'98100c4d-23f4-4a5c-87ad-2778df202d9d',organization_id:clinic,patient_id:patient1,status:'ACTIVE',billing_mode:'PRIVATE',service_type:'SPEECH_THERAPY',group_amount_cents:8000},
    {id:'ab64e1e1-9aba-4287-822a-038539d9fb95',organization_id:clinic,patient_id:patient2,status:'ACTIVE',billing_mode:'PRIVATE',service_type:'SPEECH_THERAPY',group_amount_cents:7000}
  ],
};
type Query = {table:string;cols:string;filters:Record<string,unknown>;limit?:number};
const calls:Query[]=[];
function supabaseWith(overrides:Record<string,any[]> = {}, errorTable = '') {
  return {
    from(table:string) {
      const q:Query={table,cols:'',filters:{}};
      calls.push(q);
      const finish=()=> errorTable === table
        ? { data:null,error:{code:'42703'} }
        : { data:overrides[table] ?? rows[table] ?? [],error:null };
      const chain={
        select(cols:string){q.cols=cols;return chain;},
        eq(key:string,value:unknown){q.filters[key]=value;return chain;},
        in(key:string,values:string[]){q.filters[key]=values;return chain;},
        is(key:string,value:unknown){q.filters[key]=value;return chain;},
        or(value:string){q.filters.or=value;return chain;},
        limit(n:number){q.limit=n;return table==='clinics' ? chain : Promise.resolve(finish());},
        maybeSingle(){const result=finish();return Promise.resolve({
          ...result,data:Array.isArray(result.data)?result.data[0] || null:result.data,
        });}
      };
      return chain;
    }
  };
}
const input={
  authenticatedClinicId:clinic,patientIds:[patient1,patient2],professionalIds:[professional],
  specialty:'Fonoaudiologia',date:'2026-10-16',startTime:'21:45',
  durationMinutes:50,roomId:room,idempotencyKey:'group-create:abc12345',
  scheduledStartAt:'2026-10-17T00:45:00Z'
};
const result=await previewNewGroupBooking({...input,supabase:supabaseWith()});
assert.equal(result.ok,true);
if (result.ok) {
  assert.equal(result.plan.modality,'GROUP');
  assert.deepEqual(result.plan.patients.map(item=>item.priceCents),[8000,7000]);
}
assert.equal(calls.length,6,'four canonical resource reads plus clinic timezone and one appointment collision batch');
assert.deepEqual(calls.map(q=>q.table),['patients','clinic_memberships','clinic_rooms','patient_financial_plans','clinics','appointments']);
for(const query of calls) {
  assert.equal(query.filters[query.table==='patient_financial_plans'?'organization_id':query.table==='clinics'?'id':'clinic_id'],clinic);
  assert.ok(query.cols && !query.cols.includes('*'));
}
assert.equal(calls.find(q=>q.table==='patient_financial_plans')?.limit,201);
calls.length=0;
const bad=await previewNewGroupBooking({...input,patientIds:[patient1,patient1],supabase:supabaseWith()});
assert.equal(bad.ok,false);
assert.equal(calls.length,0,'invalid input must not spend DB queries');
for (const changes of [
  {date:'2026-02-30'},
  {startTime:'25:00'},
  {durationMinutes:361},
  {durationMinutes:0},
  {specialty:'   '},
  {idempotencyKey:'short'},
  {scheduledStartAt:'2026-10-16T21:45:00'},
  {scheduledStartAt:'not-a-timestamp'},
  {scheduledStartAt:'2026-10-17T00:45:30Z'},
  {scheduledStartAt:'2026-10-17T00:45:00.001Z'},
]) {
  calls.length = 0;
  const rejected = await previewNewGroupBooking({...input,...changes,supabase:supabaseWith()});
  assert.deepEqual(rejected,{ok:false,code:'GROUP_PREVIEW_INPUT_INVALID'},JSON.stringify(changes));
  assert.equal(calls.length,0,'invalid calendar payload must not consume batch reads');
}
const foreign=await previewNewGroupBooking({...input,supabase:supabaseWith({
  clinic_memberships:[{...rows.clinic_memberships[0],clinic_id:other}]
})});
assert.equal(foreign.ok,false,'other-clinic therapist must be denied');
const wrongSpec=await previewNewGroupBooking({...input,supabase:supabaseWith({
  clinic_memberships:[{...rows.clinic_memberships[0],specialty:'Psicologia'}]
})});
assert.equal(wrongSpec.ok,false,'professional specialty mismatch');
const blockedRoom=await previewNewGroupBooking({...input,supabase:supabaseWith({
  clinic_rooms:[{...rows.clinic_rooms[0],capacity:1}]
})});
assert.equal(blockedRoom.ok,false,'room capacity enforced');
const missingPrice=await previewNewGroupBooking({...input,supabase:supabaseWith({
  patient_financial_plans:[rows.patient_financial_plans[0]]
})});
assert.equal(missingPrice.ok,false,'missing rate must block creation');
const missingMig=await previewNewGroupBooking({...input,supabase:supabaseWith({},'patient_financial_plans')});
assert.deepEqual(missingMig,{ok:false,code:'GROUP_PRICING_MIGRATION_REQUIRED'});
const booked={id:'prior-appointment',clinic_id:clinic,patient_id:'another-patient',
  therapist_id:professional,room_id:room,status:'scheduled',
  scheduled_start_at:'2026-10-17T00:45:00Z',scheduled_end_at:'2026-10-17T01:35:00Z'};
const conflicting=await previewNewGroupBooking({...input,supabase:supabaseWith({
  appointments:[booked]
})});
assert.deepEqual(conflicting,{ok:false,code:'GROUP_PROFESSIONAL_BUSY'},
  'same professional cannot join a different appointment with overlapping clock time');
const forbiddenRoom=await previewNewGroupBooking({...input,supabase:supabaseWith({
  appointments:[{...booked,therapist_id:'another-therapist'}]
})});
assert.deepEqual(forbiddenRoom,{ok:false,code:'GROUP_ROOM_BUSY'});
const sharedRoom=await previewNewGroupBooking({...input,supabase:supabaseWith({
  clinic_rooms:[{...rows.clinic_rooms[0],prevent_overlapping_appointments:false}],
  appointments:[{...booked,therapist_id:'another-therapist'}],
})});
assert.equal(sharedRoom.ok,true,'sharing room does not automatically share professional');
const badTimezone=await previewNewGroupBooking({...input,scheduledStartAt:'2026-10-17T01:45:00Z',supabase:supabaseWith()});
assert.deepEqual(badTimezone,{ok:false,code:'GROUP_PREVIEW_TIMEZONE_INVALID'});
const truncated=await previewNewGroupBooking({...input,supabase:supabaseWith({
  appointments:Array.from({length:251},()=>({...booked}))
})});
assert.deepEqual(truncated,{ok:false,code:'GROUP_PREVIEW_APPOINTMENTS_TRUNCATED'});
console.log('groupSessionBookingPreview.test.ts: ok');
