import assert from 'node:assert/strict';
import { getPayerSetupReadiness } from '../src/components/PayerRequirementsPanel';
import {
  collectTissPreGuideSetupIssues,
  shouldShowTissPreGuidePreparation,
} from '../src/utils/tissPreGuideSetupIssues';
import { validatePayerAttendanceProfile040300 } from '../src/services/tissOfficial/versions/communication040300/domains';

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

const technicalBlockersBeforePortalWarning = collectTissPreGuideSetupIssues(
  {
    status: 'pending_data',
    validationErrorCodes: [
      'PAYER_ATTENDANCE_TYPE_INVALID',
      'PAYER_ATTENDANCE_REGIME_INVALID',
      'PAYER_ATTENDANCE_CHARACTER_INVALID',
    ],
  },
  {
    issues: [{
      code: 'ZERO_AMOUNT_XML_OPERATOR_POLICY',
      severity: 'warning',
      description: 'Valor pelo portal',
    }],
  },
);
assert.deepEqual(technicalBlockersBeforePortalWarning, [
  'Tipo de atendimento TISS oficial não configurado',
  'Regime de atendimento TISS oficial não configurado',
  'Caráter de atendimento TISS oficial não configurado',
]);
assert.equal(technicalBlockersBeforePortalWarning.includes('Valor pelo portal'), false);

assert.deepEqual(
  collectTissPreGuideSetupIssues(
    { status: 'valid', validationErrorCodes: [] },
    { issues: [{ severity: 'warning', description: 'Valor pelo portal' }] },
  ),
  ['Valor pelo portal'],
);

const missingOfficialAttendance = validatePayerAttendanceProfile040300({});
assert.deepEqual(missingOfficialAttendance.map((issue) => issue.field), [
  'defaultAttendanceType',
  'defaultAttendanceRegime',
  'defaultAttendanceCharacter',
]);
assert.equal(validatePayerAttendanceProfile040300({
  defaultAttendanceType: '04',
  defaultAttendanceRegime: '01',
  defaultAttendanceCharacter: '1',
}).length, 0);
assert.equal(validatePayerAttendanceProfile040300({
  defaultAttendanceType: '99',
  defaultAttendanceRegime: '01',
  defaultAttendanceCharacter: '1',
})[0]?.reason, 'unsupported');

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
  tissProfile: {
    ansRegistration: '123456',
    contractedProviderCode: 'CLINICA-1',
    defaultAttendanceType: '04',
    defaultAttendanceRegime: '01',
    defaultAttendanceCharacter: '1',
  },
  activeProcedureCount: 1,
  activeMappingCount: 1,
  readyMappingCount: 1,
  activePriceCount: 1,
  activeBillingConfigurationCount: 1,
  preGuideTestStatus: 'blocked',
  preGuideTestIssues: ['Procedimento sem mapeamento TUSS para este convênio'],
});
const blockedTestStep = blockedReadiness.steps.find((step) => step.key === 'test');
const readyMappingStep = blockedReadiness.steps.find((step) => step.key === 'tuss');
assert.equal(readyMappingStep?.status, 'ready');
assert.equal(readyMappingStep?.canContinue, true);
assert.deepEqual(readyMappingStep?.blockingReasons, []);
assert.deepEqual(blockedTestStep?.blockingReasons, [
  'Procedimento sem mapeamento TUSS para este convênio',
]);
assert.deepEqual(blockedTestStep?.warnings, []);
assert.equal(blockedTestStep?.status, 'blocked');
assert.equal(blockedTestStep?.canContinue, false);
assert.equal(blockedReadiness.blockers.filter((item) => item.includes('mapeamento TUSS')).length, 1);
assert.equal(blockedReadiness.overallStatus, 'ready_for_pre_guide');
assert.notEqual(blockedReadiness.steps.find((step) => step.key === 'ready')?.status, 'ready');

const incompleteTissReadiness = getPayerSetupReadiness({
  payer: { name: 'Vivest', payerType: 'INSURANCE' },
  tissProfile: { ansRegistration: '123456', contractedProviderCode: 'CLINICA-1' },
});
const incompleteTissStep = incompleteTissReadiness.steps.find((step) => step.key === 'tiss');
assert.equal(incompleteTissStep?.status, 'blocked');
assert.equal(incompleteTissStep?.canContinue, false);
assert.equal(incompleteTissStep?.blockingReasons?.length, 3);

console.log('tissPreGuideSetupIssues: ok');
