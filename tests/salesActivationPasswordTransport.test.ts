import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadPublicSalesActivationSummary, persistPublicSalesActivationPassword } from '../src/services/salesActivationPasswordTransport';

test('activation GET keeps one anonymous encoded, abortable call', async()=>{
 const controller = new AbortController();
 const calls:Array<{url:string;init?:RequestInit}>=[];
 const request=(async (url:string,init?:RequestInit)=>{
   calls.push({url,init});
   return new Response(JSON.stringify({success:true,activation:{email:'director@example.test'}}),{status:200});
 }) as typeof fetch;
 const r=await loadPublicSalesActivationSummary('token/a ?',controller.signal,request);
 assert.equal(r.response.status,200);
 assert.equal(r.payload.activation.email,'director@example.test');
 assert.deepEqual(calls,[{url:'/api/public/sales-activations/token%2Fa%20%3F',
   init:{credentials:'omit',signal:controller.signal}}]);
});
test('one explicit password POST, no client-selected role, clinic, or checkout',async()=>{
 const password='ValidStrong#Password123',calls:Array<{url:string;init?:RequestInit}>=[];
 const request=(async(url:string,init?:RequestInit)=>{
   calls.push({url,init});return new Response(JSON.stringify({success:true,passwordSaved:true}),{status:200});
 }) as typeof fetch;
 const r=await persistPublicSalesActivationPassword('opaque/token ?',password,request);
 assert.equal(r.payload.passwordSaved,true);
 assert.deepEqual(calls,[{
   url:'/api/public/sales-activations/opaque%2Ftoken%20%3F/password',
   init:{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify({password})}
 }]);
 assert.doesNotMatch(JSON.stringify(calls[0]),/clinic_id|role|checkoutSessionId|userId/);
});
test('error statuses, malformed body and network exception never retry or claim success',async()=>{
 let calls=0;
 for(const status of [409,429,503]){
   const request=(async()=>{calls++;return new Response('non-json',{status});}) as typeof fetch;
   const r=await persistPublicSalesActivationPassword('opaque','Password#ABC123',request);
   assert.equal(r.response.status,status);assert.deepEqual(r.payload,{});
 }
 const offline=(async()=>{calls++;throw Error('NETWORK_OFFLINE');}) as typeof fetch;
 await assert.rejects(persistPublicSalesActivationPassword('opaque','Password#ABC123',offline),/NETWORK_OFFLINE/);
 assert.equal(calls,4);
});