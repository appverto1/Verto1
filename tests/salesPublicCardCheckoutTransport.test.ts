import assert from 'node:assert/strict';
import {test} from 'node:test';
import {requestPublicSalesCardCheckout} from '../src/services/publicSalesCardCheckout';

test('one anonymous POST initiates hosted Stripe Checkout from opaque offer token and server frozen price',async()=>{
  const calls:Array<{url:string;init:RequestInit|undefined}>=[];
  const mock=(async(url:string,init?:RequestInit)=>{
    calls.push({url,init});
    return new Response(JSON.stringify({
      success:true,
      url:'https://checkout.stripe.com/c/pay/cs_test_fixture',
      idempotent:true
    }),{status:200});
  }) as typeof fetch;
  const result=await requestPublicSalesCardCheckout('offer/with ?spaces',mock);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/public/sales-offers/offer%2Fwith%20%3Fspaces/checkout');
  assert.deepEqual(calls[0].init,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    credentials:'omit',
    body:JSON.stringify({acceptTerms:true})
  });
  assert.equal(result.url,'https://checkout.stripe.com/c/pay/cs_test_fixture');
  assert.equal(result.idempotent,true);
});

test('server refusal (unaccepted, expired, payment conflict) does not redirect or create a second request',async()=>{
  for(const error of ['MODULAR_OFFER_ACCEPTANCE_REQUIRED','MODULAR_OFFER_EXPIRED','MODULAR_CHECKOUT_PAYMENT_RECOVERY_REQUIRED']){
    let calls=0;
    const mock=(async()=>{calls++;return new Response(JSON.stringify({success:false,error}),{status:409});}) as typeof fetch;
    await assert.rejects(requestPublicSalesCardCheckout('offer',mock),new RegExp(error));
    assert.equal(calls,1);
  }
});

test('server message is preferred; missing URL and malformed responses fail closed',async()=>{
  const rejected=(async()=>new Response(JSON.stringify({success:false,message:'Não foi possível continuar em teste.'}),{status:403})) as typeof fetch;
  await assert.rejects(requestPublicSalesCardCheckout('offer',rejected),/Não foi possível continuar em teste/);
  const missing=(async()=>new Response(JSON.stringify({success:true}),{status:200})) as typeof fetch;
  await assert.rejects(requestPublicSalesCardCheckout('offer',missing),/Checkout indisponível/);
  const html=(async()=>new Response('<!doctype html>',{status:502})) as typeof fetch;
  await assert.rejects(requestPublicSalesCardCheckout('offer',html),/Não foi possível continuar/);
});
test('network error passes through unchanged, with no automatic retry',async()=>{
  let calls=0;
  const mock=(async()=>{calls++;throw Error('network unavailable');}) as typeof fetch;
  await assert.rejects(requestPublicSalesCardCheckout('offer',mock),/network unavailable/);
  assert.equal(calls,1);
});
