import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { registerPartnershipRoutes } from '../services/partnerships/partnershipRoutes';
import { parsePublicSalesLeadInput } from '../services/publicSalesLeadInput';

const externalId='11111111-1111-4111-8111-111111111111';
const professionalId='22222222-2222-4222-8222-222222222222';
const email='partner@example.test';
const internalCode='VERTO-0123456789ABCDEF01';

function fixture(opts: {
  kind?:'external'|'professional'; alias?:string|null; approved?:boolean;
  activeMember?:boolean; updateError?:any; concurrentAlias?:string|null;
}={}){
  const kind=opts.kind||'external';
  const row:any={
    id:externalId, user_id:kind==='professional'?professionalId:null,
    contact_email:email, partner_kind:kind, referral_alias:opts.alias??null,
    status:opts.approved===false?'pending':'approved',compliance_approved:opts.approved!==false,
  };
  const calls:any[]=[];
  const routes:Record<string,any[]>={};
  const app:any={};
  for(const method of ['get','post','patch']){
    app[method]=(path:string,...handlers:any[])=>{routes[method.toUpperCase()+' '+path]=handlers;};
  }
  const supabase:any={
    auth:{getUser:async()=>({data:{user:null},error:null})},
    from(table:string){
      const filters:Record<string,unknown>={};let pendingUpdate:any=null;
      const q:any={
        select(){return q;},
        eq(key:string,value:unknown){filters[key]=value;return q;},
        is(key:string,value:unknown){filters[key]=value;return q;},
        in(){return q;},
        update(values:any){pendingUpdate=values;calls.push({table,type:'update',values,filters});return q;},
        async limit(){return {data:opts.activeMember===false?[]:[{id:'member'}],error:null};},
        async maybeSingle(){
          if(table!=='verto_partner_accounts')return {data:null,error:null};
          if(filters.id && filters.id!==row.id)return {data:null,error:null};
          if(filters.user_id && filters.user_id!==row.user_id)return {data:null,error:null};
          if(filters.contact_email && filters.contact_email!==row.contact_email)return {data:null,error:null};
          if(filters.partner_kind && filters.partner_kind!==row.partner_kind)return {data:null,error:null};
          if(!pendingUpdate)return {data:{...row},error:null};
          if(opts.updateError)return {data:null,error:opts.updateError};
          if(row.referral_alias!==null){
            return {data:null,error:null};
          }
          if(opts.concurrentAlias!==undefined){
            row.referral_alias=opts.concurrentAlias;
            return {data:null,error:null};
          }
          row.referral_alias=pendingUpdate.referral_alias;
          return {data:{referral_alias:row.referral_alias},error:null};
        },
      };
      return q;
    },
  };
  const checkAuth=()=>{};
  registerPartnershipRoutes(app,{supabase,checkAuth,checkPlatformAdmin:()=>{}});
  const externalSession:any={
    partnerAccountId:externalId,
    partnerAuthUserId:professionalId,
    partnerEmail:email,partnerAuthAt:Date.now(),
  };
  const clinicalSession:any={user:{id:professionalId,role:'therapist'}};
  async function run(body:any, session:any=kind==='external'?externalSession:clinicalSession){
    const path=kind==='external'
      ? '/api/partnerships/portal/referral-alias'
      : '/api/partnerships/me/referral-alias';
    const route=routes['PATCH '+path];
    assert.ok(route,'route exists');
    const result:any={statusCode:200,body:null,headers:{}};
    const res:any={
      status(value:number){result.statusCode=value;return res;},
      setHeader(key:string,value:string){result.headers[key]=value;return res;},
      json(body:any){result.body=body;return res;},
    };
    await route[route.length-1]({body,session,is:()=>true},res);
    return result;
  }
  return {run,calls,routes,row,externalSession,clinicalSession,checkAuth};
}

