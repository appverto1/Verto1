import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadPublicSalesOfferResponse} from '../src/services/publicSalesOfferTransport';

test('anonymous public GET uses only opaque URL token and no login/cookies/auth headers',async()=>{
  const calls:Array<{url:string;init:RequestInit|undefined}>=[];
  const fetchMock=(async (url:string,init?:RequestInit)=>{
    calls.push({url,init});
    return new Response(JSON.stringify({success:true,offer:{offerType:'modular',proposalName:'Oferta congelada A',items:[{itemKey:'clinical_core',publicName:'Clínico'}],promotionalMonthlyAmountCents:17000}}),{status:200});
  }) as typeof fetch;
  const a=await loadPublicSalesOfferResponse('a/b? t=2',fetchMock);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/public/sales-offers/a%2Fb%3F%20t%3D2');
  assert.deepEqual(calls[0].init,{credentials:'omit'});
  assert.equal(a.response.status,200);
  assert.equal(a.data.offer.offerType,'modular');
  assert.equal(a.data.offer.proposalName,'Oferta congelada A');
  assert.equal(a.data.offer.promotionalMonthlyAmountCents,17000);
});
test('distinct historical tokens preserve distinct frozen offers without any shared client cache',async()=>{
  const urls:string[]=[];
  const mock=(async (url:string)=>{
    urls.push(url);
    const id=url.split('/').at(-1);
    return new Response(JSON.stringify({success:true,offer:{offerType:'legacy',clinicName:id,baseUnitAmountCents:id==='A'?10000:20000}}),{status:200});
  }) as typeof fetch;
  const [a,b]=await Promise.all([
    loadPublicSalesOfferResponse('A',mock),
    loadPublicSalesOfferResponse('B',mock)
  ]);
  assert.deepEqual(urls,['/api/public/sales-offers/A','/api/public/sales-offers/B']);
  assert.equal(a.data.offer.clinicName,'A');
  assert.equal(b.data.offer.clinicName,'B');
  assert.equal(a.data.offer.baseUnitAmountCents,10000);
  assert.equal(b.data.offer.baseUnitAmountCents,20000);
});
test('unavailable public offer stays 404 with OFFER_UNAVAILABLE, no retry or login redirect',async()=>{
  let count=0;
  const mock=(async()=>{count++;return new Response(JSON.stringify({error:'OFFER_UNAVAILABLE'}),{status:404});}) as typeof fetch;
  const {response,data}=await loadPublicSalesOfferResponse('expired',mock);
  assert.equal(response.status,404);
  assert.equal(data.error,'OFFER_UNAVAILABLE');
  assert.equal(count,1);
});
test('network failures propagate once; non-JSON response follows existing empty-payload fallback',async()=>{
  let count=0;
  const fail=(async()=>{count++;throw Error('network error');}) as typeof fetch;
  await assert.rejects(loadPublicSalesOfferResponse('offline',fail),/network error/);
  assert.equal(count,1);
  const notJson=(async()=>new Response('<!doctype html>',{status:503})) as typeof fetch;
  const result=await loadPublicSalesOfferResponse('invalid',notJson);
  assert.equal(result.response.status,503);
  assert.deepEqual(result.data,{});
});
