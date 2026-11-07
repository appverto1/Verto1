import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { registerPublicSalesDirectorSessionRoute } from '../services/publicSalesDirectorSessionRoute';

const code=readFileSync('services/publicSalesDirectorSessionRoute.ts','utf8');
const marker='  app.post(\n    "/api/public/sales-offers/:token/director-session",';
const body=code.slice(code.indexOf(marker),code.indexOf('}\n\n// The route body'));
const fnv=(s:string)=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),0x01000193)>>>0;return h.toString(16).padStart(8,'0');};

test('Director HTTP handler has original SHA-equivalent literal source and no new billing operations',()=>{
  assert.ok(body.startsWith(marker));
  assert.equal(fnv(body),'75bb604d');
  assert.match(body,/payment_confirmed_at/);
  assert.match(body,/userId !== clinicId/);
  assert.match(body,/verifySalesDirectorContractAccess/);
  assert.match(body,/getUserById/);
  assert.match(body,/generateLink/);
  assert.doesNotMatch(body,/checkout\.sessions\.create|subscriptions\.create/);
});

const uuid='11111111-1111-4111-8111-111111111111';
const validToken='t'.repeat(40);
type Options={paid?:boolean;clinicId?:string;bootstrapUsed?:boolean;authEmail?:string;context?:boolean;contractFails?:boolean};
function fixture(options:Options={}){
  let handler:any;
  const events:string[]=[];
  const row:any={
    sales_offers:{id:'offer',lead_id:'lead',status:options.paid===false?'pending':'paid',payment_confirmed_at:'2026-11-06',provisioning_status:'completed',offer_type:'modular',contract_email:'director@example.test',stripe_subscription_id:'sub_test'},
    sales_leads:{id:'lead',normalized_email:'director@example.test',converted_user_id:uuid,converted_clinic_id:options.clinicId||uuid},
    pending_activations:{id:'bootstrap',email:'director@example.test',used:options.bootstrapUsed===true,token:'expected-hash',expires_at:'2099-01-01'},
  };
  const db={
    from:(table:string)=>({
      select:()=>({eq(){return this;},is(){return this;},limit(){return this;},maybeSingle:async()=>({data:row[table],error:null})}),
      upsert:async()=>{events.push('audit-upsert');return {error:null};}
    }),
    auth:{admin:{
      getUserById:async()=>({data:{user:{email:options.authEmail||'director@example.test'}},error:null}),
      generateLink:async()=>({data:{properties:{hashed_token:'otp-hash'}},error:null}),
    }},
  };
  const app:any={post:(url:string,_limiter:any,fn:any)=>{assert.equal(url,'/api/public/sales-offers/:token/director-session');handler=fn;}};
  registerPublicSalesDirectorSessionRoute(app,{
    supabase:db as any, publicSalesPostPaymentLimiter:((_req:any,_res:any,next:any)=>next()) as any,
    sanitizeString:(v:unknown,max=1000)=>String(v||'').slice(0,max),
    sanitizeEmail:(v:unknown)=>String(v||'').trim().toLowerCase()||null,
    isUuid:(v:any)=>v===uuid,
    resolveSalesPostPaymentContextToken:async()=>options.context===false?null:{offerId:'offer',leadId:'lead'},
    hashSalesOfferToken:()=> 'expected-hash',
    deriveSalesActivationToken:()=> 'bootstrap-token',
    verifySalesDirectorContractAccess:async({organizationId})=>{
      events.push('contract-verified');
      assert.equal(organizationId,uuid);
      if(options.contractFails)throw Error('CONTRACT_NOT_AUTHORIZED');
    },
  });
  const response:any={statusCode:200,body:null,headers:{}};
  const res:any={
    setHeader:(k:string,v:string)=>{response.headers[k]=v;},
    status:(statusCode:number)=>{response.statusCode=statusCode;return res;},
    json:(body:any)=>{response.body=body;return res;},
  };
  const req:any={params:{token:validToken},body:{sessionId:'cs_test_fixture'}};
  return {handler,req,res,response,events};
}
test('invalid token/session and unresolved context fail before issuing Director OTP',async()=>{
  const a=fixture();a.req.params.token='bad';await a.handler(a.req,a.res);
  assert.equal(a.response.statusCode,400);assert.equal(a.response.body.error,'SALES_DIRECTOR_SESSION_CONTEXT_INVALID');
  assert.deepEqual(a.events,[]);
  const b=fixture({context:false});await b.handler(b.req,b.res);
  assert.equal(b.response.statusCode,404);assert.equal(b.response.body.error,'SALES_DIRECTOR_SESSION_CONTEXT_NOT_FOUND');
  assert.deepEqual(b.events,[]);
});
test('no payment, different clinic and reused activation token fail closed',async()=>{
  for(const [opts,error] of [
    [{paid:false},'SALES_DIRECTOR_SESSION_NOT_READY'],
    [{clinicId:'forged-clinic'},'SALES_DIRECTOR_SESSION_LINKAGE_INVALID'],
    [{bootstrapUsed:true},'SALES_DIRECTOR_SESSION_ALREADY_CLAIMED']
  ] as const){
    const v=fixture(opts);await v.handler(v.req,v.res);
    assert.equal(v.response.statusCode,409);assert.equal(v.response.body.error,error);
    assert.deepEqual(v.events,[]);
  }
});
test('Director receives OTP only after contract verification and matched Auth email',async()=>{
  const a=fixture();await a.handler(a.req,a.res);
  assert.equal(a.response.statusCode,200);
  assert.equal(a.response.body.role,'director');
  assert.equal(a.response.body.tokenHash,'otp-hash');
  assert.deepEqual(a.events,['contract-verified','audit-upsert']);
  const b=fixture({authEmail:'attacker@example.test'});await b.handler(b.req,b.res);
  assert.equal(b.response.statusCode,409);
  assert.equal(b.response.body.error,'SALES_DIRECTOR_AUTH_EMAIL_MISMATCH');
  assert.deepEqual(b.events,['contract-verified']);
});
