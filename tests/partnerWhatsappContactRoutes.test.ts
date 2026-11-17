import assert from 'node:assert/strict';
import {registerPartnerWhatsappContactRoutes} from '../services/partnerships/partnerWhatsappContactRoutes';

const partnerId='11111111-1111-4111-8111-111111111111';
const userId='22222222-2222-4222-8222-222222222222';
const email='partner@example.test';

function fixture(opts:{approved?:boolean;member?:boolean}={}){
  const routes:Record<string,any[]>={};
  const filters:Record<string,unknown>[]=[];
  const writes:any[]=[];
  const app:any={
    get:(path:string,...handlers:any[])=>{routes['GET '+path]=handlers;},
    post:(path:string,...handlers:any[])=>{routes['POST '+path]=handlers;},
  };
  const supabase:any={
    from(table:string){
      const where:Record<string,unknown>={table};
      filters.push(where);
      let values:any;
      const q:any={
        select(_fields:string){return q;},
        eq(key:string,value:unknown){where[key]=value;return q;},
        in(key:string,value:unknown){where[key]=value;return q;},
        order(){return q;},
        upsert(payload:any,options:any){
          values=payload;writes.push({payload,options});return q;
        },
        async limit(_n:number){
          if(table==='clinic_memberships')return {data:opts.member===false?[]:[{id:'membership'}],error:null};
          return {data:[{id:'contact'}],error:null};
        },
        async maybeSingle(){
          if(table!=='verto_partner_accounts')throw new Error('UNEXPECTED_LOOKUP');
          if(opts.approved===false)return {data:null,error:null};
          assert.equal(where.status,'approved');
          assert.equal(where.compliance_approved,true);
          return {data:{id:partnerId},error:null};
        },
        async single(){
          assert.equal(table,'verto_partner_whatsapp_contacts');
          assert.equal(values.partner_id,partnerId);
          return {data:{id:'33333333-3333-4333-8333-333333333333',
            clinic_name:values.clinic_name,phone_e164:values.phone_e164,
            created_at:'2026-11-17T12:00:00Z'},error:null};
        },
      };
      if(table==='verto_partner_whatsapp_contacts'){
        q.limit=async()=>{
          assert.equal(where.partner_id,partnerId,'GET must be scoped to server-resolved partner');
          return {data:[],error:null};
        };
      }
      return q;
    }
  };
  registerPartnerWhatsappContactRoutes(app,{supabase,checkAuth:()=>{}});
  const session:any={partnerAccountId:partnerId,partnerAuthUserId:userId,
    partnerEmail:email,partnerAuthAt:Date.now()};
  const run=async(method:'GET'|'POST',mode:'portal'|'me',body:any={},overrideSession:any=session)=>{
    const key=method+' /api/partnerships/'+mode+'/whatsapp-contacts';
    const route=routes[key];assert.ok(route);
    const req:any={session:overrideSession,body,is:(v:string)=>v==='application/json'};
    let status=200,payload:any,headers:Record<string,string>={};
    const res:any={
      status(n:number){status=n;return this;},
      json(v:any){payload=v;return this;},
      setHeader(key:string,value:string){headers[key]=value;return this;},
    };
    await route[route.length-1](req,res);
    return {status,payload,headers};
  };
  return {run,session,writes,filters};
}

const f=fixture();
let result=await f.run('POST','portal',{clinicName:' Clínica Boa ',phone:'(11) 99999-9999'});
assert.equal(result.status,200);
assert.equal(result.payload.success,true);
assert.equal(f.writes.length,1);
assert.equal(f.writes[0].payload.partner_id,partnerId);
assert.equal(f.writes[0].payload.phone_e164,'5511999999999');
assert.equal(f.writes[0].payload.clinic_name,'Clínica Boa');
assert.equal(f.writes[0].options.onConflict,'partner_id,phone_e164',
  'repeat saves must not create duplicate contacts');
assert.equal(f.filters.find(x=>x.table==='verto_partner_accounts')?.contact_email,email);
assert.equal(f.filters.find(x=>x.table==='verto_partner_accounts')?.partner_kind,'external');
assert.ok(!('sales_lead_id' in f.writes[0].payload),
  'outreach must not claim partner commissions');
result=await f.run('GET','portal');
assert.equal(result.status,200);
assert.deepEqual(result.payload.contacts,[]);
assert.equal(result.headers['Cache-Control'],'private, no-store');

assert.equal((await f.run('POST','portal',{clinicName:'Clínica Boa',phone:'11999999999',
  partnerId:'44444444-4444-4444-8444-444444444444'})).status,400,
  'spoofed partner ID is rejected');
assert.equal((await f.run('POST','portal',{clinicName:'Clínica Boa',phone:'123'})).status,400,
  'invalid phone is rejected');
assert.equal((await f.run('POST','portal',{clinicName:'Clínica Boa',phone:'11999999999'},
  {...f.session,partnerAuthAt:Date.now()-13*60*60*1000})).status,403,
  'expired external login cannot save');
assert.equal((await f.run('POST','portal',{clinicName:'Clínica Boa',phone:'11999999999'},
  {...f.session,user:{id:userId}})).status,403,
  'clinical session cannot borrow external partner privileges');
assert.equal(f.writes.length,1);
const suspended=fixture({approved:false});
assert.equal((await suspended.run('POST','portal',
  {clinicName:'Clínica Boa',phone:'11999999999'})).status,403,
  'suspended or unapproved partner cannot save');
const inactive=fixture({member:false});
assert.equal((await inactive.run('POST','me',{clinicName:'Clínica Boa',phone:'11999999999'},
  {user:{id:userId}})).status,403,
  'inactive professional membership cannot save');
const professional=fixture();
assert.equal((await professional.run('POST','me',{clinicName:'Clínica Boa',phone:'11999999999'},
  {user:{id:userId}})).status,200);
assert.equal(professional.filters.find(x=>x.table==='verto_partner_accounts')?.user_id,userId);
assert.equal(professional.filters.find(x=>x.table==='verto_partner_accounts')?.partner_kind,'professional');
console.log('partnerWhatsappContactRoutes: auth, role, stale session, input, partner isolation and upsert passed');
