import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {registerClinicSchedulingSpecialtyRoute} from '../services/groupSessions/clinicSchedulingSpecialtyRoute';
const clinic='70000000-0000-4000-8000-000000000001',other='70000000-0000-4000-8000-000000000002';
let handlers:any[]=[];const filters:any[]=[];let reads=0;
const deps={noStoreDynamicResponse:(_q:any,_s:any,n:any)=>n(),checkAuth:(q:any,s:any,n:any)=>q.auth?n():s.status(401).json({success:false}),requireAnyClinicCapability:()=> (q:any,s:any,n:any)=>q.allowed?n():s.status(403).json({success:false}),currentClinicId:(user:any)=>user.clinicId,
  supabase:{from(table:string){reads++;assert.equal(table,'clinic_memberships');return{select(columns:string){assert.equal(columns,'user_id,specialty');return this;},eq(k:string,v:any){filters.push([k,v]);return this;},limit:async()=>({data:[{user_id:clinic,specialty:'Fonoaudiólogo'},{user_id:other,specialty:'ABA'}],error:null})};}}};
registerClinicSchedulingSpecialtyRoute({get:(path:string,...h:any[])=>{assert.equal(path,'/api/clinic/scheduling-specialties');handlers=h;}} as any,deps);
async function run(changes:any={}){const req={auth:true,allowed:true,session:{user:{clinicId:clinic}},query:{clinicId:other},...changes};const res:any={statusCode:200,status(v:number){this.statusCode=v;return this;},json(v:any){this.body=v;return this;}};let i=0;const next=async()=>{if(i<handlers.length)await handlers[i++](req,res,next);};await next();return res;}
assert.equal((await run({auth:false})).statusCode,401);assert.equal((await run({allowed:false})).statusCode,403);assert.equal(reads,0);
assert.equal((await run({session:{user:{clinicId:'invalid'}}})).statusCode,403);assert.equal(reads,0);
const read=await run();assert.equal(read.statusCode,200);assert.deepEqual(filters,[['clinic_id',clinic],['status','active'],['role','therapist']]);assert.equal(read.body.clinicId,clinic);assert.equal(read.body.data.length,1);
// Execute the real dataService method with a backend cookie session and no Supabase client.
const source=fs.readFileSync('src/services/dataService.ts','utf8');const start=source.indexOf('  async getClinicSchedulingSpecialties('),end=source.indexOf('\n  async getClinicMemberAuthorization',start);
let responseBody=read.body;let calls=0;
const ctx:any={getSupabase:()=>{throw Error('browser Supabase session must not be required');},getAuthHeaders:async()=>({}),safeJson:async(r:any)=>r.json(),fetch:async(url:string,options:any)=>{calls++;assert.equal(url,'/api/clinic/scheduling-specialties');assert.equal(options.credentials,'include');assert.equal(options.cache,'no-store');return{ok:true,json:async()=>responseBody};}};
vm.createContext(ctx);vm.runInContext(ts.transpileModule('const service={'+source.slice(start,end)+'};globalThis.get=service.getClinicSchedulingSpecialties;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
assert.equal((await ctx.get(clinic)).success,true);assert.equal(calls,1);
responseBody={...read.body,clinicId:other};assert.equal((await ctx.get(clinic)).success,false,'workspace switch must not reuse another clinic response');
const before=calls;assert.equal((await ctx.get('invalid')).success,false);assert.equal(calls,before);
console.log('groupSessionSpecialtyTransport: cookie-only session, active clinic membership filters, permission denial, specialty validation and switched-workspace rejection passed');
