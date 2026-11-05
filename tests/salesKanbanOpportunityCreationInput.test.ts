import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseManualOpportunityPreviewInput,parseManualOpportunitySaveInput} from '../services/salesKanbanOpportunityCreationInput';

const actor='11111111-1111-4111-8111-111111111111';
const channel='22222222-2222-4222-8222-222222222222';
const deps={
  sanitizeString:(value:unknown,limit:number)=>String(value??'').trim().slice(0,limit),
  isUuid:(value:string)=>[actor,channel].includes(value),
};
const req=(body:any, key='test-key-123456',id=actor)=>({body,headers:{'x-idempotency-key':key},session:{user:{id}}});
const base={phones:['11 99999-9999'],channelsByPhone:[[channel]]};

test('duplicate preview keeps normalization, invalid numbers and batch collisions intact',()=>{
  const p=parseManualOpportunityPreviewInput(['11 99999-9999','11 99999-9999','(21) 98888-8888','x']);
  assert.equal(p.ok,true);
  if(!p.ok)return;
  assert.deepEqual(p.normalized,['5511999999999','5511999999999','5521988888888',null]);
  assert.equal(p.counts.get('5511999999999'),2);
  assert.deepEqual(p.unique,['5511999999999','5521988888888']);
});
test('preview denies invalid shape and oversized batches before any query',()=>{
  for(const phones of [null,[],Array(101).fill('11999999999'),[23],['x'.repeat(41)]]){
    const p=parseManualOpportunityPreviewInput(phones);
    assert.equal(p.ok,false);
    if(!p.ok) assert.equal(p.error,'Informe entre 1 e 100 telefones.');
  }
});
test('Save keeps v2 fallback and v3 details selection purely data driven',()=>{
  const old=parseManualOpportunitySaveInput(req(base),deps);
  assert.equal(old.ok,true);
  if(old.ok){assert.equal(old.withDetails,false);assert.equal(old.key,'test-key-123456');assert.equal(old.actorId,actor);}
  const details=[{name:'Contato Teste',clinicName:'Clínica Teste',email:'contato@example.test'}];
  const newer=parseManualOpportunitySaveInput(req({...base,detailsByPhone:details}),deps);
  assert.equal(newer.ok,true);
  if(newer.ok){assert.equal(newer.withDetails,true);assert.equal(newer.detailsByPhone,details);}
});
test('Save rejects bad actor, idempotency and channel IDs before RPC',()=>{
  for(const request of [
    req(base,'short'),req(base,'test-key-123456','forged-user'),
    req({phones:[],channelsByPhone:[]}),
    req({phones:['11 99999-9999'],channelsByPhone:[['not-uuid']]}),
    req({phones:['11 99999-9999'],channelsByPhone:[[channel,channel]]}),
  ]) assert.equal(parseManualOpportunitySaveInput(request,deps).ok,false);
});
test('Save rejects injected fields, controls, duplicate emails and oversize contacts',()=>{
  for(const detailsByPhone of [
    [{name:'x',role:'director'}],
    [{name:'X'}],
    [{name:'Contato'+String.fromCharCode(10)+'Invalido'}],
    [{email:'invalid-email'}],
    [{name:'a'.repeat(181)}],
    [{clinicName:'b'.repeat(181)}],
  ]){
    const parsed=parseManualOpportunitySaveInput(req({...base,detailsByPhone}),deps);
    assert.equal(parsed.ok,false);
  }
  const dup=parseManualOpportunitySaveInput(req({
    phones:['11 99999-9999','21 98888-8888'],channelsByPhone:[[],[]],
    detailsByPhone:[{email:'TEST@EXAMPLE.COM'},{email:'test@example.com'}],
  }),deps);
  assert.equal(dup.ok,false);
  if(!dup.ok)assert.equal(dup.error,'E-mail repetido no lote de contatos.');
});
