import assert from 'node:assert/strict';
import { test } from 'node:test';
import { establishPublicSalesDirectorSession } from '../src/services/publicSalesDirectorSession';

const successfulOtp = () => ({auth:{verifyOtp:async ({token_hash,type}:any)=>{
  assert.equal(token_hash,'server-issued-hash');
  assert.equal(type,'magiclink');
  return {data:{session:{access_token:'verified-access-token'}},error:null};
}}}) as any;

test('paid Director bootstrap keeps the exact two server calls and fixed director role',async()=>{
  const calls: Array<{url:string;init?:RequestInit}>=[];
  const request=(async(url:string,init?:RequestInit)=>{
    calls.push({url,init});
    if(calls.length===1)return new Response(JSON.stringify({success:true,tokenHash:'server-issued-hash'}),{status:200});
    return new Response(JSON.stringify({success:true}),{status:200});
  }) as typeof fetch;
  const result=await establishPublicSalesDirectorSession('offer/with space','cs_test_opaque/:?',request,async()=>successfulOtp());
  assert.equal(result,'authenticated');
  assert.equal(calls.length,2);
  assert.deepEqual(calls[0],{
    url:'/api/public/sales-offers/offer%2Fwith%20space/director-session',
    init:{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',body:JSON.stringify({sessionId:'cs_test_opaque/:?'})}
  });
  assert.deepEqual(calls[1],{
    url:'/api/auth/login',
    init:{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({accessToken:'verified-access-token',intendedRole:'director',provider:'sales_checkout',activationFlow:false})}
  });
});

test('claimed one-time Director bootstrap does not call OTP or login',async()=>{
  let calls=0;
  const request=(async()=>{calls++;return new Response(JSON.stringify({error:'SALES_DIRECTOR_SESSION_ALREADY_CLAIMED'}),{status:409});}) as typeof fetch;
  const result=await establishPublicSalesDirectorSession('offer','session',request,async()=>{throw Error('OTP must not run');});
  assert.equal(result,'already_claimed');assert.equal(calls,1);
});

test('missing server token, rejected OTP, rejected login and network failures never authenticate or charge',async()=>{
  const missingToken=(async()=>new Response(JSON.stringify({success:true}),{status:200})) as typeof fetch;
  await assert.rejects(establishPublicSalesDirectorSession('offer','session',missingToken,async()=>successfulOtp()),/Não foi possível abrir sua conta agora/);
  const bootstrap=(async()=>new Response(JSON.stringify({success:true,tokenHash:'server-issued-hash'}),{status:200})) as typeof fetch;
  await assert.rejects(establishPublicSalesDirectorSession('offer','session',bootstrap,async()=>({auth:{verifyOtp:async()=>({error:new Error('OTP_DENIED'),data:null})}}) as any),/OTP_DENIED/);
  let calls=0;
  const rejectLogin=(async()=>{calls++;return calls===1
    ?new Response(JSON.stringify({success:true,tokenHash:'server-issued-hash'}),{status:200})
    :new Response(JSON.stringify({success:false,error:'CLINIC_ACCESS_DENIED'}),{status:403});}) as typeof fetch;
  await assert.rejects(establishPublicSalesDirectorSession('offer','session',rejectLogin,async()=>successfulOtp()),/CLINIC_ACCESS_DENIED/);
  assert.equal(calls,2);
  const offline=(async()=>{throw Error('NETWORK_OFFLINE');}) as typeof fetch;
  await assert.rejects(establishPublicSalesDirectorSession('offer','session',offline,async()=>successfulOtp()),/NETWORK_OFFLINE/);
});
