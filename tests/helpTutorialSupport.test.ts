import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import fs from 'node:fs';
import { registerHelpCenterRoutes } from '../services/helpCenterRoutes';
import { publishedTutorialHelpProjection, TUTORIAL_ARTICLES } from '../services/helpTutorialCatalog';
import { findSupportTopics, pausedSupportQuery } from '../src/help/helpSupport';
import { CAPABILITY_CATALOG } from '../src/constants/authorizationModel';
import { createSensitiveApiMutationProtectionMiddleware } from '../src/utils/sensitiveApiMutationProtection.mjs';

const caps=CAPABILITY_CATALOG.map(c=>c.key),modules=['clinical_core','appointments_communication','financial_management','insurance_tiss'];
assert.equal(new Set(TUTORIAL_ARTICLES.flatMap(a=>a.requiredCapabilities).filter(c=>!caps.includes(c as any))).size,0);
for(const role of ['director','coordinator','therapist','supervisor','receptionist']){
  const articles=publishedTutorialHelpProjection(role,caps,modules);
  assert.equal(new Set(articles.map(a=>a.articleId)).size,articles.length,'unique topics for each role');
  assert.ok(!articles.some(a=>['agenda-cancelar','agenda-recorrencia','recebimento-ajustes'].includes(a.articleId)),'OFF absent');
  for(const a of articles)for(const s of a.tutorialSteps||[])assert.ok(fs.existsSync(new URL(`../services/help-media/${s.mediaId}.jpg`,import.meta.url)));
}
assert.equal(publishedTutorialHelpProjection('patient',caps,modules).length,0);
assert.equal(publishedTutorialHelpProjection('receptionist',caps,modules).some(a=>a.articleId==='atendimento-evolucao'),false);
assert.equal(publishedTutorialHelpProjection('director',caps,[]).some(a=>a.articleId==='recebimento-registrar'),true,'tutorials are informational and do not grant financial access');
const director=publishedTutorialHelpProjection('director',caps,modules);
assert.equal(findSupportTopics(director,'quero aprender a registrar pagamento parcial','Módulo financeiro')[0].articleId,'recebimento-parcial');
assert.equal(pausedSupportQuery('quero fazer agendamentos recorrentes'),true);
assert.deepEqual(findSupportTopics(director,'agendamento recorrente'),[],'OFF recurrence must not point to avulso');
assert.deepEqual(findSupportTopics(director,'zzzxxy desconhecido'),[]);
assert.deepEqual(findSupportTopics(director,'lembretes de sessão','Gestão de agenda'),[],'generic session keyword does not invent a reminder lesson');
assert.equal(findSupportTopics(director,'criar cobranças','Módulo financeiro')[0].articleId,'recebimento-cobrar');

