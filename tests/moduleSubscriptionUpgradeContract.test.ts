import assert from 'node:assert/strict';
import { exactScheduleBoundaries, parseCheckoutPlan } from '../services/moduleSubscriptionUpgradeContract';
const first = { startsAt: '2026-11-03T00:00:00.000Z', endsAt: '2026-12-03T00:00:00.000Z' };
const second = { startsAt: '2026-12-03T00:00:00.000Z', endsAt: null };
const toUnix = (value: string) => Date.parse(value) / 1000;
const stripePhases = [
  { start_date: toUnix(first.startsAt), end_date: toUnix(first.endsAt) },
  { start_date: toUnix(second.startsAt), end_date: null },
];
assert.equal(exactScheduleBoundaries(stripePhases, [first, second]), true);
assert.equal(exactScheduleBoundaries(stripePhases, [first]), false, 'mismatched phase count');
assert.equal(exactScheduleBoundaries(stripePhases, [second, first]), false, 'reordered phases');
assert.equal(exactScheduleBoundaries([{ ...stripePhases[0], start_date: stripePhases[0].start_date + 1 }, stripePhases[1]], [first, second]), false, 'start changed');
assert.equal(exactScheduleBoundaries([{ ...stripePhases[0], end_date: stripePhases[0].end_date + 1 }, stripePhases[1]], [first, second]), false, 'end changed');
assert.equal(exactScheduleBoundaries([{ ...stripePhases[0], end_date: null }, stripePhases[1]], [first, second]), false, 'ended phase converted to open');
assert.equal(exactScheduleBoundaries([stripePhases[0], { ...stripePhases[1], end_date: stripePhases[0].end_date + 1 }], [first, second]), false, 'open phase closed');
assert.equal(exactScheduleBoundaries([], []), true, 'preserve zero-phase behavior');
assert.throws(() => parseCheckoutPlan({ modular_snapshot: { commercialPhases: [] } }), /MODULE_UPGRADE_OFFER_PHASES_MISSING/);
assert.throws(() => parseCheckoutPlan({ modular_snapshot: null }), /MODULE_UPGRADE_OFFER_PHASES_MISSING/);
console.log('moduleSubscriptionUpgradeContract: PASS');
