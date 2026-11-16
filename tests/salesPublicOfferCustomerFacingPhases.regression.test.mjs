import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const route = readFileSync('services/publicSalesOfferReadRoute.ts', 'utf8');

test('customer-facing phases are filtered before publication, preserving legacy fallback', () => {
  assert.match(route, /const customerFacingCommercialPhases = customerFacingModulesOnly/);
  assert.match(route, /Array\.isArray\(modularSnapshot\.commercialPhases\)/);
  assert.match(route, /commercialPhases\.map\(\(phase: any\) => \(\{/);
  assert.match(route, /lines: Array\.isArray\(phase\?\.lines\)/);
  assert.match(route, /!isSalesInternalCommercialItemKey\(line\?\.itemKey\)/);
  assert.match(route, /: modularSnapshot\.commercialPhases;/,
    'historical offers keep their original phases');
  assert.match(route, /commercialPhases: sanitizePublicCommercialPhases\(\s*customerFacingCommercialPhases,/,
    'only the filtered phase view must leave the server');
  assert.doesNotMatch(route, /commercialPhases: sanitizePublicCommercialPhases\(\s*modularSnapshot\.commercialPhases,/);
});

test('billable internal lines remain blocked and the single public token route retained', () => {
  assert.match(route, /internalItemHasBillableValue/);
  assert.match(route, /if \(internalItemHasBillableValue\) \{/);
  assert.match(route, /OFFER_UNAVAILABLE/);
  assert.match(route, /customerFacingItems/);
  assert.match(route, /salesOfferUsesCustomerFacingModulesOnly\(modularSnapshot\)/);
});
