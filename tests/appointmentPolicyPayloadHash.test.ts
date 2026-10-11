import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { payloadHash } from '../services/appointmentPolicyPayloadHash.ts';

const source = fs.readFileSync(new URL('../services/clinicAppointmentPolicyRoutes.ts', import.meta.url), 'utf8');
assert.ok(source.includes("import { payloadHash } from './appointmentPolicyPayloadHash';"));
assert.ok(!source.includes('const stableValue ='), 'inline hash helper must be removed');
assert.ok(source.includes('p_payload_hash: payloadHash(operation)'), 'existing RPC hash contract must be preserved');

const originalStableValue = (value: any): any => {
  if (Array.isArray(value)) return value.map(originalStableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result: any, key) => {
      if (value[key] !== undefined) result[key] = originalStableValue(value[key]);
      return result;
    }, {});
  }
  return value;
};
const originalPayloadHash = (value: any) =>
  crypto.createHash('sha256').update(JSON.stringify(originalStableValue(value))).digest('hex');

const cases = [
  {},
  { action: 'cancel', appointment_id: 'abc' },
  { b: 2, a: 1 },
  { a: 1, b: 2 },
  { z: [2, { b: 2, a: 1 }], a: { x: null, z: false } },
  { a: undefined, b: null },
  { a: [undefined, null, 0, ''] },
  { number: -1.5, yes: true },
];
for (const value of cases) {
  assert.equal(payloadHash(value), originalPayloadHash(value));
  assert.match(payloadHash(value), /^[a-f0-9]{64}$/);
}
assert.equal(payloadHash({ b: 2, a: 1 }), payloadHash({ a: 1, b: 2 }));
assert.notEqual(payloadHash({ a: 1 }), payloadHash({ a: 2 }));
console.log('appointment policy hash: 8 reference equivalence cases and determinism checks passed');
