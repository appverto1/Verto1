import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calculateCustomCapacity,
  DEFAULT_CUSTOM_CAPACITY_POLICY
} from '../src/utils/salesCommercialEvolution.ts';

// The builder synchronizes capacity blocks before the price fields are complete.
// Its effect must never derive a monetary amount from partially edited inputs.
const builder = readFileSync('src/components/SalesModularProposalBuilder.tsx', 'utf8');
const start = builder.indexOf('// Block selection depends on patient capacity');
const end = builder.indexOf('  }, [catalog, input]);', start);
assert.ok(start !== -1 && end > start, 'capacity sync effect not found');
const effect = builder.slice(start, end);
assert.match(effect, /calculateCustomCapacity\(/);
assert.match(effect, /basePriceCents:\s*0/);
assert.doesNotMatch(effect, /recurringLines|proposedPricePerPatientCents|customRecurringAmountCents/);
assert.match(builder, /code === 'CUSTOM_CAPACITY_INVALID' && detail === 'basePriceCents'/);

const policy = { ...DEFAULT_CUSTOM_CAPACITY_POLICY, blockSizePatients: 50 };
const make = (basePriceCents, selection) => calculateCustomCapacity({
  currentPatients: 70,
  expectedPatients: 70,
  baseLimitPatients: 50,
  basePriceCents,
  selection
}, policy);
const capacityOnly = make(0, { mode: 'automatic', selectedBlocks: null });
const fullyPriced = make(159900, { mode: 'automatic', selectedBlocks: null });
assert.equal(capacityOnly.minimumBlocks, 1);
assert.equal(capacityOnly.selectedBlocks, fullyPriced.selectedBlocks);
assert.equal(capacityOnly.totalContractedLimitPatients, fullyPriced.totalContractedLimitPatients);
const manual = make(0, { mode: 'manual', selectedBlocks: 2 });
assert.equal(manual.selectedBlocks, 2);
assert.equal(manual.selectionMode, 'manual');

// The monetary calculation must STILL reject invalid or excessive amounts.
assert.throws(() => make(-1), /CUSTOM_CAPACITY_INVALID:basePriceCents/);
assert.throws(() => make(1_000_000_001), /CUSTOM_CAPACITY_INVALID:basePriceCents/);
console.log('salesCustomCapacityDraftPriceCrash.regression.test.mjs: PASS');
