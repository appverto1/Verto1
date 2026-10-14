import assert from 'node:assert/strict';
import { createProfessionalFinancialReceiptHandlers } from '../services/professionalFinancialReceiptHandlers.ts';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const THERAPIST = '22222222-2222-4222-8222-222222222222';
const PATIENT = '33333333-3333-4333-8333-333333333333';
const APPT = '44444444-4444-4444-8444-444444444444';
const PAYMENT = '55000000-0000-4000-8000-000000000000';
const request = (role='therapist', body={}) => ({
  session: { user: { id: THERAPIST, clinicId: CLINIC } },
  params: { paymentId: PAYMENT },
  body: { appointmentId: APPT, amount: 180, method: 'pix', idempotencyKey: 'smoke-unique-payment-key', ...body },
  headers: {},
  role
});
const response = () => ({
  code: 200, payload: null,
  status(value) { this.code = value; return this; },
  json(value) { this.payload = value; return this; }
});
function mockDb(role='therapist', snapshot=null, appointmentOverrides={}, itemCount=0) {
  const rpcCalls = [];
  const appointments = { id: APPT, organization_id: CLINIC, patient_id: PATIENT,
    therapist_id: THERAPIST, status: 'completed', actual_end_at: '2026-10-14T12:00:00Z',
    scheduled_at:'2026-10-14T11:00:00Z', service_type:'Fonoaudiologia', ...appointmentOverrides };
  const payments = { id: PAYMENT, patient_id: PATIENT, appointment_id: APPT,
    organization_id: CLINIC, amount:180, balance_amount:180, paid_amount:0,
    financial_status:'pending', source:'APPOINTMENT', private_price_source:'SPECIALTY_RULE' };
  const fixtures = {
    clinic_memberships: role==='therapist' ? [{user_id:THERAPIST,role,status:'active'}] : [],
    appointments: [appointments],
    payments: [payments],
    payment_appointment_items: Array.from({ length:itemCount },(_,i)=>({
      appointment_id:i===0?APPT:'99999999-9999-4999-8999-999999999999',payment_id:PAYMENT,active:true
    })),
    appointment_private_financial_snapshots: snapshot?[snapshot]:[],
    patients:[{id:PATIENT,name:'Paciente de teste'}]
  };
  const from = (table) => {
    const conds = [];let inFilter=null;
    const query = {
      select(){return this;}, eq(key,value){conds.push([key,value]);return this;},
      is(){return this;}, in(key,value){inFilter=[key,value];return this;},
      order(){return this;}, limit(){return this;},
      data(){
        let rows=fixtures[table]||[];
        for(const [key,value] of conds)rows=rows.filter(x=>String(x[key])===String(value));
        if(inFilter)rows=rows.filter(x=>inFilter[1].map(String).includes(String(x[inFilter[0]])));
        return rows;
      },
      async maybeSingle(){return {data:this.data()[0]||null,error:null};},
      then(resolve,reject){return Promise.resolve({data:this.data(),error:null}).then(resolve,reject);}
    };
    return query;
  };
  return { rpcCalls, client:{from,async rpc(name,args){rpcCalls.push({name,args});return {data:{charge:{id:PAYMENT}},error:null};}} };
}
function handlers(db){
  return createProfessionalFinancialReceiptHandlers({
    supabase:db.client,currentClinicId:user=>user.clinicId,
    isUuid:v=>/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v),
    sanitizeString:(v,n)=>String(v??'').slice(0,n),
    patientFinanceErrorResponse:()=>({status:500,error:'Erro financeiro'})
  });
}

{
 const db=mockDb('therapist');
 const res=response();await handlers(db).record(request('therapist'),res);
 assert.equal(res.code,200);
 assert.equal(res.payload.success,true);
 assert.equal(db.rpcCalls.length,1);
 assert.equal(db.rpcCalls[0].name,'apply_private_patient_financial_operation_v2');
 assert.equal(db.rpcCalls[0].args.p_operation,'PAYMENT');
 assert.equal(db.rpcCalls[0].args.p_method,'pix');
}
{
 const db=mockDb('guest');
 const res=response();await handlers(db).record(request('guest'),res);
 assert.equal(res.code,403);
 assert.equal(db.rpcCalls.length,0);
}
{
 const db=mockDb('therapist');
 const res=response();await handlers(db).record(request('therapist',{amount:90,notes:''}),res);
 assert.equal(res.code,400);
 assert.equal(db.rpcCalls.length,0);
}
{
 const db=mockDb('therapist');
 const res=response();await handlers(db).record(request('therapist',{amount:90,notes:'Pagamento parcial'}),res);
 assert.equal(res.code,200);
 assert.equal(db.rpcCalls[0].args.p_operation,'PARTIAL_PAYMENT');
}
{
 const db=mockDb('therapist',{allow_partial_payment:false,allowed_payment_methods:['pix']});
 const res=response();await handlers(db).record(request('therapist',{amount:90,notes:'Entrada'}),res);
 assert.equal(res.code,409);
 assert.equal(db.rpcCalls.length,0);
}
{
 const db=mockDb('therapist',null,{therapist_id:'99999999-9999-4999-8999-999999999999'});
 const res=response();await handlers(db).record(request('therapist'),res);
 assert.equal(res.code,403);
 assert.equal(db.rpcCalls.length,0);
}
{
 const db=mockDb('therapist',null,{},2);
 const res=response();await handlers(db).record(request('therapist'),res);
 assert.equal(res.code,403,'grouped charge must not be payable by a single therapist');
}
{
 const db=mockDb('therapist');
 const res=response();await handlers(db).list(request('therapist'),res);
 assert.equal(res.code,200);
 assert.equal(res.payload.data.length,1);
 assert.equal(res.payload.data[0].patientName,'Paciente de teste');
 assert.equal(res.payload.data[0].balance,180);
}
console.log('professional scoped financial receipts: PASS');
