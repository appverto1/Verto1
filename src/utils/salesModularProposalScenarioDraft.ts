import type { SalesModularProposalInput, SalesModularProposalResult, SalesPricingCatalogSnapshot } from './salesModularProposal';
import { recommendSalesPackageTier } from './salesModularProposal';
import { commercialCapacityForDemand, commercialCapacityForExactDemand, isSalesFunctionalModuleItemKey } from './salesModularProposalBuilderInput';
import { normalizeSalesTrialDays } from './salesTrialContract';

// Pure draft transformation for the explicit Duplicate scenario action.
// Neither historical frozen snapshots nor backend-authoritative pricing are mutated.
export const buildSalesModularProposalDuplicateDraft = (
  simulation: { modular_input_snapshot: SalesModularProposalInput; results_snapshot: SalesModularProposalResult },
  catalog: SalesPricingCatalogSnapshot | null,
): SalesModularProposalInput => {
    const snapshotInput = simulation.modular_input_snapshot;
    const snapshotDemand = Math.max(1, snapshotInput.patientQuantity);
    const snapshotRecommended = catalog
      ? recommendSalesPackageTier(catalog, snapshotDemand)
      : null;
    const snapshotCoreItem = catalog?.items.find(
      (item) => item.itemKey === 'clinical_core'
    );
    const snapshotTier = snapshotCoreItem?.tiers.find(
      (tier) => tier.id === snapshotInput.basePackageTierId
    );
    const modernCoreTier =
      snapshotCoreItem?.tiers.find((tier) => tier.isCustom) ||
      snapshotCoreItem?.tiers.find((tier) => tier.maximumQuantity === null) ||
      null;
    const modernCapacity = snapshotInput.exactPerPatientBilling === true
      ? commercialCapacityForExactDemand(snapshotDemand)
      : commercialCapacityForDemand(snapshotDemand) || Math.max(51, snapshotDemand);
    const inferredMode = snapshotInput.basePackageSelectionMode ||
      (snapshotRecommended?.id === snapshotInput.basePackageTierId
        ? 'automatic'
        : 'manual');
    return {
      ...snapshotInput,
      trialDays: normalizeSalesTrialDays(snapshotInput.trialDays, 0),
      commercialPricingMode: 'manual_module_prices',
      commercialCapacityBasis: 'current_patients',
      // Duplicar um cenário histórico cria uma nova composição comercial sem
      // expor a infraestrutura como módulo; o snapshot original permanece intacto.
      platformFoundationPricingMode: 'manual',
      platformFoundationMonthlyAmountCents: 0,
      usageProfile: 'intensive',
      driverOverrides: {},
      basePackageTierId:
        modernCoreTier?.id || snapshotInput.basePackageTierId,
      basePackageSelectionMode: modernCoreTier ? 'manual' : inferredMode,
      customBasePackageLimit: modernCoreTier
        ? modernCapacity
        : snapshotTier?.isCustom || snapshotTier?.maximumQuantity === null
          ? snapshotInput.customBasePackageLimit ??
            simulation.results_snapshot?.basePackage?.limitQuantity ??
            snapshotDemand
          : null,
      customCapacityBlocks: null,
      customCapacitySelectionMode: 'automatic',
      lines: snapshotInput.lines
        .filter((line) => isSalesFunctionalModuleItemKey(line.itemKey))
        .map((line) => {
        const item = catalog?.items.find(
          (candidate) => candidate.itemKey === line.itemKey
        );
        if (!item || item.billingInterval === 'one_time') return line;
        const tier = item.tiers.find(
          (candidate) => candidate.id === line.tierId
        );
        const modernTier =
          item.tiers.find((candidate) => candidate.isCustom) ||
          item.tiers.find((candidate) => candidate.maximumQuantity === null) ||
          tier ||
          null;
        return {
          ...line,
          tierId: modernTier?.id || line.tierId,
          pricingEditMode: line.pricingEditMode || 'monthly_total',
          customRecurringAmountCents:
            line.pricingEditMode === 'per_patient'
              ? line.customRecurringAmountCents ?? null
              : line.customRecurringAmountCents ??
                tier?.recurringAmountCents ??
                item.recurringAmountCents ??
                0
        };
      })
    };
};
