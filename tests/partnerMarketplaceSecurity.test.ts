import assert from 'node:assert/strict';
import test from 'node:test';
import { registerPartnershipRoutes } from '../services/partnerships/partnershipRoutes';

const userId='11111111-1111-4111-8111-111111111111';
const clinicId='22222222-2222-4222-8222-222222222222';
const partnerId='33333333-3333-4333-8333-333333333333';
const leadId='44444444-4444-4444-8444-444444444444';
const email='owner@example.test';

function fixture(role='director', options:{partnerLogin?:boolean;requestResult?:string|null}={}){
  const routes:Record<string,any[]>={};
  const calls:any[]=[];
  const app:any={};
  for(const method of ['get','post','patch']){
    app[method]=(path:string,...handlers:any[])=>{routes[method.toUpperCase()+' '+path]=handlers;};
  }
  const supabase:any={
    auth:{getUser:async()=>({data:{user:null},error:null})},
    from(table:string){
      const filters:Record<string,any>={};
      const q:any={
        select(){return q;},eq(k:string,v:any){filters[k]=v;return q;},
        order(){return q;},in(){return q;},
        upsert(values:any){calls.push({type:'upsert',table,values});return q;},
        limit:async()=>({
          data:table==='clinic_memberships'?(role?[{role}]:[])
            :table==='verto_partner_marketplace_services'?[{
              partner_id:partnerId,service_name:'Tráfego pago',category:'Marketing',
              description:'Descrição de serviço que atende empresas.',logo_url:null,
              partner:{display_name:'Somar'}
            }]
            :table==='verto_partner_marketplace_leads'?[]:[],
          error:null
        }),
        maybeSingle:async()=>({
          data:table==='users'?{name:'Diretora Verto',email}
            :table==='clinics'?{phone_commercial:'11988887777'}
            :table==='verto_partner_accounts'?{id:partnerId,status:'approved',compliance_approved:true}
            :table==='verto_partner_marketplace_leads'?{id:leadId}
            :table==='verto_partner_marketplace_services'?null:null,error:null
        }),
        single:async()=>({data:{service_name:'Tráfego pago'},error:null}),
      };
      calls.push({type:'from',table,filters});
      return q;
    },
    rpc:async(name:string,args:any)=>{
      calls.push({type:'rpc',name,args});
      return {data:name==='verto_marketplace_request_v1'?(options.requestResult===undefined?leadId:options.requestResult):true,error:null};
    }
  };
  const checkAuth=()=>{};
  const checkPlatformAdmin=()=>{};
  registerPartnershipRoutes(app,{supabase,checkAuth,checkPlatformAdmin});
  async function run(method:string,path:string,body:any={},session:any={user:{id:userId}},query:any={}){
    const handlers=routes[method+' '+path];
    assert.ok(handlers,path+' registered');
    const result:any={statusCode:200,body:null,headers:{}};
    const res:any={
      status(n:number){result.statusCode=n;return res;},
      json(v:any){result.body=v;return res;},
      setHeader(k:string,v:string){result.headers[k]=v;return res;}
    };
    const req:any={body,session,query,params:{id:leadId,partnerId},is:()=>true};
    await handlers[handlers.length-1](req,res);
    return result;
  }
  return {run,calls,routes,checkAuth,checkPlatformAdmin};
}

test('clinic directory requires real membership and never accepts session role alone',async()=>{
  const noMembership=fixture('');
  const result=await noMembership.run('GET','/api/partnerships/marketplace',{},{
    user:{id:userId,role:'director',clinicId}
  },{clinicId});
  assert.equal(result.statusCode,403);
  assert.equal(result.body.error,'CLINIC_MEMBERSHIP_REQUIRED');
  assert.equal(noMembership.calls.some(c=>c.table==='verto_partner_marketplace_services'),false);
});

test('professional can discover services but cannot share the clinic contact',async()=>{
  const f=fixture('therapist');
  const found=await f.run('GET','/api/partnerships/marketplace',{},undefined,{clinicId});
  assert.equal(found.statusCode,200);
  assert.equal(found.body.canManage,false);
  assert.equal(found.body.contact,null);
  const denied=await f.run('POST','/api/partnerships/marketplace/interest',{
    clinicId,partnerId,consent:true
  });
  assert.equal(denied.statusCode,403);
  assert.equal(f.calls.some(c=>c.type==='rpc'&&c.name==='verto_marketplace_request_v1'),false);
});

