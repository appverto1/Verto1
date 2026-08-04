import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SALES_PROFITABILITY_POLICY,
  buildSalesCommercialApprovalResult,
  classifySalesProposalReview,
  isSalesProfitabilityPolicySchemaMissingError,
  validateSalesCommercialExceptionActor
} from '../src/utils/salesModularEconomics';

const commercialResult = {
  catalogVersion: 3,
  promotionalRecurringRevenueCents: 159_900,
  totalsReconciled: true,
  missingCosts: [],
  missingDrivers: [],
  possibleDuplicateCosts: [],
  commercialPricing: {
    enabled: true,
    missingPriceItemKeys: [],
    totalProposedPricePerPatientCents: 1066,
    contractedCapacityPatients: 150
  },
  economics: {
    policy: structuredClone(DEFAULT_SALES_PROFITABILITY_POLICY),
    pricingProfile: 'intensive',
    percentageCostBasisPoints: 900,
    promotional: {
      revenueCents: 159_900,
      costCents: 70_000,
      ebitdaCents: 89_900,
      marginBasisPoints: 5622,
      maximumDiscountCents: 0
    },
    postPromotion: {
      revenueCents: 194_800,
      costCents: 70_000,
      ebitdaCents: 124_800,
      marginBasisPoints: 6407,
      maximumDiscountCents: 0
    },
    items: [
      {
        itemKey: 'clinical_core',
        publicName: 'Verto Clínica',
        isBasePackage: true,
        promotionalRevenueCents: 159_900,
        promotionalCostCents: 60_000,
        promotionalMarginBasisPoints: 6248,
        postPromotionRevenueCents: 159_900,
        postPromotionCostCents: 60_000,
        postPromotionMarginBasisPoints: 6248
      },
      {
        itemKey: 'school_management',
        publicName: 'Gestão Escolar e Institucional',
        isBasePackage: false,
        promotionalRevenueCents: 0,
        promotionalCostCents: 10_000,
        promotionalMarginBasisPoints: null,
        postPromotionRevenueCents: 34_900,
        postPromotionCostCents: 10_000,
        postPromotionMarginBasisPoints: 7135
      }
    ],
    capacity: {
      revenueCents: 0,
      incrementalCostCents: 0,
      marginBasisPoints: 7000,
      minimumPriceCents: 0,
      meetsMinimumMargin: false
    },
    expansions: [],
    phases: [
      {
        startsAt: '2026-07-28T00:00:00.000Z',
        endsAt: '2027-01-28T00:00:00.000Z',
        revenueCents: 159_900,
        costCents: 170_000,
        ebitdaCents: -10_100,
        marginBasisPoints: -632,
        maximumDiscountCents: 0,
        belowAbsoluteMinimum: true,
        requiresTemporaryDiscountJustification: false
      }
    ],
    firstYearMaximumDiscountCents: 0,
    canSend: false,
    requiresJustification: true,
    blockingCodes: [
      'CLINIC_MARGIN_BELOW_60',
      'POST_PROMOTION_MARGIN_BELOW_70',
      'MODULE_MARGIN_BELOW_75:school_management',
      'CAPACITY_MARGIN_BELOW_75'
    ],
    warnings: []
  }
} as any;

const originalResult = structuredClone(commercialResult);
const review = classifySalesProposalReview(commercialResult);
assert.equal(review.technicalBlockingCodes.length, 0);
assert.equal(review.requiresCommercialApproval, false);
assert.equal(
  review.canGeneratePublicOfferWithoutApproval,
  true,
  'margem abaixo da meta gera aviso, mas não bloqueia publicação'
);
assert.equal(
  review.canSaveDraft,
  true,
  'alertas comerciais não podem impedir o rascunho'
);
assert.ok(review.commercialAlertCodes.includes('PROMOTIONAL_PHASE_DEFICIT'));
assert.ok(
  review.commercialAlertCodes.includes(
    'FREE_MODULE_WITH_COST:school_management'
  )
);

assert.equal(
  validateSalesCommercialExceptionActor({
    role: 'owner',
    mfaVerified: true,
    explicitConfirmation: true,
    justification:
      'Cliente-vitrine com condição posterior contratualmente sustentável.',
    type: 'strategic_showcase'
  }),
  null,
  'owner com MFA, confirmação e justificativa pode aprovar'
);
assert.equal(
  validateSalesCommercialExceptionActor({
    role: 'admin',
    mfaVerified: true,
    explicitConfirmation: true,
    justification: 'Justificativa comercial suficientemente detalhada.',
    type: 'margin_policy_override'
  }),
  'OWNER_ROLE_REQUIRED'
);
assert.equal(
  validateSalesCommercialExceptionActor({
    role: 'owner',
    mfaVerified: false,
    explicitConfirmation: true,
    justification: 'Justificativa comercial suficientemente detalhada.',
    type: 'margin_policy_override'
  }),
  'OWNER_MFA_REQUIRED'
);
assert.equal(
  validateSalesCommercialExceptionActor({
    role: 'owner',
    mfaVerified: true,
    explicitConfirmation: true,
    justification: 'Muito curta',
    type: 'margin_policy_override'
  }),
  'COMMERCIAL_EXCEPTION_JUSTIFICATION_REQUIRED'
);
assert.equal(
  validateSalesCommercialExceptionActor({
    role: 'owner',
    mfaVerified: true,
    explicitConfirmation: false,
    justification: 'Justificativa comercial suficientemente detalhada.',
    type: 'margin_policy_override'
  }),
  'COMMERCIAL_EXCEPTION_CONFIRMATION_REQUIRED'
);

