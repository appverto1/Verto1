import assert from 'node:assert/strict';
import { createSchoolErrorResponse } from '../services/schoolErrorResponse';

const resolveError = createSchoolErrorResponse((value: any, max = 200) => String(value || '').slice(0, max));
const cases = [
  [{ message: 'SCHOOL_PROFESSIONAL_CONFLICT:{"meetingId":"m1"}' }, 409, 'SCHOOL_PROFESSIONAL_CONFLICT'],
  [{ message: 'SCHOOL_PROFESSIONAL_CONFLICT:{broken}' }, 409, 'SCHOOL_PROFESSIONAL_CONFLICT'],
  [{ code: 'IDEMPOTENCY_CONFLICT' }, 409, 'SCHOOL_CONFLICT'],
  [{ message: '23505 duplicate row' }, 409, 'SCHOOL_CONFLICT'],
  [{ message: 'CONSENT_REQUIRED' }, 422, 'SCHOOL_CONSENT_REQUIRED'],
  [{ message: 'ACCESS_DENIED' }, 403, 'SCHOOL_ACCESS_DENIED'],
  [{ message: 'PATIENT_ACCESS_DENIED' }, 403, 'SCHOOL_ACCESS_DENIED'],
  [{ message: 'NOT_FOUND' }, 404, 'SCHOOL_NOT_FOUND'],
  [{ message: 'PGRST116' }, 404, 'SCHOOL_NOT_FOUND'],
  [{ message: 'SCHOOL_UNIT_REQUIRED' }, 422, 'SCHOOL_UNIT_REQUIRED'],
  [{ message: 'MISMATCH' }, 422, 'SCHOOL_BUSINESS_RULE'],
  [{ message: 'some error', statusCode: 429 }, 429, 'some error'],
] as const;
for (const [error, expectedStatus, expectedCode] of cases) {
  const record: { status?: number; body?: any } = {};
  const response = { status(code: number) { record.status = code; return this; }, json(body: any) { record.body = body; return this; } };
  assert.equal(resolveError(response, error), response);
  assert.equal(record.status, expectedStatus);
  assert.equal(record.body?.error, expectedCode);
}
const record: { status?: number; body?: any } = {};
const response = { status(code: number) { record.status = code; return this; }, json(body: any) { record.body = body; return this; } };
const prior = console.error;
try { console.error = () => {}; resolveError(response, { message: 'UNKNOWN_ERROR' }); } finally { console.error = prior; }
assert.equal(record.status, 500);
assert.equal(record.body?.error, 'SCHOOL_OPERATION_FAILED');
assert.equal(record.body?.message, 'Não foi possível concluir a operação escolar.');
assert.equal(record.body?.success, false);
console.log('schoolErrorResponse.test.ts: 13 cases passed');
