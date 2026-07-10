import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluatePayerRequirementsForClosure,
  resolvePayerRequirements
} from '../src/services/payerRequirementEngine';
import { evaluateAppointmentClosureReadiness } from '../src/services/closureReadinessEngine';
import {
  formatCentsForBrazilianInput,
  getPayerSetupReadiness,
  getBillingConfigurationCompletionState,
  isLegacyOrInvalidTussCodeForSetup,
  isBillingConfigurationOperational,
  parseBrazilianCurrencyToCents,
} from '../src/components/PayerRequirementsPanel';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const closureCenterCode = readFileSync(join(root, 'src/components/OperationalClosureCenter.tsx'), 'utf8');
const calendarCode = readFileSync(join(root, 'src/components/Calendar.tsx'), 'utf8');
const coordinatorCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const adminDashboardCode = readFileSync(join(root, 'src/components/AdminDashboard.tsx'), 'utf8');
const therapistDashboardCode = readFileSync(join(root, 'src/components/TherapistDashboard.tsx'), 'utf8');
const receptionistDashboardCode = readFileSync(join(root, 'src/components/ReceptionistDashboard.tsx'), 'utf8');
const payerPanelCode = readFileSync(join(root, 'src/components/PayerRequirementsPanel.tsx'), 'utf8');
const migrationCode = readFileSync(join(root, 'supabase/migrations/20260529123000_payer_requirements_prefacturing.sql'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

const rules = [
  {
    id: 'general-rule',
    service_type: null,
    require_signature: true,
    require_report: true,
    require_actual_duration: true,
    require_authorization: false,
    require_guide: true,
    min_duration_minutes: 30,
    allow_manual_override: true,
    is_active: true
  },
  {
    id: 'aba-rule',
    service_type: 'ABA',
    require_signature: true,
    require_report: true,
    require_actual_duration: true,
    require_authorization: true,
    require_guide: true,
    min_duration_minutes: 45,
    allow_manual_override: false,
    is_active: true
  }
];

test('regra específica por service_type sobrepõe regra geral', () => {
  const result = resolvePayerRequirements({ payerId: 'payer-1', serviceType: 'ABA', rules });
  assert.equal(result.source, 'SPECIFIC');
  assert.equal(result.appliedRuleId, 'aba-rule');
  assert.equal(result.requireAuthorization, true);
  assert.equal(result.minDurationMinutes, 45);
});

test('regra geral aplica quando não há específica e default aplica sem pagador/regra', () => {
  const general = resolvePayerRequirements({ payerId: 'payer-1', serviceType: 'Fono', rules });
  assert.equal(general.source, 'GENERAL');
  assert.equal(general.appliedRuleId, 'general-rule');
  assert.equal(general.requireGuide, true);

  const fallback = resolvePayerRequirements({ payerId: null, serviceType: null, rules: [] });
  assert.equal(fallback.source, 'DEFAULT');
  assert.equal(fallback.requireSignature, true);
  assert.equal(fallback.requireGuide, false);
});

test('engine gera pendências humanas para assinatura, relatório, guia e duração mínima', () => {
  const requirements = resolvePayerRequirements({ payerId: 'payer-1', serviceType: 'ABA', rules });
  const result = evaluatePayerRequirementsForClosure({
    requirements,
    context: {
      hasSignature: false,
      hasReport: false,
      actualMinutes: 40,
      authorizationCode: '',
      guideNumber: ''
    }
  });
  assert.ok(result.checklistItems.some((item) => item.key === 'payer_authorization_required' && item.status === 'FAILED'));
  assert.ok(result.checklistItems.some((item) => item.key === 'payer_guide_required' && item.status === 'FAILED'));
  assert.ok(result.checklistItems.some((item) => item.key === 'payer_min_duration' && item.status === 'FAILED'));

  const closure = evaluateAppointmentClosureReadiness({
    organizationId: 'org-1',
    appointmentId: 'appointment-1',
    patientId: 'patient-1',
    now: '2026-05-29T12:00:00.000Z',
    appointment: {
      patient_id: 'patient-1',
      therapist_id: 'professional-1',
      service_type: 'ABA',
      status: 'completed',
      scheduled_start_at: '2026-05-29T09:00:00.000Z',
      scheduled_end_at: '2026-05-29T09:50:00.000Z',
      scheduled_duration_minutes: 50,
      actual_start_at: '2026-05-29T09:00:00.000Z',
      actual_end_at: '2026-05-29T09:40:00.000Z',
      actual_duration_minutes: 40,
      authorization_code: '',
      guide_number: '',
      required_documents: [{ status: 'PENDING', document_type: 'GUIDE' }]
    },
    sessionSummary: { session_note: '', duration_seconds: 2400 },
    signature: false,
    requirements: {
      requireSignature: true,
      requireReport: true,
      requireActualDuration: true,
      requireAuthorization: true,
      requireGuide: true,
      minDurationMinutes: 45,
      allowManualOverride: false,
      payerName: 'Convênio A',
      payerRequirementSource: 'SPECIFIC',
      appliedPayerRequirementId: 'aba-rule'
    }
  });
  assert.equal(closure.readinessStatus, 'PENDING');
  assert.ok(closure.checklist.some((item) => item.key === 'payer_authorization_required' && item.status === 'FAILED'));
  assert.ok(closure.checklist.some((item) => item.key === 'payer_guide_required' && item.status === 'FAILED'));
  assert.ok(!closure.checklist.some((item) => item.key === 'authorization_linked'));
  assert.ok(closure.checklist.some((item) => item.key === 'required_documents_status' && item.status === 'FAILED'));
});

test('migration cria tabelas, índices e RLS de pagadores/documentos', () => {
  for (const table of [
    'clinic_payers',
    'clinic_payer_requirements',
    'appointment_billing_contexts',
    'appointment_required_documents',
    'payer_requirement_audit_logs'
  ]) {
    assert.match(migrationCode, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migrationCode, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migrationCode, /idx_clinic_payer_requirements_scope/);
  assert.match(migrationCode, /idx_appointment_billing_contexts_appointment/);
  assert.match(migrationCode, /required_document_pending_count/);
});

test('endpoints são autenticados, têm role check, rate limit e selects explícitos', () => {
  for (const marker of [
    "app.get('/api/admin/payers'",
    "app.post('/api/admin/payers'",
    "app.patch('/api/admin/payers/:payerId'",
    "app.get('/api/admin/payers/:payerId/requirements'",
    "app.post('/api/admin/payers/:payerId/requirements'",
    "app.patch('/api/admin/payer-requirements/:requirementId'",
    "app.get('/api/appointments/:appointmentId/billing-context'",
    "app.patch('/api/appointments/:appointmentId/billing-context'",
    "app.post('/api/appointments/:appointmentId/required-documents/:documentId/waive'"
  ]) {
    const index = serverCode.indexOf(marker);
    assert.ok(index >= 0, `${marker} deve existir.`);
    const signature = serverCode.slice(index, index + 360);
    assert.match(signature, /checkAuth/, `${marker} deve exigir autenticação.`);
  }
  assert.match(serverCode, /requireRoles\('coordinator', 'admin', 'owner'\)/);
  assert.match(serverCode, /portalActionLimiter, checkAuth, requireRoles\('coordinator', 'admin', 'owner'\)/);
  assert.match(serverCode, /const CLINIC_PAYER_SELECT = \[/);
  assert.match(serverCode, /const APPOINTMENT_BILLING_CONTEXT_SELECT = \[/);
  assert.match(serverCode, /fetchAppointmentForBillingContext/);
  assert.doesNotMatch(serverCode, /\.select\('\*'\)/);
});

test('UI expõe configuração, agenda e fechamento sem IDs técnicos ou HTML perigoso', () => {
  assert.match(dataServiceCode, /async getPayers/);
  assert.match(dataServiceCode, /async updateAppointmentBillingContext/);
  assert.match(coordinatorCode, /PayerRequirementsPanel/);
  assert.match(coordinatorCode, /payers:\s*"clinic-settings"/);
  assert.match(coordinatorCode, /payers:\s*"Convênios"/);
  const navigationSection = coordinatorCode.slice(
    coordinatorCode.indexOf('const navigationGroups'),
    coordinatorCode.indexOf('const filterNavigationNode'),
  );
  assert.match(navigationSection, /id:\s*"care-root"[\s\S]*label:\s*"Atendimento"/);
  assert.match(navigationSection, /id:\s*"tiss-root"[\s\S]*label:\s*"Convênios e TISS"/);
  assert.match(navigationSection, /id:\s*"payer-convenios"[\s\S]*label:\s*"Convênios"/);
  assert.match(navigationSection, /id:\s*"patient-authorizations"[\s\S]*label:\s*"Autorizações dos pacientes"/);
  assert.match(navigationSection, /aliases:\s*\[[\s\S]*id:\s*"payer-tuss"[\s\S]*label:\s*"De\/Para TUSS"/);
  assert.match(navigationSection, /aliases:\s*\[[\s\S]*id:\s*"payer-prices"[\s\S]*label:\s*"Tabela de valores"/);
  assert.match(navigationSection, /aliases:\s*\[[\s\S]*id:\s*"payer-rules"[\s\S]*label:\s*"Regras TISS"/);
  assert.doesNotMatch(navigationSection, /\{\s*id:\s*"payer-tuss",\s*label:\s*"De\/Para TUSS",\s*icon:/);
  assert.doesNotMatch(navigationSection, /\{\s*id:\s*"payer-prices",\s*label:\s*"Tabela de valores",\s*icon:/);
  assert.doesNotMatch(navigationSection, /\{\s*id:\s*"payer-rules",\s*label:\s*"Regras TISS",\s*icon:/);
  assert.doesNotMatch(navigationSection, /Convênios e Faturamento/);
  assert.match(navigationSection, /id:\s*"prebilling-root"[\s\S]*label:\s*"Pré-faturamento TISS"/);
  assert.match(navigationSection, /id:\s*"prebilling-preguides"[\s\S]*label:\s*"Pré-guias TISS"/);
  assert.match(navigationSection, /aliases:\s*\[[\s\S]*id:\s*"prebilling-conference"[\s\S]*label:\s*"Conferência"/);
  assert.match(navigationSection, /aliases:\s*\[[\s\S]*id:\s*"prebilling-pending"[\s\S]*label:\s*"Pendências"/);
  assert.doesNotMatch(navigationSection, /\{\s*id:\s*"prebilling-conference",\s*label:\s*"Conferência",\s*icon:/);
  assert.doesNotMatch(navigationSection, /\{\s*id:\s*"prebilling-pending",\s*label:\s*"Pendências",\s*icon:/);
  assert.match(navigationSection, /id:\s*"prebilling-batches"[\s\S]*label:\s*"Lotes XML"/);
  assert.match(navigationSection, /id:\s*"finance-root"[\s\S]*label:\s*"Financeiro"/);
  assert.match(navigationSection, /id:\s*"finance-dashboard"[\s\S]*label:\s*"Dashboard financeiro"[\s\S]*intent:\s*financialIntent\("Dashboard financeiro"\)/);
  assert.match(navigationSection, /aliases:\s*\[[\s\S]*id:\s*"finance-clinic-internal"[\s\S]*label:\s*"Financeiro da clínica"/);
  assert.match(navigationSection, /aliases:\s*\[[\s\S]*id:\s*"finance-overview"[\s\S]*label:\s*"Visão geral da clínica"/);
  assert.match(navigationSection, /id:\s*"clinical-revenue"[\s\S]*label:\s*"Receitas"[\s\S]*intent:\s*financialIntent\("Receitas"\)/);
  assert.match(navigationSection, /id:\s*"clinical-expenses"[\s\S]*label:\s*"Despesas"[\s\S]*intent:\s*financialIntent\("Despesas"\)/);
  assert.match(navigationSection, /id:\s*"clinical-cashflow"[\s\S]*label:\s*"Fluxo de caixa"[\s\S]*intent:\s*financialIntent\("Fluxo de caixa"\)/);
  assert.match(navigationSection, /id:\s*"clinical-payers"[\s\S]*label:\s*"Convênios e lotes"[\s\S]*tab:\s*"financial"[\s\S]*financialIntent\("Convênios e lotes"\)/);
  const financialPayerLotsNode = navigationSection.slice(
    navigationSection.indexOf('id: "clinical-payers"'),
    navigationSection.indexOf('id: "finance-patient-operations"'),
  );
  assert.match(financialPayerLotsNode, /tab:\s*"financial"/);
  assert.doesNotMatch(financialPayerLotsNode, /conferenceIntent|Lotes XML/);
  const tissLotsNode = navigationSection.slice(
    navigationSection.indexOf('id: "prebilling-batches"'),
    navigationSection.indexOf('id: "finance-root"'),
  );
  assert.match(tissLotsNode, /tab:\s*"conference"/);
  assert.match(tissLotsNode, /conferenceIntent\("Lotes XML"/);
  assert.doesNotMatch(tissLotsNode, /financialIntent\("Convênios e lotes"/);
  assert.doesNotMatch(navigationSection, /id:\s*"report-payers"/);
  assert.match(navigationSection, /id:\s*"finance-patient-operations"[\s\S]*label:\s*"Financeiro de pacientes"/);
  assert.match(navigationSection, /id:\s*"clinical-transfers"[\s\S]*label:\s*"Repasses a profissionais"/);
  assert.match(navigationSection, /id:\s*"patient-receivables"[\s\S]*label:\s*"Recebimentos de pacientes"/);
  assert.match(navigationSection, /id:\s*"finance-reports"[\s\S]*label:\s*"Relatórios"/);
  assert.match(navigationSection, /id:\s*"settings-root"[\s\S]*label:\s*"Configurações"/);
  assert.match(coordinatorCode, /expandedNavigationSections/);
  assert.match(coordinatorCode, /financialNavigationContext\.breadcrumb\.join\(" > "\)/);
  assert.match(coordinatorCode, /item\.aliases\?\.some/);
  assert.match(coordinatorCode, /data-financial-clinic-internal-nav/);
  assert.match(coordinatorCode, /data-financial-revenue-view/);
  assert.match(coordinatorCode, /data-financial-expenses-view/);
  assert.match(coordinatorCode, /data-financial-cashflow-view/);
  assert.match(coordinatorCode, /data-financial-payer-lots-view/);
  const financialSection = coordinatorCode.slice(
    coordinatorCode.indexOf('activeTab === "financial"'),
    coordinatorCode.indexOf('activeTab === "flow"'),
  );
  assert.match(financialSection, /navigateToTab\("payers", payerIntent\("convenios", "Convênios"\)\)/);
  assert.match(financialSection, /<KeyRound size=\{18\} \/> Convênios/);
  assert.match(coordinatorCode, /activeTab === "payers"[\s\S]*?<PayerRequirementsPanel[\s\S]*initialSection=\{financialNavigationContext\.payerSection\}/);
  assert.match(coordinatorCode, /activeTab === "patientAuthorizations"[\s\S]*Autorizações dos pacientes/);
  assert.match(coordinatorCode, /dataService\.getPatientTissAuthorizationsOverview/);
  assert.match(dataServiceCode, /async getPatientTissAuthorizationsOverview/);
  assert.match(serverCode, /app\.get\('\/api\/patients\/tiss-authorizations'/);
  assert.match(serverCode, /hydratePatientPayerAuthorizations/);
  assert.match(coordinatorCode, /activeTab === "conference"[\s\S]*?<MonthlyConferenceCenter[\s\S]*initialTab=\{financialNavigationContext\.conferenceTab\}/);
  assert.match(coordinatorCode, /tissInitialPanel=\{financialNavigationContext\.tissPanel\}/);
  assert.match(payerPanelCode, /Configuração de Convênios/);
  assert.match(payerPanelCode, /Cadastro avançado de operadoras/);
  assert.match(payerPanelCode, /Adicionar convênio/);
  assert.match(payerPanelCode, /Nenhum convênio configurado/);
  assert.match(payerPanelCode, /Tentar novamente/);
  assert.match(payerPanelCode, /De\/Para TUSS por Convênio/);
  assert.match(payerPanelCode, /Tabela de procedimentos e valores/);
  assert.match(payerPanelCode, /Sincronizar autorizações e Pré-guias afetadas/);
  assert.match(payerPanelCode, /Confirmar sincronização/);
  assert.match(payerPanelCode, /dataService\.syncPayerTussMappingAuthorizations/);
  assert.match(dataServiceCode, /async syncPayerTussMappingAuthorizations/);
  assert.match(serverCode, /\/api\/admin\/tuss\/mappings\/:mappingId\/sync-authorizations/);
  assert.match(payerPanelCode, /Dados da operadora/);
  assert.match(payerPanelCode, /Dados do prestador no convênio/);
  assert.match(payerPanelCode, /Exigências anti-glosa da operadora/);
  assert.match(payerPanelCode, /Status da configura/);
  assert.match(payerPanelCode, /Revisei as exig/);
  assert.match(payerPanelCode, /Esta operadora n/);
  assert.match(payerPanelCode, /Perfil anti-glosa ainda n/);
  assert.match(payerPanelCode, /Contatos e observações administrativas/);
  assert.match(coordinatorCode, /Pagador e conferência/);
  assert.match(calendarCode, /billingContext/);
  assert.match(calendarCode, /Editar pagador/);
  assert.match(closureCenterCode, /Regras do pagador/);
  assert.match(closureCenterCode, /Sem guia/);
  assert.doesNotMatch(coordinatorCode, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(calendarCode, /PostgREST|Railway|Supabase/i);
  assert.doesNotMatch(closureCenterCode, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});

test('sidebar expande apenas por clique, persiste preferencia e usa cor principal unica', () => {
  for (const code of [coordinatorCode, adminDashboardCode, therapistDashboardCode, receptionistDashboardCode]) {
    assert.doesNotMatch(code, /onMouseEnter=\{\(\) => setIsSidebarExpanded\(true\)\}/);
    assert.doesNotMatch(code, /onMouseLeave=\{\(\) => setIsSidebarExpanded\(false\)\}/);
    assert.match(code, /Recolher menu lateral/);
    assert.match(code, /Expandir menu lateral/);
    assert.match(code, /localStorage\.setItem\([^,]+,\s*expanded \? ['"]true['"] : ['"]false['"]\)/);
  }

  assert.match(coordinatorCode, /COORDINATOR_SIDEBAR_PREFERENCE_KEY/);
  assert.match(coordinatorCode, /space-y-5/);
  assert.match(coordinatorCode, /border-t border-slate-100 pt-4/);
  assert.match(coordinatorCode, /text-\[#7a32fc\] bg-violet-50/);
  assert.doesNotMatch(coordinatorCode, /bg-amber-400 px-1\.5 py-0\.5 text-\[8px\]/);
});

test('Tabela de Valores tem rotulos permanentes, reais no formulario e configuracao consolidada', () => {
  assert.equal(formatCentsForBrazilianInput(12000), '120,00');
  assert.equal(formatCentsForBrazilianInput(null), '');
  assert.equal(parseBrazilianCurrencyToCents('120,00'), 12000);
  assert.equal(parseBrazilianCurrencyToCents('120.00'), 12000);
  assert.equal(parseBrazilianCurrencyToCents('R$ 120,00'), 12000);
  assert.equal(parseBrazilianCurrencyToCents(''), null);
  assert.equal(parseBrazilianCurrencyToCents('120,001'), null);

  for (const marker of [
    'htmlFor="payer-price-service"',
    'htmlFor="payer-price-tuss"',
    'htmlFor="payer-price-amount"',
    'htmlFor="payer-price-source"',
    'htmlFor="payer-price-mapping"',
    'htmlFor="payer-price-valid-from"',
    'htmlFor="payer-price-valid-until"',
    'htmlFor="payer-price-notes"',
    'Valor negociado (R$)',
    'Origem do valor',
    'Vínculo De/Para',
    'Início da vigência',
    'Fim da vigência',
    'Observações',
  ]) {
    assert.ok(payerPanelCode.includes(marker), marker);
  }

  assert.match(payerPanelCode, /Configurações ativas deste convênio/);
  assert.match(payerPanelCode, /Histórico e configurações inativas/);
  assert.match(payerPanelCode, /Cadastros de apoio/);
  assert.match(payerPanelCode, /Esses cadastros são referências usadas nas configurações de faturamento/);
  assert.match(payerPanelCode, /Mapeamento por pagador/);
  assert.match(payerPanelCode, /O De\/Para define o vínculo contratual/);
  for (const marker of [
    'htmlFor="payer-mapping-service"',
    'htmlFor="payer-mapping-tuss-code"',
    'htmlFor="payer-mapping-contract-code"',
    'htmlFor="payer-mapping-contract-description"',
    'htmlFor="payer-mapping-guide-type"',
    'htmlFor="payer-mapping-billing-unit"',
    'htmlFor="payer-mapping-quantity-rule"',
    'htmlFor="payer-mapping-default-quantity"',
    'htmlFor="payer-mapping-valid-from"',
    'htmlFor="payer-mapping-valid-to"',
    'htmlFor="payer-mapping-duration"',
    'htmlFor="payer-mapping-source"',
    'htmlFor="payer-mapping-notes"',
    'Dados financeiros legados do De/Para',
    'O preço utilizado atualmente vem de Valores negociados',
  ]) {
    assert.ok(payerPanelCode.includes(marker), marker);
  }
  assert.match(payerPanelCode, /supportFormOpen && supportFormTarget/);
  assert.match(payerPanelCode, /supportCatalogOpen \? \(/);
  assert.match(payerPanelCode, /openSupportForm\("service"\)/);
  assert.match(payerPanelCode, /openSupportForm\("code"\)/);
  assert.match(payerPanelCode, /startNewSupportForm\("service"\)/);
  assert.match(payerPanelCode, /startNewSupportForm\("code"\)/);
  assert.match(payerPanelCode, /supportFormTarget === "service"/);
  assert.match(payerPanelCode, /supportFormTarget === "code"/);
  assert.match(payerPanelCode, /Editando procedimento interno/);
  assert.match(payerPanelCode, /Editando código TUSS/);
  assert.match(payerPanelCode, /Novo procedimento interno/);
  assert.match(payerPanelCode, /Novo código TUSS/);
  assert.ok((payerPanelCode.match(/primaryLabel="Salvar alterações"/g) || []).length >= 2);
  assert.match(payerPanelCode, /reactivateTussService/);
  assert.match(payerPanelCode, /reactivateTussCode/);
  assert.match(payerPanelCode, /Deseja reativar este procedimento/);
  assert.match(payerPanelCode, /Procedimento reativado com sucesso/);
  assert.match(payerPanelCode, /dataService\.updateTussService\(serviceId, \{ active \}\)/);
  assert.match(payerPanelCode, /dataService\.updateTussCode\(codeId, \{ active \}\)/);
  assert.match(payerPanelCode, /supportActionKey/);
  assert.match(payerPanelCode, /supportActionInFlightRef/);
  assert.match(payerPanelCode, /aria-label=\{`Reativar procedimento/);
  assert.match(payerPanelCode, /aria-label=\{`Reativar código TUSS/);
  assert.match(payerPanelCode, /Procedimento inativo/);
  assert.match(payerPanelCode, /De\/Para ausente/);
  assert.match(payerPanelCode, /Valor ausente/);
  assert.match(payerPanelCode, /procedurePriceSaveInFlightRef/);
  assert.match(payerPanelCode, /parseBrazilianCurrencyToCents\(procedurePriceForm\.amountCents\)/);
  assert.doesNotMatch(payerPanelCode, /parseBrazilianCurrencyToCents\(tussMappingForm/);
  assert.match(serverCode, /amount_cents:\s*null/);
  assert.match(serverCode, /negotiated_amount_cents:\s*null/);
  assert.match(serverCode, /TUSS_MAPPING_GUIDE_TYPE_UNSUPPORTED/);
  assert.doesNotMatch(payerPanelCode, /placeholder="Valor negociado em centavos"/);
});

test('configuracoes de faturamento separam operacionais de historicas e usam acoes contextuais', () => {
  const activePart = { active: true };
  const inactivePart = { active: false };
  assert.equal(isBillingConfigurationOperational({ service: activePart, code: activePart, mapping: activePart, price: activePart }), true);
  assert.equal(isBillingConfigurationOperational({ service: inactivePart, code: activePart, mapping: activePart, price: activePart }), false);
  assert.equal(isBillingConfigurationOperational({ service: activePart, code: inactivePart, mapping: activePart, price: activePart }), false);
  assert.equal(isBillingConfigurationOperational({ service: activePart, code: activePart, mapping: inactivePart, price: activePart }), false);
  assert.equal(isBillingConfigurationOperational({ service: activePart, code: activePart, mapping: activePart, price: inactivePart }), false);
  assert.equal(isBillingConfigurationOperational({ service: activePart, code: activePart, mapping: activePart, price: null }), false);
  assert.equal(getBillingConfigurationCompletionState({ service: activePart, code: activePart, mapping: activePart, price: activePart }), 'active');
  assert.equal(getBillingConfigurationCompletionState({ service: activePart, code: activePart, mapping: activePart, price: null }), 'awaiting_price');
  assert.equal(getBillingConfigurationCompletionState({ service: activePart, code: activePart, mapping: activePart, price: inactivePart }), 'awaiting_price');
  assert.equal(getBillingConfigurationCompletionState({ service: inactivePart, code: activePart, mapping: activePart, price: activePart }), 'inactive');

  for (const marker of [
    'Configurações ativas deste convênio',
    'Usadas para novas Pré-guias, autorizações e geração de XML.',
    'Configurações incompletas',
    'De/Para já salvo aguardando valor negociado. Ainda não é usado em novas Pré-guias.',
    'Histórico e configurações inativas',
    'Registros preservados para histórico. Não são usados em novas Pré-guias enquanto estiverem inativos.',
    'Pronta para novas Pré-guias',
    'De/Para configurado',
    'Preço pendente',
    'Próximo passo: cadastrar valor negociado.',
    'Configuração inativa',
    'Nenhuma configuração ativa para este convênio.',
    'Crie ou reative os cadastros necessários para faturar novas sessões.',
    'Novo procedimento interno',
    'Novo código TUSS',
    'Novo De/Para',
    'Novo valor negociado',
    'Cadastrar valor negociado',
  ]) assert.ok(payerPanelCode.includes(marker), marker);

  const cardStart = payerPanelCode.indexOf('const renderBillingConfigurationCard =');
  const renderStart = payerPanelCode.indexOf('  return (', cardStart);
  const cardEnd = payerPanelCode.indexOf('\n  return (', renderStart + 1);
  const cardCode = payerPanelCode.slice(cardStart, cardEnd);
  assert.match(cardCode, /isOperational && mapping[^\n]+Revalidar atendimentos afetados/);
  assert.match(cardCode, /isOperational && mapping[^\n]+Sincronizar autorizações e Pré-guias/);
  assert.match(cardCode, /!isOperational && !isAwaitingPrice && service\?\.active === false[^\n]+Reativar procedimento/);
  assert.match(cardCode, /!isOperational && !isAwaitingPrice && code\?\.active === false[^\n]+Reativar código TUSS/);
  assert.match(cardCode, /!isOperational && !isAwaitingPrice && mapping\?\.active === false[^\n]+Reativar De\/Para/);
  assert.match(cardCode, /!isOperational && !isAwaitingPrice && price\?\.active === false[^\n]+Reativar preço/);
  assert.match(cardCode, /\(isOperational \|\| isAwaitingPrice\) && mapping \? <button[^\n]+Editar De\/Para/);
  assert.match(cardCode, /isOperational && price \? <button[^\n]+Editar valor/);
  assert.match(cardCode, /isAwaitingPrice && mapping \? <button[^\n]+Cadastrar valor negociado/);
  assert.doesNotMatch(cardCode, /!isOperational[^\n]+Revalidar atendimentos afetados/);
  assert.doesNotMatch(cardCode, /!isOperational[^\n]+Sincronizar autorizações e Pré-guias/);
  assert.doesNotMatch(cardCode, /isAwaitingPrice[^\n]+Revalidar atendimentos afetados/);
  assert.doesNotMatch(cardCode, /isAwaitingPrice[^\n]+Sincronizar autorizações e Pré-guias/);

  const serviceCreate = payerPanelCode.slice(
    payerPanelCode.indexOf('const createTussService = async'),
    payerPanelCode.indexOf('const createTussCode = async'),
  );
  const codeCreate = payerPanelCode.slice(
    payerPanelCode.indexOf('const createTussCode = async'),
    payerPanelCode.indexOf('const createTussMapping = async'),
  );
  assert.doesNotMatch(serviceCreate, /createPayerTussMapping|createPayerProcedurePrice/);
  assert.doesNotMatch(codeCreate, /createPayerTussMapping|createPayerProcedurePrice/);
});

test('modal de exclusao traduz dependencias tecnicas sem renderizar chaves cruas', () => {
  for (const label of [
    'Preços vinculados',
    'Itens de faturamento',
    'Pré-guias',
    'XMLs oficiais',
    'Autorizações',
    'Vínculo histórico não confirmado',
  ]) assert.ok(payerPanelCode.includes(label), label);
  assert.match(payerPanelCode, /deleteDependencyLabels\[key\] \|\| "Vínculo histórico"/);
  assert.doesNotMatch(payerPanelCode, /<p className="text-xs text-slate-500">\{key\}<\/p>/);
});

test('Dados TISS da operadora tem rotulos permanentes e versao oficial automatica', () => {
  for (const marker of [
    'htmlFor={id}',
    'id="payer-ans-registration"',
    'id="payer-operator-code"',
    'id="payer-operator-document"',
    'id="payer-default-guide-type"',
    'id="payer-beneficiary-identification"',
    'id="payer-contracted-provider-code"',
    'id="payer-contracted-executant"',
    'id="payer-operator-provider-code"',
    'id="payer-default-attendance-type"',
    'id="payer-default-attendance-regime"',
    'id="payer-default-attendance-character"',
    'id="payer-auditor-contact"',
    'id="payer-billing-email"',
    'id="payer-billing-phone"',
    'id="payer-operator-portal"',
    'id="payer-administrative-notes"',
    'id="payer-specific-rules"',
    'Registro ANS da operadora',
    'Código da operadora',
    'CNPJ da operadora',
    'Código do prestador na operadora',
    'Nome do prestador no contrato',
    'Versão do XML TISS',
    'Gerenciada automaticamente pela Verto',
    'OFFICIAL_TISS_XML_STRATEGY.communicationVersion',
    'attendanceTypes040300.map',
    'attendanceRegimes040300.map',
    'attendanceCharacters040300.map',
    'guideTypes040300.map',
    'Legado inválido',
    'Configuração do convênio para TISS',
    'Exigências anti-glosa da operadora',
    'Status da configuração anti-glosa',
    'Revisei as exigências anti-glosa desta operadora',
    'Esta operadora não possui exigências adicionais',
    'Exceções por serviço',
    'A exceção substitui a regra geral apenas para este serviço',
  ]) {
    assert.ok(payerPanelCode.includes(marker), marker);
  }

  assert.doesNotMatch(payerPanelCode, /updatePayerTiss\("tissVersion"/);
  assert.doesNotMatch(payerPanelCode, /placeholder="Versão TISS configurada"/);
  assert.doesNotMatch(payerPanelCode, /placeholder="Ex\.: 03"/);
  assert.doesNotMatch(payerPanelCode, /placeholder="Ex\.: 01"/);
  assert.doesNotMatch(payerPanelCode, /Versão TISS não configurada/);
});

test('CRUD seguro de cadastros de apoio, De/Para e valores tem impacto de exclusao e acoes isoladas', () => {
  for (const marker of [
    'type PayerCrudEntityType = "requirement" | "service" | "code" | "mapping" | "price"',
    'SectionFeedbackMessage',
    'activeEditingSection',
    'beginEditingSection("service")',
    'beginEditingSection("code")',
    'beginEditingSection("mapping")',
    'beginEditingSection("price")',
    'Editar De/Para',
    'Editar valor',
    'Mais ações',
    'De/Para inativo',
    'Preço inativo',
    'Excluir De/Para',
    'Excluir preço',
    'Reativar De/Para',
    'Reativar preço',
    'Excluir definitivamente',
    'Inativar cadastro',
    'keep_inactive',
    'getPayerRequirementDeleteImpact',
    'deletePayerRequirement',
    'getTussDeleteImpact',
    'deleteTussEntity',
  ]) {
    assert.ok(payerPanelCode.includes(marker) || dataServiceCode.includes(marker), marker);
  }

  assert.match(payerPanelCode, /Este cadastro possui vínculos históricos e não pode ser excluído/);
  assert.doesNotMatch(payerPanelCode, /Editar configuração/);
  assert.match(payerPanelCode, /De\/Para configurado/);
  assert.match(payerPanelCode, /isAwaitingPrice \? "De\/Para configurado"/);
  assert.match(payerPanelCode, /openDeleteImpactModal\("requirement"/);
  assert.match(payerPanelCode, /openDeleteImpactModal\("service"/);
  assert.match(payerPanelCode, /openDeleteImpactModal\("code"/);
  assert.match(payerPanelCode, /openDeleteImpactModal\("mapping"/);
  assert.match(payerPanelCode, /openDeleteImpactModal\("price"/);
  assert.match(serverCode, /buildRequirementDeleteImpact/);
  assert.match(serverCode, /buildTussDeleteImpact/);
  assert.match(serverCode, /app\.get\('\/api\/admin\/payer-requirements\/:requirementId\/delete-impact'/);
  assert.match(serverCode, /app\.delete\('\/api\/admin\/payer-requirements\/:requirementId'/);
  assert.match(serverCode, /app\.get\('\/api\/admin\/tuss\/:entityType\/:entityId\/delete-impact'/);
  assert.match(serverCode, /app\.delete\('\/api\/admin\/tuss\/:entityType\/:entityId'/);
  assert.match(serverCode, /PAYER_REQUIREMENT_DELETE_BLOCKED/);
  assert.match(serverCode, /TUSS_DELETE_BLOCKED_BY_DEPENDENCIES/);
  assert.match(serverCode, /const TUSS_ENTITY_CONFIG = \{/);
  assert.match(serverCode, /prices:\s*\{[\s\S]*table:\s*'payer_procedure_prices'[\s\S]*validToColumn:\s*'valid_until'/);
  assert.match(serverCode, /mappings:\s*\{[\s\S]*table:\s*'payer_tuss_mappings'[\s\S]*validToColumn:\s*'valid_to'/);
  assert.match(serverCode, /activeColumn:\s*'active'/);
  assert.match(serverCode, /INVALID_TUSS_DELETE_ENTITY_TYPE/);
  assert.match(serverCode, /TUSS_DELETE_IMPACT_QUERY_FAILED/);
  assert.match(serverCode, /logTussDeleteFailure\('\[TussReady\] delete impact failed'/);
  assert.match(serverCode, /recommendedAction:\s*impact\.recommendedAction/);
  assert.match(serverCode, /function safeJsonPreview\(value: unknown, maxLength = 1000\)/);
  assert.match(serverCode, /function normalizeUnknownError\(error: unknown\)/);
  assert.match(serverCode, /message !== '\[object Object\]'/);
  assert.match(serverCode, /resolveTussDeleteRequestId/);
  assert.match(serverCode, /crypto\.randomUUID\(\)/);
  assert.match(serverCode, /const requestId = resolveTussDeleteRequestId\(req\)/);
  assert.match(serverCode, /unknownDependencies\?\s*:\s*string\[\]/);
  assert.match(serverCode, /optionalSchema\?\s*:\s*boolean/);
  assert.match(serverCode, /unknownDependencies\?\.push\(params\.stage\)/);
  assert.match(serverCode, /unknown:\s*unknownDependencies\.length/);
  assert.match(serverCode, /canDelete = unknownDependencies\.length === 0/);
  assert.match(serverCode, /impact_price_load/);
  assert.match(serverCode, /impact_price_billing_items/);
  assert.match(serverCode, /impact_price_pre_guides_direct/);
  assert.match(serverCode, /impact_price_official_documents/);
  assert.match(serverCode, /impact_price_authorizations/);
  assert.match(serverCode, /impact_mapping_prices/);
  assert.match(serverCode, /impact_mapping_billing_items/);
  assert.match(serverCode, /impact_mapping_pre_guides_direct/);
  assert.match(serverCode, /impact_mapping_official_documents/);
  assert.match(serverCode, /impact_mapping_authorizations/);
  assert.match(serverCode, /appointment_tiss_pre_guides/);
  assert.match(serverCode, /appointment_billing_items/);
  assert.match(serverCode, /patient_payer_authorizations/);
  assert.match(serverCode, /official_document_id/);
  assert.match(serverCode, /requireRoles\('coordinator', 'admin', 'owner'\)/);
});

test('delete-impact TUSS normaliza erros e usa schemas especificos por entidade sem 500 opaco', () => {
  const tussConfigStart = serverCode.indexOf('const TUSS_ENTITY_CONFIG = {');
  const impactStart = serverCode.indexOf('const buildTussDeleteImpact = async');
  const tussConfig = serverCode.slice(tussConfigStart, impactStart);
  const pricesConfig = tussConfig.slice(tussConfig.indexOf('prices:'), tussConfig.indexOf('} as const'));
  const mappingsConfig = tussConfig.slice(tussConfig.indexOf('mappings:'), tussConfig.indexOf('prices:'));
  assert.match(pricesConfig, /table:\s*'payer_procedure_prices'/);
  assert.match(pricesConfig, /activeColumn:\s*'active'/);
  assert.match(pricesConfig, /validToColumn:\s*'valid_until'/);
  assert.doesNotMatch(pricesConfig, /validToColumn:\s*'valid_to'/);
  assert.doesNotMatch(pricesConfig, /is_active|deleted_at|status/);
  assert.match(mappingsConfig, /table:\s*'payer_tuss_mappings'/);
  assert.match(mappingsConfig, /activeColumn:\s*'active'/);
  assert.match(mappingsConfig, /validToColumn:\s*'valid_to'/);
  assert.doesNotMatch(mappingsConfig, /validToColumn:\s*'valid_until'/);
  assert.doesNotMatch(mappingsConfig, /is_active|deleted_at|status/);

  const logStart = serverCode.indexOf('const logTussDeleteFailure =');
  const payloadStart = serverCode.indexOf('const buildTussDeleteImpactPayload =');
  const logSlice = serverCode.slice(logStart, payloadStart);
  assert.match(logSlice, /normalizeUnknownError\(error\)/);
  assert.match(logSlice, /errorContext\.stage \|\| context\.stage/);
  assert.match(logSlice, /rawType: normalized\.rawType/);
  assert.doesNotMatch(logSlice, /String\(error \|\| ''\)/);

  const routeSlice = serverCode.slice(
    serverCode.indexOf("app.get('/api/admin/tuss/:entityType/:entityId/delete-impact'"),
    serverCode.indexOf("app.post('/api/admin/tuss/mappings/:mappingId/revalidate'")
  );
  assert.match(routeSlice, /const requestId = resolveTussDeleteRequestId\(req\)/);
  assert.match(routeSlice, /requestId,\s*entityType: impact\.entityType/);
  assert.match(routeSlice, /unknownDependencies: impact\.unknownDependencies/);
  assert.match(routeSlice, /buildTussDeleteImpact\(organizationId, entityType, entityId, requestId\)/);
  assert.match(routeSlice, /TUSS_DELETE_BLOCKED_BY_DEPENDENCIES/);
  assert.match(routeSlice, /Este cadastro já foi utilizado e não pode ser excluído/);
});

test('esteira de convenio novo recomenda identificacao e marca configuracao incompleta', () => {
  const readiness = getPayerSetupReadiness({
    payer: { name: 'Amil', payerType: 'INSURANCE', status: 'ACTIVE' },
    tissProfile: {},
  });
  assert.equal(readiness.currentStepKey, 'identification');
  assert.equal(readiness.overallStatus, 'incomplete');
  assert.equal(readiness.steps.find((step) => step.key === 'identification')?.status, 'incomplete');
});

test('esteira avanca para dados da clinica quando identificacao esta pronta', () => {
  const readiness = getPayerSetupReadiness({
    payer: { name: 'Amil', payerType: 'INSURANCE', status: 'ACTIVE' },
    tissProfile: { ansRegistration: '326305' },
  });
  assert.equal(readiness.steps.find((step) => step.key === 'identification')?.status, 'ready');
  assert.equal(readiness.currentStepKey, 'clinic');
  assert.match(readiness.blockers.join(' '), /c[oó]digo da cl[ií]nica|clinica/i);
});

test('esteira bloqueia TUSS legado ou inadequado antes de XML', () => {
  assert.equal(isLegacyOrInvalidTussCodeForSetup('50000470'), false);
  assert.equal(isLegacyOrInvalidTussCodeForSetup('10101012'), true);
  assert.equal(isLegacyOrInvalidTussCodeForSetup('TESTE-ABA'), true);
  const readiness = getPayerSetupReadiness({
    payer: { name: 'Amil', payerType: 'INSURANCE', status: 'ACTIVE' },
    tissProfile: { ansRegistration: '326305', contractedProviderCode: 'PREST-1' },
    activeProcedureCount: 1,
    activeMappingCount: 1,
    activePriceCount: 1,
    activeBillingConfigurationCount: 1,
    hasLegacyTussCode: true,
  });
  assert.equal(readiness.steps.find((step) => step.key === 'tuss')?.status, 'blocked');
  assert.notEqual(readiness.overallStatus, 'ready_for_xml');
  assert.match(payerPanelCode, /getOfficialTussCodeForSetupValidation/);
  assert.match(payerPanelCode, /selectedPayerLegacyTussCodes[\s\S]*getOfficialTussCodeForSetupValidation/);
});

test('esteira pede valor negociado quando DePara existe sem preco vigente', () => {
  const readiness = getPayerSetupReadiness({
    payer: { name: 'Amil', payerType: 'INSURANCE', status: 'ACTIVE' },
    tissProfile: { ansRegistration: '326305', contractedProviderCode: 'PREST-1' },
    activeProcedureCount: 1,
    activeMappingCount: 1,
    activePriceCount: 0,
    pendingPriceCount: 1,
  });
  assert.equal(readiness.steps.find((step) => step.key === 'prices')?.status, 'incomplete');
  assert.match(readiness.steps.find((step) => step.key === 'prices')?.blockingReasons?.join(' ') || '', /valor negociado/i);
});

test('esteira marca anti-glosa nao revisada como alerta sem bloquear geracao futura', () => {
  const readiness = getPayerSetupReadiness({
    payer: { name: 'Amil', payerType: 'INSURANCE', status: 'ACTIVE' },
    tissProfile: { ansRegistration: '326305', contractedProviderCode: 'PREST-1' },
    activeProcedureCount: 1,
    activeMappingCount: 1,
    activePriceCount: 1,
    activeBillingConfigurationCount: 1,
    antiGlosaProfileNeedsReview: true,
  });
  const antiGlosaStep = readiness.steps.find((step) => step.key === 'anti_glosa');
  assert.equal(antiGlosaStep?.status, 'warning');
  assert.equal(antiGlosaStep?.canContinue, true);
  assert.equal(readiness.overallStatus, 'ready_for_xml_with_warning');
});

test('esteira reconhece convenio ja configurado e teste de pre-guia aprovado como pronto para XML', () => {
  const readiness = getPayerSetupReadiness({
    payer: { name: 'Amil', payerType: 'INSURANCE', status: 'ACTIVE' },
    tissProfile: {
      ansRegistration: '326305',
      contractedProviderCode: 'PREST-1',
      antiGlosaReviewed: true,
    },
    activeProcedureCount: 1,
    activeMappingCount: 1,
    activePriceCount: 1,
    activeBillingConfigurationCount: 1,
    preGuideTestStatus: 'ready',
  });
  assert.equal(readiness.overallStatus, 'ready_for_xml');
  assert.equal(readiness.currentStepKey, 'ready');
});

test('esteira leva teste de pre-guia com alerta para pronto para XML com alerta', () => {
  const readiness = getPayerSetupReadiness({
    payer: { name: 'Amil', payerType: 'INSURANCE', status: 'ACTIVE' },
    tissProfile: {
      ansRegistration: '326305',
      contractedProviderCode: 'PREST-1',
      antiGlosaReviewed: true,
    },
    activeProcedureCount: 1,
    activeMappingCount: 1,
    activePriceCount: 1,
    activeBillingConfigurationCount: 1,
    preGuideTestStatus: 'warning',
    preGuideTestIssues: ['Exigências da operadora ainda não revisadas'],
  });
  assert.equal(readiness.overallStatus, 'ready_for_xml_with_warning');
  assert.equal(readiness.steps.find((step) => step.key === 'test')?.status, 'warning');
  assert.match(readiness.warnings.join(' '), /Exig/);
});

test('esteira bloqueada por teste de pre-guia explica pendencias', () => {
  const readiness = getPayerSetupReadiness({
    payer: { name: 'Amil', payerType: 'INSURANCE', status: 'ACTIVE' },
    tissProfile: {
      ansRegistration: '326305',
      contractedProviderCode: 'PREST-1',
      antiGlosaReviewed: true,
    },
    activeProcedureCount: 1,
    activeMappingCount: 1,
    activePriceCount: 1,
    activeBillingConfigurationCount: 1,
    preGuideTestStatus: 'blocked',
    preGuideTestIssues: ['Profissional não definido'],
  });
  assert.equal(readiness.steps.find((step) => step.key === 'test')?.status, 'blocked');
  assert.match(readiness.blockers.join(' '), /Profissional/);
  assert.notEqual(readiness.overallStatus, 'ready_for_xml');
});

test('UI de convenios exibe esteira guiada e mantem modo avancado existente', () => {
  assert.match(payerPanelCode, /Esteira de configura/);
  assert.match(payerPanelCode, /Configurar conv.nio at. ficar pronto para XML/s);
  assert.match(payerPanelCode, /Identifica..o da operadora/s);
  assert.match(payerPanelCode, /Dados da cl.nica no conv.nio/s);
  assert.match(payerPanelCode, /TUSS e De\/Para/);
  assert.match(payerPanelCode, /Valores negociados/);
  assert.match(payerPanelCode, /Exig.ncias anti-glosa/s);
  assert.match(payerPanelCode, /Teste de Pr.-guia/s);
  assert.match(payerPanelCode, /Editar avan.ado/s);
});

test('esteira executavel embute campos praticos de DePara, valores e anti-glosa', () => {
  assert.match(payerPanelCode, /activeSetupStep\.key === "tuss"[\s\S]*Procedimento interno para c.digo TUSS/s);
  assert.match(payerPanelCode, /activeSetupStep\.key === "tuss"[\s\S]*C.digo TUSS[\s\S]*Descri..o TUSS/s);
  assert.match(payerPanelCode, /return "Salvar e continuar"/);
  assert.match(payerPanelCode, /activeSetupStep\.key === "prices"[\s\S]*Valores negociados[\s\S]*Valor negociado[\s\S]*Vig.ncia inicial[\s\S]*Vig.ncia final opcional/s);
  assert.doesNotMatch(payerPanelCode, /Salvar valores e continuar/);
  assert.match(payerPanelCode, /Informe o valor contratado para este procedimento/);
  assert.match(payerPanelCode, /activeSetupStep\.key === "anti_glosa"[\s\S]*Revisei as exig.ncias anti-glosa desta operadora/s);
  assert.match(payerPanelCode, /Editar avan.ado em tabela de valores/s);
  assert.match(payerPanelCode, /Editar avan.ado em De\/Para TUSS/s);
});

test('etapa 9 da esteira executa teste de pre-guia dentro do fluxo', () => {
  assert.match(payerPanelCode, /activeSetupStep\.key === "test"[\s\S]*Paciente[\s\S]*Sess.o\/atendimento/s);
  assert.match(payerPanelCode, /activeSetupStep\.key === "test"[\s\S]*Profissional[\s\S]*Sala\/local/s);
  assert.match(payerPanelCode, /activeSetupStep\.key === "test"[\s\S]*TISS t.cnico[\s\S]*Anti-glosa[\s\S]*XML/s);
  assert.match(payerPanelCode, /Rodar teste de Pr.-guia/s);
  assert.match(payerPanelCode, /dataService\.getPatients\(\)/);
  assert.match(payerPanelCode, /dataService\.getCalendarEvents\(\{ from: range\.from, to: range\.to, view: "month", limit: 120 \}\)/);
  assert.match(payerPanelCode, /dataService\.revalidateTissPreGuide\(setupAppointmentId\)/);
  assert.match(payerPanelCode, /setupEventResolvedProfessionalName\(selectedSetupAppointment\)/);
  assert.match(payerPanelCode, /setupEventResolvedRoomName\(selectedSetupAppointment\)/);
  assert.match(payerPanelCode, /buildSetupPreGuideEligibilityReasons/);
  assert.match(payerPanelCode, /Sess.es encontradas, mas n.o eleg.veis/);
  assert.match(payerPanelCode, /Sess.o est. com outro pagador/);
  assert.match(payerPanelCode, /Sess.o sem guia ou autoriza..o vigente vinculada/);
  assert.match(payerPanelCode, /Nenhuma sess.o encontrada para este paciente e per.odo/);
  assert.doesNotMatch(payerPanelCode, /Use uma sess.o real na aba Pr.-Guias TISS para rodar a revalida/s);
});

test('etapa 10 resume pronto, alerta e bloqueio com acoes finais', () => {
  assert.match(payerPanelCode, /Conv.nio pronto para XML/s);
  assert.match(payerPanelCode, /Conv.nio pronto para XML com alerta/s);
  assert.match(payerPanelCode, /Configura..o ainda n.o est. pronta para XML/s);
  assert.match(payerPanelCode, /Identifica..o da operadora/);
  assert.match(payerPanelCode, /Teste de Pr.-guia/);
  assert.match(payerPanelCode, /Ir para Pr.-Guias TISS/);
  assert.match(payerPanelCode, /Gerar lote XML/);
  assert.match(payerPanelCode, /Ver lotes XML/);
});

test('botao padrao de salvar confirma no proprio botao e usa cor principal', () => {
  assert.match(payerPanelCode, /function SaveActionButton/);
  assert.match(payerPanelCode, /data-save-action-button/);
  assert.match(payerPanelCode, /data-save-action-status=\{status\}/);
  assert.match(payerPanelCode, /min-h-\[42px\]/);
  assert.match(payerPanelCode, /min-w-\[156px\]/);
  assert.match(payerPanelCode, /bg-\[#7a32fc\]/);
  assert.match(payerPanelCode, /Salvando\.\.\./);
  assert.match(payerPanelCode, /status: SaveActionStatus/);
  assert.match(payerPanelCode, /status === "loading"/);
  assert.match(payerPanelCode, /status === "success"/);
  assert.match(payerPanelCode, /status === "error"/);
  assert.match(payerPanelCode, /`✓ \$\{successLabel\}`/);
  assert.match(payerPanelCode, /<SaveActionButton[\s\S]*idleLabel=\{setupPrimaryLabel\(activeSetupStep\.key\)\}/);
  assert.match(payerPanelCode, /loadingLabel=\{activeSetupStep\.key === "test" \? "Testando\.\.\." : "Salvando\.\.\."\}/);
  assert.match(payerPanelCode, /successLabel=\{activeSetupStep\.key === "test" \? "Teste conclu.do" : "Salvo"\}/);
  assert.match(payerPanelCode, /return "Salvar e continuar"/);
  assert.doesNotMatch(payerPanelCode, /Salvar identifica..o e continuar/);
  assert.doesNotMatch(payerPanelCode, /Salvar valores e continuar/);
  assert.doesNotMatch(payerPanelCode, /bg-slate-900[\s\S]{0,180}Salvar/);
  assert.doesNotMatch(payerPanelCode, /bg-emerald-700[\s\S]{0,180}Salvar/);
});

test('layout de convenios usa lista horizontal no topo e esteira abaixo com largura ampla', () => {
  assert.match(payerPanelCode, /data-payer-list-grid/);
  assert.match(payerPanelCode, /grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4/);
  assert.match(payerPanelCode, /data-payer-card/);
  assert.match(payerPanelCode, /aria-pressed=\{isSelected\}/);
  assert.match(payerPanelCode, /data-payer-setup-area/);
  assert.match(payerPanelCode, /lg:grid-cols-\[minmax\(240px,0\.42fr\)_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(payerPanelCode, /mt-5 grid gap-5 xl:grid-cols-\[minmax\(240px,0\.9fr\)_minmax\(0,1\.4fr\)\]/);
});

test('modo avancado fica secundario e link avancado abre as secoes tecnicas', () => {
  assert.match(payerPanelCode, /advancedModeOpen/);
  assert.match(payerPanelCode, /setAdvancedModeOpen\(true\)/);
  assert.equal((payerPanelCode.match(/Modo avan.ado/g) || []).length, 1);
  assert.match(payerPanelCode, /Ajustes t.cnicos do conv.nio: De\/Para completo, tabela de valores, regras TISS, cadastros de apoio e exce..es/s);
  assert.match(payerPanelCode, /data-payer-advanced-mode-tabs/);
  assert.match(payerPanelCode, /Dados TISS avan.ados/);
  assert.match(payerPanelCode, /Exce..es por servi.o/);
  assert.match(payerPanelCode, /Editar avan.ado em tabela de valores/s);
  assert.match(payerPanelCode, /Editar avan.ado em De\/Para TUSS/s);
  assert.match(payerPanelCode, /<SaveActionButton[\s\S]*idleLabel="Salvar altera..es"/);
});

test('salvar etapa confirma e avanca automaticamente para a proxima etapa', () => {
  assert.match(payerPanelCode, /setSetupStepStatus\(stepKey, "loading"\)/);
  assert.match(payerPanelCode, /setSetupStepStatus\(stepKey, "success"\)/);
  assert.match(payerPanelCode, /window\.setTimeout\(\(\) => \{[\s\S]*goToAdjacentSetupStep\(1\)/);
});

let passed = 0;
for (const entry of tests) {
  try {
    entry.fn();
    passed += 1;
    console.log(`ok - ${entry.name}`);
  } catch (error) {
    console.error(`not ok - ${entry.name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} payer requirement tests passed`);