test('consent is opt-in; forged role, email, phone and partner status fields are rejected',async()=>{
  const f=fixture();
  for(const payload of [
    {clinicId,partnerId,consent:false},
    {clinicId,partnerId,consent:true,contact_email:'victim@example.test'},
    {clinicId,partnerId,consent:true,contact_phone:'9999'},
    {clinicId,partnerId,consent:true,status:'active'}
  ]){
    const result=await f.run('POST','/api/partnerships/marketplace/interest',payload);
    assert.equal(result.statusCode,400);
  }
  assert.equal(f.calls.some(c=>c.type==='rpc'),false);
});

test('director share persists only server-fetched, scoped contact attributes',async()=>{
  const f=fixture();
  const accepted=await f.run('POST','/api/partnerships/marketplace/interest',{
    clinicId,partnerId,consent:true
  });
  assert.equal(accepted.statusCode,201);
  assert.equal(accepted.body.leadId,leadId);
  const call=f.calls.find(c=>c.name==='verto_marketplace_request_v1');
  assert.deepEqual(call.args,{
    p_clinic_id:clinicId,p_partner_id:partnerId,p_user_id:userId,
    p_contact_name:'Diretora Verto',p_contact_email:email,
    p_contact_phone:'11988887777',p_consent_version:'marketplace-2026-11-v1'
  });
});

test('duplicate interest cannot overwrite prior attribution or contact consent',async()=>{
  const f=fixture('director',{requestResult:null});
  const result=await f.run('POST','/api/partnerships/marketplace/interest',{
    clinicId,partnerId,consent:true
  });
  assert.equal(result.statusCode,409);
});

test('partner inbox and contract declaration are denied without isolated verified identity',async()=>{
  const f=fixture();
  const read=await f.run('GET','/api/partnerships/marketplace/partner',{}, {});
  assert.equal(read.statusCode,401);
  const write=await f.run('POST','/api/partnerships/marketplace/partner/confirm/:id',
    {monthlyCents:10000},{});
  assert.equal(write.statusCode,401);
  assert.equal(f.calls.some(c=>c.name==='verto_marketplace_partner_confirm_v1'),false);
});

test('approved partner cannot confirm someone else’s ID via browser input',async()=>{
  const f=fixture();
  const session={partnerAccountId:partnerId,partnerAuthUserId:userId,partnerEmail:email,
    partnerAuthAt:Date.now()};
  const result=await f.run('POST','/api/partnerships/marketplace/partner/confirm/:id',
    {monthlyCents:150000,partnerId:clinicId},session);
  assert.equal(result.statusCode,400);
  const accepted=await f.run('POST','/api/partnerships/marketplace/partner/confirm/:id',
    {monthlyCents:150000},session);
  assert.equal(accepted.statusCode,200);
  const call=f.calls.find(c=>c.name==='verto_marketplace_partner_confirm_v1');
  assert.equal(call.args.p_partner_id,partnerId);
});

test('reviews require active confirmed contract, rating range and clinic representative',async()=>{
  const f=fixture();
  assert.equal((await f.run('POST','/api/partnerships/marketplace/review/:id',
    {clinicId,rating:0,comment:'ok'})).statusCode,400);
  assert.equal((await f.run('POST','/api/partnerships/marketplace/review/:id',
    {clinicId,rating:5,comment:'Boa empresa'})).statusCode,200);
  const bad=fixture('therapist');
  assert.equal((await bad.run('POST','/api/partnerships/marketplace/review/:id',
    {clinicId,rating:5,comment:'ok'})).statusCode,403);
});

test('owner opportunity report keeps both existing administrative guards',()=>{
  const f=fixture();
  const chain=f.routes['GET /api/owner/partnerships/marketplace'];
  assert.equal(chain[0],f.checkAuth);
  assert.equal(chain[1],f.checkPlatformAdmin);
});
