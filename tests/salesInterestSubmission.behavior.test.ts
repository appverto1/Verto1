import assert from 'node:assert/strict';
import { test } from 'node:test';
import { submitSalesInterest } from '../src/services/salesInterestSubmission';

const input = {
  normalizedName: 'Pessoa Sintética',
  phone: '(11) 99999-9999',
  clinicName: ' Clínica de Teste ',
  initialAcquisitionChannel: '',
  website: '',
  startedAt: 123456,
  idempotencyKey: 'synthetic-key-123456',
};

test('public site submission preserves the exact request and error handling contract', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      assert.equal(url, '/api/public/sales-leads');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.credentials, 'include');
      assert.equal((init?.headers as Record<string, string>)?.['X-Idempotency-Key'], input.idempotencyKey);
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body, {
        name: 'Pessoa Sintética', phone: '(11) 99999-9999', clinicName: 'Clínica de Teste',
        acquisitionChannel: 'public_landing', source: 'public_landing', website: '',
        formStartedAt: 123456,
      });
      return {ok:true,json:async()=>({success:true})} as Response;
    }) as typeof fetch;
    await submitSalesInterest(input);
    assert.equal(calls, 1);
    globalThis.fetch = (async () => ({ok:false,json:async()=>({error:'Falha controlada'})} as Response)) as typeof fetch;
    await assert.rejects(submitSalesInterest(input), /Falha controlada/);
    globalThis.fetch = (async () => ({ok:true,json:async()=>({success:false,message:'Rejeitado'})} as Response)) as typeof fetch;
    await assert.rejects(submitSalesInterest(input), /Rejeitado/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a 2xx response without success:true never acknowledges lead persistence', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    for (const payload of [{}, {success: null}, {success: 0}, {success: 'true'}, {success: false}]) {
      globalThis.fetch = (async () => {
        calls++;
        return {ok: true, status: 201, json: async () => payload} as Response;
      }) as typeof fetch;
      await assert.rejects(submitSalesInterest(input), /Não foi possível registrar seu interesse/);
    }
    globalThis.fetch = (async () => {
      calls++;
      return {ok: true, status: 201, json: async () => {throw new SyntaxError('invalid JSON');}} as Response;
    }) as typeof fetch;
    await assert.rejects(submitSalesInterest(input), /Não foi possível registrar seu interesse/);
    assert.equal(calls, 6, 'rejecting invalid ACKs must not add HTTP requests or retries');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
