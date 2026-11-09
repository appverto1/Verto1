import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptPublicSalesModularOffer, handoffPublicSalesCardCheckout } from '../src/services/publicSalesCardCheckout';

test('explicit acceptance retains one anonymous POST with frozen commercial consent payload', async () => {
  const calls: Array<{url: string; init?: RequestInit}> = [];
  const mock = (async (url: string, init?: RequestInit) => {
    calls.push({url,init});
    return new Response(JSON.stringify({success:true,acceptedAt:'2026-11-06T12:00:00.000Z'}),{status:200});
  }) as typeof fetch;
  const result = await acceptPublicSalesModularOffer('offer/with space',mock);
  assert.equal(result.acceptedAt,'2026-11-06T12:00:00.000Z');
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0],{
    url:'/api/public/sales-offers/offer%2Fwith%20space/accept',
    init:{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',
      body:JSON.stringify({commercialValuesConsent:true})}
  });
});

test('acceptance failure does not become a saved acknowledgement and does not retry',async()=>{
  const cases=[
    [403,{success:false,error:'ACCESS_DENIED'}],
    [409,{success:false,error:'OFFER_EXPIRED'}],
    [200,{success:false,error:'OFFER_CONFLICT'}]
  ] as const;
  for(const [status,payload] of cases){
    let calls=0;
    const mock=(async()=>{calls++;return new Response(JSON.stringify(payload),{status});}) as typeof fetch;
    await assert.rejects(acceptPublicSalesModularOffer('offer',mock),new RegExp(payload.error));
    assert.equal(calls,1);
  }
  const broken=(async()=>new Response('<html>',{status:502})) as typeof fetch;
  await assert.rejects(acceptPublicSalesModularOffer('offer',broken),/Não foi possível registrar o aceite/);
});

test('Checkout handoff performs one POST and navigates only to backend-issued URL',async()=>{
  const calls:Array<{url:string;init?:RequestInit}>=[];
  const navigation:string[]=[];
  const mock=(async(url:string,init?:RequestInit)=>{
    calls.push({url,init});
    return new Response(JSON.stringify({success:true,url:'https://checkout.stripe.com/c/pay/cs_test_server'}),{status:200});
  }) as typeof fetch;
  await handoffPublicSalesCardCheckout('token/with ?space',(url)=>navigation.push(url),mock);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/public/sales-offers/token%2Fwith%20%3Fspace/checkout');
  assert.equal(calls[0].init?.credentials,'omit');
  assert.deepEqual(navigation,['https://checkout.stripe.com/c/pay/cs_test_server']);
});

test('failed or interrupted Checkout never navigates and never retries',async()=>{
  const responses=[
    ()=>new Response(JSON.stringify({success:false,error:'MODULAR_CHECKOUT_PAYMENT_RECOVERY_REQUIRED'}),{status:409}),
    ()=>new Response(JSON.stringify({success:true}),{status:200}),
    ()=>new Response('<html>',{status:502}),
    ()=>{throw new Error('network unavailable');}
  ];
  for(const getResponse of responses){
    let calls=0,navigations=0;
    const mock=(async()=>{calls++;return getResponse();}) as typeof fetch;
    await assert.rejects(handoffPublicSalesCardCheckout('offer',()=>{navigations++;},mock));
    assert.equal(calls,1);assert.equal(navigations,0);
  }
});
