import assert from 'node:assert/strict';
import { test } from 'node:test';
import { persistConfirmedClinicSettings } from '../src/services/confirmedClinicSettingsSave';

const confirmationMessage='Não foi possível confirmar o salvamento das configurações da clínica.';

test('explicit clinic Save performs exactly one authenticated POST and preserves server record', async()=>{
  const calls: Array<{endpoint:string;init:RequestInit}> = [];
  const payload = { profileSaveScope:'clinic', clinicSettings:{clinicName:'Clínica Exemplo'},updated_at:'2026-11-07T00:00:00.000Z' };
  const expected = { success:true, user:{clinicSettings:{clinicName:'Confirmada pelo backend'}} };
  const result = await persistConfirmedClinicSettings('/api/profile/director-id',payload,{
    request:async(endpoint,init)=>{
      calls.push({endpoint,init});
      return new Response(JSON.stringify(expected),{status:200});
    },
    authHeaders:async()=>({Authorization:'Bearer fake-test-token','Content-Type':'application/json'}),
    parseResponse:async(response)=>response.json(),
  });
  assert.deepEqual(result,expected);
  assert.equal(calls.length,1);
  assert.equal(calls[0].endpoint,'/api/profile/director-id');
  assert.equal(calls[0].init.method,'POST');
  assert.equal(calls[0].init.credentials,'include');
  assert.equal((calls[0].init.headers as Record<string,string>).Authorization,'Bearer fake-test-token');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)),payload);
});

test('HTTP 403, HTTP 500 and a success:false payload always fail closed, without retries',async()=>{
  let calls=0;
  for(const [status,resultPayload] of [
    [403,{success:false,error:'CLINIC_SETTINGS_EDIT_DENIED'}],
    [500,{success:false,message:'Database unavailable'}],
    [200,{success:false,message:'Business validation rejected'}],
  ] as const){
    const result=await persistConfirmedClinicSettings('/api/profile/director-id',{profileSaveScope:'clinic'},{
      request:async()=>{calls++;return new Response(JSON.stringify(resultPayload),{status});},
      authHeaders:async()=>({}),
      parseResponse:async(response)=>response.json(),
    });
    assert.equal(result.success,false);
    assert.equal(result.error,resultPayload.message || resultPayload.error);
  }
  assert.equal(calls,3);
});

test('network outage, auth header error and invalid JSON cannot acknowledge a Save',async()=>{
  let calls=0;
  const errors=[
    {request:async()=>{calls++;throw Error('offline');},authHeaders:async()=>({}),parseResponse:async()=>({success:true})},
    {request:async()=>{calls++;return new Response('{}');},authHeaders:async()=>{throw Error('auth unavailable');},parseResponse:async()=>({success:true})},
    {request:async()=>{calls++;return new Response('broken');},authHeaders:async()=>({}),parseResponse:async()=>{throw Error('invalid json');}},
  ];
  for(const deps of errors){
    const result=await persistConfirmedClinicSettings('/api/profile/director-id',{profileSaveScope:'clinic'},deps as any);
    assert.deepEqual(result,{success:false,error:confirmationMessage});
  }
  assert.equal(calls,2);
});

test('HTTP 200 without explicit success:true is not persistence confirmation',async()=>{
  const result=await persistConfirmedClinicSettings('/api/profile/director-id',{},{
    request:async()=>new Response(JSON.stringify({user:{clinicSettings:{clinicName:'Not saved'}}}),{status:200}),
    authHeaders:async()=>({}),parseResponse:async(r)=>r.json(),
  });
  assert.deepEqual(result,{success:false,error:confirmationMessage});
});
