import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerOwnerSalesOfferCreationRoute} from '../services/ownerSalesOfferCreationRoutes';

const uuid='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const headerKey='a-sufficient-idempotency-key';
const setup=kind=>{
 const calls=[];
 const checkAuth=()=>{};
 const checkPlatformAdmin=()=>{};
 const app={post:(...parts)=>{calls.push(parts);}};
 const deps={app,checkAuth,checkPlatformAdmin,
   sanitizeString:(value, limit=256)=>String(value??'').trim().slice(0,limit),
   sanitizeEmail:value=>String(value??'').trim().toLowerCase(),
   isUuid:value=>/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value),
   normalizeSalesInteger:value=>Number(value),
   SALES_ESTIMATED_ACTIVE_PATIENTS_MAX:200000,
   isCouponDurationMonths:value=>[1,2,3,6,12].includes(value),
   supabase:{from:()=>({select(){return this;},eq(){return this;},is(){return this;},maybeSingle:async()=>({data:{simulation_type:kind},error:null})})},
   prepareSalesModularOffer:()=>{}, prepareSalesOfferFromSimulation:()=>{}
 };
 registerOwnerSalesOfferCreationRoute(deps as any);
 assert.equal(calls.length,1);
 assert.equal(calls[0][0],'/api/owner/sales/offers');
 assert.equal(calls[0][1],checkAuth);
 assert.equal(calls[0][2],checkPlatformAdmin);
 const handler=calls[0][3];
 const response=()=>({statusCode:200, body:null as any, status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}});
 const request=(body={})=>({body, headers:{'x-idempotency-key':headerKey},session:{user:{id:uuid}}});
 return {handler,response,request,deps};
};

test('route rejects injected Stripe IDs without DB or preparing an offer',async()=>{
 const s=setup('modular'); let called=0;
 s.deps.supabase.from=()=>{called++;throw Error('must not read DB');};
 const res=s.response();
 await s.handler(s.request({leadId:uuid,simulationId:other,stripePriceId:'price_forged'}),res);
 assert.equal(res.statusCode,400);
 assert.equal(called,0);
 assert.match(res.body.error,/IDs Stripe/);
});

test('modular preparation rejects role spoofing before any write', async()=>{
 const s=setup('modular');const res=s.response();
 await s.handler(s.request({leadId:uuid,simulationId:other,contractEmail:'director@example.com',actorUserId:other}),res);
 assert.equal(res.statusCode,403);
 assert.equal(res.body.code,'PROPOSAL_ACCESS_DENIED');
});

test('owner with valid MFA still requires selected canonical simulation', async()=>{
 const s=setup('modular');const registered=[];
 registerOwnerSalesOfferCreationRoute({...s.deps,app:{post:(...parts)=>registered.push(parts)},hasVerifiedMfaSession:()=>true} as any);
 const req=s.request({leadId:uuid,simulationId:other,contractEmail:'director@example.com',actorUserId:other});
 req.session.user.isPlatformAdmin=true;
 const res=s.response();
 await registered[0][3](req,res);
 assert.equal(res.statusCode,409);
 assert.equal(res.body.code,'PROPOSAL_SIMULATION_INVALID');
});

test('route cannot treat invalid records as legacy offer',async()=>{
 const s=setup('legacy');
 const res=s.response();
 await s.handler(s.request({leadId:'invalid',initialActivePatientQuantity:0}),res);
 assert.equal(res.statusCode,400);
});
