import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { clinicPolicyPayloadHash } from '../services/clinicPolicyPayloadHash';

const legacyStable = (value: any): any => {
  if (Array.isArray(value)) return value.map(legacyStable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result: any, key) => {
      if (value[key] !== undefined) result[key] = legacyStable(value[key]);
      return result;
    }, {});
  }
  return value;
};
const legacyHash = (value: any) => crypto.createHash('sha256').update(JSON.stringify(legacyStable(value))).digest('hex');

for (const value of [
  { idempotencyKey: 'save-1', noShowMode: 'AUTO', reason: null, noShowToleranceMinutes: 30 },
  { noShowToleranceMinutes: 5, autoNoShowEnabled: false, nested: { z: 4, a: [1, { c: true, b: null }] } },
  { reason: undefined, allowPatientReschedule: true, idempotencyKey: 'save-2' },
  ['one', { b: 1, a: 2 }, null, false],
]) assert.equal(clinicPolicyPayloadHash(value), legacyHash(value));
assert.equal(clinicPolicyPayloadHash({ b: 2, a: 1 }), clinicPolicyPayloadHash({ a: 1, b: 2 }));
assert.notEqual(clinicPolicyPayloadHash({ idempotencyKey: 'a', reason: null }), clinicPolicyPayloadHash({ idempotencyKey: 'b', reason: null }));
console.log('clinicPolicyPayloadHash: PASS');
