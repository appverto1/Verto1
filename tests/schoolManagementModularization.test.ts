import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { payloadHash } from '../services/schoolPayloadHash';
import { createSchoolErrorResponse } from '../services/schoolErrorResponse';

const capture = (error: any, fallback?: string) => {
  let code = 200;
  let response: any;
  const res = {
    status(next: number) { code = next; return this; },
    json(data: any) { response = data; return this; }
  };
  const send = createSchoolErrorResponse((v: unknown, max = 80) => String(v ?? '').slice(0, max));
  send(res, error, fallback);
  return { code, response };
};

test('idempotency hash is stable across JSON key ordering without changing values', () => {
  const original = { clinic_id: 'clinic-1', actor_id: 'user-1', data: { b: 2, a: 1 }, omitted: undefined };
  const ordered = { data: { a: 1, b: 2 }, actor_id: 'user-1', clinic_id: 'clinic-1' };
  assert.equal(payloadHash(original), payloadHash(ordered));
  assert.match(payloadHash(original), /^[a-f0-9]{64}$/);
  assert.notEqual(payloadHash(original), payloadHash({ ...ordered, clinic_id: 'clinic-2' }));
  assert.notEqual(payloadHash({ items: [1, 2] }), payloadHash({ items: [2, 1] }), 'array order is business-relevant');
});

test('errors preserve conflict, authorization and validation HTTP status codes', () => {
  const cases = [
    ['IDEMPOTENCY_CONFLICT', 409, 'SCHOOL_CONFLICT'],
    ['duplicate record', 409, 'SCHOOL_CONFLICT'],
    ['CONSENT_REQUIRED', 422, 'SCHOOL_CONSENT_REQUIRED'],
    ['PATIENT_ACCESS_DENIED', 403, 'SCHOOL_ACCESS_DENIED'],
    ['PGRST116', 404, 'SCHOOL_NOT_FOUND'],
    ['SCHOOL_UNIT_REQUIRED', 422, 'SCHOOL_UNIT_REQUIRED'],
    ['INVALID_SCHOOL_ID', 422, 'SCHOOL_BUSINESS_RULE']
  ] as const;
  for (const [message, code, expected] of cases) {
    const result = capture({ message });
    assert.equal(result.code, code, message);
    assert.equal(result.response?.success, false);
    assert.equal(result.response?.error, expected, message);
  }
});

test('professional schedule conflict retains structured details without changing status', () => {
  const result = capture({ message: 'SCHOOL_PROFESSIONAL_CONFLICT:{"appointmentId":"abc"}' });
  assert.equal(result.code, 409);
  assert.equal(result.response?.error, 'SCHOOL_PROFESSIONAL_CONFLICT');
  assert.deepEqual(result.response?.conflict, { appointmentId: 'abc' });
});

test('explicit backend error status and fallback are passed through', () => {
  const result = capture({ statusCode: 429, message: 'RATE_LIMITED' }, 'Aguarde.');
  assert.equal(result.code, 429);
  assert.equal(result.response.error, 'RATE_LIMITED');
  assert.equal(result.response.message, 'Aguarde.');
});

test('extraction leaves clinic scope, backend RPC and idempotency Save authority in place', () => {
  const routes = readFileSync('services/schoolManagementRoutes.ts', 'utf8');
  const hash = readFileSync('services/schoolPayloadHash.ts', 'utf8');
  const errors = readFileSync('services/schoolErrorResponse.ts', 'utf8');
  assert.match(routes, /const errorResponse = createSchoolErrorResponse\(sanitizeString\)/);
  assert.match(routes, /p_payload_hash: payloadHash\(operationPayload\)/);
  assert.match(routes, /p_idempotency_key: idempotencyKey/);
  assert.match(routes, /p_clinic_id: scope\.clinicId/);
  assert.match(routes, /p_actor_id: scope\.actorId/);
  assert.match(routes, /currentClinicId/);
  assert.doesNotMatch(hash, /\bsupabase\b|\bfetch\s*\(|\.from\s*\(/);
  assert.doesNotMatch(errors, /\bsupabase\b|\bfetch\s*\(|\.from\s*\(/);
});
