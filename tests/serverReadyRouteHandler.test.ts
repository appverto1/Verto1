import assert from 'node:assert/strict';
import { createReadyRouteHandler } from '../services/readyRouteHandler';
const cases=[
  ['ready development',{},200,true],
  ['supabase rejection',{supabaseError:true},503,true],
  ['supabase throws',{supabaseThrows:true},503,true],
  ['otp missing',{otpFailure:true},503,true],
  ['otp throws',{otpThrows:true},503,true],
  ['session unreachable',{sessionFails:true},503,true],
  ['development without sessionPool',{noSessionPool:true},200,true],
  ['distributed healthy',{distributed:true},200,true],
  ['distributed down',{distributed:true,distributedFailure:true},503,true],
  ['distributed throws',{distributed:true,distributedThrows:true},503,true],
  ['production healthy',{prod:true},200,false],
  ['production without sessionPool',{prod:true,noSessionPool:true},503,false],
  ['production distributed down',{prod:true,distributed:true,distributedFailure:true},503,false],
] as const;
for(const [name,config,expectedStatus,checksVisible] of cases){
  const flags:Record<string,boolean>={...config};
  let dependenciesRead=0;
  const deps=()=>{
    dependenciesRead++;
    return {
      deploymentReleaseId:()=> 'release-test',
      isProd: Boolean(flags.prod),
      supabase:{from:(table:string)=>{
        assert.equal(table,'users');
        if(flags.supabaseThrows)throw Error('DB_DOWN');
        return {select:(column:string)=>{assert.equal(column,'id');return {
          limit:async(n:number)=>{assert.equal(n,1);return {error:flags.supabaseError?{message:'DB_DOWN'}:null};}
        };}};
      }},
      ensureOtpTableAvailability:async(strict:boolean)=>{
        assert.equal(strict,true);
        if(flags.otpThrows)throw Error('OTP_DOWN');
        return !flags.otpFailure;
      },
      sessionPool:flags.noSessionPool?null:{query:async(sql:string)=>{
        assert.equal(sql,'select 1');
        if(flags.sessionFails)throw Error('SESSION_DOWN');
      }},
      requiresDistributedRuntimeState:()=>Boolean(flags.distributed),
      checkDistributedRuntimeState:async()=>{
        if(flags.distributedThrows)throw Error('RUNTIME_DOWN');
        return !flags.distributedFailure;
      },
      cleanObject:(o:any)=>o,
    };
  };
  let code=0,response:any=null;
  const res:any={status(n:number){code=n;return res;},json(payload:any){response=payload;return res;}};
  await createReadyRouteHandler(deps)({},res);
  assert.equal(code,expectedStatus,name+' status');
  assert.equal(response.status,code===200?'ready':'not_ready',name+' payload');
  assert.equal(response.release,'release-test',name+' release');
  assert.equal(Object.hasOwn(response,'checks'),checksVisible,name+' checks visibility');
  assert.equal(dependenciesRead,1,name+' laziness');
}
console.log('serverReadyRouteHandler.test: PASS 13 scenarios');
