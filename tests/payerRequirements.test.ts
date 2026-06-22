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
  parseBrazilianCurrencyToCents,
} from '../src/components/PayerRequirementsPanel';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const dataServiceCode = readFileSync(join(root, 'src/services/dataService.ts'), 'utf8');
const closureCenterCode = readFileSync(join(root, 'src/components/OperationalClosureCenter.tsx'), 'utf8');
const calendarCode = readFileSync(join(root, 'src/components/Calendar.tsx'), 'utf8');
const coordinatorCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
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
  assert.ok(closure.checklist.some((item) => item.key === 'authorization_linked' && item.status === 'FAILED'));
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
  assert.match(navigationSection, /id:\s*"finance-root"[\s\S]*label:\s*"Financeiro"/);
  assert.match(navigationSection, /id:\s*"finance-dashboard"[\s\S]*label:\s*"Dashboard Financeiro"/);
  assert.match(navigationSection, /id:\s*"finance-billing-config"[\s\S]*label:\s*"Convênios e Faturamento"/);
  assert.match(navigationSection, /id:\s*"payer-convenios"[\s\S]*label:\s*"Convênios"/);
  assert.match(navigationSection, /id:\s*"payer-tuss"[\s\S]*label:\s*"De\/Para TUSS"/);
  assert.match(navigationSection, /id:\s*"payer-prices"[\s\S]*label:\s*"Tabela de Valores"/);
  assert.match(navigationSection, /id:\s*"payer-rules"[\s\S]*label:\s*"Regras TISS"/);
  assert.match(navigationSection, /id:\s*"finance-prebilling"[\s\S]*label:\s*"Pré-Faturamento"/);
  assert.match(navigationSection, /id:\s*"prebilling-preguides"[\s\S]*label:\s*"Pré-guias TISS"/);
  assert.match(navigationSection, /id:\s*"prebilling-conference"[\s\S]*label:\s*"Conferência"/);
  assert.match(navigationSection, /id:\s*"prebilling-pending"[\s\S]*label:\s*"Pendências"/);
  assert.match(navigationSection, /id:\s*"finance-closing"[\s\S]*label:\s*"Fechamento"/);
  assert.match(navigationSection, /id:\s*"closing-tiss"[\s\S]*label:\s*"Fechamento TISS"/);
  assert.match(navigationSection, /id:\s*"closing-batches"[\s\S]*label:\s*"Lotes Rascunho"/);
  assert.match(navigationSection, /id:\s*"closing-xml"[\s\S]*label:\s*"XML Rascunhos"/);
  assert.match(navigationSection, /id:\s*"finance-clinical"[\s\S]*label:\s*"Financeiro Clínico"/);
  assert.match(navigationSection, /id:\s*"finance-reports"[\s\S]*label:\s*"Relatórios"/);
  assert.match(coordinatorCode, /expandedNavigationSections/);
  assert.match(coordinatorCode, /financialNavigationContext\.breadcrumb\.join\(" > "\)/);
  const financialSection = coordinatorCode.slice(
    coordinatorCode.indexOf('activeTab === "financial"'),
    coordinatorCode.indexOf('activeTab === "flow"'),
  );
  assert.match(financialSection, /navigateToTab\("payers", payerIntent\("convenios", "Convênios"\)\)/);
  assert.match(financialSection, /<KeyRound size=\{18\} \/> Convênios/);
  assert.match(coordinatorCode, /activeTab === "payers"[\s\S]*?<PayerRequirementsPanel[\s\S]*initialSection=\{financialNavigationContext\.payerSection\}/);
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
  assert.match(payerPanelCode, /Exigências gerais da operadora/);
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

  assert.match(payerPanelCode, /Configurações de faturamento deste convênio/);
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
  assert.match(payerPanelCode, /open=\{supportFormOpen\}/);
  assert.match(payerPanelCode, /open=\{supportCatalogOpen\}/);
  assert.match(payerPanelCode, /openSupportForm\("service"\)/);
  assert.match(payerPanelCode, /openSupportForm\("code"\)/);
  assert.match(payerPanelCode, /Editando procedimento interno/);
  assert.match(payerPanelCode, /Editando código TUSS/);
  assert.match(payerPanelCode, /Atualizar procedimento/);
  assert.match(payerPanelCode, /Cancelar edição/);
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
  assert.match(payerPanelCode, /uniqueStatusBadges/);
  assert.match(payerPanelCode, /new Map\(statusBadges\.map/);
  assert.match(payerPanelCode, /Procedimento inativo/);
  assert.match(payerPanelCode, /De\/Para ausente/);
  assert.match(payerPanelCode, /Valor ausente/);
  assert.match(payerPanelCode, /Configuração inconsistente/);
  assert.match(payerPanelCode, /procedurePriceSaveInFlightRef/);
  assert.match(payerPanelCode, /parseBrazilianCurrencyToCents\(procedurePriceForm\.amountCents\)/);
  assert.doesNotMatch(payerPanelCode, /parseBrazilianCurrencyToCents\(tussMappingForm/);
  assert.match(serverCode, /amount_cents:\s*null/);
  assert.match(serverCode, /negotiated_amount_cents:\s*null/);
  assert.match(serverCode, /TUSS_MAPPING_GUIDE_TYPE_UNSUPPORTED/);
  assert.doesNotMatch(payerPanelCode, /placeholder="Valor negociado em centavos"/);
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
    'Exigências gerais da operadora',
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

  assert.match(payerPanelCode, /Este cadastro possui v(?:Ã­|í)nculos hist(?:Ã³|ó)ricos e n(?:Ã£|ã)o pode ser exclu(?:Ã­|í)do/);
  assert.doesNotMatch(payerPanelCode, /Editar configura(?:Ã§Ã£o|ção)/);
  assert.doesNotMatch(payerPanelCode, /De\/Para configurado/);
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
