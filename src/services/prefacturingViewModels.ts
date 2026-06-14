import {
  classifyConferencePendingDetails,
  normalizeConferenceStatus,
  type ConferencePendingDetail,
  type MonthlyConferenceRow
} from './monthlyConferenceEngine';

export type OperationalClosureStatus =
  | 'OPEN'
  | 'READY'
  | 'OPERATIONAL_PENDING'
  | 'NOT_BILLABLE'
  | 'NEEDS_REVALIDATION';

export type OperationalClosureViewModel = {
  operationalStatus: OperationalClosureStatus;
  operationalStatusLabel: string;
  mainBlockingIssue: string;
  checklistSummary: string;
  operationalPendingChips: ConferencePendingDetail[];
  configurationPendingChips: ConferencePendingDetail[];
  nextAction: string;
  canBeMarkedReady: boolean;
  canRevalidate: boolean;
  canApplySuggestedPayer: boolean;
  isReadyForConference: boolean;
};

export type MonthlyConferenceViewModel = {
  conferenceStatus: string;
  conferenceStatusLabel: string;
  billingStatus: 'READY' | 'PENDING_CONFIGURATION' | 'OPERATIONAL_PENDING' | 'NON_BILLABLE';
  billingStatusLabel: string;
  exportStatus: string;
  expectedAmountCents: number;
  payerGroup: string;
  procedureGroup: string;
  tussGroup: string;
  guideGroup: string;
  financialPendingChips: ConferencePendingDetail[];
  remainingPendingChips: ConferencePendingDetail[];
  canMarkReviewed: boolean;
  canExport: boolean;
  canReopen: boolean;
  canMarkNonBillable: boolean;
};

const displayLabel: Record<string, string> = {
  Relatorio: 'Relatório',
  Autorizacao: 'Autorização',
  Duracao: 'Duração',
  Pagador: 'Contexto financeiro',
  'Plano financeiro': 'Plano financeiro',
  Procedimento: 'Procedimento',
  TUSS: 'TUSS',
  Valor: 'Valor',
  Carteirinha: 'Carteirinha',
  'Registro profissional': 'Registro profissional',
  'Aguardando realizacao': 'Aguardando realização',
  'Nao aplicavel ao faturamento': 'Não aplicável ao faturamento'
};

function labelFor(value?: string | null) {
  const label = String(value || '').trim();
  return displayLabel[label] || label || 'Sem pendência';
}

function firstLabel(items: string[]) {
  return items.length > 0 ? labelFor(items[0]) : '';
}

function normalizeWorkflowStatus(row: MonthlyConferenceRow) {
  const fallback = normalizeConferenceStatus(row.readiness_status) === 'NOT_BILLABLE' ? 'non_billable' : 'pending_review';
  const status = String(row.conference_status || fallback).toLowerCase();
  return ['pending_review', 'reviewed', 'exported', 'reopened', 'non_billable'].includes(status) ? status : fallback;
}

function checklistCounts(row: MonthlyConferenceRow) {
  const checklist = Array.isArray(row.checklist) ? row.checklist : [];
  const failed = checklist.filter((item) => String(item?.status || '').toUpperCase() === 'FAILED').length;
  const warning = checklist.filter((item) => String(item?.status || '').toUpperCase() === 'WARNING').length;
  const passed = checklist.filter((item) => String(item?.status || '').toUpperCase() === 'PASSED').length;
  return { failed, warning, passed, total: checklist.length };
}

