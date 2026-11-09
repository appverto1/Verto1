import assert from 'node:assert/strict';
import {test} from 'node:test';
import {splitOpportunityPhones,previewOpportunityDuplicates,createManualOpportunities} from '../src/services/salesKanbanOpportunityCreation';

test('manual single phone and multi-phone paste preserve the exact parsing contract',()=>{
  assert.deepEqual(splitOpportunityPhones(' 11 99999-9999 '),['11 99999-9999']);
  assert.deepEqual(splitOpportunityPhones(' 11 99999-9999\n21 98888-8888,31 97777-7777;'),['11 99999-9999','21 98888-8888','31 97777-7777']);
  assert.deepEqual(splitOpportunityPhones(' \n , ; '),[]);
  assert.equal(splitOpportunityPhones(Array(101).fill('11 99999-9999').join('\n')).length,101);
});

test('duplicate preview makes only one API call with the exact selected batch',async()=>{
  const calls:any[]=[];
  const request=async(url:string,options?:RequestInit)=>{calls.push({url,options});return {success:true,matches:[]};};
  await previewOpportunityDuplicates(request,'11 99999-9999;21 98888-8888');
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/owner/sales/kanban/opportunities/duplicates');
  assert.equal(calls[0].options.method,'POST');
  assert.deepEqual(JSON.parse(String(calls[0].options.body)),{phones:['11 99999-9999','21 98888-8888']});
});

test('explicit Save uses the existing owner request, idempotency key and per-phone channels',async()=>{
  const calls:any[]=[];
  const request=async(url:string,options?:RequestInit)=>{calls.push({url,options});return {success:true,leads:[{id:'1'},{id:'2'}]};};
  const phones=['11 99999-9999','21 98888-8888'];
  const channelId='11111111-1111-4111-8111-111111111111';
  const response=await createManualOpportunities(request,phones,[[channelId],[]],'test-key-123456');
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/owner/sales/kanban/opportunities');
  assert.equal(calls[0].options.method,'POST');
  assert.deepEqual(calls[0].options.headers,{'X-Idempotency-Key':'test-key-123456'});
  assert.deepEqual(JSON.parse(String(calls[0].options.body)),{phones,channelsByPhone:[[channelId],[]]});
  assert.equal(response.leads.length,2);
});

test('backend rejection still propagates to the existing Save error handler',async()=>{
  const request=async()=>{throw new Error('Número já cadastrado ou repetido. Nenhuma oportunidade foi criada.');};
  await assert.rejects(
    createManualOpportunities(request,['11999999999'],[[]],'test-key-123456'),
    /Número já cadastrado ou repetido/,
  );
});


test('Save includes per-contact names, clinic and emails in the same POST with no extra calls',async()=>{
  const calls:any[]=[];
  const request=async(url:string,options?:RequestInit)=>{
    calls.push({url,options});return {success:true,leads:[{id:'new-lead',name:'Contato Teste',clinicName:'Clínica Exemplo'}]};
  };
  const details=[
    {name:'Contato Teste',clinicName:'Clínica Exemplo',email:'contato@example.test'},
    {name:'Outro Contato',clinicName:'Outra Clínica',email:''},
  ];
  const phones=['11 99999-9999','21 98888-8888'];
  const response=await createManualOpportunities(request,phones,[[],[]],'new-key-123456',details);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'/api/owner/sales/kanban/opportunities');
  assert.equal(calls[0].options.method,'POST');
  assert.deepEqual(JSON.parse(String(calls[0].options.body)),{
    phones,channelsByPhone:[[],[]],detailsByPhone:details,
  });
  assert.equal(response.leads[0].clinicName,'Clínica Exemplo');
});