const approvalResult = buildSalesCommercialApprovalResult(
  commercialResult,
  review.commercialAlertCodes
);
assert.deepEqual(
  commercialResult,
  originalResult,
  'classificação e aprovação não alteram os cálculos nem a política global'
);
assert.deepEqual(
  approvalResult.approvedCodes,
  [...review.commercialAlertCodes].sort(),
  'códigos aprovados devem ser congelados de forma determinística'
);

const stableHash = (value: unknown) => {
  const normalize = (entry: any): any =>
    Array.isArray(entry)
      ? entry.map(normalize)
      : entry && typeof entry === 'object'
        ? Object.keys(entry)
            .sort()
            .reduce((result: Record<string, any>, key) => {
              result[key] = normalize(entry[key]);
              return result;
            }, {})
        : entry;
  return createHash('sha256')
    .update(JSON.stringify(normalize(value)))
    .digest('hex');
};
const approvedHash = stableHash(approvalResult);
const changedPrice = structuredClone(commercialResult);
changedPrice.promotionalRecurringRevenueCents += 100;
changedPrice.commercialPricing.totalProposedPricePerPatientCents += 1;
const changedHash = stableHash(
  buildSalesCommercialApprovalResult(
    changedPrice,
    classifySalesProposalReview(changedPrice).commercialAlertCodes
  )
);
assert.notEqual(
  approvedHash,
  changedHash,
  'mudança de preço deve invalidar o hash aprovado'
);

for (const technicalCode of [
  'ECONOMICS_INSUFFICIENT_DATA',
  'ECONOMICS_DENOMINATOR_INVALID',
  'MODULE_DEPENDENCY_MISSING:school_management'
]) {
  const technicalResult = structuredClone(commercialResult);
  technicalResult.economics.blockingCodes = [technicalCode];
  const technicalReview = classifySalesProposalReview(technicalResult);
  assert.ok(technicalReview.technicalBlockingCodes.includes(technicalCode));
  assert.equal(
    technicalReview.canSaveDraft,
    false,
    'uma aprovação comercial não pode liberar bloqueio técnico'
  );
}
const missingPriceResult = structuredClone(commercialResult);
missingPriceResult.economics.blockingCodes = [];
missingPriceResult.commercialPricing.missingPriceItemKeys = [
  'school_management'
];
assert.ok(
  classifySalesProposalReview(missingPriceResult).technicalBlockingCodes.some(
    (code) => code.startsWith('COMMERCIAL_PRICE_PER_PATIENT_MISSING:')
  ),
  'preço ausente continua não excepcionável'
);
assert.equal(
  isSalesProfitabilityPolicySchemaMissingError({
    code: '42703',
    message:
      'column sales_pricing_catalog_versions.profitability_policy does not exist'
  }),
  true
);
assert.equal(
  isSalesProfitabilityPolicySchemaMissingError({
    message:
      "Could not find the 'profitability_policy' column in the schema cache"
  }),
  true
);
assert.equal(
  isSalesProfitabilityPolicySchemaMissingError({
    message: 'profitability_policy is null for a historical catalog'
  }),
  false,
  'política histórica null após a coluna existir continua compatível'
);

const server = readFileSync('server.ts', 'utf8');
const builder = readFileSync(
  'src/components/SalesModularProposalBuilder.tsx',
  'utf8'
);
const catalogPanel = readFileSync(
  'src/components/SalesPricingCatalogPanel.tsx',
  'utf8'
);
const legacySimulator = readFileSync(
  'src/components/SalesProfitabilitySimulator.tsx',
  'utf8'
);
const publicSerializer = server.slice(
  server.indexOf('if (offerType === "modular")'),
  server.indexOf('if (offerType === "modular")') + 9000
);
assert.doesNotMatch(
  publicSerializer,
  /commercialExceptionApproval|commercialReview|justification/,
  'DTO público não pode expor aprovação, justificativa, custos ou margens'
);
assert.match(server, /commercialExceptionApproval: approvalResult\.approval/);
assert.match(server, /salesCommercialExceptionApprovalMatches/);
assert.match(server, /rawApproval\.resultHash/);
assert.match(server, /PROPOSAL_MARGIN_POLICY_REVIEW_REQUIRED/);
assert.match(server, /MODULAR_CHECKOUT_MARGIN_POLICY_REVIEW_REQUIRED/);
assert.match(server, /SALES_PROFITABILITY_POLICY_MIGRATION_PENDING/);
assert.match(
  server,
  /res\.status\(503\)\.json\(\{[\s\S]*SALES_PROFITABILITY_POLICY_MIGRATION_PENDING_CODE/
);
assert.doesNotMatch(server, /PROPOSAL_EBITDA_POLICY_BLOCKED/);
assert.doesNotMatch(server, /MODULAR_CHECKOUT_EBITDA_POLICY_BLOCKED/);
assert.match(
  `${builder}\n${catalogPanel}\n${legacySimulator}`,
  /EBITDA atribuído/i,
  'a área interna deve explicar o EBITDA atribuído da proposta'
);
assert.match(
  builder,
  /Lucro líquido estimado/i,
  'a área interna deve usar a terminologia de lucro líquido estimado'
);
assert.doesNotMatch(
  `${server}\n${builder}`,
  /Plural Multi/i,
  'o cenário estratégico deve ser genérico, sem cliente hardcoded'
);

const profitabilityMigration = readFileSync(
  'supabase/migrations/20260728020000_sales_modular_profitability_policy.sql',
  'utf8'
);
assert.doesNotMatch(
  profitabilityMigration,
  /update\s+public\.sales_offer_simulations|update\s+public\.sales_offers/i,
  'a migration não pode recalcular propostas ou snapshots históricos'
);

console.log('salesCommercialExceptionApproval.test.ts: OK');
