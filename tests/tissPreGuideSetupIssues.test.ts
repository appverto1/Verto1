import assert from 'node:assert/strict';
import { getPayerSetupReadiness } from '../src/components/PayerRequirementsPanel';
import {
  collectTissPreGuideSetupIssues,
  shouldShowTissPreGuidePreparation,
} from '../src/utils/tissPreGuideSetupIssues';

const detailed = collectTissPreGuideSetupIssues(
  { status: 'pending_data', validationErrorCodes: ['PAYER_TUSS_MAPPING_MISSING'] },
  {
    issues: [{
      code: 'MISSING_TUSS_MAPPING',
      description: 'Pré-guia de convênio precisa de procedimento TUSS oficial resolvido por De/Para.',
    }],
  },
);
assert.deepEqual(detailed, [
  'Pré-guia de convênio precisa de procedimento TUSS oficial resolvido por De/Para.',
]);
assert.equal(detailed.join(' ').includes('pending_data'), false);

const fromChecklistItem = collectTissPreGuideSetupIssues(
  { status: 'pending_data' },
  {
    items: [{ status: 'blocking', relatedIssueCodes: ['PAYER_TUSS_MAPPING_MISSING'] }],
  },
);
assert.deepEqual(fromChecklistItem, ['Procedimento sem mapeamento TUSS para este convênio']);

const fromCodes = collectTissPreGuideSetupIssues({
  status: 'pending_data',
  validationErrorCodes: ['PAYER_TUSS_MAPPING_MISSING', 'PAYER_TUSS_MAPPING_MISSING'],
});
assert.deepEqual(fromCodes, ['Procedimento sem mapeamento TUSS para este convênio']);

assert.deepEqual(
  collectTissPreGuideSetupIssues({ status: 'pending_data' }),
  ['A Pré-guia ainda possui dados obrigatórios pendentes.'],
);
assert.deepEqual(collectTissPreGuideSetupIssues({ status: 'valid' }), []);
assert.equal(shouldShowTissPreGuidePreparation('not_tested'), true);
assert.equal(shouldShowTissPreGuidePreparation('blocked'), false);
assert.equal(shouldShowTissPreGuidePreparation('ready'), false);

const blockedReadiness = getPayerSetupReadiness({
  payer: { name: 'Vivest', payerType: 'INSURANCE' },
  tissProfile: { ansRegistration: '123456', contractedProviderCode: 'CLINICA-1' },
  activeProcedureCount: 1,
  activeMappingCount: 1,
  readyMappingCount: 1,
  activePriceCount: 1,
  activeBillingConfigurationCount: 1,
  preGuideTestStatus: 'blocked',
  preGuideTestIssues: ['Procedimento sem mapeamento TUSS para este convênio'],
});
const blockedTestStep = blockedReadiness.steps.find((step) => step.key === 'test');
assert.deepEqual(blockedTestStep?.blockingReasons, [
  'Procedimento sem mapeamento TUSS para este convênio',
]);
assert.deepEqual(blockedTestStep?.warnings, []);
assert.equal(blockedTestStep?.status, 'blocked');
assert.equal(blockedTestStep?.canContinue, false);
assert.equal(blockedReadiness.blockers.filter((item) => item.includes('mapeamento TUSS')).length, 1);
assert.equal(blockedReadiness.overallStatus, 'ready_for_pre_guide');
assert.notEqual(blockedReadiness.steps.find((step) => step.key === 'ready')?.status, 'ready');

console.log('tissPreGuideSetupIssues: ok');
