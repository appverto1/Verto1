import assert from 'node:assert/strict';
import {createOwnerStatsHandler,createOwnerClientsHandler,createAdminClientsHandler,createAdminDemoSandboxesHandler} from '../services/ownerAdminReadHandlers';
function res(){return {code:200,payload:null as any,status(c:number){this.code=c;return this;},json(d:any){this.payload=d;return this;}};}
{
 let calls=0;
 const fn=createOwnerClientsHandler(()=>({loadOwnerSaasClients:async()=>{calls++;return [{id:1}]},sanitizeString:(v:any)=>String(v)}));
 const r=res();await fn({},r);assert.equal(r.code,200);assert.equal(calls,1);assert.equal(r.payload.data.length,1);
}
{
 const fn=createOwnerStatsHandler(()=>({loadOwnerSaasClients:async()=>[{subscription_status:'active',first_paid_at:'2026-01-01'},{subscription_status:'trialing'}],buildOwnerFinancialOverviewFromLedger:async()=>({summary:{revenueNet:123}}),sanitizeString:(v:any)=>String(v)}));
 const r=res();await fn({},r);assert.equal(r.code,200);assert.equal(r.payload.stats.payingClients,1);assert.equal(r.payload.stats.mrr,123);
}
{
 let limit=0;
 const query={select(){return this},order(){return this},limit(n:number){limit=n;return Promise.resolve({data:[{id:1}],error:null})}};
 const fn=createAdminClientsHandler(()=>({supabase:{from(t:string){assert.equal(t,'users');return query}},USER_PROFILE_SELECT:'id',parseBoundedListLimit:()=>50}));
 const r=res();await fn({query:{limit:'99999'}},r);assert.equal(r.code,200);assert.equal(limit,50);
}
{
 const error={code:'PGRST204',message:'missing column'};
 const q={select(){return this},eq(){return this},order(){return this},limit(){return Promise.resolve({data:null,error})}};
 const fn=createAdminDemoSandboxesHandler(()=>({supabase:{from(){return q}},extractMissingColumnName:()=> 'demo_kind',isMissingRelationError:()=>false,sanitizeString:(v:any)=>String(v),logRouteDbError:()=>{throw Error('not expected')}}));
 const r=res();await fn({},r);assert.equal(r.code,200);assert.deepEqual(r.payload.data,[]);
}
console.log('PASS: four owner/admin handler mock scenarios');
