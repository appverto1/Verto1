import assert from 'node:assert/strict';
import { createAbaV3DrainStatusHandler } from '../services/abaV3DrainStatusHandler';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const start = server.indexOf("'/api/aba/v3/admin/drain-status'");
const end = server.indexOf("'/api/aba/v3/admin/cohort-catalog'", start);
assert.ok(start > 0 && end > start);
const registration = server.slice(start,end);
assert.match(registration,/requireAbaV3PreflightFeature,\s*checkAuth,\s*checkPlatformAdmin,\s*createAbaV3DrainStatusHandler/);
assert.equal(server.split("'/api/aba/v3/admin/drain-status'").length - 1, 1);
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let calls = 0; let rpcPayload: any = null; let failure = false;
const handler = createAbaV3DrainStatusHandler({
  sanitizeString:(v:any,n=500)=>String(v??'').trim().slice(0,n),
  isUuid:(v:any)=>v===id,
  supabase:{rpc:async(name:string,payload:any)=>{calls++;assert.equal(name,'get_aba_v3_rollout_drain_status');rpcPayload=payload;return failure?{error:{message:'unavailable'}}:{data:{pending:3},error:null};}},
  handleAbaV3RolloutRpcError:(res:any,error:any)=>res.status(503).json({error:error.message}),
});
const invoke = async(query:any) => {
  const result:any={statusCode:200,headers:{},payload:null};
  const res:any={
    status(code:number){result.statusCode=code;return this;},
    setHeader(k:string,v:string){result.headers[k]=v;return this;},
    json(payload:any){result.payload=payload;return this;},
  };
  await handler({query} as any,res);
  return result;
};
let r=await invoke({organizationId:id,scopeType:'TARGET',patientId:id});
assert.equal(r.statusCode,200);
assert.deepEqual(r.payload,{success:true,data:{pending:3}});
assert.equal(r.headers['Cache-Control'],'private, no-store');
assert.deepEqual(rpcPayload,{p_organization_id:id,p_scope_type:'TARGET',p_patient_id:id,p_program_id:null,p_target_id:null});
r=await invoke({organizationId:'invalid'});
assert.equal(r.statusCode,400);
assert.equal(calls,1);
r=await invoke({organizationId:id,patientId:'invalid'});
assert.equal(r.statusCode,422);
assert.equal(calls,1);
failure=true;
r=await invoke({organizationId:id});
assert.equal(r.statusCode,503);
assert.equal(calls,2);
console.log('abaV3DrainStatusHandler.test.ts: PASS');
