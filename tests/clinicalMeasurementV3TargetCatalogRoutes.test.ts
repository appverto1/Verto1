import assert from 'node:assert/strict';
import { registerClinicalMeasurementV3CatalogRoutes } from '../services/clinicalMeasurementV3CatalogRoutes';

type Handler=(req:any,res:any,next?:()=>Promise<void>)=>unknown;
const registrations: {path:string;handlers:Handler[]}[]=[];
const reads: {table:string; filters:[string,unknown][];limit:number}[]=[];
let targets:any[]=[], definitions:any[]=[], failTable:string|null=null;
const supabase={from:(table:string)=>{
  const read={table,filters:[] as [string,unknown][],limit:0};reads.push(read);
  const q={
    select:()=>q,
    eq:(key:string,value:unknown)=>{read.filters.push([key,value]);return q;},
    in:(key:string,value:unknown)=>{read.filters.push([key,value]);return q;},
    order:()=>q,
    limit:(n:number)=>{read.limit=n;return {data:table==='clinical_measurement_targets_v3'?targets:definitions,error:table===failTable?{code:'TEST',message:'failure'}:null};}
  };return q;
}};
const noStore:Handler=(req,_res,next)=>{req.trace.push('noStore');return next?.();};
const checkAuth:Handler=(req,res,next)=>{req.trace.push('auth');return req.session?.user?next?.():res.status(401).json({error:'AUTH_REQUIRED'});};
const capability=(key:string):Handler=>(req,res,next)=>{req.trace.push(key);return req.allowed?next?.():res.status(403).json({error:'FORBIDDEN'});};
const patientAccess:Handler=(req,_res,next)=>{req.trace.push('patientAccess');return next?.();};
registerClinicalMeasurementV3CatalogRoutes(
  {get:(path:string,...handlers:Handler[])=>registrations.push({path,handlers})} as any,
  {supabase,noStoreDynamicResponse:noStore,checkAuth,checkPatientAccess:patientAccess,requireClinicCapability:capability,
   sanitizeString:(value:unknown,max=120)=>String(value??'').trim().slice(0,max),
   currentClinicId:(user:any)=>user?.clinicId??null} as any
);
assert.deepEqual(registrations.map(r=>r.path),[
  '/api/clinical-measurement-v3/patients/:patientId/catalog',
  '/api/clinical-measurement-v3/patients/:patientId/targets/:targetId/view'
]);
assert.equal(registrations[0].handlers.length,5);
async function invoke(overrides:Record<string,any>={}) {
  reads.length=0;
  const req={params:{patientId:'patient-1'},resolvedPatientId:'patient-1',resolvedPatientClinicId:'clinic-1',
    session:{user:{clinicId:'clinic-1'}},allowed:true,trace:[] as string[],...overrides};
  let status=200,body:any;
  const res:any={status:(n:number)=>{status=n;return res;},json:(v:any)=>{body=v;return res;}};
  let i=0;const stack=registrations[0].handlers;
  const next=async():Promise<void>=>{if(i<stack.length)await stack[i++](req,res,next);};
  await next();return{status,body,trace:req.trace,reads:[...reads]};
}
let result=await invoke({session:{}});
assert.equal(result.status,401);assert.equal(result.reads.length,0);
result=await invoke({allowed:false});
assert.equal(result.status,403);assert.equal(result.reads.length,0);
result=await invoke({resolvedPatientId:'',params:{patientId:''}});
assert.equal(result.status,400);assert.equal(result.body.error,'CMV3_SCOPE_REQUIRED');
result=await invoke({resolvedPatientClinicId:'other-clinic'});
assert.equal(result.status,404);assert.equal(result.body.error,'CMV3_PATIENT_SCOPE_MISMATCH');assert.equal(result.reads.length,0);
result=await invoke();
assert.equal(result.status,200);assert.deepEqual(result.body,{success:true,data:{targets:[]}});assert.equal(result.reads.length,1);
targets=[{id:'target-1',target_key:'Goal',specialty:'TO'}];
definitions=[{id:'def-1',target_id:'target-1',definition_key:'count',semantic_family:'COUNT'}];
result=await invoke();
assert.equal(result.status,200);assert.equal(result.reads.length,2);
assert.equal(result.body.data.targets[0].definitions[0].definition_id,'def-1');
assert.deepEqual(result.trace,['noStore','auth','clinical.history.view','patientAccess']);
for(const read of result.reads){
 assert.ok(read.filters.some(([k,v])=>k==='organization_id'&&v==='clinic-1'));
 assert.ok(read.filters.some(([k,v])=>k==='patient_id'&&v==='patient-1'));
}
const originalConsoleError=console.error;
try{
 console.error=()=>{};
 failTable='clinical_measurement_targets_v3';
 result=await invoke();assert.equal(result.status,500);assert.equal(result.body.error,'CMV3_CATALOG_FAILED');
}finally{console.error=originalConsoleError;failTable=null;}
console.log('clinicalMeasurementV3TargetCatalogRoutes.test: PASS');