test('approved external partner can save FRATELLI10 once, without caller-supplied identity',async()=>{
  const f=fixture();
  const saved=await f.run({couponCode:'Fratelli 10'});
  assert.equal(saved.statusCode,200);
  assert.deepEqual(saved.body,{success:true,couponCode:'FRATELLI10'});
  assert.equal(f.row.referral_alias,'FRATELLI10');
  assert.equal(f.calls.filter(c=>c.type==='update').length,1);
  const written=f.calls.find(c=>c.type==='update');
  assert.equal(written.filters.id,externalId);
  assert.equal(written.filters.referral_alias,null);
  assert.equal(written.values.referral_alias,'FRATELLI10');
  assert.equal(written.values.status,undefined);
  assert.equal((await f.run({couponCode:'FRATELLI10'})).body.idempotent,true);
  assert.equal(f.calls.filter(c=>c.type==='update').length,1);
  const locked=await f.run({couponCode:'OUTRO10'});
  assert.equal(locked.statusCode,409);
  assert.equal(locked.body.error,'REFERRAL_COUPON_LOCKED');
});

test('coupon saving refuses forged identity, malformed codes and expired sessions',async()=>{
  const f=fixture();
  for(const couponCode of ['abc','VERTO-1234','<script>','--','A'.repeat(25),'']){
    const denied=await f.run({couponCode});
    assert.equal(denied.statusCode,400,couponCode);
  }
  assert.equal((await f.run({couponCode:'FRATELLI10',partnerId:professionalId})).statusCode,400);
  assert.equal((await f.run({couponCode:'FRATELLI10'},{})).statusCode,401);
  assert.equal((await f.run({couponCode:'FRATELLI10'},{...f.externalSession,partnerAuthAt:Date.now()-13*60*60*1000})).statusCode,401);
  assert.equal((await f.run({couponCode:'FRATELLI10'},{...f.externalSession,partnerEmail:'intruder@example.test'})).statusCode,403);
  assert.equal((await f.run({couponCode:'FRATELLI10'},{...f.externalSession,user:{id:professionalId}})).statusCode,401);
  assert.equal(f.calls.filter(c=>c.type==='update').length,0);
});

test('pending partner and duplicate coupon cannot register a referral alias',async()=>{
  const pending=fixture({approved:false});
  assert.equal((await pending.run({couponCode:'FRATELLI10'})).statusCode,403);
  assert.equal(pending.calls.length,0);
  const duplicate=fixture({updateError:{code:'23505'}});
  const response=await duplicate.run({couponCode:'FRATELLI10'});
  assert.equal(response.statusCode,409);
  assert.equal(response.body.error,'REFERRAL_COUPON_TAKEN');
  const concurrent=fixture({concurrentAlias:'OTHER10'});
  assert.equal((await concurrent.run({couponCode:'FRATELLI10'})).statusCode,409);
});

test('clinical partner still needs checkAuth and an active professional membership',async()=>{
  const missing=fixture({kind:'professional',activeMember:false});
  assert.equal(missing.routes['PATCH /api/partnerships/me/referral-alias'][0],missing.checkAuth);
  assert.equal((await missing.run({couponCode:'PROF123'})).statusCode,403);
  assert.equal(missing.calls.length,0);
  const allowed=fixture({kind:'professional'});
  assert.equal((await allowed.run({couponCode:'PROF123'})).statusCode,200);
  assert.equal(allowed.calls.find(c=>c.type==='update').filters.id,externalId);
  assert.equal((await allowed.run({couponCode:'PROF124'},{})).statusCode,401);
});

