import assert from 'node:assert/strict';
import { registerClinicalMeasurementV3PlanRoutes } from '../services/clinicalMeasurementV3PlanRoutes';

type Middleware=(req:any,res:any,next?:()=>Promise<void>)=>unknown;
type Call={table:string;filters:Array<[string,unknown]>;columns:string;};
const routes:{method:string;path:string;stack:Middleware[]}[]=[];
const queries:Call[]=[];
let plans:any[]=[];
let rpcFailure=false;
let sqlFailure=false;
const uuid=(first:string)=>first.repeat(8)+'-'+first.repeat(4)+'-4'+first.repeat(3)+'-8'+first.repeat(3)+'-'+first.repeat(12);
const patient=uuid('a'),clinic=uuid('b'),plan=uuid('c'),actor=uuid('d');
let rpcRequests:Array<{name:string;payload:any}>=[];
const supabase={
  from:(table:string)=>{
    const log:Call={table,filters:[],columns:''};
    queries.push(log);
    const chain={
      select:(columns:string)=>{log.columns=columns;return chain;},
      eq:(k:string,v:unknown)=>{log.filters.push([k,v]);return chain;},
      in:(k:string,v:unknown)=>{log.filters.push([k,v]);return chain;},
      not:(k:string,_op:string,v:unknown)=>{log.filters.push([k,v]);return chain;},
      gte:(k:string,v:unknown)=>{log.filters.push([k,v]);return chain;},
      lte:(k:string,v:unknown)=>{log.filters.push([k,v]);return chain;},
      limit:(_n:number)=>({
        data:table==='patient_therapeutic_plans'?plans:[],
        error:sqlFailure?{message:'simulated db error'}:null,
      }),
    };return chain;
  },
  rpc:async(name:string,payload:any)=>{rpcRequests.push({name,payload});return {data:[],error:rpcFailure?{message:'simulated RPC error'}:null};},
};
registerClinicalMeasurementV3PlanRoutes(
 {post:(path:string,...stack:Middleware[])=>routes.push({method:'POST',path,stack}),
  get:(path:string,...stack:Middleware[])=>routes.push({method:'GET',path,stack})} as any,
 {supabase,
  noStoreDynamicResponse:(req:any,_res:any,next:any)=>{req.trace.push('no-store');return next();},
  checkAuth:(req:any,res:any,next:any)=>{req.trace.push('auth');return req.session?.user?next():res.status(401).json({error:'AUTH'});},
  requireClinicCapability:(cap:string)=>(req:any,res:any,next:any)=>{req.trace.push(cap);return req.capabilityAllowed?next():res.status(403).json({error:'CAPABILITY'});},
  checkPatientAccess:(req:any,_res:any,next:any)=>{req.trace.push('patient-access');return next();},
  sanitizeString:(value:any,max:number)=>String(value??'').trim().slice(0,max),
  currentClinicId:(user:any)=>user?.clinicId??null,
  enforcePayloadLimit:()=>true,
  canEditTherapeuticPlanScope:()=>true,
  filterTherapeuticPlanScopesForActor:(items:any[])=>items,
  filterTherapeuticPlanProgramsForActor:(items:any[])=>items} as any,
);
assert.deepEqual(routes.map(r=>[r.method,r.path]),[
 ['POST','/api/clinical-measurement-v3/patients/:patientId/plan-measurements'],
 ['GET','/api/clinical-measurement-v3/patients/:patientId/plan-outcomes'],
], 'registration order or public path changed');
assert.equal(routes[1].stack.length,5,'middleware stack changed');
async function invoke(overrides:any={}){
  queries.length=0;rpcRequests=[];
  const req={params:{patientId:patient},resolvedPatientId:patient,resolvedPatientClinicId:clinic,
    session:{user:{clinicId:clinic,id:actor}},capabilityAllowed:true,trace:[] as string[],
    effectiveClinicRole:'director',query:{},...overrides};
  let status=200,body:any;
  const res:any={status:(n:number)=>{status=n;return res;},json:(v:any)=>{body=v;return res;}};
  let idx=0;const stack=routes[1].stack;
  const next=async():Promise<void>=>{if(idx<stack.length)await stack[idx++](req,res,next);};
  await next();return {status,body,trace:req.trace,queries:[...queries],rpcs:[...rpcRequests]};
}
let result=await invoke({session:{user:null}});
assert.equal(result.status,401);assert.equal(result.queries.length,0);
result=await invoke({capabilityAllowed:false});
assert.equal(result.status,403);assert.equal(result.queries.length,0);
result=await invoke({resolvedPatientId:'',params:{patientId:''}});
assert.equal(result.status,400);assert.equal(result.body.error,'CMV3_PLAN_READ_SCOPE_REQUIRED');
result=await invoke({resolvedPatientClinicId:uuid('e')});
assert.equal(result.status,404);assert.equal(result.body.error,'CMV3_PATIENT_SCOPE_MISMATCH');
result=await invoke({query:{planId:'INVALID'}});
assert.equal(result.status,422);assert.equal(result.body.error,'CMV3_PLAN_READ_PLAN_INVALID');
result=await invoke();
assert.equal(result.status,200);assert.deepEqual(result.body.data,{rows:[]});
assert.equal(result.body.meta.rpcCount,0);assert.equal(result.queries.length,4);
assert.equal(result.rpcs.length,0);
assert.deepEqual(result.trace,['no-store','auth','reports.clinical.indicators','patient-access']);
plans=[{id:plan,patient_id:patient,organization_id:clinic,clinic_id:clinic}];
result=await invoke({query:{days:'30',planId:plan}});
assert.equal(result.status,200);assert.equal(result.queries.length,4);
assert.equal(result.rpcs.length,1);
assert.equal(result.rpcs[0].name,'read_clinical_outcomes_converged_v3');
assert.equal(result.rpcs[0].payload.p_organization_id,clinic);
assert.equal(result.rpcs[0].payload.p_patient_id,patient);
assert.deepEqual(result.rpcs[0].payload.p_plan_ids,[plan]);
assert.equal(result.rpcs[0].payload.p_limit,5000);
assert.equal(result.body.meta.periodDays,30);
for(const query of result.queries) {
  assert.ok(query.filters.some(([k,v])=>(k==='organization_id'||k==='clinic_id')&&v===clinic), 'clinic scope missing: '+query.table);
  assert.ok(query.filters.some(([k,v])=>k==='patient_id'&&v===patient), 'patient scope missing: '+query.table);
}
const previousConsole=console.error;
try {
  console.error=()=>{};
  rpcFailure=true;result=await invoke();assert.equal(result.status,500);
  assert.equal(result.body.error,'CMV3_PLAN_READ_FAILED');
  rpcFailure=false;
  sqlFailure=true;result=await invoke();assert.equal(result.status,500);
  assert.equal(result.body.error,'CMV3_PLAN_READ_FAILED');
} finally { console.error=previousConsole;rpcFailure=false;sqlFailure=false; }
console.log('clinicalMeasurementV3PlanOutcomesRoutes.test: PASS');
