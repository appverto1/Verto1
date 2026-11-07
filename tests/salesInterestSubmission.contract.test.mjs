import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const form = readFileSync('src/components/SalesInterestForm.tsx', 'utf8');
const transport = readFileSync('src/services/salesInterestSubmission.ts', 'utf8');
const server = readFileSync('server.ts', 'utf8');
const backend = readFileSync('services/publicSalesLeadRoutes.ts', 'utf8');

test('the public site form delegates transport without changing its user-visible lifecycle', () => {
  assert.match(form, /await submitSalesInterest\(/);
  assert.match(form, /submissionInFlightRef\.current = true/);
  assert.match(form, /persisted = true;[\s\S]*?setSubmitted\(true\)/);
  assert.match(form, /if \(!persisted\) submissionInFlightRef\.current = false/);
  assert.doesNotMatch(form, /fetch\("\/api\/public\/sales-leads"/);
});
test('request protocol, source and idempotency stay exactly as before', () => {
  assert.match(transport, /fetch\("\/api\/public\/sales-leads", \{/);
  assert.match(transport, /method: "POST"/);
  assert.match(transport, /"X-Idempotency-Key": idempotencyKey/);
  assert.match(transport, /credentials: "include"/);
  assert.match(transport, /name: normalizedName/);
  assert.match(transport, /clinicName: clinicName\.trim\(\)/);
  assert.match(transport, /initialAcquisitionChannel\.trim\(\) \|\| "public_landing"/);
  assert.match(transport, /source: "public_landing"/);
  assert.match(transport, /formStartedAt: startedAt/);
  assert.match(transport, /if \(!response\.ok \|\| data\?\.success !== true\)/);
  assert.match(server, /registerPublicSalesLeadRoute\(app,/);
  assert.match(backend, /"\/api\/public\/sales-leads"/);
  assert.match(backend, /supabase\.rpc\("upsert_public_sales_lead"/);
  assert.match(backend, /publicSalesLeadIpLimiter,[\s\S]*?publicSalesLeadIdentityLimiter/);
});
