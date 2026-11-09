import assert from 'node:assert/strict';
import {test} from 'node:test';
import {requestPublicSalesPostPaymentReconciliation,loadPublicSalesPaymentStatusResponse} from '../src/services/publicSalesPostPaymentTransport';

test('pending boleto reconciliation is one anonymous no-cache POST with original body and no paid inference',async()=>{
  const calls:Array<{url:string;init?:RequestInit}>=[];
  const mock=(async(url:string,init?:RequestInit)=>{
    calls.push({url,init});
    return new Response(JSON.stringify({state:'payment_pending',paymentConfirmed:false}),{status:202});
  }) as typeof fetch;
  const {response,data}=await requestPublicSalesPostPaymentReconciliation('offer/a ?','cs_test_opaque/?:',mock);
  assert.equal(response.status,202);
  assert.equal(data.paymentConfirmed,false);
  assert.deepEqual(calls,[{
    url:'/api/public/sales-offers/offer%2Fa%20%3F/prepare-activation',
    init:{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',
      body:JSON.stringify({sessionId:'cs_test_opaque/?:'})}
  }]);
});

test('payment status GET preserves exact encoded token/session URL and no-cache credentials omission',async()=>{
  const calls:Array<{url:string;init?:RequestInit}>=[];
  const mock=(async(url:string,init?:RequestInit)=>{
    calls.push({url,init});
    return new Response(JSON.stringify({state:'payment_pending',paymentConfirmed:false}),{status:202});
  }) as typeof fetch;
  const {response,data}=await loadPublicSalesPaymentStatusResponse('offer/a','cs_test_123/?:',mock);
  assert.equal(response.status,202);assert.equal(data.paymentConfirmed,false);
  assert.deepEqual(calls,[{
    url:'/api/public/sales-offers/offer%2Fa/payment-status?session_id=cs_test_123%2F%3F%3A',
    init:{credentials:'omit',cache:'no-store'}
  }]);
});

test('429, 503 and bad bodies are returned unchanged so existing caller owns bounded retry',async()=>{
  let calls=0;
  const limited=(async()=>{calls++;return new Response(JSON.stringify({error:'RATE_LIMIT'}),{
    status:429,headers:{'retry-after':'9'}
  });}) as typeof fetch;
  const a=await loadPublicSalesPaymentStatusResponse('token','session',limited);
  assert.equal(a.response.status,429);assert.equal(a.response.headers.get('retry-after'),'9');
  const failed=(async()=>{calls++;return new Response('<html>',{status:503});}) as typeof fetch;
  const b=await requestPublicSalesPostPaymentReconciliation('token','session',failed);
  assert.equal(b.response.status,503);assert.deepEqual(b.data,{});
  assert.equal(calls,2);
});

test('network failure throws once and never retries or launches Checkout automatically',async()=>{
  let calls=0;
  const failed=(async()=>{calls++;throw Error('network error');}) as typeof fetch;
  await assert.rejects(loadPublicSalesPaymentStatusResponse('token','session',failed),/network error/);
  assert.equal(calls,1);
});
