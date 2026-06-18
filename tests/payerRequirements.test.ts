import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluatePayerRequirementsForClosure,
  resolvePayerRequirements
} from '../src/services/payerRequirementEngine';
import { evaluateAppointmentClosureReadiness } from '../src/services/closureReadinessEngine';

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
  assert.match(payerPanelCode, /Dados da operadora/);
  assert.match(payerPanelCode, /Dados do prestador no convênio/);
  assert.match(payerPanelCode, /Regras TISS e autorização/);
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
