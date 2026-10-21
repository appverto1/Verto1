import assert from 'node:assert/strict';
import { previewGroupSessionRates } from '../services/groupSessions/groupSessionPricePreview';

const clinic = 'b138ce3b-e24e-4c26-918b-6b72f8c51f47';
const outside = 'd745a2f6-3e82-455c-b7bb-5853bf53e15b';
const first = '5502e3c5-f4c1-4a18-ae65-714180e38b92';
const second = '46b81ab1-d910-4b87-90d3-30d0f0d5886f';
const planBase = { organization_id:clinic,service_type:'SPEECH_THERAPY',billing_mode:'PRIVATE',status:'ACTIVE' };
const planRows = [
  { ...planBase, patient_id:first, id:'98100c4d-23f4-4a5c-87ad-2778df202d9d',group_amount_cents:8500 },
  { ...planBase, patient_id:second, id:'ab64e1e1-9aba-4287-822a-038539d9fb95',group_amount_cents:6500 }
];
function makeDb(patients=[first,second], plans:any[]=planRows) {
  const calls: Array<{table:string,select?:string,eq:Array<[string,unknown]>,in:Array<[string,unknown[]]>,limit?:number}> = [];
  return {
    calls,
    from(table:string) {
      const call:{table:string,select?:string,eq:Array<[string,unknown]>,in:Array<[string,unknown[]]>,limit?:number} = {table,eq:[],in:[]};
      calls.push(call);
      const chain = {
        select(columns:string) {call.select=columns; return chain;},
        eq(column:string,value:unknown) {call.eq.push([column,value]);return chain;},
        in(column:string,values:unknown[]) {call.in.push([column,values]);return chain;},
        limit(max:number) {
          call.limit=max;
          return Promise.resolve({ data: table==='patients'
            ? patients.map(id=>({id}))
            : plans, error:null });
        }
      };
      return chain;
    }
  };
}
const goodDb = makeDb();
const result=await previewGroupSessionRates({
  supabase:goodDb,authenticatedClinicId:clinic,specialty:'Fonoaudiólogo',patientIds:[first,second]
});
assert.equal(result.ok,true);
if(result.ok) assert.deepEqual(result.rates.map(row=>row.amountCents),[8500,6500]);
assert.equal(goodDb.calls.length,2,'independent of patient count; no N+1');
assert.ok(goodDb.calls[0].eq.some(([name,value])=>name==='clinic_id'&&value===clinic));
assert.ok(goodDb.calls[1].eq.some(([name,value])=>name==='organization_id'&&value===clinic));
assert.ok(goodDb.calls[1].select?.includes('group_amount_cents'));
assert.equal((await previewGroupSessionRates({
  supabase:makeDb([first]),authenticatedClinicId:clinic,specialty:'Fonoaudiólogo',patientIds:[first,second]
})).ok,false,'patient outside authenticated clinic not eligible');
assert.equal((await previewGroupSessionRates({
  supabase:makeDb(),authenticatedClinicId:outside,specialty:'Fonoaudiólogo',patientIds:[first,second]
})).ok,false,'foreign clinic cannot borrow matching plans');
const invalidDb=makeDb();
assert.equal((await previewGroupSessionRates({
  supabase:invalidDb,authenticatedClinicId:clinic,specialty:'Fonoaudiólogo',patientIds:[first,first]
})).ok,false);
assert.equal(invalidDb.calls.length,0,'invalid IDs are rejected before DB I/O');
assert.equal((await previewGroupSessionRates({
  supabase:makeDb(),authenticatedClinicId:clinic,specialty:'Fonoaudiólogo',patientIds:[first,second],
})).ok,true);
assert.equal((await previewGroupSessionRates({
  supabase:makeDb([first,second],planRows.map(plan=>({...plan,group_amount_cents:0}))),
  authenticatedClinicId:clinic,specialty:'Fonoaudiólogo',patientIds:[first,second]
})).ok,false,'never substitute individual rate for missing group rate');
const datedDb = makeDb();
const dated=await previewGroupSessionRates({
  supabase:datedDb, authenticatedClinicId:clinic,specialty:'Fonoaudiólogo',
  patientIds:[first,second],scheduledStartAt:'2026-11-02T13:00:00Z',localDate:'2026-11-02'
});
assert.equal(dated.ok,true);
assert.equal(datedDb.calls.length,2,'date-aware added-participant preview must keep same two batched reads');
assert.match(datedDb.calls[1].select||'',/valid_from,valid_until,package_valid_until/);
const expired=await previewGroupSessionRates({
  supabase:makeDb([first,second],planRows.map((plan,i)=>i===0
    ? {...plan,valid_until:'2026-11-02T13:00:00Z'} : plan)),
  authenticatedClinicId:clinic,specialty:'Fonoaudiólogo',
  patientIds:[first,second],scheduledStartAt:'2026-11-02T13:00:00Z',localDate:'2026-11-02'
});
assert.deepEqual(expired,{ok:false,code:'GROUP_PRICING_PLAN_NOT_VALID_AT_DATE',patientId:first},
  'adding a patient cannot quote a plan expired at the reserved group slot');
const noDateDb=makeDb();
assert.deepEqual(await previewGroupSessionRates({
  supabase:noDateDb,authenticatedClinicId:clinic,specialty:'Fonoaudiólogo',patientIds:[first,second],
  localDate:'2026-11-02',
}),{ok:false,code:'GROUP_PREVIEW_DATE_INVALID'});
assert.equal(noDateDb.calls.length,0,'malformed date preview must be rejected without DB I/O');

console.log('groupSessionPricePreview.test.ts: ok');
