import assert from 'node:assert/strict';
import {
  normalizeSalesTrialDays,
  parseSalesTrialDays,
  resolveFrozenSalesOfferTrialDays,
} from '../src/utils/salesTrialContract.ts';

assert.equal(normalizeSalesTrialDays(7), 7);
assert.equal(normalizeSalesTrialDays('14'), 14);
assert.equal(normalizeSalesTrialDays(undefined, 0), 0);
assert.equal(parseSalesTrialDays(365), null);

assert.equal(
  resolveFrozenSalesOfferTrialDays({
    trial_days: 7,
    modular_snapshot: { trialDays: 7 },
    simulation_snapshot: { input: { trialDays: 7 } },
  }),
  7,
);

assert.equal(
  resolveFrozenSalesOfferTrialDays({
    trial_days: 0,
    modular_snapshot: {},
    simulation_snapshot: { input: {} },
  }),
  0,
);

assert.throws(
  () => resolveFrozenSalesOfferTrialDays({
    trial_days: 0,
    modular_snapshot: { trialDays: 7 },
    simulation_snapshot: { input: { trialDays: 7 } },
  }),
  /MODULAR_CHECKOUT_RECONCILIATION_FAILED:trial_snapshot_mismatch/,
);

assert.throws(
  () => resolveFrozenSalesOfferTrialDays({ trial_days: 365 }),
  /MODULAR_CHECKOUT_RECONCILIATION_FAILED:sales_offers\.trial_days/,
);

console.log('salesTrialContract.test.ts: OK');
