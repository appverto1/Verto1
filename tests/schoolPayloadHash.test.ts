import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { payloadHash } from '../services/schoolPayloadHash';

const stableValueReference = (value: any): any => {
  if (Array.isArray(value)) return value.map(stableValueReference);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((acc: any, key) => {
    if (value[key] !== undefined) acc[key] = stableValueReference(value[key]);
    return acc;
  }, {});
  return value;
};
const originalHash = (payload: any) => crypto.createHash('sha256').update(JSON.stringify(stableValueReference(payload))).digest('hex');

const fixtures: any[] = [
  null, true, '', 1, {}, [], { b: 2, a: 1 },
  { c: [{ z: 'v', a: null }, { q: [], ignored: undefined }], idempotencyKey: 'abc' },
  { a: undefined, b: null, count: 0 },
  [{ k: 2, b: 3 }, { k: 1, b: 1 }],
  { nested: { deep: { z: 5, a: 2 } } },
];
for (const [index, fixture] of fixtures.entries()) {
  assert.equal(payloadHash(fixture), originalHash(fixture), `Reference hash changed for fixture ${index}`);
}
assert.equal(payloadHash({ a: 1, b: 2 }), payloadHash({ b: 2, a: 1 }));
assert.notEqual(payloadHash({ a: null }), payloadHash({ a: undefined }));

const schoolRoutes = readFileSync(new URL('../services/schoolManagementRoutes.ts', import.meta.url), 'utf8');
assert.match(schoolRoutes, /import\s*\{\s*payloadHash\s*\}\s*from\s*['"]\.\/schoolPayloadHash['"]/);
assert.match(schoolRoutes, /p_payload_hash:\s*payloadHash\(operationPayload\)/);
assert.doesNotMatch(schoolRoutes, /(?:const|function)\s+(?:stableValue|payloadHash)\s*=/);
console.log('schoolPayloadHash.regression: PASS');
