import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createPatientFinancialPlan,
  financialPlanRequiresPaymentMethod,
  normalizePatientFinancialPlans,
  serializePatientFinancialPlanForPayload
} from '../src/utils/patientFinancialPlan';
import {
  ABA_INDIVIDUAL_EXPECTED_TUSS_CODE,
  dedupePatientTissAuthorizationSelectionOptions,
  findSuggestedTissAuthorizationForAppointment,
  findSuggestedTissAuthorizationForFinancialPlan,
  getPatientTissAuthorizationQuantitySummary,
  getPatientTissAuthorizationVisualState,
  getPatientTissAuthorizationTussReview,
  groupPatientTissAuthorizations
} from '../src/utils/patientTissAuthorizationView';
import {
  mapPatientProfileTypeToLegacyPortalType,
  normalizePatientProfileType,
  PATIENT_PROFILE_TYPE_OPTIONS
} from '../src/utils/patientProfileType';
import { PATIENT_LIST_SELECT } from '../src/utils/routeSchemaFallbacks';

const root = process.cwd();
const coordinatorCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const appCode = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const migrationCode = readFileSync(join(root, 'supabase/migrations/20260529183000_patient_financial_plans.sql'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('normalizacao nao cria Terapia fixa em cadastro novo', () => {
  assert.deepEqual(normalizePatientFinancialPlans([]), []);
  const legacy = normalizePatientFinancialPlans([], { monthlyTreatmentValue: 300, billingDueDay: 10 });
  assert.equal(legacy.length, 1);
  assert.notEqual(legacy[0].specialty, 'Terapia');
});

test('convênio nao força PIX sem coparticipacao', () => {
  const plan = createPatientFinancialPlan({
    serviceType: 'SPEECH_THERAPY',
    billingMode: 'INSURANCE',
    payerNameSnapshot: 'Convênio A',
    paymentMethod: 'pix'
  });
  const payload = serializePatientFinancialPlanForPayload(plan);
  assert.equal(financialPlanRequiresPaymentMethod(plan), false);
  assert.equal(payload.paymentMethod, null);
  assert.equal(payload.billingMethod, null);

  const withCopay = createPatientFinancialPlan({
    ...plan,
    copaymentAmount: '45,00',
    paymentMethod: 'pix'
  });
  assert.equal(financialPlanRequiresPaymentMethod(withCopay), true);
  assert.equal(serializePatientFinancialPlanForPayload(withCopay).paymentMethod, 'pix');
});

test('plano de convênio do paciente persiste dados oficiais de carteirinha', () => {
  const plan = createPatientFinancialPlan({
    serviceType: 'ABA',
    billingMode: 'INSURANCE',
    payerId: 'payer-unimed',
    payerNameSnapshot: 'Unimed',
    insurancePlanName: 'Unimed Nacional',
    insuranceCardNumber: '000000000',
    insuranceCardHolder: 'Pedro Henrique Alves Santana',
    insuranceCardValidUntil: '2026-12-31',
    isPrimaryInsurance: true,
  });
  const payload = serializePatientFinancialPlanForPayload(plan);

  assert.equal(plan.insurancePlanName, 'Unimed Nacional');
  assert.equal(plan.insuranceCardNumber, '000000000');
  assert.equal(plan.insuranceCardHolder, 'Pedro Henrique Alves Santana');
  assert.equal(plan.insuranceCardValidUntil, '2026-12-31');
  assert.equal(plan.isPrimaryInsurance, true);
  assert.equal(payload.insurancePlanName, 'Unimed Nacional');
  assert.equal(payload.insuranceCardNumber, '000000000');
  assert.equal(payload.insuranceCardHolder, 'Pedro Henrique Alves Santana');
  assert.equal(payload.insuranceCardValidUntil, '2026-12-31');
  assert.equal(payload.isPrimaryInsurance, true);
});

test('perfil canonical persiste sem quebrar portal legado', () => {
  assert.equal(normalizePatientProfileType('kids_tea'), 'KIDS');
  assert.equal(normalizePatientProfileType('adult_tea'), 'ABA');
  assert.equal(normalizePatientProfileType('ABA'), 'ABA');
  assert.equal(mapPatientProfileTypeToLegacyPortalType('ABA'), 'adult_tea');
  assert.equal(mapPatientProfileTypeToLegacyPortalType('ADULT'), 'adult_conventional');
});

test('cadastro expõe somente os três portais configurados', () => {
  assert.deepEqual(
    PATIENT_PROFILE_TYPE_OPTIONS.map((option) => option.label),
    [
      'Kids ABA (portal infantil)',
      'Adulto ABA (adulto TEA)',
      'Adulto convencional (adulto neurotípico)'
    ]
  );
});

test('UI remove lembrete automatico e expõe plano financeiro por modalidade', () => {
  assert.doesNotMatch(coordinatorCode, /Lembrete de renovação da ficha anamnese/);
  assert.doesNotMatch(coordinatorCode, /Renovação da anamnese/);
  assert.doesNotMatch(coordinatorCode, /specialty:\s*String\(plan\.specialty \|\| "Terapia"\)/);
  assert.match(coordinatorCode, /PATIENT_FINANCIAL_BILLING_MODE_OPTIONS/);
  assert.match(coordinatorCode, /label="Coparticipação"/);
  assert.match(coordinatorCode, /label="Autorização legada do plano"/);
  assert.match(coordinatorCode, /Valor planejado do convênio/);
  assert.match(coordinatorCode, /Quantidade planejada/);
  assert.match(coordinatorCode, /Senhas, guias e saldo autorizado para Pré-guia\/XML devem ser mantidos em Autorizações TISS do paciente/);
  assert.match(coordinatorCode, /Pagador\/convênio/);
});

test('UI separa Autorizações TISS do paciente do plano financeiro legado', () => {
  for (const marker of [
    'Autorizações TISS do paciente',
    'Use esta seção para controlar senhas/guias autorizadas pelo convênio. O Verto sugere a autorização vigente compatível para novas sessões e Pré-guias.',
    'Nova autorização',
    'Procedimento faturável',
    'Código TUSS resolvido',
    'Fonte: De/Para ativo do convênio.',
    'Valor negociado',
    'Fonte operacional: Tabela de Valores negociados.',
    'Número da autorização / senha',
    'Número da guia',
    'Quantidade autorizada',
    'Quantidade consumida',
    'Nenhuma autorização TISS cadastrada para este paciente.',
    'Autorização vigente sugerida para novas sessões',
    'Nenhuma autorização TISS vigente elegível para novas sessões.',
    'Autorizações semelhantes',
    'Autorizações legadas/inadequadas para Pré-guia',
    'Autorizações históricas/inativas',
    'Autorização TISS vinculada/sugerida',
    'Dados legados de autorização',
    'Estes campos foram preservados apenas para compatibilidade com cadastros antigos.',
    'A Pré-guia TISS usará a autorização vigente compatível com a sessão, quando exigida pelo convênio.',
    'Qtde. planejada',
  ]) {
    assert.ok(coordinatorCode.includes(marker), marker);
  }

  assert.match(coordinatorCode, /selectedPatientAuthorizationConfiguration/);
  assert.match(coordinatorCode, /patientAuthorizationBillingConfigurations/);
  assert.match(coordinatorCode, /groupPatientTissAuthorizations/);
  assert.match(coordinatorCode, /getPatientTissAuthorizationVisualState/);
  assert.match(coordinatorCode, /findSuggestedTissAuthorizationForFinancialPlan/);
  assert.match(coordinatorCode, /dataService\.getPatientTissAuthorizations/);
  assert.match(coordinatorCode, /dataService\.upsertPatientPayerAuthorization/);
  assert.match(coordinatorCode, /dataService\.setPatientTissAuthorizationActive/);
  assert.match(coordinatorCode, /dataService\.deletePatientTissAuthorization/);
  assert.match(dataServiceCode, /async getPatientTissAuthorizations/);
  assert.match(dataServiceCode, /async setPatientTissAuthorizationActive/);
  assert.match(dataServiceCode, /async deletePatientTissAuthorization/);
  assert.match(serverCode, /app\.get\('\/api\/patients\/:patientId\/tiss-authorizations'/);
  assert.match(serverCode, /app\.patch\('\/api\/patients\/:patientId\/tiss-authorizations\/:authorizationId'/);
  assert.match(serverCode, /app\.delete\('\/api\/patients\/:patientId\/tiss-authorizations\/:authorizationId'/);
  assert.match(serverCode, /AUTHORIZATION_PAYER_PRICE_MISSING/);
  assert.match(serverCode, /AUTHORIZATION_REACTIVATION_PRICE_MISSING/);
  assert.match(serverCode, /fetchActivePayerProcedurePrice/);
  assert.doesNotMatch(coordinatorCode, /label=\{isInsurancePlan \? "Valor autorizado"/);
  assert.doesNotMatch(coordinatorCode, /label=\{isInsurancePlan \? "Quantidade autorizada"/);
  assert.doesNotMatch(coordinatorCode, /Qtde\. autorizada/);
});

test('modal de edição do paciente organiza cadastro em abas sem perder estado único', () => {
  for (const marker of [
    'type PatientRegistrationTab = "personal" | "insurance" | "tiss" | "financial" | "legacy"',
    'Dados pessoais',
    'Convênio e elegibilidade',
    'Autorizações TISS',
    'Plano financeiro',
    'Histórico / dados legados',
    'activePatientRegistrationTab === "personal"',
    'activePatientRegistrationTab === "insurance"',
    'activePatientRegistrationTab === "tiss"',
    'activePatientRegistrationTab === "financial"',
    'activePatientRegistrationTab === "legacy"',
    'Campos preservados por compatibilidade com cadastros antigos. Para Pré-guias e XML, use Autorizações TISS do paciente.',
    'Nenhum dado legado de autorização neste cadastro.'
  ]) {
    assert.ok(coordinatorCode.includes(marker), marker);
  }

  assert.match(coordinatorCode, /const \[activePatientRegistrationTab, setActivePatientRegistrationTab\]/);
  assert.match(coordinatorCode, /onClick=\{\(\) => setActivePatientRegistrationTab\(tab\.id\)\}/);
  assert.match(coordinatorCode, /onClick=\{handleCreatePatientFromFullForm\}/);
  assert.match(coordinatorCode, /value=\{newPatientForm\.nome\}/);
  assert.match(coordinatorCode, /value=\{newPatientForm\.convenioNome\}/);
  assert.match(coordinatorCode, /value=\{plan\.authorizationCode\}/);
  assert.match(coordinatorCode, /scrollToPatientTissAuthorizations[\s\S]*setActivePatientRegistrationTab\("tiss"\)/);
  assert.match(coordinatorCode, /goToNewPatientTissAuthorization[\s\S]*openNewPatientTissAuthorizationForm\(\)/);
});

test('Ver cadastro mostra resumo operacional sem truncar nome completo', () => {
  for (const marker of [
    'Visão operacional do cadastro, convênio, autorização TISS e plano financeiro.',
    'Informações cadastrais',
    'Nome completo',
    'Convênio atual',
    'Carteirinha',
    'Plano / categoria',
    'Titular',
    'Autorização TISS vigente',
    'Nenhuma autorização TISS vigente encontrada.',
    'Plano financeiro',
    'Alertas operacionais',
    'Sem autorização TISS vigente',
    'Autorização TISS vencida',
    'Autorização TISS consumida',
    'Sem De/Para TUSS ativo',
    'Sem preço negociado ativo',
    'Convênio incompleto'
  ]) {
    assert.ok(coordinatorCode.includes(marker), marker);
  }

  assert.match(coordinatorCode, /name: readFirstText\(profile\?\.name, profile\?\.fullName, profile\?\.full_name, profile\?\.nome, anamnesisData\?\.nome\)/);
  assert.match(coordinatorCode, /dataService\.getPatientTissAuthorizations\(profilePatientId\)/);
  assert.match(coordinatorCode, /selectedPatientProfileAuthorizations/);
  assert.match(coordinatorCode, /selectedProfileOperationalAlerts/);
  assert.match(coordinatorCode, /renderPatientProfileSummaryField\("Nome completo", selectedPatientProfile\.name\)/);
  assert.doesNotMatch(coordinatorCode, /selectedPatientProfile\.name\.split/);
});

test('áreas de cadastro do paciente não exibem mojibake', () => {
  const start = coordinatorCode.indexOf('const patientRegistrationTabs');
  const end = coordinatorCode.indexOf('{processingState.active', start);
  const patientRegistrationArea = coordinatorCode.slice(start, end);

  for (const brokenText of [
    'AutorizaÃ§Ãµes',
    'ConvÃªnio',
    'HistÃ³rico',
    'InformaÃ§Ãµes',
    'ResponsÃ¡vel'
  ]) {
    assert.doesNotMatch(patientRegistrationArea, new RegExp(brokenText));
  }
});

test('autorizações TISS agrupam, deduplicam e calculam status comercial', () => {
  const base = {
    id: 'auth-1',
    payerId: 'payer-amil',
    payerName: 'Amil',
    serviceCatalogId: 'service-aba',
    serviceName: 'Sessão ABA individual',
    tussCodeId: 'tuss-50000470',
    tussCode: '50000470',
    authorizationNumber: 'AUTH-123',
    guideNumber: 'GUIA-1',
    validFrom: '2026-06-01',
    validUntil: '2026-06-30',
    authorizedQuantity: 10,
    usedQuantity: 2,
    active: true,
    status: 'active'
  };
  const groups = groupPatientTissAuthorizations([
    base,
    { ...base },
    { ...base, id: 'auth-expired', authorizationNumber: 'AUTH-OLD', validFrom: '2026-05-01', validUntil: '2026-05-30' },
    { ...base, id: 'auth-consumed', authorizationNumber: 'AUTH-USED', usedQuantity: 10 },
    { ...base, id: 'auth-inactive', authorizationNumber: 'AUTH-OFF', active: false, status: 'cancelled' },
    { ...base, id: 'auth-future', authorizationNumber: 'AUTH-NEXT', validFrom: '2026-07-01', validUntil: '2026-07-31' },
  ], '2026-06-15');

  assert.equal(groups.length, 1);
  assert.equal(groups[0].authorizations.length, 5);
  assert.equal(groups[0].suggestedAuthorization?.authorizationNumber, 'AUTH-123');
  assert.equal(getPatientTissAuthorizationVisualState(base, '2026-06-10').label, 'Vigente');
  assert.equal(getPatientTissAuthorizationVisualState({ ...base, validUntil: '2026-06-20' }, '2026-06-15').label, 'A vencer');
  assert.equal(getPatientTissAuthorizationVisualState({ ...base, validUntil: '2026-05-30' }, '2026-06-15').label, 'Expirada');
  assert.equal(getPatientTissAuthorizationVisualState({ ...base, usedQuantity: 10 }, '2026-06-15').label, 'Consumida');
  assert.equal(getPatientTissAuthorizationVisualState({ ...base, active: false }, '2026-06-15').label, 'Inativa');
  assert.equal(getPatientTissAuthorizationVisualState({ ...base, validFrom: '2026-07-01', validUntil: '2026-07-31' }, '2026-06-15').label, 'Futura');
});

test('autorizações TISS do agendamento deduplicam equivalentes e calculam saldo de pacote', () => {
  const base = {
    patientId: 'patient-pedro',
    payerId: 'payer-amil',
    serviceCatalogId: 'service-aba',
    tussCodeId: 'tuss-50000470',
    tussCode: '50000470',
    authorizationNumber: '123456789',
    authorizationCode: '123456789',
    guideNumber: '12345679',
    validFrom: '2026-06-01',
    validUntil: '2026-06-30',
    quantityAuthorized: 10,
    quantityConsumed: 2,
    quantityReserved: 1,
    canUseForAppointment: true,
    isEligibleForAppointment: true,
    updatedAt: '2026-06-10T12:00:00Z',
    active: true,
    status: 'active'
  };

  assert.deepEqual(getPatientTissAuthorizationQuantitySummary(base), {
    authorized: 10,
    consumed: 2,
    reserved: 1,
    available: 7,
    hasPackageLimit: true,
  });

  const deduped = dedupePatientTissAuthorizationSelectionOptions([
    { ...base, id: 'auth-old', authorizationId: 'auth-old', updatedAt: '2026-06-01T12:00:00Z', quantityReserved: 3 },
    { ...base, id: 'auth-new', authorizationId: 'auth-new', updatedAt: '2026-06-12T12:00:00Z' },
    { ...base, id: 'auth-other-guide', authorizationId: 'auth-other-guide', guideNumber: '999' },
  ]);

  assert.equal(deduped.length, 2);
  assert.equal(deduped.find((item) => item.guideNumber === '12345679')?.authorizationId, 'auth-new');
  assert.equal(getPatientTissAuthorizationQuantitySummary(deduped.find((item) => item.authorizationId === 'auth-new')).available, 7);
});

test('autorizações ABA com TUSS legado não são sugeridas para novas Pré-guias', () => {
  const base = {
    payerId: 'payer-amil',
    payerName: 'Amil',
    serviceCatalogId: 'service-aba',
    serviceName: 'Sessão ABA individual',
    authorizationNumber: 'AUTH',
    validFrom: '2026-06-01',
    validUntil: '2026-06-30',
    authorizedQuantity: 10,
    usedQuantity: 0,
    active: true,
    status: 'active'
  };
  const groups = groupPatientTissAuthorizations([
    { ...base, id: 'auth-good', tussCodeId: 'tuss-50000470', tussCode: '50000470', authorizationNumber: 'AUTH-GOOD' },
    { ...base, id: 'auth-10101012', tussCodeId: 'tuss-10101012', tussCode: '10101012', authorizationNumber: 'AUTH-OLD' },
    { ...base, id: 'auth-teste-aba', tussCodeId: 'tuss-teste-aba', tussCode: 'TESTE-ABA', authorizationNumber: 'AUTH-TEST' }
  ], '2026-06-15');

  assert.equal(ABA_INDIVIDUAL_EXPECTED_TUSS_CODE, '50000470');
  assert.equal(groups.find((group) => group.tussCode === '50000470')?.suggestedAuthorization?.authorizationNumber, 'AUTH-GOOD');
  assert.equal(groups.find((group) => group.tussCode === '10101012')?.suggestedAuthorization, null);
  assert.equal(groups.find((group) => group.tussCode === 'TESTE-ABA')?.suggestedAuthorization, null);
  assert.equal(groups.find((group) => group.tussCode === '10101012')?.legacyAuthorizations.length, 1);
  assert.equal(groups.find((group) => group.tussCode === 'TESTE-ABA')?.legacyAuthorizations.length, 1);
  assert.equal(getPatientTissAuthorizationVisualState({ ...base, tussCode: '10101012' }, '2026-06-15').label, 'Legado');
  assert.equal(getPatientTissAuthorizationVisualState({ ...base, tussCode: 'TESTE-ABA' }, '2026-06-15').isLegacyOrInadequate, true);
  assert.equal(getPatientTissAuthorizationTussReview({ ...base, tussCode: '10101012' }).expectedTussCode, '50000470');

  assert.match(coordinatorCode, /Autorizações semelhantes \(\{patientTissCollapsedCurrentAuthorizations\.length\}\)/);
  assert.match(coordinatorCode, /Autorizações legadas\/inadequadas para Pré-guia \(\{patientTissLegacyAuthorizations\.length\}\)/);
  assert.match(coordinatorCode, /Autorizações históricas\/inativas \(\{patientTissHistoricalAuthorizations\.length\}\)/);
  assert.match(coordinatorCode, /De\/Para ativo esperado: \{visualState\.expectedTussCode \|\| ABA_INDIVIDUAL_EXPECTED_TUSS_CODE\}/);
});

test('resolvedor de consulta sugere autorizacao TISS vigente por paciente pagador servico data e TUSS', () => {
  const base = {
    patientId: 'patient-pedro',
    payerId: 'payer-amil',
    payerName: 'Amil',
    serviceCatalogId: 'service-aba',
    serviceName: 'Sessão ABA individual - teste XML',
    internalCode: 'ABA',
    payerTussMappingId: 'mapping-amil-aba',
    tussCodeId: 'tuss-50000470',
    tussCode: '50000470',
    authorizationNumber: '123456789',
    authorizationCode: '123456789',
    guideNumber: '12345679',
    validFrom: '2026-06-01',
    validUntil: '2026-06-30',
    authorizedQuantity: 10,
    usedQuantity: 0,
    active: true,
    status: 'active'
  };
  const suggested = findSuggestedTissAuthorizationForAppointment({
    payerId: 'payer-amil',
    serviceType: 'ABA',
    serviceCatalogId: 'service-aba',
    payerTussMappingId: 'mapping-amil-aba',
    tussCodeId: 'tuss-50000470',
    tussCode: '50000470',
    appointmentDate: '2026-06-26'
  }, [
    { ...base, id: 'auth-good' },
    { ...base, id: 'auth-other-payer', payerId: 'payer-unimed', payerName: 'Unimed' },
    { ...base, id: 'auth-old-code', tussCodeId: 'tuss-10101012', tussCode: '10101012', authorizationNumber: 'OLD' },
    { ...base, id: 'auth-test-code', tussCodeId: 'tuss-teste-aba', tussCode: 'TESTE-ABA', authorizationNumber: 'TEST' },
    { ...base, id: 'auth-expired', validUntil: '2026-05-30', authorizationNumber: 'EXP' },
    { ...base, id: 'auth-consumed', usedQuantity: 10, authorizationNumber: 'USED' },
    { ...base, id: 'auth-inactive', active: false, authorizationNumber: 'OFF' }
  ]);

  assert.equal(suggested?.authorizationNumber, '123456789');
  assert.equal(suggested?.guideNumber, '12345679');
  assert.equal(suggested?.tussCode, '50000470');
});

test('plano financeiro mostra resumo da autorização vigente sem virar fonte TISS', () => {
  const groups = groupPatientTissAuthorizations([
    {
      id: 'auth-aba',
      payerId: 'payer-amil',
      payerName: 'Amil',
      serviceCatalogId: 'service-aba',
      serviceName: 'Sessão ABA individual',
      internalCode: 'ABA',
      tussCodeId: 'tuss-50000470',
      tussCode: '50000470',
      authorizationNumber: 'AUTH-OK',
      validFrom: '2026-06-01',
      validUntil: '2026-06-30',
      authorizedQuantity: 3,
      usedQuantity: 0,
      active: true
    }
  ], '2026-06-15');
  const plan = createPatientFinancialPlan({
    billingMode: 'INSURANCE',
    payerId: 'payer-amil',
    payerNameSnapshot: 'Amil',
    serviceType: 'ABA',
    authorizationCode: 'LEGACY-ONLY'
  });

  assert.equal(findSuggestedTissAuthorizationForFinancialPlan(plan, groups)?.authorizationNumber, 'AUTH-OK');
  assert.match(coordinatorCode, /Dados legados de autorização[\s\S]*Autorização legada do plano/);
  assert.match(coordinatorCode, /Autorização TISS vinculada\/sugerida/);
  assert.match(coordinatorCode, /Adicionar autorização TISS/);
});

test('plano financeiro resolve convênio exibido sem placeholder falso', () => {
  assert.match(coordinatorCode, /const resolveFinancialPlanPayer = \(plan: any\) =>/);
  assert.match(coordinatorCode, /value=\{plan\.payerId \|\| resolvedFinancialPlanPayer\?\.id \|\| ""\}/);
  assert.match(coordinatorCode, /Convênio: \$\{financialPlanPayerDisplayName\}/);
  assert.match(coordinatorCode, /<option value="">Convênio não definido<\/option>/);
  assert.doesNotMatch(coordinatorCode, /<option value="">Pagador\/convênio<\/option>/);
});

test('helpers das Autorizações TISS não entram em temporal dead zone no render', () => {
  const helperIndex = coordinatorCode.indexOf('const normalizeUtf8Text =');
  const componentIndex = coordinatorCode.indexOf('export function CoordinatorDashboard');
  const lookupIndex = coordinatorCode.indexOf('const normalizeLookupText =');
  const authorizationMemoIndex = coordinatorCode.indexOf('const selectedPatientInsurancePayer = useMemo');
  assert.ok(helperIndex >= 0, 'normalizeUtf8Text deve existir.');
  assert.ok(componentIndex >= 0, 'CoordinatorDashboard deve existir.');
  assert.ok(lookupIndex >= 0, 'normalizeLookupText deve existir.');
  assert.ok(authorizationMemoIndex >= 0, 'memo de pagador da autorização deve existir.');
  assert.ok(helperIndex < componentIndex, 'normalizeUtf8Text deve ser helper puro fora do componente.');
  assert.ok(helperIndex < lookupIndex, 'normalizeUtf8Text precisa estar inicializado antes de normalizeLookupText.');
  assert.ok(lookupIndex < authorizationMemoIndex, 'normalizeLookupText precisa ser declarado antes do useMemo.');
});

test('agendamento usa convenio cadastrado do paciente como pagador', () => {
  assert.match(coordinatorCode, /resolvePatientInsurancePayer/);
  assert.match(coordinatorCode, /sessionPayerNameSnapshot/);
  assert.match(coordinatorCode, /Conv.nio do paciente: \{sessionPayerSnapshotOptionLabel\}/);
  assert.match(coordinatorCode, /financialContextType: sessionFinancialContextType/);
  assert.match(coordinatorCode, /payerName: sessionFinancialContextType === "INSURANCE" \? selectedSessionPayerName : (""|null)/);
  assert.match(coordinatorCode, /payerName: sessionFinancialContextType === "INSURANCE" \? selectedSessionPayerName : null[\s\S]{0,220}serviceType: sessionApproach/);
});

test('modal de agendamento nao herda convenio legado quando ha planos ativos ambiguos', () => {
  assert.match(coordinatorCode, /isPreferredPatientInsurancePlan/);
  assert.match(coordinatorCode, /preferredInsurancePlans\.length === 1/);
  assert.match(coordinatorCode, /if \(insurancePlans\.length > 0\) \{/);
  assert.match(coordinatorCode, /payerId: "",\s*payerName: "",\s*insurancePlanName: "",\s*insuranceCardNumber: ""/);
  assert.match(coordinatorCode, /insurancePlanName: String\(insurancePlan\?\.insurancePlanName \|\| ""\)\.trim\(\)/);
  assert.match(coordinatorCode, /insuranceCardNumber: String\(insurancePlan\?\.insuranceCardNumber \|\| ""\)\.trim\(\)/);
  assert.doesNotMatch(coordinatorCode, /insurancePlan\?\.insurancePlanName \|\| insuranceEligibility\.insurancePlanCategory/);
  assert.doesNotMatch(coordinatorCode, /insuranceCardNumber: String\(insuranceEligibility\.insuranceCardNumber \|\| ""\)\.trim\(\),[\s\S]{0,260}planPayerId/);
});

test('modal de agendamento mostra plano e carteirinha somente leitura', () => {
  assert.match(coordinatorCode, /Dados do plano/);
  assert.match(coordinatorCode, /Somente leitura no agendamento/);
  assert.match(coordinatorCode, /Editar dados do convênio no paciente/);
  assert.match(coordinatorCode, /openSelectedSessionPatientInsuranceRegistration/);
  assert.match(coordinatorCode, /formatSessionReadonlyValue\(sessionInsurancePlanName\)/);
  assert.match(coordinatorCode, /formatSessionReadonlyValue\(sessionInsuranceCardNumber\)/);
  assert.match(coordinatorCode, /formatSessionReadonlyValue\(sessionInsuranceHolderName\)/);
  assert.match(coordinatorCode, /formatSessionReadonlyDate\(sessionInsuranceCardValidUntil\)/);
  assert.doesNotMatch(coordinatorCode, /onChange=\{\(e\) => setSessionInsurancePlanName\(e\.target\.value\)\}/);
  assert.doesNotMatch(coordinatorCode, /onChange=\{\(e\) => setSessionInsuranceCardNumber\(e\.target\.value\)\}/);
});

test('cadastro do paciente expõe vínculo convênio com plano carteirinha e principalidade', () => {
  for (const marker of [
    'Fonte oficial para o agendamento quando este convênio for selecionado.',
    'Carteirinha específica deste convênio.',
    'Titular do plano',
    'Validade da carteirinha',
    'Convênio principal/atual',
    'Usado como preferência ao criar novos agendamentos de convênio.',
  ]) {
    assert.ok(coordinatorCode.includes(marker), marker);
  }
  assert.match(coordinatorCode, /value=\{plan\.insuranceCardNumber\}/);
  assert.match(coordinatorCode, /value=\{plan\.insuranceCardHolder\}/);
  assert.match(coordinatorCode, /value=\{plan\.insuranceCardValidUntil\}/);
  assert.match(coordinatorCode, /checked=\{Boolean\(plan\.isPrimaryInsurance\)\}/);
  assert.match(coordinatorCode, /field === "payerId"[\s\S]{0,260}insuranceCardNumber: ""/);
});

test('modal de agendamento deixa data e hora no topo e usa texto leve', () => {
  assert.match(coordinatorCode, /const openNewAppointmentAt = \(date: string, time = "08:00"\)/);
  assert.match(coordinatorCode, /const normalizedClickedTime = \/\^\\d\{2\}:\\d\{2\}\//);
  assert.match(coordinatorCode, /setSessionTime\(normalizedClickedTime\)/);
  assert.match(coordinatorCode, /<p className=\{sessionModalSectionLabelClass\}>Quando<\/p>/);
  assert.match(coordinatorCode, /Hora de início/);
  assert.match(coordinatorCode, /Confirmar agendamento/);
  assert.doesNotMatch(coordinatorCode, /Confirmar Agendamento/);
  assert.doesNotMatch(coordinatorCode, /CONFIRMAR AGENDAMENTO/);
});

test('modal de agendamento explica ausencia de autorizacao utilizavel', () => {
  assert.match(coordinatorCode, /sessionAuthorizationUnavailableInsight/);
  assert.match(coordinatorCode, /Nenhuma autorização utilizável para \$\{payerName\} nesta data\./);
  assert.match(coordinatorCode, /Há autorizações cadastradas para outro convênio/);
  assert.match(coordinatorCode, /fora da validade da sessão/);
  assert.match(coordinatorCode, /procedimento\/TUSS não é compatível/);
  assert.match(coordinatorCode, /sem saldo disponível/);
});

test('persistencia envia campos cadastrais visiveis e planos para backend', () => {
  for (const pattern of [
    /birthDate: resolvedBirthDate/,
    /responsibleName: resolvedGuardian\?\.nome/,
    /patientProfileType: resolvedProfileType/,
    /financialPlans: Array\.isArray\(data\.financialPlans\)/,
    /async savePatientFinancialPlans/
  ]) {
    assert.match(`${appCode}\n${dataServiceCode}`, pattern);
  }
});

test('backend tem endpoints financeiros autenticados, role check e selects explicitos', () => {
  assert.match(serverCode, /const PATIENT_FINANCIAL_PLAN_SELECT = \[/);
  assert.match(serverCode, /app\.get\('\/api\/patients\/:patientId\/financial-plans', checkAuth, requireRoles\('coordinator', 'admin', 'owner'\)/);
  assert.match(serverCode, /app\.put\('\/api\/patients\/:patientId\/financial-plans', portalActionLimiter, checkAuth, requireRoles\('coordinator', 'admin', 'owner'\)/);
  assert.match(serverCode, /persistPatientFinancialPlans\(/);
  assert.match(serverCode, /Pagador fora do escopo da clínica/);
  assert.doesNotMatch(serverCode, /\.select\('\*'\)/);
});

test('migration cria tabela financeira, campos cadastrais e RLS', () => {
  for (const column of [
    'birth_date',
    'responsible_name',
    'patient_profile_type',
    'panel_type',
    'insurance_name'
  ]) {
    assert.match(migrationCode, new RegExp(`add column if not exists ${column}`));
  }
  for (const column of [
    'service_type',
    'billing_mode',
    'payer_id',
    'authorization_code',
    'authorization_valid_until',
    'sessions_quantity',
    'amount_cents',
    'copayment_amount_cents',
    'payment_method',
    'due_day'
  ]) {
    assert.match(migrationCode, new RegExp(column));
  }
  assert.match(migrationCode, /create table if not exists public\.patient_financial_plans/);
  assert.match(migrationCode, /alter table public\.patient_financial_plans enable row level security/);
  assert.match(migrationCode, /u\.role in \('owner', 'admin', 'coordinator'\)/);
  assert.doesNotMatch(migrationCode, /tiss|tuss/i);
});

test('schema fallback lista campos novos como opcionais sem select star', () => {
  assert.match(PATIENT_LIST_SELECT, /patient_profile_type/);
  assert.match(PATIENT_LIST_SELECT, /responsible_name/);
  assert.match(PATIENT_LIST_SELECT, /birth_date/);
  assert.doesNotMatch(PATIENT_LIST_SELECT, /\*/);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

if (failed > 0) {
  process.exitCode = 1;
}
