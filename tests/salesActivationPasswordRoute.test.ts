import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { registerPublicSalesActivationPasswordRoute } from '../services/publicSalesActivationPasswordRoute';

const code=readFileSync('services/publicSalesActivationPasswordRoute.ts','utf8');
const marker='  app.post(\n    "/api/public/sales-activations/:token/password",';
const body=code.slice(code.indexOf(marker), code.indexOf('}\n\n// The handler body'));
const fnv=(s:string)=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),0x01000193)>>>0;return h.toString(16).padStart(8,'0');};

test('password activation route is the byte-identical original handler',()=>{
  assert.ok(body.startsWith(marker));
  assert.equal(fnv(body),'9a23e4a1');
  assert.match(body,/validateStrongPassword\(req\.body\?\.password\)/);
  assert.match(body,/loadPublicSalesActivation\(req\.params\?\.token\)/);
  assert.match(body,/recoverablePartialActivation/);
  assert.match(body,/finalizeSalesActivationForUser/);
  assert.doesNotMatch(body,/checkout\.sessions\.create|subscriptions\.create/);
});

function setup(opts:{weak?:boolean;invalid?:string|null}={}){
  let handler:any;
  let loaded=0;
  let authCalls=0;
  const app:any={post:(path:string,_limiter:any,cb:any)=>{
    assert.equal(path,'/api/public/sales-activations/:token/password');handler=cb;
  }};
  registerPublicSalesActivationPasswordRoute(app,{
    supabase:{} as any, publicSalesActivationLimiter:((_req:any,_res:any,next:any)=>next()) as any,
    validateStrongPassword:(pwd:unknown)=>opts.weak?null:String(pwd||''),
    loadPublicSalesActivation:async()=>{loaded++;return {error:opts.invalid||'SALES_ACTIVATION_NOT_FOUND'};},
    findAuthUserByEmail:async()=>{authCalls++;throw Error('Must not touch Auth');},
    fetchProfileWithSchemaFallback:async()=>{throw Error('Must not read profile');},
    insertUserProfileWithSchemaFallback:async()=>{throw Error('Must not write profile');},
    extractMissingColumnName:()=>null,cleanObject:(value:any)=>value,
    ensureClinicAndMembershipForCoordinator:async()=>{throw Error('Must not create clinic');},
    finalizeSalesActivationForUser:async()=>{throw Error('Must not activate');},
    maskEmail:()=>'<masked>',sanitizeEmail:(v:unknown)=>String(v||''),
    sanitizeString:(v:unknown,n=300)=>String(v||'').slice(0,n),
  });
  const state:any={status:200,body:null};
  const res:any={status:(status:number)=>{state.status=status;return res;},
    json:(body:any)=>{state.body=body;return res;}};
  const req:any={body:{password:'ValidStrong#Password123'},params:{token:'opaque'}};
  return {handler,req,res,state,access:()=>({loaded,authCalls})};
}
test('oversized body is rejected before validation, Auth and DB',async()=>{
 const f=setup();f.req.body={password:'P'.repeat(4097)};
 await f.handler(f.req,f.res);
 assert.equal(f.state.status,413);assert.equal(f.state.body.error,'PAYLOAD_TOO_LARGE');
 assert.deepEqual(f.access(),{loaded:0,authCalls:0});
});
test('weak password rejected before activation token lookup',async()=>{
 const f=setup({weak:true});
 await f.handler(f.req,f.res);
 assert.equal(f.state.status,400);assert.equal(f.state.body.error,'WEAK_PASSWORD');
 assert.deepEqual(f.access(),{loaded:0,authCalls:0});
});
test('expired/forged activation token cannot set password or enter clinic',async()=>{
 for(const [error,status] of [['SALES_ACTIVATION_EXPIRED',410],['SALES_ACTIVATION_NOT_FOUND',404]] as const){
   const f=setup({invalid:error});await f.handler(f.req,f.res);
   assert.equal(f.state.status,status);assert.equal(f.state.body.error,error);
   assert.deepEqual(f.access(),{loaded:1,authCalls:0});
 }
});
