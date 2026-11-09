import assert from 'node:assert/strict';
import { shiftGroupFixtureDates } from './helpers/groupSessionFixtureDates.mjs';

const first = shiftGroupFixtureDates('2026-11-02');
const next = shiftGroupFixtureDates('2026-11-03');
const repeat = shiftGroupFixtureDates('2026-11-16T13:00:00Z');
assert.ok(Date.parse(first + 'T00:00:00Z') > Date.now() + 13 * 86_400_000);
assert.equal(new Date(first + 'T00:00:00Z').getUTCDay(), 1, 'Monday preserved');
assert.equal(Date.parse(next + 'T00:00:00Z') - Date.parse(first + 'T00:00:00Z'), 86_400_000);
assert.equal(Date.parse(repeat) - Date.parse(first + 'T13:00:00Z'), 14 * 86_400_000);
assert.equal(shiftGroupFixtureDates('unrelated dates remain 2025-01-02'), 'unrelated dates remain 2025-01-02');
assert.equal(shiftGroupFixtureDates(null), null);
console.log('groupSessionFixtureDates: PASS');
