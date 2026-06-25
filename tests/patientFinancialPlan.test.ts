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
  findSuggestedTissAuthorizationForFinancialPlan,
  getPatientTissAuthorizationVisualState,
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
    'Use esta seção para cadastrar as senhas/guias autorizadas pelo convênio. Esses dados são usados na Pré-guia TISS e no XML quando aplicável.',
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
    'Nenhuma autorização vigente para este procedimento',
    'Histórico / inativas deste procedimento',
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
