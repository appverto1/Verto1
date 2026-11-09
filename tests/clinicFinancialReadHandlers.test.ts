import assert from 'node:assert/strict';
import {
 createPrivatePricingCatalogReadHandler,
 createPrivatePricingSnapshotReadHandler,
 createPatientFinancePolicyReadHandler,
 createPatientFinanceTransactionDocumentReadHandler,
 createFinancialFeatureSurveyReadHandler,
} from '../services/clinicFinancialReadHandlers';

const CLINIC='11111111-1111-4111-8111-111111111111';
const FORGED='22222222-2222-4222-8222-222222222222';
const RECORD='33333333-3333-4333-8333-333333333333';
const isUuid=(v:unknown)=>typeof v==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const sanitizeString=(v:unknown,max=120)=>String(v??'').slice(0,max);
const errorResponse=()=>({status:500,error:'unexpected error'});
const req=(extra:any={})=>({
 session:{user:{id:RECORD,clinicId:CLINIC}},params:{},query:{},headers:{'x-clinic-id':FORGED},...extra,
});
const res=()=>({
 statusCode:200,body:null as any,
 status(code:number){this.statusCode=code;return this;},
 json(data:any){this.body=data;return this;},
});
function mockReadDb(data:any=null) {
 const filters:Array<[string,unknown]>=[];
 let reads=0;
 const query=()=>({
  select(_columns:any){return this;},
  eq(field:string,value:unknown){filters.push([field,value]);return this;},
  order(){return this;},
  limit(){return this;},
  async maybeSingle(){return {data,error:null};},
 });
 return {filters,get reads(){return reads;},from(_table:string){reads++;return query();}};
}
{
 const db=mockReadDb();
 const handler=createPatientFinancePolicyReadHandler(()=>({
  currentClinicId:()=>'',sanitizeString,isUuid,supabase:db,PATIENT_FINANCE_POLICY_SELECT:'id',
  hasMissingFinancialSchema:()=>false,patientFinanceErrorResponse:errorResponse,
 }));
 const reply=res();await handler(req(),reply);
 assert.equal(reply.statusCode,400);
 assert.equal(db.reads,0,'missing clinic cannot read financial data');
}
{
 const db=mockReadDb({id:RECORD});
 const handler=createPatientFinancePolicyReadHandler(()=>({
  currentClinicId:()=>CLINIC,sanitizeString,isUuid,supabase:db,PATIENT_FINANCE_POLICY_SELECT:'id',
  hasMissingFinancialSchema:()=>false,patientFinanceErrorResponse:errorResponse,
 }));
 const reply=res();await handler(req(),reply);
 assert.equal(reply.statusCode,200);
 assert.deepEqual(db.filters,[['organization_id',CLINIC]],'forged clinic header must never override session');
}
{
 const db=mockReadDb(null);
 const handler=createPatientFinanceTransactionDocumentReadHandler(()=>({
  currentClinicId:()=>CLINIC,sanitizeString,isUuid,supabase:db,sanitizeReceiptUrl:(s:any)=>s,patientFinanceErrorResponse:errorResponse,
 }));
 const reply=res();await handler(req({params:{transactionId:RECORD},query:{kind:'receipt'}}),reply);
 assert.equal(reply.statusCode,404,'missing tenant-scoped receipt is not exposed');
 assert.deepEqual(db.filters,[['id',RECORD],['organization_id',CLINIC]],'receipt lookup must enforce owning clinic');
}
{
 const db=mockReadDb();
 const handler=createPrivatePricingSnapshotReadHandler(()=>({
  currentClinicId:()=>CLINIC,sanitizeString,isUuid,supabase:db,PRIVATE_FINANCIAL_SNAPSHOT_SELECT:'id',
  privateSessionPricingErrorResponse:errorResponse,
 }));
 const reply=res();await handler(req({params:{appointmentId:'forged'}}),reply);
 assert.equal(reply.statusCode,400);
 assert.equal(db.reads,0,'invalid appointment ID cannot reach database');
}
{
 const db=mockReadDb(null);
 const handler=createPrivatePricingCatalogReadHandler(()=>({
  currentClinicId:()=>CLINIC,sanitizeString,isUuid,supabase:db,
  PRIVATE_PATIENT_AGREEMENT_SELECT:'id',PRIVATE_PRICE_RULE_SELECT:'id',TUSS_SERVICE_CATALOG_SELECT:'id',
  CLINIC_PAYER_SELECT:'id',privateSessionPricingErrorResponse:errorResponse,
 }));
 const reply=res();await handler(req({query:{patientId:RECORD}}),reply);
 assert.equal(reply.statusCode,403,'foreign-clinic patient is forbidden');
 assert.deepEqual(db.filters,[['id',RECORD],['clinic_id',CLINIC]],'patient lookup is scoped to active clinic');
}
{
 const handler=createFinancialFeatureSurveyReadHandler(()=>({
  currentClinicId:()=>null,supabase:{from(){throw Error('should not read');}},FINANCIAL_FEEDBACK_SELECT:'id',
 }));
 const reply=res();await handler(req(),reply);
 assert.equal(reply.statusCode,200);
 assert.deepEqual(reply.body,{success:true,submitted:false,data:null},'no context receives empty financial survey');
}
console.log('PASS: six financial handler scenarios including tenant forgery, foreign patient, invalid IDs and missing context.');