const deps:any={
  sanitizeString:(v:unknown,n:number)=>String(v??'').trim().slice(0,n),
  sanitizeEmail:(v:unknown)=>{const s=String(v??'').trim().toLowerCase();return s&&/^[^@ ]+@[^@ ]+\\.[^@ ]+$/.test(s)?s:null;},
  normalizeSalesPhone:(v:unknown)=>{const d=String(v??'').replace(/\\D/g,'');return d.length===11?'55'+d:d.startsWith('55')&&d.length===13?d:null;},
  normalizeSalesInteger:()=>null,
  SALES_PUBLIC_PAYLOAD_MAX_BYTES:24*1024,
  SALES_ESTIMATED_ACTIVE_PATIENTS_MAX:100000,
  SALES_ESTIMATED_PROFESSIONALS_MAX:10000,
  SALES_CONTACT_CONSENT_VERSION:'sales-contact-v1',
  SALES_OPERATION_TYPES:new Set(['clinic','independent_professional']),
  SALES_PREFERRED_CONTACT_PERIODS:new Set(['']),
  BRAZIL_STATE_CODES:new Set(['SP']),
};
const lead=(partnerCode?:any):any=>({
  headers:{'x-idempotency-key':'coupon-test-123456'},
  body:{name:'Clínica Sintética',phone:'11999999999',clinicName:'Clínica Sintética',
    source:'public_landing',website:'',formStartedAt:Date.now()-2000,
    ...(partnerCode===undefined?{}:{partnerCode})},
});

test('landing parses both old links and typed coupons with no extra DB reads',()=>{
  for(const [text,expected] of [
    [internalCode,internalCode],
    ['fratelli 10','FRATELLI10'],
    ['FRATELLI-10','FRATELLI-10'],
    ['',''],
  ]){
    const result=parsePublicSalesLeadInput(lead(text),deps);
    assert.equal(result.ok,true,text);
    if(result.ok)assert.equal(result.input.partnerCode,expected);
  }
  for(const text of ['<script>','VERTO-INVALID','A'.repeat(70)]){
    const rejected=parsePublicSalesLeadInput(lead(text),deps);
    assert.equal(rejected.ok,false,text);
    if(!rejected.ok)assert.equal(rejected.status,400);
  }
});

test('migration preserves canonical referral uniqueness, existing anti-fraud RPC and RLS boundaries',()=>{
  const sql=readFileSync('supabase/migrations/20261111154000_verto_partner_referral_coupon_v1.sql','utf8');
  const ui=readFileSync('src/components/SalesInterestForm.tsx','utf8');
  const panel=readFileSync('src/components/PartnershipPanel.tsx','utf8');
  assert.equal((sql.match(/create or replace function public\\.verto_claim_partner_referral_v1\\(/g)||[]).length,1,
    'migration must replace the referral function exactly once');
  assert.match(sql,/or not \\(/);
  assert.match(sql,/p_referral_code ~ '\\^VERTO-\\[A-F0-9\\]\\{18\\}\\
  assert.match(sql,/create unique index if not exists verto_partner_referral_alias_uidx/);
  assert.match(sql,/p\.referral_code = p_referral_code or p\.referral_alias = p_referral_code/);
  assert.match(sql,/for update/);
  assert.match(sql,/e\.idempotency_key = p_idempotency_key/);
  assert.match(sql,/lower\(l\.normalized_email\)/);
  assert.match(sql,/revoke all on function public\.verto_claim_partner_referral_v1/);
  assert.match(ui,/Quem te indicou\?/);
  assert.match(ui,/setPartnerCode/);
  assert.match(panel,/Salvar cupom/);
  assert.match(panel,/referral_alias\|\|account\.referral_code/);
});
/);
  assert.match(sql,/\\)\\s*or char_length\\(coalesce\\(p_idempotency_key/);
  assert.equal((sql.match(/end;\\s*\\$\\$;/g)||[]).length,1,
    'no truncated or duplicated function body');
  assert.match(sql,/add column if not exists referral_alias text/);
  assert.match(sql,/create unique index if not exists verto_partner_referral_alias_uidx/);
  assert.match(sql,/p\.referral_code = p_referral_code or p\.referral_alias = p_referral_code/);
  assert.match(sql,/for update/);
  assert.match(sql,/e\.idempotency_key = p_idempotency_key/);
  assert.match(sql,/lower\(l\.normalized_email\)/);
  assert.match(sql,/revoke all on function public\.verto_claim_partner_referral_v1/);
  assert.match(ui,/Quem te indicou\?/);
  assert.match(ui,/setPartnerCode/);
  assert.match(panel,/Salvar cupom/);
  assert.match(panel,/referral_alias\|\|account\.referral_code/);
});
