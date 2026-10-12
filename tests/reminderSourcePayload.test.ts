import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseReminderSourcePayload } from '../services/reminderSourcePayload';

const reference = (value: unknown): Record<string, any> => {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, any>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};
const object = { patientId: 'example', scheduledAt: '2026-10-11T09:00:00Z' };
const array = [1, { a: true }];
const cycle: any = {}; cycle.self = cycle;
const fixtures: unknown[] = [
  null, undefined, false, true, 0, -1, 3.14, '', ' ', 'null',
  'true', '3', '"string"', '{}', '[]', '[1,2]',
  '{"scheduledAt":"2026-10-11T09:00:00Z","status":"confirmed"}',
  '{"__proto__":{"admin":true}}', '{invalid', '[', '"',
  object, array, cycle, Symbol('x'), 'a'.repeat(200_000),
];
for (const [index, value] of fixtures.entries()) {
  const actual = parseReminderSourcePayload(value);
  assert.deepStrictEqual(actual, reference(value), `payload parsing mismatch for fixture ${index}`);
  if (value && typeof value === 'object') {
    assert.strictEqual(actual, value, `object reference changed for fixture ${index}`);
  }
}
const cronSource = readFileSync(new URL('../services/cronService.ts', import.meta.url), 'utf8');
assert.match(cronSource, /import\s*\{\s*parseReminderSourcePayload\s*\}\s*from\s*['"]\.\/reminderSourcePayload['"]/);
assert.match(cronSource, /parseReminderSourcePayload\(request\?\.metadata\)/);
assert.doesNotMatch(cronSource, /const\s+parseReminderSourcePayload\s*=/);
console.log('reminderSourcePayload.regression: PASS (26 inputs)');
