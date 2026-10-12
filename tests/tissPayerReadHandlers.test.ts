import assert from 'node:assert/strict';
import {
 createTissProviderProfileReadHandler,
 createTissPayerProfileReadHandler,
 createPatientTissAuthorizationReadHandler,
 createTissOwnProfessionalProfileReadHandler,
 createTissXmlDraftReadHandler,
 createTissPreGuidesCoverageReadHandler,
 createPayerOptionsReadHandler,
 createTissPreGuidesReadHandler
} from '../services/tissPayerReadHandlers';

const CLINIC='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const USER='33333333-3333-4333-8333-333333333333';
const VALID='44444444-4444-4444-8444-444444444444';
const sanitizeString=(value:unknown,length=120)=>String(value??'').slice(0,length);
const isUuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const payerSafeError=(status:number)=>({success:false,error:'safe_'+status});
const sendNoStoreJson=(res:any,payload:any)=>res.json(payload);
const request=(changes:any={})=>({
 session:{user:{id:USER,clinicId:CLINIC}},
 headers:{'x-clinic-id':OTHER},query:{},params:{},...changes
});
const response=()=>({
 statusCode:200,body:null as any,
 status(code:number){this.statusCode=code;return this;},
 json(data:any){this.body=data;return this;}
});
function dbMock(data:any=null) {
 const filters:Array<[string,unknown]>=[];
 const tables:string[]=[];
 const query=()=>({
  select(){return this;},eq(key:string,value:unknown){filters.push([key,value]);return this;},
  order(){return this;},limit(){return this;},in(){return this;},range(){return this;},gte(){return this;},lte(){return this;},overlaps(){return this;},
  async maybeSingle(){return {data,error:null};},
  then(resolve:any,reject?:any){return Promise.resolve({data,error:null,count:0}).then(resolve,reject);}
 });
 return {tables,filters,from(table:string){tables.push(table);return query();}};
}
{
 let calls=0;
 const handler=createTissProviderProfileReadHandler(()=>({
  currentClinicId:()=>null,sanitizeString,isUuid,payerSafeError,sendNoStoreJson,
  CLINIC_TISS_PROFILE_SELECT:'id',fetchTissPreGuideProfile:()=>{calls++;return null;}
 }));
 const res=response();await handler(request(),res);
 assert.equal(res.statusCode,400);assert.equal(calls,0,'invalid clinic cannot fetch provider config');
}
{
 let calls=0;
 const handler=createTissPayerProfileReadHandler(()=>({
  currentClinicId:()=>CLINIC,sanitizeString,isUuid,payerSafeError,sendNoStoreJson,PAYER_TISS_PROFILE_SELECT:'id',
  fetchPayerForAdmin:async()=>null,
  fetchTissPreGuideProfile:()=>{calls++;return null;}
 }));
 const res=response();await handler(request({params:{payerId:VALID}}),res);
 assert.equal(res.statusCode,404);assert.equal(calls,0,'foreign payer must not reveal profile');
}
{
 const db=dbMock();
 const handler=createPatientTissAuthorizationReadHandler(()=>({
  currentClinicId:()=>CLINIC,sanitizeString,isUuid,payerSafeError,sendNoStoreJson,sanitizeTextField:sanitizeString,
  supabase:db,PATIENT_PAYER_AUTHORIZATION_SELECT:'id',canAccessPatientBillingInCurrentClinic:async()=>false,
  hasMissingFinancialSchema:()=>false,isMissingRelationError:()=>false,
  hydratePatientPayerAuthorizations:async()=>[]
 }));
 const res=response();await handler(request({params:{patientId:VALID}}),res);
 assert.equal(res.statusCode,404);
 assert.deepEqual(db.filters,[['organization_id',CLINIC],['patient_id',VALID]],'query is scoped to active clinic');
}
{
 let recorded:any=null;
 const handler=createTissOwnProfessionalProfileReadHandler(()=>({
  currentClinicId:()=>CLINIC,sanitizeString,isUuid,payerSafeError,sendNoStoreJson,
  PROFESSIONAL_BILLING_PROFILE_SELECT:'id',
  fetchTissPreGuideProfile:async (...args:any[])=>{recorded=args;return {id:USER};}
 }));
 const res=response();await handler(request({params:{professionalId:OTHER}}),res);
 assert.equal(res.statusCode,200);
 assert.deepEqual(recorded,['professional_billing_profiles','id',CLINIC,'professional_id',USER],
  'professional identity must come from authenticated session');
}
{
 const db=dbMock();
 const handler=createTissXmlDraftReadHandler(()=>({
  currentClinicId:()=>CLINIC,sanitizeString,isUuid,payerSafeError,sendNoStoreJson,
  supabase:db,TISS_XML_DRAFT_DETAIL_SELECT:'id',hasMissingFinancialSchema:()=>false,
  isMissingRelationError:()=>false,serializeTissXmlDraft:(v:any)=>v
 }));
 const res=response();await handler(request({params:{draftId:'not-a-uuid'}}),res);
 assert.equal(res.statusCode,400);assert.equal(db.tables.length,0,'invalid draft cannot query DB');
}
{
 let calls=0;
 const handler=createTissPreGuidesCoverageReadHandler(()=>({
  currentClinicId:()=>CLINIC,sanitizeString,isUuid,payerSafeError,
  parseClosureDateRange:()=>({ok:false}),
  fetchClosurePeriodAppointmentRows:()=>{calls++;return [];},
  sanitizeTextField:sanitizeString
 }));
 const res=response();await handler(request({query:{from:'invalid'}}),res);
 assert.equal(res.statusCode,400);assert.equal(calls,0,'invalid coverage period must not read');
}
{
 const db=dbMock([]);
 const handler=createPayerOptionsReadHandler(()=>({
  currentClinicId:()=>CLINIC,sanitizeString,isUuid,parseBoundedListLimit:()=>10,
  supabase:db,hasMissingFinancialSchema:()=>false,normalizePayerType:(v:any)=>v
 }));
 const res=response();await handler(request(),res);
 assert.equal(res.statusCode,200);
 assert.deepEqual(db.filters.slice(0,2),[['organization_id',CLINIC],['payer_type','INSURANCE']],
  'forged header must not replace clinic scope');
}
{
 const db=dbMock([]);
 const handler=createTissPreGuidesReadHandler(()=>({
  currentClinicId:()=>OTHER,sanitizeString,isUuid,parseBoundedListLimit:()=>10,
  payerSafeError,sendNoStoreJson,supabase:db,
  APPOINTMENT_TISS_PRE_GUIDE_LIST_SELECT:'id',APPOINTMENT_TISS_PRE_GUIDE_LIST_BASE_SELECT:'id',
  tissPreGuideQuickFilterCodes:{},hasMissingFinancialSchema:()=>false,isMissingRelationError:()=>false,
  isOptionalTissPreGuideColumn:()=>false,extractMissingColumnName:()=>null
 }));
 const res=response();await handler(request(),res);
 assert.equal(res.statusCode,200,'TISS pre-guide list returns a successful scoped page');
 assert.ok(db.filters.some(([key,value])=>key==='organization_id'&&value===OTHER),'TISS pre-guide list uses currentClinicId for tenant scope');
}
console.log('PASS: 8 TISS/payer handler scenarios (clinic isolation, denial, invalid IDs, session identity, invalid period).');