export function buildOperationalClosureViewModel(row: MonthlyConferenceRow): OperationalClosureViewModel {
  const status = normalizeConferenceStatus(row.readiness_status);
  const details = classifyConferencePendingDetails(row);
  const counts = checklistCounts(row);
  const hasSuggestedPayer = !String(row.payer_id || '').trim() && Boolean(String((row as any).suggested_payer_id || '').trim());
  const isReadyForConference = status === 'READY' && details.blocking.length === 0;
  const operationalStatus: OperationalClosureStatus =
    status === 'NOT_BILLABLE'
      ? 'NOT_BILLABLE'
      : status === 'DRAFT'
        ? 'OPEN'
        : isReadyForConference
          ? 'READY'
          : details.blocking.length > 0
            ? 'OPERATIONAL_PENDING'
            : 'NEEDS_REVALIDATION';
  const operationalStatusLabel =
    operationalStatus === 'READY'
      ? 'Pronta para pré-faturamento'
      : operationalStatus === 'OPEN'
        ? 'Em aberto'
        : operationalStatus === 'NOT_BILLABLE'
          ? 'Não faturável'
          : operationalStatus === 'NEEDS_REVALIDATION'
            ? 'Precisa revalidar'
            : 'Pendência operacional';
  const mainBlockingIssue =
    firstLabel(details.operational) ||
    firstLabel(details.configuration) ||
    firstLabel(details.notApplicable) ||
    firstLabel(details.informational) ||
    'Sem pendência';
  const checklistSummary = counts.total > 0
    ? `${counts.failed} pendente(s), ${counts.warning} alerta(s), ${counts.passed} ok`
    : details.blocking.length > 0
      ? `${details.blocking.length} item(ns) a corrigir`
      : 'Checklist pronto';
  let nextAction = 'Enviar para conferência';
  if (operationalStatus === 'OPEN') nextAction = 'Aguardar realização';
  else if (operationalStatus === 'NOT_BILLABLE') nextAction = 'Manter fora do pré-faturamento';
  else if (details.operational.includes('Assinatura')) nextAction = 'Coletar assinatura';
  else if (details.operational.includes('Relatorio')) nextAction = 'Completar relatório';
  else if (details.operational.includes('Duracao')) nextAction = 'Informar duração real';
  else if (details.operational.includes('Guia') || details.operational.includes('Autorizacao')) nextAction = 'Revisar guia/autorização';
  else if (details.configuration.includes('Pagador')) nextAction = hasSuggestedPayer ? 'Aplicar pagador sugerido' : 'Definir contexto financeiro';
  else if (details.configuration.includes('Procedimento') || details.configuration.includes('TUSS')) nextAction = 'Configurar procedimento/TUSS';
  else if (details.configuration.includes('Registro profissional')) nextAction = 'Atualizar registro profissional';
  else if (operationalStatus === 'NEEDS_REVALIDATION') nextAction = 'Revalidar atendimento';

  return {
    operationalStatus,
    operationalStatusLabel,
    mainBlockingIssue,
    checklistSummary,
    operationalPendingChips: details.visible.filter((item) => item.category === 'operational' || item.category === 'not_applicable'),
    configurationPendingChips: details.visible.filter((item) => item.category === 'configuration'),
    nextAction,
    canBeMarkedReady: isReadyForConference,
    canRevalidate: operationalStatus !== 'NOT_BILLABLE',
    canApplySuggestedPayer: hasSuggestedPayer,
    isReadyForConference
  };
}

export function buildMonthlyConferenceViewModel(row: MonthlyConferenceRow): MonthlyConferenceViewModel {
  const status = normalizeConferenceStatus(row.readiness_status);
  const details = classifyConferencePendingDetails(row);
  const workflowStatus = normalizeWorkflowStatus(row);
  const expectedAmountCents = Number((row as any).billing_amount_cents || (row as any).expected_amount_cents || 0) || 0;
  const configurationPending = details.visible.filter((item) => item.category === 'configuration');
  const operationalPending = details.visible.filter((item) => item.category === 'operational');
  const billingStatus =
    workflowStatus === 'non_billable' || status === 'NOT_BILLABLE'
      ? 'NON_BILLABLE'
      : configurationPending.length > 0
        ? 'PENDING_CONFIGURATION'
        : operationalPending.length > 0
          ? 'OPERATIONAL_PENDING'
          : 'READY';
  const billingStatusLabel =
    billingStatus === 'READY'
      ? 'Pronto para conferência'
      : billingStatus === 'PENDING_CONFIGURATION'
        ? 'Configuração pendente'
        : billingStatus === 'OPERATIONAL_PENDING'
          ? 'Pendência operacional'
          : 'Não faturável';
  const conferenceStatusLabel =
    workflowStatus === 'reviewed'
      ? 'Conferido'
      : workflowStatus === 'exported'
        ? 'Exportado'
        : workflowStatus === 'reopened'
          ? 'Reaberto'
          : workflowStatus === 'non_billable'
            ? 'Não faturável'
            : 'A revisar';

  return {
    conferenceStatus: workflowStatus,
    conferenceStatusLabel,
    billingStatus,
    billingStatusLabel,
    exportStatus: row.export_id ? 'Exportado' : 'Não exportado',
    expectedAmountCents,
    payerGroup: String(row.payer_name || (row as any).payer_name_snapshot || 'Sem pagador').trim() || 'Sem pagador',
    procedureGroup: String(row.internal_procedure_name || 'Sem procedimento').trim() || 'Sem procedimento',
    tussGroup: String(row.tuss_code || 'Sem TUSS').trim() || 'Sem TUSS',
    guideGroup: String(row.guide_number || row.guide_type || 'Sem guia').trim() || 'Sem guia',
    financialPendingChips: configurationPending,
    remainingPendingChips: details.visible,
    canMarkReviewed: workflowStatus === 'pending_review' || workflowStatus === 'reopened',
    canExport: workflowStatus === 'reviewed',
    canReopen: workflowStatus === 'exported',
    canMarkNonBillable: workflowStatus !== 'exported' && workflowStatus !== 'non_billable'
  };
}
