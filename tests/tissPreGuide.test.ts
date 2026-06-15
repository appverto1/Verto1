import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateTissPreGuideEligibility,
  validateTissPreGuide,
} from '../src/services/tissPreGuideEngine';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const conferenceCode = readFileSync(join(root, 'src/components/MonthlyConferenceCenter.tsx'), 'utf8');
const preGuideUiCode = readFileSync(join(root, 'src/components/TissPreGuideTab.tsx'), 'utf8');
const billingTissSettingsCode = readFileSync(join(root, 'src/components/BillingTissSettingsPanel.tsx'), 'utf8');
const settingsPanelCode = readFileSync(join(root, 'src/components/ClinicGlobalSettingsPanel.tsx'), 'utf8');
const coordinatorCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const migrationCode = readFileSync(join(root, 'supabase/migrations/20260614183000_tiss_pre_guides.sql'), 'utf8');
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
    "app.get('/api/tiss/pre-guides'",
    "app.get('/api/tiss/pre-guides/coverage'",
    "app.post('/api/tiss/pre-guides/revalidate-period'",
    "app.get('/api/tiss/pre-guides/:appointmentId'",
    "app.post('/api/tiss/pre-guides/:appointmentId/revalidate'",
    "app.post('/api/appointments/:appointmentId/tiss-pre-guide/revalidate'",
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

test('frontend oferece cards, paginação, detalhe sob demanda e nenhuma ação de XML', () => {
  assert.match(conferenceCode, /"preGuides", "Pré-guias TISS"/);
  assert.match(conferenceCode, /<TissPreGuideTab/);
  for (const label of [
    'Pré-guias válidas',
    'Pendentes',
    'Não aplicáveis',
    'Sem dados do prestador',
    'Sem dados do pagador',
    'Sem registro profissional',
    'Sem CBO',
    'Sem TUSS',
    'Sem guia/autorização',
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
  assert.match(preGuideUiCode, /Cadastro global do prestador/);
  assert.match(preGuideUiCode, /Cadastro global do pagador/);
  assert.match(preGuideUiCode, /Cadastro global do profissional/);
  assert.match(preGuideUiCode, /Salvar cadastro global e revalidar pré-guia atual/);
  assert.match(preGuideUiCode, /Você está editando o perfil faturável global da clínica/);
  assert.match(preGuideUiCode, /Você está editando o perfil TISS global deste pagador/);
  assert.match(preGuideUiCode, /Você está editando o perfil faturável global deste profissional/);
  assert.match(preGuideUiCode, /Esta é uma pré-guia para validação interna\. XML TISS ainda não foi gerado\./);
  assert.match(preGuideUiCode, /sticky top-0 z-20/);
  assert.match(preGuideUiCode, /snapshot\.provider\?\.tradeName/);
  assert.doesNotMatch(preGuideUiCode, /snapshot\.provider\?\.tradeName \|\| detail\.clinicName/);
  assert.match(preGuideUiCode, /<ActiveFilterBanner/);
  assert.match(preGuideUiCode, /missingPreGuides/);
  assert.match(preGuideUiCode, /stalePreGuides/);
  assert.match(preGuideUiCode, /Gerar\/Revalidar pendentes/);
  assert.match(preGuideUiCode, /Nenhum atendimento eleg/);
  assert.doesNotMatch(preGuideUiCode, /Gerar XML|Enviar lote|Enviar remessa|Registrar glosa/i);
});

test('data service usa operações explícitas e o pacote expõe suíte dedicada', () => {
  for (const helper of [
    'getTissPreGuides',
    'getTissPreGuideCoverage',
    'getTissPreGuide',
    'revalidateTissPreGuide',
    'revalidateTissPreGuidePeriod',
    'getClinicTissProfile',
    'updateClinicTissProfile',
    'getPayerTissProfile',
    'getPayerTissProfiles',
    'updatePayerTissProfile',
    'getProfessionalBillingProfile',
    'getProfessionalBillingProfiles',
    'updateProfessionalBillingProfile',
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
