import assert from 'node:assert/strict';
import {
  applySalesPackageTierSelection,
  calculateSalesModularProposal,
  recommendSalesPackageTier,
  resolveSalesPackageTierSelection
} from '../src/utils/salesModularProposal';
import {
  PACKAGE_TIERS,
  modularAssumptionsFixture,
  modularCatalogFixture,
  proposalInputFixture
} from './fixtures/salesModularFixture';

const recommendationCases = [
  [10, PACKAGE_TIERS.upTo10.id],
  [17, PACKAGE_TIERS.upTo25.id],
  [50, PACKAGE_TIERS.upTo50.id],
  [100, PACKAGE_TIERS.upTo100.id],
  [101, PACKAGE_TIERS.custom.id],
  [150, PACKAGE_TIERS.custom.id]
] as const;

for (const [demand, expectedTierId] of recommendationCases) {
  assert.equal(
    recommendSalesPackageTier(modularCatalogFixture, demand)?.id,
    expectedTierId,
    `${demand} pacientes deve recomendar ${expectedTierId}`
  );
}

const from150To100 = proposalInputFixture(
  150,
  PACKAGE_TIERS.custom.id,
  150,
  159900
);
from150To100.patientQuantity = 100;
from150To100.expectedPatientQuantity12Months = 100;
assert.equal(
  resolveSalesPackageTierSelection(modularCatalogFixture, from150To100)
    .selectedTier?.id,
  PACKAGE_TIERS.upTo100.id,
  '150 → 100 deve voltar à faixa convencional até 100'
);

const from100To150 = proposalInputFixture(100, PACKAGE_TIERS.upTo100.id);
from100To150.patientQuantity = 150;
from100To150.expectedPatientQuantity12Months = 150;
assert.equal(
  resolveSalesPackageTierSelection(modularCatalogFixture, from100To150)
    .selectedTier?.id,
  PACKAGE_TIERS.custom.id,
  '100 → 150 deve usar a faixa personalizada'
);

const compatibleManual = proposalInputFixture(17, PACKAGE_TIERS.upTo50.id);
compatibleManual.basePackageSelectionMode = 'manual';
const compatibleResolution = resolveSalesPackageTierSelection(
  modularCatalogFixture,
  compatibleManual
);
assert.equal(compatibleResolution.selectedTier?.id, PACKAGE_TIERS.upTo50.id);
assert.equal(compatibleResolution.mode, 'manual');
assert.equal(compatibleResolution.manualOverrideRemoved, false);

const incompatibleManual = proposalInputFixture(50, PACKAGE_TIERS.upTo25.id);
incompatibleManual.basePackageSelectionMode = 'manual';
const incompatibleResolution = resolveSalesPackageTierSelection(
  modularCatalogFixture,
  incompatibleManual
);
assert.equal(incompatibleResolution.selectedTier?.id, PACKAGE_TIERS.upTo50.id);
assert.equal(incompatibleResolution.mode, 'automatic');
assert.equal(incompatibleResolution.manualOverrideRemoved, true);

const resetToRecommended = applySalesPackageTierSelection(
  compatibleManual,
  PACKAGE_TIERS.upTo25,
  'automatic'
);
assert.equal(resetToRecommended.basePackageTierId, PACKAGE_TIERS.upTo25.id);
assert.equal(resetToRecommended.basePackageSelectionMode, 'automatic');

const customInput = proposalInputFixture(
  150,
  PACKAGE_TIERS.custom.id,
  150,
  159900
);
const customResult = calculateSalesModularProposal(
  customInput,
  modularCatalogFixture,
  modularAssumptionsFixture
);
const customCore = customResult.lines.find(
  (line) => line.itemKey === 'clinical_core'
);
assert.ok(customCore, 'clinical_core deve existir no resultado');
assert.equal(customResult.basePackage.limitQuantity, 150);
assert.equal(customResult.basePackage.includedStorageMb, 15000);
assert.equal(customCore.directCostBreakdown.includedStorageGb, 15000 / 1024);
assert.equal(
  customCore.directCostBreakdown.estimatedUsedStorageGb,
  (15000 / 1024) * 0.6
);
assert.equal(
  customCore.directCostBreakdown.estimatedEgressGb,
  (15000 / 1024) * 0.6 * 2
);
assert.ok(Number(customCore.promotional.directCostCents) > 0);
assert.equal(customResult.missingCosts.length, 0);
assert.equal(customResult.missingDrivers.length, 0);
assert.equal(customResult.forecast.aggressivePatients, 150);
assert.equal(customResult.input.customBasePackageLimit, 150);
assert.equal(
  customResult.input.lines[0].customRecurringAmountCents,
  159900,
  'snapshot deve preservar o preço personalizado'
);
assert.equal(customCore.publicMetadata.maximumQuantity, 150);

assert.throws(
  () =>
    calculateSalesModularProposal(
      proposalInputFixture(150, PACKAGE_TIERS.custom.id, 149, 159900),
      modularCatalogFixture,
      modularAssumptionsFixture
    ),
  /customBasePackageLimit/
);
assert.throws(
  () =>
    calculateSalesModularProposal(
      proposalInputFixture(150, PACKAGE_TIERS.custom.id, 150, null),
      modularCatalogFixture,
      modularAssumptionsFixture
    ),
  /customRecurringAmountCents/
);

const intensiveInput = {
  ...customInput,
  usageProfile: 'intensive' as const
};
const intensiveResult = calculateSalesModularProposal(
  intensiveInput,
  modularCatalogFixture,
  modularAssumptionsFixture
);
const intensiveCore = intensiveResult.lines.find(
  (line) => line.itemKey === 'clinical_core'
)!;
assert.equal(intensiveCore.directCostBreakdown.estimatedUsedStorageGb, 15000 / 1024);
assert.equal(intensiveCore.directCostBreakdown.estimatedEgressGb, (15000 / 1024) * 5);
assert.ok(
  Number(intensiveResult.promotional.totalEstimatedCostCents) >
    Number(customResult.promotional.totalEstimatedCostCents),
  'cenário agressivo intensivo deve incorporar maior armazenamento/egress'
);

const conventionalResult = calculateSalesModularProposal(
  proposalInputFixture(100, PACKAGE_TIERS.upTo100.id),
  modularCatalogFixture,
  modularAssumptionsFixture
);
assert.equal(conventionalResult.basePackage.limitQuantity, 100);
assert.equal(conventionalResult.basePackage.includedStorageMb, 10000);
assert.equal(conventionalResult.missingCosts.length, 0);
assert.equal(conventionalResult.totalsReconciled, true);

console.log('salesModularProposal.test.ts: OK');
