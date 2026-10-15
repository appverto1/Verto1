import assert from 'node:assert/strict';
import { resolveFinancialPlanSessionPrice, canScheduleModalityFromPlan } from '../src/utils/groupFinancialPlanPrice';

const plan = { status:'ACTIVE', amount_cents: 15000, group_amount_cents: 7000 };
assert.deepEqual(resolveFinancialPlanSessionPrice(plan,'INDIVIDUAL'), { modality:'INDIVIDUAL', amountCents:15000 });
assert.deepEqual(resolveFinancialPlanSessionPrice(plan,'GROUP'), { modality:'GROUP', amountCents:7000 });
assert.equal(resolveFinancialPlanSessionPrice({amount_cents:15000}, 'GROUP'),null);
assert.equal(canScheduleModalityFromPlan({ amount_cents: 0, group_amount_cents:6000 }, 'INDIVIDUAL'),false);
assert.equal(canScheduleModalityFromPlan({ amount_cents: 0, group_amount_cents:6000 }, 'GROUP'),true);
for (const invalid of [null, undefined, '', -1, '123.2', Infinity, 'invalid']) {
  assert.equal(resolveFinancialPlanSessionPrice({ ...plan, group_amount_cents:invalid }, 'GROUP'),null);
}
assert.equal(resolveFinancialPlanSessionPrice({ ...plan, status:'INACTIVE' },'GROUP'),null);
console.log('groupFinancialPlanPrice.test.ts: ok');