const contexts=new Map<string,any>([
  ['a',{userId:'user-a',clinicId:'clinic-a',membershipId:'membership-a',role:'director',capabilities:new Set(caps),modules:new Set(modules)}],
  ['b',{userId:'user-b',clinicId:'clinic-a',membershipId:'membership-b',role:'director',capabilities:new Set(caps),modules:new Set(modules)}],
  ['other-clinic',{userId:'user-a',clinicId:'clinic-b',membershipId:'membership-c',role:'director',capabilities:new Set(caps),modules:new Set(modules)}],
  ['therapist-min',{userId:'user-therapist',clinicId:'clinic-a',membershipId:'membership-therapist',role:'therapist',capabilities:new Set(['calendar.own.view','patient.list']),modules:new Set(['clinical_core'])}],
]);
const rows=new Map<string,any>();let fail=false,dbDenied=false,rpcCalls=0;let number='+55 11 99999-0000';
const supabase:any={
  from:(table:string)=>{
    assert.equal(table,'help_tutorial_progress');const filters:any={};const q:any={
      select:()=>q,eq:(key:string,value:any)=>{filters[key]=value;return q;},in:()=>q,
      limit:async()=>({error:fail?{code:'DB_UNAVAILABLE'}:null,data:[...rows.values()].filter(row=>row.user_id===filters.user_id&&row.clinic_id===filters.clinic_id)})};return q;
  },
  rpc:async(name:string,p:any)=>{
    rpcCalls++;assert.ok(['set_help_tutorial_completion','get_help_tutorial_completion'].includes(name));
    if(fail||dbDenied)return {error:{code:dbDenied?'42501':'DB_UNAVAILABLE'}};
    const key=JSON.stringify([p.p_user_id,p.p_clinic_id,p.p_article_id,p.p_content_revision]);
    if(name==='set_help_tutorial_completion')rows.set(key,{user_id:p.p_user_id,clinic_id:p.p_clinic_id,article_id:p.p_article_id,content_revision:p.p_content_revision,
      completed_at:p.p_completed?(rows.get(key)?.completed_at||'2026-10-06T19:00:00Z'):null});
    return {data:{completedAt:rows.get(key)?.completed_at||null},error:null};
  }
};
const app=express();app.use(express.json({limit:'2kb'}));
app.use('/api',createSensitiveApiMutationProtectionMiddleware({configuredAppBase:()=> 'https://appverto.example.invalid'}));
registerHelpCenterRoutes(app,{supabase,supportNumber:()=>number,
  noStoreDynamicResponse:(_req:any,res:any,next:any)=>{res.setHeader('Cache-Control','private, no-store');next();},
  checkAuth:(req:any,res:any,next:any)=>{const ctx=contexts.get(req.get('x-test-session'));if(!ctx)return res.sendStatus(401);req.session={user:{id:ctx.userId,clinicId:ctx.clinicId}};next();},
  requireClinicCapability:cap=>(req:any,res:any,next:any)=>{const ctx=contexts.get(req.get('x-test-session'));if(!ctx?.capabilities.has(cap))return res.sendStatus(403);req.authorizationContext=ctx;next();},
  requireAnyClinicCapability:(...keys:string[])=>(req:any,res:any,next:any)=>{
    const ctx=contexts.get(req.get('x-test-session'));
    if(!ctx||!keys.some(key=>ctx.capabilities.has(key)))return res.sendStatus(403);
    req.authorizationContext=ctx;next();
  },
  currentClinicId:user=>user?.clinicId||null
});
const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as any;const base=`http://127.0.0.1:${address.port}`;
const call=async(path:string,session='a',body?:any,headers:any={})=>{
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'x-test-session':session,'Content-Type':'application/json',Cookie:'verto-session=synthetic-test',Origin:base,...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();return {status:r.status,body:()=>JSON.parse(text),text,headers:r.headers};
};
try{
  assert.equal((await call('/api/help/catalog','invalid')).status,401);
  const catalog=await call('/api/help/catalog');assert.equal(catalog.status,200);assert.ok(!catalog.text.includes(number));
  assert.equal((await call('/api/help/catalog','therapist-min')).status,200,'therapist without clinic.view can open tutorial');
  const topic=catalog.body().articles.find((a:any)=>a.articleId==='agenda-confirmar');
  const body={articleId:topic.articleId,contentRevision:topic.contentRevision,contextKey:catalog.body().contextKey};
  let response=await call('/api/help/support','a',body);assert.equal(response.status,200);assert.equal(response.body().completed,false);assert.ok(!response.text.includes(number));
  assert.ok(response.body().tutorialUrl.endsWith('agenda-confirmar'));
  assert.equal((await call('/api/help/tutorial-progress','a',{...body,completed:true,userId:'user-b'})).status,400,'client cannot select identity');
  assert.equal((await call('/api/help/tutorial-progress','a',{...body,completed:true,clinicId:'clinic-b'})).status,400);
  const before=rpcCalls;
  assert.equal((await call('/api/help/support','a',body,{Origin:'https://evil.invalid'})).status,403);assert.equal(rpcCalls,before);
  assert.equal((await call('/api/help/support','a',body,{Origin:'',Referer:''})).status,403,'cookie mutation needs trusted browser origin');
  assert.equal((await call('/api/help/support','a',body,{Origin:'https://appverto.example.invalid'})).status,200,'configured app origin remains accepted through API proxy');
  assert.equal((await call('/api/help/tutorial-progress','a',{...body,completed:'yes'})).status,400);
  assert.equal((await call('/api/help/tutorial-progress','a',{...body,completed:true})).status,200);
  const first=(await call('/api/help/tutorial-progress','a',{...body,completed:true})).body().completedAt;
  assert.ok(first);assert.equal(rows.size,1,'duplicate save is idempotent');
  response=await call('/api/help/support','a',body);assert.equal(response.body().completed,true);assert.ok(response.text.includes(number));assert.ok(!response.text.includes('wa.me'));
  for(const session of ['b','other-clinic']){
    assert.equal((await call('/api/help/support',session,body)).status,409,'stale user/clinic context rejected');
    const own=await call('/api/help/catalog',session);
    assert.equal((await call('/api/help/support',session,{...body,contextKey:own.body().contextKey})).body().completed,false);
  }
  const other=catalog.body().articles.find((a:any)=>a.articleId==='agenda-remarcar');
  assert.equal((await call('/api/help/support','a',{...body,articleId:other.articleId,contentRevision:other.contentRevision})).body().completed,false,'other topic completion cannot unlock');
  assert.equal((await call('/api/help/support','a',{...body,contentRevision:'0000000000000000'})).status,409,'old revision rejected');
  assert.equal((await call('/api/help/support','a',{...body,articleId:'agenda-cancelar'})).status,404);
  dbDenied=true;response=await call('/api/help/support','a',body);assert.equal(response.status,403);assert.ok(!response.text.includes(number));dbDenied=false;
  fail=true;response=await call('/api/help/support','a',body);assert.equal(response.status,503);assert.ok(!response.text.includes(number));fail=false;
  number='';assert.equal((await call('/api/help/support','a',body)).status,503,'missing contact never uses a sales fallback');number='+55 11 99999-0000';
  assert.equal((await call('/api/help/tutorial-progress','a',{...body,completed:false})).status,200);
  assert.equal((await call('/api/help/support','a',body)).body().completed,false,'undo completion closes gate again');
  const a=contexts.get('a');a.capabilities.delete('calendar.attendance.confirm');assert.equal((await call('/api/help/support','a',body)).status,409,'permissions revalidated');a.capabilities.add('calendar.attendance.confirm');
  a.modules.delete('appointments_communication');assert.equal((await call('/api/help/support','a',body)).status,409,'module revalidated');a.modules.add('appointments_communication');
  const image=await call(`/api/help/tutorial-media/${topic.mediaIds[0]}`);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.equal(image.headers.get('cache-control'),'private, no-store');
  assert.equal((await call('/api/help/tutorial-media/..%2Fserver')).status,404);
  assert.equal((await call('/api/help/tutorial-media/verto-tutorial-99-unpublished')).status,404);
  console.log('helpTutorialSupport: PASS (topic/identity/tenant/revision/permission/module/origin/storage/media gates)');
}finally{server.close();server.closeAllConnections();}
