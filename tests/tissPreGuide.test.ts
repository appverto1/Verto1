import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateTissPreGuideEligibility,
  validateTissPreGuide,
} from '../src/services/tissPreGuideEngine';
import {
  buildTissSpSadtDraftPayload,
  generateTissXmlDraft,
} from '../src/services/tissXmlDraftGenerator';
import {
  validateTissXmlDraft,
} from '../src/services/tissXmlDraftValidator';
import {
  deriveTissRevenueCycleStateFromPreGuide,
  transitionTissRevenueCycleState,
} from '../src/services/tissRevenueCycleStateMachine';
import {
  buildTissAntiGlosaChecklist,
} from '../src/services/tissAntiGlosaChecklist';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const conferenceCode = readFileSync(join(root, 'src/components/MonthlyConferenceCenter.tsx'), 'utf8');
const preGuideUiCode = readFileSync(join(root, 'src/components/TissPreGuideTab.tsx'), 'utf8');
const billingTissSettingsCode = readFileSync(join(root, 'src/components/BillingTissSettingsPanel.tsx'), 'utf8');
const payerRequirementsCode = readFileSync(join(root, 'src/components/PayerRequirementsPanel.tsx'), 'utf8');
const settingsPanelCode = readFileSync(join(root, 'src/components/ClinicGlobalSettingsPanel.tsx'), 'utf8');
const coordinatorCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const migrationCode = readFileSync(join(root, 'supabase/migrations/20260614183000_tiss_pre_guides.sql'), 'utf8');
const payerOperationalMigrationCode = readFileSync(join(root, 'supabase/migrations/20260617110000_payer_tiss_operational_requirements.sql'), 'utf8');
const authorizationCycleMigrationCode = readFileSync(join(root, 'supabase/migrations/20260617153000_patient_payer_authorizations_operational_cycle.sql'), 'utf8');
const xmlDraftMigrationCode = readFileSync(join(root, 'supabase/migrations/20260617190000_tiss_xml_drafts.sql'), 'utf8');
const revenueCycleMigrationCode = readFileSync(join(root, 'supabase/migrations/20260617210000_tiss_revenue_cycle_backbone.sql'), 'utf8');
const payerTussAdvancedMigrationCode = readFileSync(join(root, 'supabase/migrations/20260617223000_payer_tuss_advanced_contracts.sql'), 'utf8');
const xmlDraftGeneratorCode = readFileSync(join(root, 'src/services/tissXmlDraftGenerator.ts'), 'utf8');
const xmlDraftValidatorCode = readFileSync(join(root, 'src/services/tissXmlDraftValidator.ts'), 'utf8');
const revenueStateMachineCode = readFileSync(join(root, 'src/services/tissRevenueCycleStateMachine.ts'), 'utf8');
const antiGlosaChecklistCode = readFileSync(join(root, 'src/services/tissAntiGlosaChecklist.ts'), 'utf8');
const packageJson = readFileSync(join(root, 'package.json'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const validInput = {
  appointment: {
    id: 'appointment-1',
    patient_id: 'patient-1',
    therapist_id: 'professional-1',
    patient_name: 'Pedro Henrique',
    scheduled_start_at: '2026-06-15T15:00:00.000Z',
    scheduled_duration_minutes: 50,
  },
  patient: {
    id: 'patient-1',
    name: 'Pedro Henrique',
    cpf: '00000000000',
    insurance_card_number: 'CARD-1',
  },
  payer: { id: 'payer-1', name: 'Amil' },
  billingContext: {
    payer_id: 'payer-1',
    payer_type: 'INSURANCE',
    guide_number: 'GUIDE-1',
    authorization_code: 'AUTH-1',
    insurance_card_number: 'CARD-1',
  },
  billingItem: {
    id: 'billing-item-1',
    appointment_id: 'appointment-1',
    patient_id: 'patient-1',
    professional_id: 'professional-1',
    payer_id: 'payer-1',
    quantity: 1,
    billing_unit: 'session',
    unit_amount_cents: 12000,
    amount_cents: 12000,
    guide_type: 'sp_sadt',
  },
  service: {
    id: 'service-1',
    internal_code: 'ABA-IND',
    name: 'Sessão ABA individual',
    billing_unit: 'session',
    default_quantity: 1,
  },
  tussCode: {
    id: 'tuss-1',
    code: 'CONFIGURADO-PELA-CLINICA',
    description: 'Código configurado pela clínica',
    version: 'configurada',
  },
  mapping: {
    id: 'mapping-1',
    guide_type: 'sp_sadt',
    billing_unit: 'session',
    default_quantity: 1,
    amount_cents: 12000,
    requires_guide: true,
    requires_authorization: true,
    requires_professional_registry: true,
  },
  clinicProfile: {
    id: 'clinic-profile-1',
    legal_name: 'Clínica Exemplo Ltda.',
    trade_name: 'Clínica Exemplo',
    document_type: 'CNPJ',
    document_number: '00000000000000',
    provider_code: 'PROVIDER-1',
    cnes_code: 'CNES-1',
  },
  payerProfile: {
    id: 'payer-profile-1',
    ans_registration: 'ANS-1',
    operator_code: 'OP-1',
    tiss_version: 'configurável',
    default_guide_type: 'sp_sadt',
    requires_authorization: true,
    requires_provider_code: true,
    requires_cnes: true,
    requires_cbo: true,
    requires_executant_registry: true,
    requires_beneficiary_card: true,
  },
  professionalProfile: {
    id: 'professional-profile-1',
    professional_id: 'professional-1',
    display_name: 'Terapeuta Mateus',
    council_type: 'CRP',
    council_number: '00/00000',
    council_state: 'SP',
    cbo_code: '000000',
  },
  professional: {
    id: 'professional-1',
    name: 'Terapeuta Mateus',
  },
  authorization: {
    id: 'auth-base-1',
    status: 'active',
    authorization_number: 'AUTH-1',
    authorization_code: 'AUTH-1',
    guide_number: 'GUIDE-1',
    issue_date: '2026-06-01',
    issued_at: '2026-06-01',
    valid_from: '2026-06-01',
    valid_until: '2026-06-30',
    authorized_quantity: 10,
    authorized_unit: 'session',
    procedure_tuss_code: 'CONFIGURADO-PELA-CLINICA',
    procedure_code: 'ABA-IND',
    procedure_name_snapshot: 'Sessão ABA individual',
  },
};

test('atendimento de convênio com dados mínimos produz Pré-guia válida', () => {
  const result = validateTissPreGuide(validInput);
  assert.equal(result.status, 'valid');
  assert.equal(result.guideType, 'sp_sadt');
  assert.deepEqual(result.errorCodes, []);
  assert.equal(result.snapshot.procedure.name, 'Sessão ABA individual');
  assert.equal(result.snapshot.procedure.tussCode, 'CONFIGURADO-PELA-CLINICA');
  assert.equal(result.snapshot.procedure.totalAmountCents, 12000);
  assert.equal(result.snapshot.payer.id, 'payer-1');
  assert.equal(result.snapshot.provider.profileId, 'clinic-profile-1');
  assert.equal(result.snapshot.provider.legalName, 'Clínica Exemplo Ltda.');
  assert.equal(result.snapshot.provider.tradeName, 'Clínica Exemplo');
  assert.equal(result.snapshot.payer.profileId, 'payer-profile-1');
  assert.equal(result.snapshot.payer.ansRegistration, 'ANS-1');
  assert.equal(result.snapshot.payer.operatorCode, 'OP-1');
  assert.equal(result.snapshot.payer.tissVersion, 'configurável');
  assert.equal(result.snapshot.professional.id, 'professional-1');
  assert.equal(result.snapshot.professional.profileId, 'professional-profile-1');
  assert.equal(result.snapshot.professional.name, 'Terapeuta Mateus');
  assert.equal(result.snapshot.professional.councilType, 'CRP');
  assert.equal(result.snapshot.professional.councilNumber, '00/00000');
  assert.equal(result.snapshot.professional.councilState, 'SP');
  assert.equal(result.snapshot.professional.cboCode, '000000');
  assert.equal(result.snapshot.revenueCycle.state, 'ready_for_billing');
  assert.equal(result.snapshot.revenueCycle.canAdvanceToBilling, true);
  assert.equal(result.snapshot.antiGlosaChecklist.status, 'ready');
});

test('maquina de estados permite PrÃ©-guia vÃ¡lida e bloqueia estados oficiais futuros', () => {
  const validation = validateTissPreGuide(validInput);
  const readyState = deriveTissRevenueCycleStateFromPreGuide({
    status: validation.status,
    validationErrorCodes: validation.errorCodes,
    snapshot: validation.snapshot,
  });
  assert.equal(readyState.state, 'ready_for_billing');

  const pending = validateTissPreGuide({
    ...validInput,
    authorization: null,
    billingContext: { ...validInput.billingContext, authorization_code: '', guide_number: '' },
  });
  const pendingState = deriveTissRevenueCycleStateFromPreGuide({
    status: pending.status,
    validationErrorCodes: pending.errorCodes,
    snapshot: pending.snapshot,
  });
  assert.equal(pendingState.state, 'awaiting_authorization');

  assert.equal(transitionTissRevenueCycleState({ previousState: 'missing_data', newState: 'ready_for_billing' }).ok, true);
  const official = transitionTissRevenueCycleState({ previousState: 'ready_for_billing', newState: 'sent' });
  assert.equal(official.ok, false);
  assert.equal(official.errorCode, 'TISS_REVENUE_STATE_RESERVED_FOR_FUTURE');
});

test('checklist antiglosa reflete pendencias e riscos operacionais', () => {
  const pending = validateTissPreGuide({
    ...validInput,
    authorization: null,
    billingContext: { ...validInput.billingContext, authorization_code: '', guide_number: '' },
  });
  const checklist = buildTissAntiGlosaChecklist({
    status: pending.status,
    errors: pending.errors,
    warnings: pending.warnings,
    errorCodes: pending.errorCodes,
    warningCodes: pending.warningCodes,
    snapshot: pending.snapshot,
  });
  const authorizationItem = checklist.items.find((item) => item.code === 'authorization_valid');
  assert.equal(checklist.status, 'pending');
  assert.equal(authorizationItem?.status, 'blocking');
  assert.equal(authorizationItem?.riskClass, 'risco de negativa por autorização');
  assert.equal(authorizationItem?.suggestedAction, 'Adicionar autorização');
});

test('procedimento de convÃªnio sem De/Para TUSS do pagador fica pendente', () => {
  const result = validateTissPreGuide({
    ...validInput,
    mapping: null,
  });
  assert.equal(result.status, 'pending_data');
  assert.ok(result.errorCodes.includes('PAYER_TUSS_MAPPING_MISSING'));
  assert.equal(result.snapshot.antiGlosaChecklist.items.find((item: any) => item.code === 'procedure_tuss_mapping')?.status, 'blocking');
});

test('pré-guia usa tabela negociada vigente e bloqueia preço ou De/Para inválido', () => {
  const priced = validateTissPreGuide({
    ...validInput,
    price: {
      id: 'price-1',
      amount_cents: 13500,
      currency: 'BRL',
      valid_from: '2026-06-01',
      valid_until: '2026-06-30',
      source: 'payer_contract',
    },
    mapping: {
      ...validInput.mapping,
      amount_cents: null,
      negotiated_amount_cents: null,
      contract_code: 'AMIL-ABA-001',
      contract_description: 'Sessão ABA individual negociada Amil',
      specialty: 'ABA',
      standard_duration_minutes: 50,
      source: 'payer_contract',
    },
    billingItem: {
      ...validInput.billingItem,
      unit_amount_cents: null,
      amount_cents: null,
    },
  });
  assert.equal(priced.status, 'valid');
  assert.equal(priced.snapshot.procedure.totalAmountCents, 13500);
  assert.equal(priced.snapshot.procedure.payerProcedurePriceId, 'price-1');
  assert.equal(priced.snapshot.procedure.contractCode, 'AMIL-ABA-001');
  assert.equal(priced.snapshot.procedure.mappingSource, 'payer_contract');

  const missingPrice = validateTissPreGuide({
    ...validInput,
    mapping: {
      ...validInput.mapping,
      amount_cents: null,
      negotiated_amount_cents: null,
    },
    billingItem: {
      ...validInput.billingItem,
      unit_amount_cents: null,
      amount_cents: null,
    },
  });
  assert.ok(missingPrice.errorCodes.includes('PAYER_PROCEDURE_PRICE_MISSING'));
  assert.equal(missingPrice.snapshot.antiGlosaChecklist.items.find((item: any) => item.code === 'amount_calculated')?.status, 'blocking');

  const conflict = validateTissPreGuide({
    ...validInput,
    price: { id: 'price-2', amount_cents: 13500, conflict: true },
  });
  assert.ok(conflict.errorCodes.includes('PAYER_PROCEDURE_PRICE_CONFLICT'));

  const expiredMapping = validateTissPreGuide({
    ...validInput,
    mapping: {
      ...validInput.mapping,
      valid_to: '2026-05-31',
    },
  });
  assert.ok(expiredMapping.errorCodes.includes('PAYER_TUSS_MAPPING_EXPIRED'));
});

test('pre-guia preserva valor financeiro positivo em revalidacao de autorizacao', () => {
  const result = validateTissPreGuide({
    ...validInput,
    price: null,
    mapping: {
      ...validInput.mapping,
      amount_cents: null,
      negotiated_amount_cents: null,
    },
    billingItem: {
      ...validInput.billingItem,
      unit_amount_cents: 12000,
      amount_cents: 12000,
    },
  });

  assert.equal(result.snapshot.procedure.unitAmountCents, 12000);
  assert.equal(result.snapshot.procedure.totalAmountCents, 12000);
  assert.ok(!result.errorCodes.includes('AMOUNT_MISSING'));
  assert.ok(!result.errorCodes.includes('PAYER_PROCEDURE_PRICE_MISSING'));
  assert.ok(result.warningCodes.includes('PAYER_PROCEDURE_PRICE_UNRESOLVED_SNAPSHOT_PRESERVED'));
});

test('procedimento historico inativo preserva snapshot sem zerar valor', () => {
  const result = validateTissPreGuide({
    ...validInput,
    service: {
      ...validInput.service,
      active: false,
    },
    price: null,
    mapping: {
      ...validInput.mapping,
      amount_cents: null,
      negotiated_amount_cents: null,
    },
    billingItem: {
      ...validInput.billingItem,
      unit_amount_cents: 12000,
      amount_cents: 12000,
    },
  });

  assert.equal(result.snapshot.procedure.unitAmountCents, 12000);
  assert.equal(result.snapshot.procedure.totalAmountCents, 12000);
  assert.ok(!result.errorCodes.includes('AMOUNT_MISSING'));
  assert.ok(result.warningCodes.includes('PROCEDURE_INACTIVE_HISTORICAL_SNAPSHOT'));
});

test('pre-guia válida gera XML TISS-like SP/SADT em rascunho interno', () => {
  const validation = validateTissPreGuide(validInput);
  const payload = buildTissSpSadtDraftPayload({
    payerId: 'payer-1',
    competenceMonth: '2026-06-01',
    guideType: validation.guideType,
    tissVersion: validation.snapshot.payer.tissVersion,
    generatedAt: '2026-06-17T12:00:00.000Z',
    preGuides: [{
      id: 'pre-guide-1',
      appointmentId: 'appointment-1',
      patientName: 'Pedro Henrique',
      professionalName: 'Terapeuta Mateus',
      payerId: 'payer-1',
      payerName: 'Amil',
      status: validation.status,
      validationErrorCodes: validation.errorCodes,
      scheduledStart: '2026-06-15T15:00:00.000Z',
      guideType: validation.guideType,
      quantity: 1,
      totalAmountCents: 12000,
      snapshot: validation.snapshot,
    }],
  });
  const generated = generateTissXmlDraft({
    payerId: 'payer-1',
    competenceMonth: '2026-06-01',
    guideType: validation.guideType,
    tissVersion: validation.snapshot.payer.tissVersion,
    generatedAt: '2026-06-17T12:00:00.000Z',
    preGuides: [{
      id: 'pre-guide-1',
      appointmentId: 'appointment-1',
      patientName: 'Pedro Henrique',
      professionalName: 'Terapeuta Mateus',
      payerId: 'payer-1',
      payerName: 'Amil',
      status: validation.status,
      validationErrorCodes: validation.errorCodes,
      scheduledStart: '2026-06-15T15:00:00.000Z',
      guideType: validation.guideType,
      quantity: 1,
      totalAmountCents: 12000,
      snapshot: validation.snapshot,
    }],
  });
  if (!generated.ok) assert.fail('XML draft should be generated for a valid pre-guide');
  assert.equal(payload.draftFormat, 'tiss_sp_sadt_draft');
  assert.equal(payload.tissVersion, '4.01.00');
  assert.equal(payload.guides[0].procedure.unit.code, 'sessoes');
  assert.equal(payload.guides[0].procedure.unit.label, 'sessões');
  assert.match(generated.xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(generated.xml, /<tissSpSadtDraft/);
  assert.doesNotMatch(generated.xml, /<vertoTissXmlDraft/);
  assert.doesNotMatch(generated.xml, /version="12345678"/);
  assert.match(generated.xml, /version="4\.01\.00"/);
  assert.match(generated.xml, /Rascunho interno para conferência\. Não enviado à operadora\./);
  assert.match(generated.xml, /<spSadtGuides>/);
  assert.match(generated.xml, /<tussCode>CONFIGURADO-PELA-CLINICA<\/tussCode>/);
  assert.match(generated.xml, /<totalAmount>120\.00<\/totalAmount>/);
  assert.match(generated.xml, /<currency>BRL<\/currency>/);
  assert.match(generated.xml, /<code>sessoes<\/code>/);
  assert.match(generated.xml, /<label>sessões<\/label>/);
  assert.equal(generated.guideCount, 1);
  assert.equal(generated.totalAmountCents, 12000);
  assert.equal(generated.draftFormat, 'tiss_sp_sadt_draft');
  assert.equal(generated.technicalValidation.status, 'warning');
  assert.ok(generated.validationSummary.warnings.some((warning) => warning.code === 'TISS_VERSION_INVALID_FALLBACK_USED'));
  assert.ok(generated.technicalValidation.warnings.some((warning) => warning.code === 'TISS_XSD_VALIDATION_NOT_CONFIGURED'));
});

test('validador técnico de XML TISS rascunho aceita novo formato e preserva legado', () => {
  const validation = validateTissPreGuide({
    ...validInput,
    payerProfile: {
      ...validInput.payerProfile,
      tiss_version: '4.01.00',
    },
    tussCode: {
      ...validInput.tussCode,
      code: '10101012',
      description: 'Terapia individual',
      version: '4.01.00',
    },
    mapping: {
      ...validInput.mapping,
      tuss_code: '10101012',
    },
    authorization: {
      ...validInput.authorization,
      procedure_tuss_code: '10101012',
    },
  });
  const generated = generateTissXmlDraft({
    payerId: 'payer-1',
    competenceMonth: '2026-06-01',
    guideType: validation.guideType,
    tissVersion: '4.01.00',
    generatedAt: '2026-06-17T12:00:00.000Z',
    preGuides: [{
      id: 'pre-guide-valid-xml',
      appointmentId: 'appointment-1',
      patientName: 'Pedro Henrique',
      professionalName: 'Terapeuta Mateus',
      payerId: 'payer-1',
      payerName: 'Amil',
      status: validation.status,
      validationErrorCodes: validation.errorCodes,
      scheduledStart: '2026-06-15T15:00:00.000Z',
      guideType: validation.guideType,
      quantity: 1,
      totalAmountCents: 12000,
      snapshot: validation.snapshot,
    }],
  });
  if (!generated.ok) assert.fail('XML draft should be generated for a valid pre-guide');
  const technical = validateTissXmlDraft(generated.xml);
  assert.equal(technical.status, 'warning');
  assert.deepEqual(technical.errors, []);
  assert.ok(technical.warnings.some((warning) => warning.code === 'TISS_XSD_VALIDATION_NOT_CONFIGURED'));

  const legacy = validateTissXmlDraft('<?xml version="1.0" encoding="UTF-8"?><vertoTissXmlDraft><guideCount>1</guideCount></vertoTissXmlDraft>');
  assert.equal(legacy.status, 'warning');
  assert.ok(legacy.warnings.some((warning) => warning.code === 'VERTO_INTERNAL_LEGACY_DRAFT'));
});

test('validador técnico de XML TISS rascunho bloqueia estrutura incompleta', () => {
  assert.equal(validateTissXmlDraft('<tissSpSadtDraft version="4.01.00"><spSadtGuides></spSadtGuides></tissSpSadtDraft>').status, 'invalid');
  assert.ok(validateTissXmlDraft('<tissSpSadtDraft version="12345678"><spSadtGuides></spSadtGuides></tissSpSadtDraft>').errors.some((issue) => issue.code === 'TISS_VERSION_INVALID'));
  assert.ok(validateTissXmlDraft('<tissSpSadtDraft version="4.01.00"><spSadtGuides><spSadtGuide><procedure></procedure></spSadtGuide></spSadtGuides></tissSpSadtDraft>').errors.some((issue) => issue.code === 'BENEFICIARY_MISSING'));
  assert.ok(validateTissXmlDraft('<tissSpSadtDraft version="4.01.00"><batch><guideCount>2</guideCount><totalAmount>0.00</totalAmount></batch><provider><documentNumber>1</documentNumber></provider><payer><ansRegistration>1</ansRegistration></payer><spSadtGuides><spSadtGuide><beneficiary>ok</beneficiary><professional>ok</professional><authorization>ok</authorization><procedure><tussCode></tussCode><quantity>1</quantity></procedure><values><totalAmount>10.00</totalAmount></values></spSadtGuide></spSadtGuides></tissSpSadtDraft>').errors.some((issue) => issue.code === 'GUIDE_COUNT_MISMATCH'));
  assert.ok(validateTissXmlDraft('<tissSpSadtDraft version="4.01.00"><batch><guideCount>1</guideCount><totalAmount>20.00</totalAmount></batch><provider><documentNumber>1</documentNumber></provider><payer><ansRegistration>1</ansRegistration></payer><spSadtGuides><spSadtGuide><beneficiary>ok</beneficiary><professional>ok</professional><authorization>ok</authorization><procedure><tussCode>10101012</tussCode><quantity>1</quantity></procedure><values><totalAmount>10.00</totalAmount></values></spSadtGuide></spSadtGuides></tissSpSadtDraft>').errors.some((issue) => issue.code === 'TOTAL_AMOUNT_MISMATCH'));
  assert.ok(validateTissXmlDraft('<tissSpSadtDraft><open></tissSpSadtDraft>').errors.some((issue) => issue.code === 'XML_MALFORMED'));
});

test('pre-guia pendente não gera XML TISS em rascunho', () => {
  const validation = validateTissPreGuide({
    ...validInput,
    authorization: {},
  });
  const generated = generateTissXmlDraft({
    payerId: 'payer-1',
    competenceMonth: '2026-06-01',
    preGuides: [{
      id: 'pre-guide-2',
      appointmentId: 'appointment-2',
      payerId: 'payer-1',
      status: validation.status,
      validationErrorCodes: validation.errorCodes,
      snapshot: validation.snapshot,
    }],
  });
  if (generated.ok) assert.fail('Pending pre-guide should not generate XML draft');
  assert.equal(generated.code, 'TISS_XML_DRAFT_PRE_GUIDE_NOT_READY');
  assert.ok(generated.issues.some((issue) => issue.code === 'TISS_XML_DRAFT_PRE_GUIDE_NOT_READY'));
});

test('pre-guia usa dados do prestador da clinica e nao o nome do profissional', () => {
  const result = validateTissPreGuide({
    ...validInput,
    clinic: { id: 'clinic-1', name: 'Mateus' },
    clinicProfile: {
      id: 'clinic-profile-1',
      legal_name: 'Clinica Correta Ltda.',
      trade_name: '',
      document_type: 'CNPJ',
      document_number: '11111111111111',
      provider_code: 'PREST-1',
      cnes_code: 'CNES-1',
    },
    professionalProfile: {
      ...validInput.professionalProfile,
      display_name: 'Terapeuta Mateus',
    },
    professional: {
      id: 'professional-1',
      name: 'Terapeuta Mateus',
    },
  });

  assert.equal(result.snapshot.provider.legalName, 'Clinica Correta Ltda.');
  assert.equal(result.snapshot.provider.documentNumber, '11111111111111');
  assert.equal(result.snapshot.provider.tradeName, null);
  assert.equal(result.snapshot.provider.tradeNameSource, 'blocked_professional_name_match');
  assert.equal(result.snapshot.provider.didUseProfessionalAsClinicFallback, false);
  assert.equal(result.snapshot.professional.name, 'Terapeuta Mateus');
});

test('Equipe nao e tratada como profissional executante faturavel', () => {
  const result = validateTissPreGuide({
    ...validInput,
    professionalProfile: null,
    professional: {
      id: 'professional-1',
      name: 'Equipe',
    },
  });

  assert.equal(result.snapshot.professional.name, null);
  assert.ok(result.errorCodes.includes('PROFESSIONAL_BILLING_PROFILE_MISSING'));
  assert.ok(result.errorCodes.includes('PROFESSIONAL_REGISTRY_MISSING'));
});

test('pre-guia gera pendencia quando profissional executante nao foi resolvido', () => {
  const result = validateTissPreGuide({
    ...validInput,
    appointment: {
      ...validInput.appointment,
      therapist_id: '',
      professional_id: '',
      professionalId: '',
      therapistId: '',
    },
    billingItem: {
      ...validInput.billingItem,
      professional_id: '',
    },
    professionalProfile: {},
    professional: {},
  });

  assert.equal(result.status, 'pending_data');
  assert.ok(result.errorCodes.includes('PROFESSIONAL_NOT_DEFINED'));
  assert.ok(result.errors.some((error) => error.entity === 'professional' && error.severity === 'blocking'));
  assert.equal(result.snapshot.professional.id, null);
});

test('pre-guia prefere professional_id do billing item antes do fallback do appointment', () => {
  const result = validateTissPreGuide({
    ...validInput,
    appointment: {
      ...validInput.appointment,
      therapist_id: 'professional-fallback',
    },
    billingItem: {
      ...validInput.billingItem,
      professional_id: 'professional-billing',
    },
    professionalProfile: {
      ...validInput.professionalProfile,
      professional_id: 'professional-billing',
    },
    professional: {
      id: 'professional-billing',
      name: 'Executante Billing',
    },
  });

  assert.equal(result.snapshot.professional.id, 'professional-billing');
});

test('pre-guia usa therapist_id como fallback quando nao ha item profissional', () => {
  const result = validateTissPreGuide({
    ...validInput,
    appointment: {
      ...validInput.appointment,
      therapist_id: 'professional-therapist',
    },
    billingItem: {
      ...validInput.billingItem,
      professional_id: '',
    },
    professionalProfile: {
      ...validInput.professionalProfile,
      professional_id: 'professional-therapist',
    },
    professional: {
      id: 'professional-therapist',
      name: 'Terapeuta Fallback',
    },
  });

  assert.equal(result.snapshot.professional.id, 'professional-therapist');
});

test('sem payer_id real não produz Pré-guia faturável válida', () => {
  const result = validateTissPreGuide({
    ...validInput,
    payer: null,
    billingContext: { payer_type: 'INSURANCE' },
    billingItem: { ...validInput.billingItem, payer_id: null },
    payerProfile: null,
  });
  assert.equal(result.status, 'pending_data');
  assert.ok(result.errorCodes.includes('PAYER_MISSING'));
  assert.ok(!result.snapshot.payer.id);
});

test('contextos não faturáveis são não aplicáveis e não tentam resolver TISS', () => {
  for (const payerType of ['PRIVATE', 'NO_CHARGE', 'COURTESY', 'NOT_BILLABLE']) {
    const result = validateTissPreGuide({
      ...validInput,
      billingContext: { payer_type: payerType },
      billingItem: null,
      payer: null,
      payerProfile: null,
    });
    assert.equal(result.status, 'not_applicable');
    assert.deepEqual(result.errorCodes, []);
  }
});

test('pagador particular nao exige TISS mesmo se usado como fallback visual', () => {
  const result = validateTissPreGuide({
    ...validInput,
    payer: { id: 'payer-private', name: 'Particular', payer_type: 'PRIVATE' },
    billingContext: { ...validInput.billingContext, payer_id: 'payer-private', payer_type: 'INSURANCE' },
    payerProfile: null,
  });

  assert.equal(result.status, 'not_applicable');
  assert.deepEqual(result.errorCodes, []);
  assert.equal(result.snapshot.payerType, 'PRIVATE');
});

test('pagador convenio sem Registro ANS gera pendencia do pagador', () => {
  const result = validateTissPreGuide({
    ...validInput,
    payerProfile: {
      ...validInput.payerProfile,
      ans_registration: '',
    },
  });

  assert.equal(result.status, 'pending_data');
  assert.ok(result.errorCodes.includes('PAYER_ANS_REGISTRATION_MISSING'));
});

test('carteirinha e validade so bloqueiam quando o pagador exige', () => {
  const optional = validateTissPreGuide({
    ...validInput,
    patient: { ...validInput.patient, insurance_card_number: '', insurance_card_valid_until: '' },
    billingContext: { ...validInput.billingContext, insurance_card_number: '' },
    payerProfile: {
      ...validInput.payerProfile,
      requires_beneficiary_card: false,
      requires_beneficiary_card_validity: false,
    },
  });
  assert.ok(!optional.errorCodes.includes('BENEFICIARY_CARD_MISSING'));
  assert.ok(!optional.errorCodes.includes('BENEFICIARY_CARD_VALIDITY_MISSING'));

  const required = validateTissPreGuide({
    ...validInput,
    patient: { ...validInput.patient, insurance_card_number: '', insurance_card_valid_until: '' },
    billingContext: { ...validInput.billingContext, insurance_card_number: '' },
    payerProfile: {
      ...validInput.payerProfile,
      requires_beneficiary_card: true,
      requires_beneficiary_card_validity: true,
    },
  });
  assert.ok(required.errorCodes.includes('BENEFICIARY_CARD_MISSING'));
  assert.ok(required.errorCodes.includes('BENEFICIARY_CARD_VALIDITY_MISSING'));
});

test('autorizacao ativa valida e autorizacao vencida ou de outro TUSS gera pendencia', () => {
  const notRequired = validateTissPreGuide({
    ...validInput,
    payerProfile: { ...validInput.payerProfile, requires_authorization: false, requires_guide_number: false },
    mapping: { ...validInput.mapping, requires_authorization: false, requires_guide: false },
    authorization: null,
  });
  assert.ok(!notRequired.errorCodes.includes('AUTHORIZATION_REQUIRED'));

  const missing = validateTissPreGuide({
    ...validInput,
    authorization: null,
    billingContext: { ...validInput.billingContext, authorization_code: '', guide_number: '' },
    payerProfile: { ...validInput.payerProfile, requires_authorization: true, requires_guide_number: true },
  });
  assert.ok(missing.errorCodes.includes('AUTHORIZATION_REQUIRED'));

  const active = validateTissPreGuide({
    ...validInput,
    billingContext: { ...validInput.billingContext, authorization_code: '', guide_number: '' },
    payerProfile: { ...validInput.payerProfile, requires_authorization: true, requires_guide_number: true },
    authorization: {
      id: 'auth-1',
      status: 'active',
      authorization_number: 'AUTH-OK',
      authorization_code: 'AUTH-OK',
      guide_number: 'GUIA-OK',
      valid_from: '2026-06-01',
      valid_until: '2026-06-30',
      authorized_quantity: 10,
      authorized_unit: 'session',
      procedure_tuss_code: 'CONFIGURADO-PELA-CLINICA',
      procedure_code: 'ABA-IND',
    },
  });
  assert.ok(!active.errorCodes.includes('AUTHORIZATION_REQUIRED'));
  assert.ok(!active.errorCodes.includes('GUIDE_MISSING'));
  assert.equal(active.snapshot.authorization.authorizationCode, 'AUTH-OK');
  assert.equal(active.snapshot.authorization.authorizedQuantity, 10);
  assert.equal(active.snapshot.authorization.authorizedUnit, 'session');

  const expired = validateTissPreGuide({
    ...validInput,
    payerProfile: { ...validInput.payerProfile, requires_authorization: true },
    authorization: {
      id: 'auth-expired',
      status: 'active',
      authorization_code: 'AUTH-OLD',
      valid_from: '2026-05-01',
      valid_until: '2026-05-31',
      procedure_tuss_code: 'OUTRO-TUSS',
    },
  });
  assert.ok(expired.errorCodes.includes('AUTHORIZATION_EXPIRED'));
  assert.ok(expired.errorCodes.includes('AUTHORIZATION_PROCEDURE_MISMATCH'));

  const exhausted = validateTissPreGuide({
    ...validInput,
    authorization: {
      ...validInput.authorization,
      id: 'auth-exhausted',
      authorized_quantity: 10,
      used_quantity: 10,
    },
  });
  assert.ok(exhausted.errorCodes.includes('AUTHORIZATION_EXHAUSTED'));

  const missingAuthorizedProcedure = validateTissPreGuide({
    ...validInput,
    payerProfile: { ...validInput.payerProfile, requires_authorized_procedure: true },
    authorization: {
      id: 'auth-without-procedure',
      status: 'active',
      authorization_code: 'AUTH-NO-PROC',
      guide_number: 'GUIA-NO-PROC',
      valid_from: '2026-06-01',
      valid_until: '2026-06-30',
    },
  });
  assert.ok(missingAuthorizedProcedure.errorCodes.includes('AUTHORIZED_PROCEDURE_NOT_INFORMED'));
});

test('assinatura do responsavel valida conforme exigencia do pagador', () => {
  const notRequired = validateTissPreGuide({
    ...validInput,
    payerProfile: { ...validInput.payerProfile, requires_responsible_signature: false },
    signature: null,
  });
  assert.ok(!notRequired.errorCodes.includes('RESPONSIBLE_SIGNATURE_REQUIRED'));

  const missing = validateTissPreGuide({
    ...validInput,
    payerProfile: { ...validInput.payerProfile, requires_responsible_signature: true },
    signature: null,
  });
  assert.equal(missing.status, 'pending_data');
  assert.ok(missing.errorCodes.includes('RESPONSIBLE_SIGNATURE_REQUIRED'));
  const signatureIssue = missing.errors.find((item) => item.code === 'RESPONSIBLE_SIGNATURE_REQUIRED');
  assert.equal(signatureIssue?.entity, 'signature');
  assert.equal(signatureIssue?.section, 'signature');
  assert.equal(signatureIssue?.severity, 'blocking');
  assert.equal(signatureIssue?.action, 'Coletar assinatura');
  assert.ok(!missing.warningCodes.includes('RESPONSIBLE_SIGNATURE_REQUIRED'));

  const signed = validateTissPreGuide({
    ...validInput,
    payerProfile: { ...validInput.payerProfile, requires_responsible_signature: true },
    signature: {
      id: 'signature-1',
      appointment_id: 'appointment-1',
      aba_session_id: 'aba-session-1',
      status: 'SIGNED',
      signed_by_name: 'Maria Responsavel',
      signed_by_role: 'responsible',
      signed_at: '2026-06-15T15:10:00.000Z',
      signature_type: 'DIGITAL_ACCEPTANCE',
    },
  });
  assert.equal(signed.status, 'valid');
  assert.ok(!signed.errorCodes.includes('RESPONSIBLE_SIGNATURE_REQUIRED'));
  assert.equal(signed.snapshot.signature.present, true);
  assert.equal(signed.snapshot.signature.appointmentId, 'appointment-1');
  assert.equal(signed.snapshot.signature.abaSessionId, 'aba-session-1');
  assert.equal(signed.snapshot.signature.signedByName, 'Maria Responsavel');
  assert.equal(signed.snapshot.signature.signedByRole, 'responsible');
  assert.equal(signed.snapshot.signature.signatureType, 'DIGITAL_ACCEPTANCE');
});

test('lote considera elegível somente convênio com payer_id real', () => {
  const eligible = evaluateTissPreGuideEligibility({
    appointment: validInput.appointment,
    billingContext: validInput.billingContext,
  });
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.reason, 'eligible');
  assert.equal(eligible.payerId, 'payer-1');

  const missingPayer = evaluateTissPreGuideEligibility({
    appointment: validInput.appointment,
    billingContext: { payer_type: 'INSURANCE', payer_id: null },
  });
  assert.equal(missingPayer.eligible, false);
  assert.equal(missingPayer.reason, 'missing_payer');

  const directAppointmentPayer = evaluateTissPreGuideEligibility({
    appointment: { ...validInput.appointment, payer_id: 'payer-from-appointment', financial_context_type: 'INSURANCE' },
    billingContext: null,
  });
  assert.equal(directAppointmentPayer.eligible, true);
  assert.equal(directAppointmentPayer.payerId, 'payer-from-appointment');

  const missingProfessional = evaluateTissPreGuideEligibility({
    appointment: { ...validInput.appointment, therapist_id: '', professional_id: '' },
    billingContext: validInput.billingContext,
  });
  assert.equal(missingProfessional.eligible, true);
  assert.equal(missingProfessional.reason, 'eligible');

  const notApplicable = evaluateTissPreGuideEligibility({
    appointment: validInput.appointment,
    billingContext: { payer_type: 'NO_CHARGE', payer_id: null },
  });
  assert.equal(notApplicable.eligible, false);
  assert.equal(notApplicable.reason, 'not_applicable');
});

test('validação aponta somente requisitos TISS realmente ausentes', () => {
  const missing = validateTissPreGuide({
    ...validInput,
    clinicProfile: null,
    payerProfile: {
      ...validInput.payerProfile,
      requires_cbo: true,
      requires_executant_registry: true,
    },
    professionalProfile: {
      id: 'professional-profile-1',
      professional_id: 'professional-1',
    },
    mapping: {
      ...validInput.mapping,
      amount_cents: null,
    },
    service: null,
    tussCode: null,
    billingItem: {
      ...validInput.billingItem,
      amount_cents: null,
      unit_amount_cents: null,
    },
  });
  for (const code of [
    'CLINIC_TISS_PROFILE_MISSING',
    'PROFESSIONAL_REGISTRY_MISSING',
    'PROFESSIONAL_COUNCIL_STATE_MISSING',
    'CBO_MISSING',
    'PROCEDURE_MISSING',
    'TUSS_CODE_MISSING',
    'AMOUNT_MISSING',
  ]) {
    assert.ok(missing.errorCodes.includes(code), `esperava ${code}`);
  }
});

test('registro e CBO só bloqueiam quando a regra do pagador ou mapping exige', () => {
  const optional = validateTissPreGuide({
    ...validInput,
    mapping: { ...validInput.mapping, requires_professional_registry: false },
    payerProfile: {
      ...validInput.payerProfile,
      requires_executant_registry: false,
      requires_cbo: false,
    },
    professionalProfile: null,
    professional: { id: 'professional-1', name: 'Terapeuta Mateus' },
  });
  assert.ok(!optional.errorCodes.includes('PROFESSIONAL_BILLING_PROFILE_MISSING'));
  assert.ok(!optional.errorCodes.includes('PROFESSIONAL_REGISTRY_MISSING'));
  assert.ok(!optional.errorCodes.includes('CBO_MISSING'));
});

test('migration é aditiva, multi-clínica e não implementa geração eletrônica', () => {
  for (const table of [
    'clinic_tiss_profiles',
    'payer_tiss_profiles',
    'professional_billing_profiles',
    'appointment_tiss_pre_guides',
  ]) {
    assert.match(migrationCode, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migrationCode, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migrationCode, /organization_id uuid not null/);
  assert.match(migrationCode, /idx_appointment_tiss_pre_guides_appointment/);
  assert.match(migrationCode, /idx_appointment_tiss_pre_guides_period_status/);
  assert.match(migrationCode, /validation_errors jsonb/);
  assert.match(migrationCode, /status in \('draft', 'valid', 'pending_data', 'not_applicable', 'cancelled'\)/);
  assert.match(migrationCode, /does NOT generate TISS XML, batches, remittance/i);
  assert.doesNotMatch(migrationCode, /create table if not exists public\.(tiss_batches|tiss_remittances|tiss_returns|tiss_denials)/i);
});

test('migration operacional adiciona requisitos TISS do pagador e autorizacoes sem XML', () => {
  for (const column of [
    'beneficiary_identification_type',
    'requires_beneficiary_card_validity',
    'requires_authorization_password',
    'requires_guide_number',
    'requires_cid',
    'requires_responsible_signature',
    'contracted_provider_code',
    'default_attendance_type',
    'specific_rules',
  ]) {
    assert.match(payerOperationalMigrationCode, new RegExp(`add column if not exists ${column}`));
  }
  assert.match(payerOperationalMigrationCode, /create table if not exists public\.patient_payer_authorizations/);
  assert.match(payerOperationalMigrationCode, /procedure_tuss_code text/);
  assert.match(payerOperationalMigrationCode, /alter table public\.patient_payer_authorizations enable row level security/);
  assert.match(payerOperationalMigrationCode, /patient_payer_authorizations_admin_rw/);
  assert.match(payerOperationalMigrationCode, /appointment_professionals ap/);
  assert.doesNotMatch(payerOperationalMigrationCode, /a\.professional_id/);
  assert.doesNotMatch(payerOperationalMigrationCode, /appointments\.professional_id/);
  assert.match(payerOperationalMigrationCode, /does not generate TISS XML, batches, remittances, returns, denials/i);
  assert.doesNotMatch(payerOperationalMigrationCode, /create table if not exists public\.(tiss_batches|tiss_remittances|tiss_returns|tiss_denials)/i);
});

test('migration avançada de convênios cria tabela negociada e regras TISS sem remessa oficial', () => {
  assert.match(payerTussAdvancedMigrationCode, /create table if not exists public\.payer_procedure_prices/);
  assert.match(payerTussAdvancedMigrationCode, /payer_id uuid not null references public\.clinic_payers/);
  assert.match(payerTussAdvancedMigrationCode, /service_catalog_id uuid references public\.tuss_service_catalog/);
  assert.match(payerTussAdvancedMigrationCode, /payer_tuss_mapping_id uuid references public\.payer_tuss_mappings/);
  assert.match(payerTussAdvancedMigrationCode, /amount_cents integer not null/);
  assert.match(payerTussAdvancedMigrationCode, /valid_from date/);
  assert.match(payerTussAdvancedMigrationCode, /valid_until date/);
  assert.match(payerTussAdvancedMigrationCode, /alter table public\.payer_procedure_prices enable row level security/);
  assert.match(payerTussAdvancedMigrationCode, /create policy payer_procedure_prices_admin_rw/);
  assert.match(payerTussAdvancedMigrationCode, /for all to authenticated/);
  assert.match(payerTussAdvancedMigrationCode, /contract_code text/);
  assert.match(payerTussAdvancedMigrationCode, /contract_description text/);
  assert.match(payerTussAdvancedMigrationCode, /requires_signed_guide/);
  assert.match(payerTussAdvancedMigrationCode, /requires_stamped_dated_guide/);
  assert.doesNotMatch(payerTussAdvancedMigrationCode, /soap|certificado|remessa oficial|glosa|retorno/i);
});

test('migration de autorizacao operacional completa campos sem XML', () => {
  for (const column of [
    'requires_authorized_procedure',
    'authorization_number',
    'issue_date',
    'used_quantity',
    'service_catalog_id',
    'tuss_code_id',
    'procedure_code_snapshot',
    'procedure_name_snapshot',
  ]) {
    assert.match(authorizationCycleMigrationCode, new RegExp(`add column if not exists ${column}`));
  }
  assert.match(authorizationCycleMigrationCode, /idx_patient_payer_authorizations_active_period/);
  assert.match(authorizationCycleMigrationCode, /does not generate TISS XML, batches, remittances, returns, denials/i);
  assert.doesNotMatch(authorizationCycleMigrationCode, /create table if not exists public\.(tiss_batches|tiss_remittances|tiss_returns|tiss_denials)/i);
});

test('migration de XML TISS em rascunho cria historico interno sem envio', () => {
  assert.match(xmlDraftMigrationCode, /create table if not exists public\.tiss_xml_drafts/);
  assert.match(xmlDraftMigrationCode, /xml_content text/);
  assert.match(xmlDraftMigrationCode, /xml_hash text/);
  assert.match(xmlDraftMigrationCode, /generated_from_pre_guide_ids uuid\[\]/);
  assert.match(xmlDraftMigrationCode, /status in \('draft', 'superseded', 'cancelled'\)/);
  assert.match(xmlDraftMigrationCode, /alter table public\.tiss_xml_drafts enable row level security/);
  assert.match(xmlDraftMigrationCode, /tiss_xml_drafts_admin_rw/);
  for (const table of [
    'tiss_revenue_cycle_events',
    'tiss_billing_batch_drafts',
    'tuss_versions',
    'tuss_categories',
    'denial_reason_codes',
  ]) {
    assert.match(revenueCycleMigrationCode, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(revenueCycleMigrationCode, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(revenueCycleMigrationCode, /add column if not exists revenue_cycle_state/);
  assert.match(revenueCycleMigrationCode, /add column if not exists anti_glosa_checklist/);
  assert.match(revenueCycleMigrationCode, /PRE_GUIDE_READY_FOR_BILLING/);
  assert.match(revenueCycleMigrationCode, /XML_DRAFT_GENERATED/);
  assert.match(revenueCycleMigrationCode, /TISS_BILLING_BATCH_DRAFT_CREATED/);
  assert.match(revenueCycleMigrationCode, /TISS_BILLING_BATCH_DRAFT_CANCELLED/);
  assert.match(revenueCycleMigrationCode, /billing_batch_draft/);
  assert.match(revenueCycleMigrationCode, /payer_specific_description/);
  assert.match(revenueCycleMigrationCode, /negotiated_amount_cents/);
  assert.match(revenueCycleMigrationCode, /Legacy clinics created the clinic row with id = owner user id/);
  assert.match(revenueCycleMigrationCode, /for all to authenticated/);
  assert.doesNotMatch(revenueCycleMigrationCode, /for all to public/);
  assert.match(revenueCycleMigrationCode, /does NOT transmit official batches/i);
  assert.match(xmlDraftMigrationCode, /does NOT send remittances, create official batches, receive returns, handle denials/i);
  assert.doesNotMatch(xmlDraftMigrationCode, /create table if not exists public\.(tiss_batches|tiss_remittances|tiss_returns|tiss_denials)/i);
});

test('backend persiste de forma idempotente pelo appointment e revalida só por ação', () => {
  assert.match(serverCode, /const buildAndPersistTissPreGuideForAppointment/);
  assert.match(serverCode, /\.from\('appointment_tiss_pre_guides'\)[\s\S]*?\.upsert\(payload, \{ onConflict: 'organization_id,appointment_id' \}\)/);
  assert.match(serverCode, /clinic:\s*clinicResult\.data \|\| null/);
  assert.match(serverCode, /clinic_name_snapshot:\s*sanitizeString\(provider\.tradeName \|\| provider\.legalName, 180\)/);
  assert.doesNotMatch(serverCode, /clinic_name_snapshot:\s*sanitizeString\(provider\.tradeName \|\| provider\.legalName \|\| clinicResult\.data\?\.name/);
  assert.match(serverCode, /professional_name_snapshot:\s*sanitizeString\(professionalSnapshot\.name, 180\) \|\| null/);
  assert.doesNotMatch(serverCode, /professional_name_snapshot:\s*sanitizeString\(professionalSnapshot\.name \|\| professional\?\.name, 180\) \|\| 'Equipe'/);
  const centralRevalidation = serverCode.slice(
    serverCode.indexOf('const revalidateAppointmentBillingForAppointment'),
    serverCode.indexOf('const markTissPreGuidesStale')
  );
  assert.match(centralRevalidation, /buildAndPersistTissPreGuideForAppointment/);
  assert.match(centralRevalidation, /tissPreGuide: tissPreGuide\.data \|\| null/);
  const listRoute = serverCode.slice(
    serverCode.indexOf("app.get('/api/tiss/pre-guides'"),
    serverCode.indexOf("app.post('/api/tiss/pre-guides/revalidate-period'")
  );
  assert.match(listRoute, /\.range\(offset, offset \+ pageSize - 1\)/);
  assert.match(listRoute, /APPOINTMENT_TISS_PRE_GUIDE_LIST_SELECT/);
  assert.doesNotMatch(listRoute, /revalidateAppointmentBillingForAppointment|buildAndPersistTissPreGuideForAppointment/);
  assert.doesNotMatch(listRoute, /\.select\('\*'\)/);

  const coverageRoute = serverCode.slice(
    serverCode.indexOf("app.get('/api/tiss/pre-guides/coverage'"),
    serverCode.indexOf("app.post('/api/tiss/pre-guides/revalidate-period'")
  );
  assert.match(coverageRoute, /fetchClosurePeriodAppointmentRows/);
  assert.match(coverageRoute, /evaluateTissPreGuideEligibility/);
  assert.match(coverageRoute, /missingPreGuides/);
  assert.match(coverageRoute, /stalePreGuides/);
  assert.doesNotMatch(coverageRoute, /revalidateAppointmentBillingForAppointment|buildAndPersistTissPreGuideForAppointment/);
  assert.doesNotMatch(coverageRoute, /\.(upsert|insert|update|delete)\(/);
  assert.doesNotMatch(coverageRoute, /\.select\('\*'\)/);
});

test('backend gera e baixa XML TISS apenas como rascunho interno', () => {
  const createRoute = serverCode.slice(
    serverCode.indexOf("app.post('/api/tiss/xml-drafts'"),
    serverCode.indexOf("app.get('/api/tiss/xml-drafts/:draftId'")
  );
  const listRoute = serverCode.slice(
    serverCode.indexOf("app.get('/api/tiss/xml-drafts'"),
    serverCode.indexOf("app.post('/api/tiss/xml-drafts'")
  );
  const downloadRoute = serverCode.slice(
    serverCode.indexOf("app.get('/api/tiss/xml-drafts/:draftId/download'"),
    serverCode.indexOf("app.get('/api/tiss/pre-guides/coverage'")
  );
  const detailRoute = serverCode.slice(
    serverCode.indexOf("app.get('/api/tiss/xml-drafts/:draftId'"),
    serverCode.indexOf("app.get('/api/tiss/xml-drafts/:draftId/download'")
  );
  assert.match(serverCode, /import \{\s*generateTissXmlDraft\s*\} from '\.\/src\/services\/tissXmlDraftGenerator'/);
  assert.match(serverCode, /import \{\s*validateTissXmlDraft\s*\} from '\.\/src\/services\/tissXmlDraftValidator'/);
  assert.match(createRoute, /requireRoles\('coordinator', 'admin', 'owner'\)/);
  assert.match(createRoute, /appointment_tiss_pre_guides/);
  assert.match(createRoute, /\.eq\('status', 'valid'\)/);
  assert.match(createRoute, /generateTissXmlDraft/);
  assert.match(createRoute, /draft_format:\s*generated\.draftFormat/);
  assert.match(createRoute, /\.update\(\{ status: 'superseded'/);
  assert.match(createRoute, /\.from\('tiss_xml_drafts'\)[\s\S]*?\.insert\(payload\)/);
  assert.match(createRoute, /revenue_cycle_state:\s*'xml_draft_generated'/);
  assert.match(createRoute, /createTissBillingBatchDraftForXmlDraft/);
  assert.match(createRoute, /eventType:\s*'XML_DRAFT_GENERATED'/);
  assert.match(createRoute, /notSentToPayer:\s*true/);
  assert.match(createRoute, /XML TISS em rascunho gerado para conferência interna/);
  assert.match(listRoute, /TISS_XML_DRAFT_SELECT/);
  assert.doesNotMatch(listRoute, /xml_content/);
  assert.match(detailRoute, /TISS_XML_DRAFT_DETAIL_SELECT/);
  assert.match(detailRoute, /serializeTissXmlDraft\(data, true\)/);
  assert.match(serverCode, /app\.post\('\/api\/tiss\/xml-drafts\/:draftId\/validate'/);
  assert.match(serverCode, /technicalValidation = validateTissXmlDraft\(xmlContent\)/);
  assert.match(serverCode, /validation_summary:\s*nextValidationSummary/);
  assert.match(serverCode, /eventType:\s*'XML_DRAFT_VALIDATED'/);
  assert.match(serverCode, /technicalValidationStatus/);
  assert.match(serverCode, /draftFormat/);
  assert.match(downloadRoute, /Content-Type', 'application\/xml; charset=utf-8'/);
  assert.match(downloadRoute, /Content-Disposition/);
  assert.doesNotMatch(serverCode, /Remessa enviada|Faturamento TISS concluído|Guia oficial enviada|Lote transmitido/i);
  assert.doesNotMatch(createRoute, /enviar|remessa|glosa|retorno/i);
});

test('backend expõe eventos e lotes rascunho como central operacional sem envio', () => {
  const eventsRoute = serverCode.slice(
    serverCode.indexOf("app.get('/api/tiss/revenue-cycle/events'"),
    serverCode.indexOf("app.get('/api/tiss/billing-batch-drafts'")
  );
  const batchListRoute = serverCode.slice(
    serverCode.indexOf("app.get('/api/tiss/billing-batch-drafts'"),
    serverCode.indexOf("app.get('/api/tiss/billing-batch-drafts/:batchId'")
  );
  const batchDetailRoute = serverCode.slice(
    serverCode.indexOf("app.get('/api/tiss/billing-batch-drafts/:batchId'"),
    serverCode.indexOf("app.post('/api/tiss/billing-batch-drafts'")
  );
  const batchCreateRoute = serverCode.slice(
    serverCode.indexOf("app.post('/api/tiss/billing-batch-drafts'"),
    serverCode.indexOf("app.post('/api/tiss/billing-batch-drafts/:batchId/cancel'")
  );
  const batchCancelRoute = serverCode.slice(
    serverCode.indexOf("app.post('/api/tiss/billing-batch-drafts/:batchId/cancel'"),
    serverCode.indexOf("app.get('/api/tiss/pre-guides/coverage'")
  );
  assert.match(serverCode, /TISS_REVENUE_CYCLE_EVENT_SELECT/);
  assert.match(serverCode, /TISS_BILLING_BATCH_DRAFT_SELECT/);
  assert.match(eventsRoute, /\.from\('tiss_revenue_cycle_events'\)/);
  assert.match(eventsRoute, /\.eq\('organization_id', organizationId\)/);
  assert.match(eventsRoute, /pre_guide_id/);
  assert.match(eventsRoute, /appointment_id/);
  assert.doesNotMatch(eventsRoute, /\.select\('\*'\)/);
  assert.match(batchListRoute, /\.from\('tiss_billing_batch_drafts'\)/);
  assert.match(batchListRoute, /\.eq\('organization_id', organizationId\)/);
  assert.match(batchListRoute, /\.range\(offset, offset \+ pageSize - 1\)/);
  assert.doesNotMatch(batchListRoute, /\.select\('\*'\)/);
  assert.match(batchDetailRoute, /\.eq\('organization_id', organizationId\)/);
  assert.match(batchCreateRoute, /TISS_BILLING_BATCH_PRE_GUIDE_BLOCKED/);
  assert.match(batchCreateRoute, /blockingCount > 0/);
  assert.match(batchCreateRoute, /revenue_cycle_state:\s*'billing_batch_draft'/);
  assert.match(batchCreateRoute, /eventType:\s*'TISS_BILLING_BATCH_DRAFT_CREATED'/);
  assert.match(batchCreateRoute, /Nenhum dado foi enviado à operadora/);
  assert.match(batchCancelRoute, /status:\s*'cancelled'/);
  assert.match(batchCancelRoute, /eventType:\s*'TISS_BILLING_BATCH_DRAFT_CANCELLED'/);
  assert.match(batchCancelRoute, /revenue_cycle_state:\s*'ready_for_billing'/);
  assert.doesNotMatch(batchCreateRoute + batchCancelRoute, /Remessa enviada|Lote transmitido|Glosa processada|Retorno importado|protocolo/i);
});

test('revalidação reconstrói snapshots a partir dos cadastros mestres atuais', () => {
  const appointmentFetcher = serverCode.slice(
    serverCode.indexOf('const fetchAppointmentForBillingContext'),
    serverCode.indexOf('const serializeTissPreGuide')
  );
  const builder = serverCode.slice(
    serverCode.indexOf('const buildAndPersistTissPreGuideForAppointment'),
    serverCode.indexOf('const clearAppointmentBillingItemForAppointment')
  );
  const profileReader = serverCode.slice(
    serverCode.indexOf('const fetchTissPreGuideProfile'),
    serverCode.indexOf('const buildAndPersistTissPreGuideForAppointment')
  );
  const signatureReader = serverCode.slice(
    serverCode.indexOf('const fetchResponsibleSignatureForPreGuide'),
    serverCode.indexOf('const buildAndPersistTissPreGuideForAppointment')
  );
  const revalidationHandler = serverCode.slice(
    serverCode.indexOf('const handleTissPreGuideRevalidation'),
    serverCode.indexOf("app.get('/api/admin/tiss/provider-profile'")
  );

  assert.match(appointmentFetcher, /buildClosureAppointmentSelect\(omittedColumns\)/);
  assert.match(appointmentFetcher, /CLOSURE_APPOINTMENT_SCHEMA_FALLBACK_COLUMNS/);
  assert.doesNotMatch(appointmentFetcher, /BILLING_CONTEXT_APPOINTMENT_SELECT[\s\S]*?runAppointmentQuery/);
  assert.match(appointmentFetcher, /scheduled_start_at:\s*sanitizeString\(stateAppointment\?\.scheduled_start_at/);
  assert.match(appointmentFetcher, /therapist_id:\s*sanitizeString\(/);
  assert.match(profileReader, /const scopeColumns = \['organization_id', 'clinic_id'\]/);
  assert.match(builder, /\.from\('appointment_tiss_pre_guides'\)[\s\S]*?professional_id,payer_id,provider_profile_id,payer_tiss_profile_id,professional_billing_profile_id,scheduled_start,scheduled_end/);
  assert.match(builder, /\.from\('appointment_closure_checks'\)[\s\S]*?professional_id,payer_id/);
  assert.match(builder, /\.from\('appointment_professionals'\)[\s\S]*?professional_id,role,created_at/);
  assert.doesNotMatch(builder, /appointment\?\.professional_id/);
  assert.match(builder, /sanitizeString\(billingItem\?\.professional_id, 120\)/);
  assert.match(builder, /linkedAppointmentProfessionalId/);
  assert.match(builder, /sanitizeString\(closureCheck\?\.professional_id, 120\)/);
  assert.doesNotMatch(builder, /sanitizeString\(existingPreGuide\?\.professional_id, 120\)/);
  assert.match(builder, /appointmentTherapistId/);
  assert.match(builder, /billingItem\?\.professional_id[\s\S]*?linkedAppointmentProfessionalId[\s\S]*?closureCheck\?\.professional_id[\s\S]*?appointmentTherapistId/);
  assert.match(builder, /sanitizeString\(billingItem\?\.payer_id, 120\)/);
  assert.match(builder, /fetchTissPreGuideProfile\('clinic_tiss_profiles'/);
  assert.match(builder, /fetchTissPreGuideProfile\('payer_tiss_profiles'/);
  assert.match(builder, /fetchTissPreGuideProfile\('professional_billing_profiles'/);
  assert.match(builder, /provider_profile_id:\s*isUuid\(sanitizeString\(clinicProfile\?\.id/);
  assert.match(builder, /payer_tiss_profile_id:\s*isUuid\(sanitizeString\(payerProfile\?\.id/);
  assert.match(builder, /professional_billing_profile_id:\s*isUuid\(sanitizeString\(professionalProfile\?\.id/);
  assert.match(builder, /snapshot_data:\s*snapshot/);
  assert.match(builder, /revenue_cycle_state:\s*revenueCycle\.state/);
  assert.match(builder, /anti_glosa_checklist:\s*antiGlosaChecklist/);
  assert.match(builder, /anti_glosa_risk_codes:\s*antiGlosaRiskCodes/);
  assert.match(builder, /recordTissRevenueCycleEvent/);
  assert.match(builder, /PRE_GUIDE_READY_FOR_BILLING/);
  assert.match(builder, /PRE_GUIDE_PENDING/);
  assert.match(builder, /fetchResponsibleSignatureForPreGuide/);
  assert.match(signatureReader, /\.from\('session_signatures'\)[\s\S]*?\.select\(SESSION_SIGNATURE_SELECT\)/);
  assert.match(signatureReader, /\.eq\('organization_id', organizationId\)[\s\S]*?\.eq\('patient_id', patientId\)/);
  assert.match(builder, /signature:\s*responsibleSignature/);
  assert.match(builder, /responsibleSignatureFound:/);
  assert.match(builder, /providerProfileFound:/);
  assert.match(builder, /payerProfileFound:/);
  assert.match(builder, /professionalProfileFound:/);
  assert.match(builder, /usedAppointmentProfessionalId:/);
  assert.match(builder, /usedAppointmentTherapistId:/);
  assert.match(builder, /appointmentProfessionalsFound:/);
  assert.match(builder, /usedTeamFallback:\s*!isUuid\(professionalId\)/);
  assert.match(builder, /scheduledStartFound:/);
  assert.match(builder, /snapshotUpdated:\s*Boolean\(persisted\.data\?\.id\)/);
  assert.match(builder, /returnedDetailHasScheduledStart:\s*Boolean\(serializedPreGuide\.scheduledStart\)/);
  assert.match(revalidationHandler, /diagnostics:\s*process\.env\.NODE_ENV !== 'production'/);
  assert.match(revalidationHandler, /Pré-guia revalidada com dados globais atualizados/);
});

test('revalidação pontual e por período materializam Pré-guias sem backfill no GET', () => {
  const periodRoute = serverCode.slice(
    serverCode.indexOf("app.post('/api/tiss/pre-guides/revalidate-period'"),
    serverCode.indexOf("app.get('/api/tiss/pre-guides/:appointmentId'")
  );
  assert.match(periodRoute, /fetchClosurePeriodAppointmentRows/);
  assert.match(periodRoute, /evaluateTissPreGuideEligibility/);
  assert.match(periodRoute, /revalidateAppointmentBillingForAppointment/);
  assert.match(periodRoute, /foundAppointments/);
  assert.match(periodRoute, /eligible/);
  assert.match(periodRoute, /created/);
  assert.match(periodRoute, /updated/);
  assert.match(periodRoute, /staleUpdated/);
  assert.match(periodRoute, /pendingData/);
  assert.match(periodRoute, /withoutBillingItem/);
  assert.match(periodRoute, /withoutFinancialContext/);
  assert.doesNotMatch(periodRoute, /\.select\('\*'\)/);
  assert.doesNotMatch(periodRoute, /payer_name_snapshot.*eligible|payer_name.*eligible/);

  assert.match(serverCode, /app\.post\('\/api\/appointments\/:appointmentId\/tiss-pre-guide\/revalidate'/);
  assert.match(serverCode, /handleTissPreGuideRevalidation/);
  assert.match(serverCode, /TISS_PRE_GUIDE_NOT_MATERIALIZED/);
  assert.match(serverCode, /onConflict: 'organization_id,appointment_id'/);
});

test('revalidar sessão em Fechamento e Conferência propaga status da Pré-guia', () => {
  const closureRoute = serverCode.slice(
    serverCode.indexOf("app.post('/api/closure/appointments/:appointmentId/revalidate'"),
    serverCode.indexOf("app.patch('/api/closure/appointments/:appointmentId/override'")
  );
  const conferenceRoute = serverCode.slice(
    serverCode.indexOf("app.post('/api/conference/monthly/session/:appointmentId/revalidate'"),
    serverCode.indexOf("app.patch('/api/conference/monthly/session/:appointmentId/status'")
  );
  assert.match(closureRoute, /tissPreGuideResult/);
  assert.match(closureRoute, /tissPreGuideStatus/);
  assert.match(conferenceRoute, /tissPreGuideResult/);
  assert.match(conferenceRoute, /tissPreGuide:/);
  assert.match(conferenceRoute, /tissPreGuideStatus/);
});

test('endpoints protegem perfis e Pré-guias com autenticação, papel e tenant', () => {
  for (const route of [
    "app.get('/api/admin/tiss/provider-profile'",
    "app.patch('/api/admin/tiss/provider-profile'",
    "app.get('/api/admin/tiss/payer-profiles/:payerId'",
    "app.get('/api/admin/tiss/payer-profiles'",
    "app.patch('/api/admin/tiss/payer-profiles/:payerId'",
    "app.get('/api/admin/tiss/professional-profiles'",
    "app.get('/api/admin/tiss/professional-profiles/:professionalId'",
    "app.patch('/api/admin/tiss/professional-profiles/:professionalId'",
    "app.get('/api/tiss/professional-profile/me'",
    "app.patch('/api/tiss/professional-profile/me'",
    "app.get('/api/tiss/pre-guides'",
    "app.get('/api/tiss/pre-guides/coverage'",
    "app.post('/api/tiss/pre-guides/revalidate-period'",
    "app.get('/api/tiss/pre-guides/:appointmentId'",
    "app.post('/api/tiss/pre-guides/:appointmentId/revalidate'",
    "app.post('/api/appointments/:appointmentId/tiss-pre-guide/revalidate'",
    "app.post('/api/tiss/patient-payer-authorizations'",
  ]) {
    assert.match(serverCode, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(serverCode, /requireRoles\('coordinator', 'admin', 'owner'\)/);
  assert.match(serverCode, /\.eq\('organization_id', organizationId\)/);
  assert.match(serverCode, /\.eq\('clinic_id', organizationId\)/);
  assert.doesNotMatch(serverCode.slice(serverCode.indexOf("app.get('/api/tiss/pre-guides'"), serverCode.indexOf("app.get('/api/admin/payers'")), /\.select\('\*'\)/);
});

test('perfil TISS do prestador salva e le clinic_tiss_profiles sem substituir por profissional', () => {
  const providerReadRoute = serverCode.slice(
    serverCode.indexOf("app.get('/api/admin/tiss/provider-profile'"),
    serverCode.indexOf("app.patch('/api/admin/tiss/provider-profile'")
  );
  const providerPatchRoute = serverCode.slice(
    serverCode.indexOf("app.patch('/api/admin/tiss/provider-profile'"),
    serverCode.indexOf("app.get('/api/admin/tiss/payer-profiles/:payerId'")
  );
  assert.match(providerReadRoute, /fetchTissPreGuideProfile\('clinic_tiss_profiles', CLINIC_TISS_PROFILE_SELECT, organizationId\)/);
  assert.match(providerPatchRoute, /\.from\('clinic_tiss_profiles'\)/);
  assert.match(providerPatchRoute, /created_at:\s*existingProfile\?\.created_at \|\| now/);
  assert.match(providerPatchRoute, /document_number:\s*sanitizeString\(req\.body\?\.documentNumber/);
  assert.match(providerPatchRoute, /cnes_code:\s*sanitizeString\(req\.body\?\.cnesCode/);
  assert.match(providerPatchRoute, /provider_code:\s*sanitizeString\(req\.body\?\.providerCode/);
  assert.doesNotMatch(providerPatchRoute, /professionalName|professional_name|user\.name/);
});

test('cadastros TISS sao globais e reutilizaveis em Configuracoes', () => {
  assert.match(coordinatorCode, /import \{ BillingTissSettingsPanel \} from "\.\/BillingTissSettingsPanel"/);
  assert.match(coordinatorCode, /<BillingTissSettingsPanel/);
  assert.match(billingTissSettingsCode, /Configurações de Faturamento e TISS/);
  assert.match(billingTissSettingsCode, /Cadastros mestres reutilizados por Pré-guia TISS, Pré-faturamento, Fechamento, relatórios e exportações/);
  assert.match(billingTissSettingsCode, /Fonte mestre: clinic_tiss_profiles/);
  assert.match(billingTissSettingsCode, /Fonte mestre: payer_tiss_profiles/);
  assert.match(billingTissSettingsCode, /Fonte mestre: professional_billing_profiles/);
  assert.match(billingTissSettingsCode, /getClinicTissProfile/);
  assert.match(billingTissSettingsCode, /Resumo do prestador \/ clínica/);
  assert.match(billingTissSettingsCode, /Editar em Dados da clínica/);
  assert.match(settingsPanelCode, /id="clinic-master-data"/);
  assert.match(settingsPanelCode, /onEditClinicData=\{scrollToClinicData\}/);
  assert.match(coordinatorCode, /dataService\.updateClinicTissProfile/);
  assert.match(billingTissSettingsCode, /getPayerTissProfiles/);
  assert.match(billingTissSettingsCode, /getProfessionalBillingProfiles/);
  assert.doesNotMatch(billingTissSettingsCode, /dataService\.updateClinicTissProfile/);
  assert.doesNotMatch(billingTissSettingsCode, /Salvar dados do prestador/);
  assert.match(billingTissSettingsCode, /updatePayerTissProfile/);
  assert.match(billingTissSettingsCode, /updateProfessionalBillingProfile/);
  assert.match(coordinatorCode, /Pré-guias afetadas podem precisar de revalidação/);
  assert.match(billingTissSettingsCode, /Pré-guias deste pagador foram marcadas para revalidação/);
  assert.match(billingTissSettingsCode, /Pré-guias deste profissional foram marcadas para revalidação/);
  assert.doesNotMatch(billingTissSettingsCode, /appointmentId|appointment_id/);
});

test('Convênios expõe configuração TISS guiada por operadora', () => {
  assert.match(payerRequirementsCode, /Configuração de Convênios/);
  assert.match(payerRequirementsCode, /Cadastro avançado de operadoras/);
  assert.match(payerRequirementsCode, /Dados TISS da operadora/);
  assert.match(payerRequirementsCode, /Dados da operadora/);
  assert.match(payerRequirementsCode, /Dados do prestador no convênio/);
  assert.match(payerRequirementsCode, /Regras TISS e autorização/);
  assert.match(payerRequirementsCode, /Contatos e observações administrativas/);
  assert.match(payerRequirementsCode, /De\/Para TUSS por Convênio/);
  assert.match(payerRequirementsCode, /Tabela de procedimentos e valores/);
  assert.match(payerRequirementsCode, /Valor negociado/);
  assert.match(payerRequirementsCode, /Importar tabela/);
  assert.match(payerRequirementsCode, /dataService\.getPayerProcedurePrices/);
  assert.match(payerRequirementsCode, /dataService\.createPayerProcedurePrice/);
  assert.match(payerRequirementsCode, /dataService\.updatePayerProcedurePrice/);
  assert.match(payerRequirementsCode, /dataService\.getPayerTissProfile/);
  assert.match(payerRequirementsCode, /dataService\.updatePayerTissProfile/);
  assert.match(payerRequirementsCode, /Registro ANS/);
  assert.match(payerRequirementsCode, /Exige validade da carteirinha/);
  assert.match(payerRequirementsCode, /Exige procedimento autorizado/);
  assert.match(payerRequirementsCode, /Exige número de guia/);
  assert.match(payerRequirementsCode, /Exige CID/);
  assert.match(payerRequirementsCode, /Código do contratado na operadora/);
  assert.match(payerRequirementsCode, /Não aplicável/);
  assert.match(payerRequirementsCode, /Pré-guias deste pagador foram marcadas para revalidação/);
  assert.doesNotMatch(payerRequirementsCode, /Gerar XML|Enviar lote|Enviar remessa|Registrar glosa/i);
});

test('frontend separa Pré-guias e Rascunhos XML com preview interno', () => {
  assert.match(conferenceCode, /"preGuides", "Pré-guias TISS"/);
  assert.match(conferenceCode, /<TissPreGuideTab/);
  for (const label of [
    'Pré-guias válidas',
    'Pendentes',
    'Não aplicáveis',
    'Sem autorização',
    'Autorização vencida',
    'Sem carteirinha',
    'Sem dados do pagador',
    'Sem registro profissional',
    'Sem valor',
  ]) {
    assert.match(preGuideUiCode, new RegExp(label));
  }
  assert.match(preGuideUiCode, /dataService\.getTissPreGuides/);
  assert.match(preGuideUiCode, /dataService\.getTissPreGuideCoverage/);
  assert.match(preGuideUiCode, /dataService\.getTissPreGuide/);
  assert.match(preGuideUiCode, /dataService\.revalidateTissPreGuide/);
  assert.match(preGuideUiCode, /dataService\.revalidateTissPreGuidePeriod/);
  assert.match(preGuideUiCode, /Gerar\/Revalidar pré-guias do período/);
  assert.match(preGuideUiCode, /As pré-guias são criadas por revalidação para evitar backfill automático/);
  assert.match(preGuideUiCode, /Nenhum atendimento elegível encontrado/);
  assert.match(preGuideUiCode, /dataService\.updateClinicTissProfile/);
  assert.match(preGuideUiCode, /dataService\.updatePayerTissProfile/);
  assert.match(preGuideUiCode, /dataService\.updateProfessionalBillingProfile/);
  assert.match(preGuideUiCode, /dataService\.upsertPatientPayerAuthorization/);
  assert.match(preGuideUiCode, /AUTHORIZATION_REQUIRED:\s*"Sem autorização"/);
  assert.match(preGuideUiCode, /AUTHORIZATION_EXHAUSTED:\s*"Autorização esgotada"/);
  assert.match(preGuideUiCode, /AUTHORIZATION_PROCEDURE_MISMATCH:\s*"Procedimento divergente"/);
  assert.match(preGuideUiCode, /AUTHORIZED_PROCEDURE_NOT_INFORMED:\s*"Procedimento autorizado"/);
  assert.match(preGuideUiCode, /RESPONSIBLE_SIGNATURE_REQUIRED:\s*"Assinatura do responsável"/);
  assert.match(preGuideUiCode, /hasAuthorizationSnapshot/);
  assert.match(preGuideUiCode, /Editar autorização/);
  assert.match(preGuideUiCode, /Pronta/);
  assert.match(preGuideUiCode, /professionalSnapshot\.cboCode/);
  assert.match(preGuideUiCode, /missing_authorization/);
  assert.match(preGuideUiCode, /authorization_expired/);
  assert.match(preGuideUiCode, /missing_card/);
  assert.match(preGuideUiCode, /Gerar lote XML para operadora/);
  assert.match(preGuideUiCode, /Agrupa as Pré-guias válidas selecionadas do mesmo convênio e competência/);
  assert.match(preGuideUiCode, /Selecionar todas as válidas/);
  assert.match(preGuideUiCode, /Visualizar guias incluídas/);
  assert.match(preGuideUiCode, /Confirmar geração do lote XML/);
  assert.match(preGuideUiCode, /Será gerado um único arquivo XML contendo uma guia SP\/SADT para cada sessão selecionada/);
  assert.match(preGuideUiCode, /Gerar lote XML/);
  assert.match(preGuideUiCode, /Histórico de lotes XML oficiais/);
  assert.match(preGuideUiCode, /Nenhum lote XML validado nesta competência/);
  assert.match(preGuideUiCode, /Lote XML validado/);
  assert.match(preGuideUiCode, /Detalhes técnicos/);
  assert.match(preGuideUiCode, /Ver XML armazenado/);
  assert.match(preGuideUiCode, /OFFICIAL_BATCH_GUIDE_LIMIT/);
  assert.match(preGuideUiCode, /O lote suporta até 500 guias/);
  assert.match(preGuideUiCode, /officialPreGuideBlockReasons/);
  assert.match(preGuideUiCode, /toggleOfficialPreGuideSelection/);
  assert.match(preGuideUiCode, /activePanel === "batchDrafts"/);
  assert.match(preGuideUiCode, /activePanel === "xmlDrafts"/);
  assert.match(preGuideUiCode, /Central de Fechamento TISS/);
  assert.match(preGuideUiCode, /Ferramentas internas e histórico/);
  assert.match(preGuideUiCode, /Os rascunhos são recursos internos de conferência/);
  assert.match(preGuideUiCode, /Lotes rascunho/);
  assert.match(preGuideUiCode, /Criar lote rascunho/);
  assert.match(preGuideUiCode, /dataService\.getTissBillingBatchDrafts/);
  assert.match(preGuideUiCode, /dataService\.createTissBillingBatchDraft/);
  assert.match(preGuideUiCode, /dataService\.cancelTissBillingBatchDraft/);
  assert.match(preGuideUiCode, /Nenhum lote foi enviado/);
  assert.match(preGuideUiCode, /Estado do ciclo/);
  assert.match(preGuideUiCode, /revenueCycleMeta/);
  assert.match(preGuideUiCode, /Pronta para faturamento/);
  assert.match(preGuideUiCode, /Com pend/);
  assert.match(preGuideUiCode, /Aguardando autoriza/);
  assert.match(preGuideUiCode, /XML rascunho gerado/);
  assert.match(preGuideUiCode, /Em lote rascunho/);
  assert.doesNotMatch(preGuideUiCode, /Gerar XML rascunho com pré-guias prontas/);
  assert.match(preGuideUiCode, /Gerar rascunho XML/);
  assert.match(preGuideUiCode, /Rascunhos XML TISS/);
  assert.match(preGuideUiCode, /XMLs gerados apenas para conferência interna/);
  assert.match(preGuideUiCode, /Nenhum rascunho foi enviado à operadora/);
  assert.match(preGuideUiCode, /Rascunhos gerados/);
  assert.match(preGuideUiCode, /Último rascunho/);
  assert.match(preGuideUiCode, /Pré-guias incluídas/);
  assert.match(preGuideUiCode, /Valor total em rascunhos/);
  assert.match(preGuideUiCode, /Ver rascunho/);
  assert.match(preGuideUiCode, /Ir para Rascunhos XML/);
  assert.match(preGuideUiCode, /Ver XML/);
  assert.match(preGuideUiCode, /Formato/);
  assert.match(preGuideUiCode, /TISS\/SP-SADT rascunho/);
  assert.match(preGuideUiCode, /Interno Verto/);
  assert.match(preGuideUiCode, /Validação/);
  assert.match(preGuideUiCode, /Não validado/);
  assert.match(preGuideUiCode, /Válido/);
  assert.match(preGuideUiCode, /Com avisos/);
  assert.match(preGuideUiCode, /Inválido/);
  assert.match(preGuideUiCode, /Validar XML/);
  assert.match(preGuideUiCode, /Ver validação/);
  assert.match(preGuideUiCode, /Validação do XML rascunho/);
  assert.match(preGuideUiCode, /Validação XSD oficial/);
  assert.match(preGuideUiCode, /A validação contra XSD oficial ainda não está configurada/);
  assert.match(preGuideUiCode, /Copiar XML/);
  assert.match(preGuideUiCode, /Rascunho interno\. Não enviado à operadora\./);
  assert.match(preGuideUiCode, /Este XML é um rascunho para conferência interna\. Ainda não houve envio à operadora\./);
  assert.match(preGuideUiCode, /Baixar XML/);
  assert.match(preGuideUiCode, /isAuthorizationIssue/);
  assert.match(preGuideUiCode, /resolveIssueAction/);
  assert.match(preGuideUiCode, /authorizationActionLabel/);
  assert.match(preGuideUiCode, /onClick=\{issueAction\.onClick\}/);
  assert.match(preGuideUiCode, /Salvar autorização e revalidar/);
  assert.match(preGuideUiCode, /Quantidade autorizada/);
  assert.match(preGuideUiCode, /Unidade autorizada/);
  assert.match(preGuideUiCode, /Editar Dados da clínica/);
  assert.match(preGuideUiCode, /Editar perfil TISS do pagador/);
  assert.match(preGuideUiCode, /Configurar convênio/);
  assert.match(preGuideUiCode, /onNavigatePayers/);
  assert.match(preGuideUiCode, /Abrir Convênios/);
  assert.match(preGuideUiCode, /Editar perfil faturável do profissional/);
  assert.match(preGuideUiCode, /RESPONSIBLE_SIGNATURE_REQUIRED:\s*"Assinatura do responsável"/);
  assert.match(preGuideUiCode, /<Section title="Assinatura" icon=\{ClipboardCheck\}>/);
  assert.match(preGuideUiCode, /Data\/hora da assinatura/);
  assert.match(preGuideUiCode, /<Section title="Ciclo de receita" icon=\{History\}>/);
  assert.match(preGuideUiCode, /Histórico do ciclo/);
  assert.match(preGuideUiCode, /dataService\.getTissRevenueCycleEvents/);
  assert.match(preGuideUiCode, /revenueCycleEventLabel/);
  assert.match(preGuideUiCode, /Última validação/);
  assert.match(preGuideUiCode, /Próxima ação sugerida/);
  assert.match(preGuideUiCode, /Checklist antiglosa/);
  assert.match(preGuideUiCode, /antiGlosaCategoryLabel/);
  assert.match(preGuideUiCode, /Convênio e beneficiário/);
  assert.match(preGuideUiCode, /Autorização e guia/);
  assert.match(preGuideUiCode, /Profissional executante/);
  assert.match(preGuideUiCode, /Procedimento\/TUSS/);
  assert.match(preGuideUiCode, /Execução\/assinatura/);
  assert.match(preGuideUiCode, /Valores/);
  assert.match(preGuideUiCode, /Documentos físicos/);
  assert.match(preGuideUiCode, /antiGlosaChecklist/);
  assert.match(preGuideUiCode, /antiGlosaStatusMeta/);
  assert.match(preGuideUiCode, /Bloqueante/);
  assert.match(preGuideUiCode, /Aten/);
  assert.match(preGuideUiCode, /Não aplicável|NÃ£o aplicÃ¡vel/);
  assert.match(preGuideUiCode, /Ação sugerida|AÃ§Ã£o sugerida/);
  assert.match(preGuideUiCode, /isResponsibleSignatureIssue/);
  assert.match(preGuideUiCode, /Ir para atendimento e coletar assinatura/);
  assert.doesNotMatch(preGuideUiCode.slice(preGuideUiCode.indexOf('isResponsibleSignatureIssue'), preGuideUiCode.indexOf('isAuthorizationIssue')), /Adicionar autorização/);
  assert.doesNotMatch(preGuideUiCode, /<div className=\{`mt-1 text-xs font-bold/);
  assert.match(preGuideUiCode, /focusPanel:\s*"signature"/);
  assert.match(preGuideUiCode, /actionIntent:\s*"collect_signature"/);
  assert.match(coordinatorCode, /openAppointmentFromAdministrativeFlow/);
  assert.match(coordinatorCode, /actionIntent === "collect_signature"/);
  assert.match(coordinatorCode, /Abrimos o agendamento para coletar assinatura/);
  assert.match(preGuideUiCode, /Pré-guia revalidada com dados globais atualizados/);
  assert.match(preGuideUiCode, /setDetail\(result\.data\)/);
  assert.match(preGuideUiCode, /Salvar cadastro global e revalidar pré-guia atual/);
  assert.match(preGuideUiCode, /Você está editando o perfil faturável global da clínica/);
  assert.match(preGuideUiCode, /Você está editando o perfil TISS global deste pagador/);
  assert.match(preGuideUiCode, /Você está editando o perfil faturável global deste profissional/);
  assert.match(preGuideUiCode, /Esta é uma pré-guia para validação interna\. XML TISS ainda não foi gerado\./);
  assert.match(serverCode, /missing_authorization: \['GUIDE_MISSING', 'AUTHORIZATION_MISSING', 'AUTHORIZATION_REQUIRED'/);
  assert.match(serverCode, /authorization_expired: \['AUTHORIZATION_EXPIRED'\]/);
  assert.match(serverCode, /missing_card: \['BENEFICIARY_CARD_MISSING'\]/);
  assert.match(serverCode, /missingAuthorization: countCodes\(tissPreGuideQuickFilterCodes\.missing_authorization\)/);
  assert.match(serverCode, /authorizationExpired: countCodes\(tissPreGuideQuickFilterCodes\.authorization_expired\)/);
  assert.match(serverCode, /missingCard: countCodes\(tissPreGuideQuickFilterCodes\.missing_card\)/);
  assert.match(serverCode, /APPOINTMENT_TISS_PRE_GUIDE_LIST_SELECT[\s\S]*?'snapshot_data'/);
  assert.match(preGuideUiCode, /sticky top-0 z-20/);
  assert.match(preGuideUiCode, /snapshot\.provider\?\.tradeName/);
  assert.doesNotMatch(preGuideUiCode, /snapshot\.provider\?\.tradeName \|\| detail\.clinicName/);
  assert.match(preGuideUiCode, /<ActiveFilterBanner/);
  assert.match(preGuideUiCode, /missingPreGuides/);
  assert.match(preGuideUiCode, /stalePreGuides/);
  assert.match(preGuideUiCode, /Gerar\/Revalidar pendentes/);
  assert.match(preGuideUiCode, /Nenhum atendimento eleg/);
  assert.doesNotMatch(preGuideUiCode, /Enviar lote|Enviar remessa|Registrar glosa|Remessa enviada|Faturamento TISS concluído|Guia oficial enviada|Lote transmitido|Retorno importado|Glosa processada|Recurso de glosa/i);
});

test('data service usa operações explícitas e o pacote expõe suíte dedicada', () => {
  assert.match(revenueStateMachineCode, /RESERVED_FUTURE_STATES/);
  assert.match(revenueStateMachineCode, /TISS_REVENUE_STATE_RESERVED_FOR_FUTURE/);
  assert.match(antiGlosaChecklistCode, /ChecklistStatus/);
  assert.match(antiGlosaChecklistCode, /risco de negativa por autoriza/);
  assert.doesNotMatch(xmlDraftGeneratorCode, /clinical_notes|session_notes|prontuario|prontu[aá]rio|subjective|intervention|aba_trials/i);
  assert.doesNotMatch(antiGlosaChecklistCode, /clinical_notes|session_notes|prontuario|prontu[aá]rio|subjective|intervention|aba_trials/i);
  for (const helper of [
    'getTissPreGuides',
    'getTissPreGuideCoverage',
    'getTissPreGuide',
    'revalidateTissPreGuide',
    'revalidateTissPreGuidePeriod',
    'getTissXmlDrafts',
    'createTissXmlDraft',
    'getTissXmlDraft',
    'validateTissXmlDraft',
    'downloadTissXmlDraft',
    'getTissRevenueCycleEvents',
    'getTissBillingBatchDrafts',
    'getTissBillingBatchDraft',
    'createTissBillingBatchDraft',
    'cancelTissBillingBatchDraft',
    'getClinicTissProfile',
    'updateClinicTissProfile',
    'getPayerTissProfile',
    'getPayerTissProfiles',
    'updatePayerTissProfile',
    'getPayerProcedurePrices',
    'createPayerProcedurePrice',
    'updatePayerProcedurePrice',
    'upsertPatientPayerAuthorization',
    'getProfessionalBillingProfile',
    'getProfessionalBillingProfiles',
    'updateProfessionalBillingProfile',
    'getOwnProfessionalBillingProfile',
    'updateOwnProfessionalBillingProfile',
  ]) {
    assert.match(dataServiceCode, new RegExp(`async ${helper}`));
  }
  assert.match(dataServiceCode, /table: 'appointment_tiss_pre_guides'/);
  assert.match(dataServiceCode, /hasExplicitColumns: true/);
  assert.match(packageJson, /"test:tiss-pre-guide": "tsx tests\/tissPreGuide\.test\.ts"/);
});

let passed = 0;
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} TISS pre-guide tests passed`);
