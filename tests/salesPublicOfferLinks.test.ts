import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prepareSalesPublicOffer, copySalesPublicOfferUrl} from '../src/services/salesPublicOfferLinks';
const offer={leadId:'11111111-1111-4111-8111-111111111111',simulationId:'22222222-2222-4222-8222-222222222222',contractEmail:'diretor@example.com'};
test('exact frozen identity, URL, POST and idempotency contract for create/recover',async()=>{
  const calls:any[]=[];
  const request=async(url:string,init?:RequestInit)=>{
    calls.push({url,init});
    return {publicUrl:'https://example.test/offer/old',offer:{id:'historical'},idempotent:true};
  };
  const response=await prepareSalesPublicOffer(request,offer,'key-05');
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/owner/sales/offers');
  assert.equal(calls[0].init.method,'POST');
  assert.deepEqual(calls[0].init.headers,{'X-Idempotency-Key':'key-05'});
  assert.deepEqual(JSON.parse(calls[0].init.body),offer);
  assert.equal(response.publicUrl,'https://example.test/offer/old');
  assert.equal(response.idempotent,true);
});
test('copy preserves exact historical link; no URL generation and no empty copies',async()=>{
  const urls:string[]=[];
  const url='https://example.test/offer/previous?token=a%2Fb';
  assert.equal(await copySalesPublicOfferUrl(url,async v=>{urls.push(v);}),true);
  assert.deepEqual(urls,[url]);
  assert.equal(await copySalesPublicOfferUrl('',async v=>{urls.push(v);}),false);
  assert.equal(urls.length,1);
});
test('server conflicts and clipboard denials propagate without retry',async()=>{
  let calls=0;
  await assert.rejects(prepareSalesPublicOffer(async()=>{calls++;throw Error('PROPOSAL_SNAPSHOT_CONFLICT');},offer,'key'),/PROPOSAL_SNAPSHOT_CONFLICT/);
  assert.equal(calls,1);
  await assert.rejects(copySalesPublicOfferUrl('https://example.test',async()=>{throw Error('clipboard denied');}),/clipboard denied/);
});
