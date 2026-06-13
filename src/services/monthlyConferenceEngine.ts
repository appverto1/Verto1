import { formatDateInAppointmentTimezone, formatTimeInAppointmentTimezone } from '../utils/scheduling';

export type MonthlyConferenceStatus = 'READY' | 'PENDING' | 'WARNING' | 'NOT_BILLABLE' | 'DRAFT' | 'UNKNOWN';

export type MonthlyConferenceRow = {
  appointment_id?: string | null;
  patient_id?: string | null;
  patient_name?: string | null;
  professional_id?: string | null;
  professional_name?: string | null;
  service_type?: string | null;
  payer_id?: string | null;
  payer_type?: string | null;
  financial_context_type?: string | null;
  payer_name?: string | null;
  payer_name_snapshot?: string | null;
  clinic_name?: string | null;
  unit_name?: string | null;
  financial_plan_name?: string | null;
  insurance_card_number?: string | null;
  internal_procedure_code?: string | null;
  internal_procedure_name?: string | null;
  tuss_code?: string | null;
  tuss_description?: string | null;
  tuss_version?: string | null;
  guide_type?: string | null;
  billing_unit?: string | null;
  billing_quantity?: number | null;
  billing_unit_amount_cents?: number | null;
  billing_amount_cents?: number | null;
  billing_item_status?: string | null;
  tuss_mapping_status?: string | null;
  tuss_pending_reasons?: string[] | null;
  tuss_pending_reason_codes?: string[] | null;
  tuss_mapping_valid_from?: string | null;
  tuss_mapping_valid_to?: string | null;
  copayment_amount_cents?: number | null;
  expected_amount_cents?: number | null;
  financial_status?: string | null;
  professional_registry?: string | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  scheduled_minutes?: number | null;
  actual_minutes?: number | null;
  readiness_status?: string | null;
  appointment_status?: string | null;
  blocking_issues_count?: number | null;
  warning_issues_count?: number | null;
  missing_required_count?: number | null;
  required_document_pending_count?: number | null;
  guide_number?: string | null;
  authorization_code?: string | null;
  conference_status?: string | null;
  conference_status_label?: string | null;
  export_status?: string | null;
  export_id?: string | null;
  exported_at?: string | null;
  exported_by_name?: string | null;
  notes?: string | null;
  main_issues?: string[] | null;
  checklist?: Array<{ key?: string; label?: string; status?: string; required?: boolean; message?: string }> | null;
};

export type MonthlyConferenceSummary = {
  kpis: {
    totalSessions: number;
    ready: number;
    pending: number;
    warning: number;
    notBillable: number;
    open: number;
    draft: number;
    unknown: number;
    actualMinutes: number;
    scheduledMinutes: number;
    pendingSignatures: number;
    pendingReports: number;
    pendingGuides: number;
    pendingAuthorizations: number;
    pendingDocuments: number;
  };
  pendingByType: Array<{ type: string; count: number; category: 'configuration' | 'operational' }>;
  byPatient: any[];
  byProfessional: any[];
  byPayer: any[];
  byServiceType: any[];
  byProcedure: any[];
  byTussCode: any[];
  byGuideType: any[];
};

export type ConferencePendingCategory = 'operational' | 'configuration' | 'informational' | 'not_applicable';

export type ConferencePendingDetail = {
  label: string;
  category: ConferencePendingCategory;
  blocking: boolean;
};

export type ConferencePendingClassification = {
  operational: string[];
  configuration: string[];
  informational: string[];
  notApplicable: string[];
  blocking: string[];
  visible: ConferencePendingDetail[];
};

const statusSet = new Set(['READY', 'PENDING', 'WARNING', 'NOT_BILLABLE', 'DRAFT', 'UNKNOWN']);

export function normalizeConferenceStatus(value: any): MonthlyConferenceStatus {
  const status = String(value || 'UNKNOWN').toUpperCase();
  return statusSet.has(status) ? (status as MonthlyConferenceStatus) : 'UNKNOWN';
}

export function formatConferenceMinutes(value: any): string {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours > 0 && remainder > 0) return `${hours}h ${remainder}min`;
  if (hours > 0) return `${hours}h`;
  return `${remainder}min`;
}

function formatCurrencyCents(value: any): string {
  const cents = Math.round(Number(value || 0));
  if (!Number.isFinite(cents) || cents <= 0) return '';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatTimeOnly(value: any): string {
  if (!value) return '';
  return formatTimeInAppointmentTimezone(value);
}

function clinicDateOnly(value: any): string {
  if (!value) return '';
  return formatDateInAppointmentTimezone(value);
}

function competenceMonth(value: any): string {
  const text = clinicDateOnly(value);
  if (!text) return '';
  return `${text.slice(0, 7)}-01`;
}

function rowIssues(row: MonthlyConferenceRow): string[] {
  const issues = Array.isArray(row.main_issues) ? row.main_issues.filter(Boolean).map(String) : [];
  const checklistIssues = Array.isArray(row.checklist)
    ? row.checklist
        .filter((item) => String(item?.status || '').toUpperCase() === 'FAILED')
        .map((item) => String(item?.label || item?.message || item?.key || 'Pendencia'))
    : [];
  return [...issues, ...checklistIssues];
}

function hasIssue(row: MonthlyConferenceRow, patterns: RegExp[]) {
  const joined = rowIssues(row).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return patterns.some((pattern) => pattern.test(joined));
}

function isNotBillableRow(row: MonthlyConferenceRow) {
  return normalizeConferenceStatus(row.readiness_status) === 'NOT_BILLABLE';
}

function isOpenRow(row: MonthlyConferenceRow) {
  const status = normalizeConferenceStatus(row.readiness_status);
  return status === 'DRAFT' || (!row.actual_start && !row.actual_end && !Number(row.actual_minutes || 0));
}

function addUnique(target: string[], label: string) {
  if (label && !target.includes(label)) target.push(label);
}

function normalizeFinancialContextType(value: any): string {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const aliases: Record<string, string> = {
    CONVENIO: 'INSURANCE',
    INSURANCE: 'INSURANCE',
    PARTICULAR: 'PRIVATE',
    PRIVATE: 'PRIVATE',
    PACOTE: 'PACKAGE',
    PACKAGE: 'PACKAGE',
    MENSALIDADE: 'MONTHLY',
    MONTHLY: 'MONTHLY',
    CORTESIA: 'COURTESY',
    COURTESY: 'COURTESY',
    SEM_COBRANCA: 'NO_CHARGE',
    NO_CHARGE: 'NO_CHARGE',
    NAO_FATURAVEL: 'NOT_BILLABLE',
    NOT_BILLABLE: 'NOT_BILLABLE'
  };
  return aliases[normalized] || '';
}

const NON_INSURANCE_FINANCIAL_CONTEXTS = new Set(['PRIVATE', 'PACKAGE', 'MONTHLY', 'COURTESY', 'NO_CHARGE', 'NOT_BILLABLE']);

export function classifyConferencePendingDetails(row: MonthlyConferenceRow): ConferencePendingClassification {
  const operational: string[] = [];
  const configuration: string[] = [];
  const informational: string[] = [];
  const notApplicable: string[] = [];
  const notBillable = isNotBillableRow(row);
  const open = isOpenRow(row);
  const financialContextType = normalizeFinancialContextType(row.financial_context_type || row.payer_type);
  const explicitNonInsuranceContext = NON_INSURANCE_FINANCIAL_CONTEXTS.has(financialContextType);

  const addOperational = (label: string) => {
    if (notBillable) return;
    else if (open && ['Assinatura', 'Relatorio', 'Duracao', 'Sessao concluida'].includes(label)) addUnique(notApplicable, label);
    else addUnique(operational, label);
  };

  if (hasIssue(row, [/assinatura/, /signature/])) addOperational('Assinatura');
  if (hasIssue(row, [/relatorio/, /evolucao/, /report/])) addOperational('Relatorio');
  if (!String(row.guide_number || '').trim() && hasIssue(row, [/guia/, /guide/])) addOperational('Guia');
  if (!String(row.authorization_code || '').trim() && hasIssue(row, [/autorizacao/, /authorization/])) addOperational('Autorizacao');
  if (hasIssue(row, [/duracao/, /duration/])) addOperational('Duracao');
  if (hasIssue(row, [/profissional/, /professional/])) addOperational('Profissional');
  const hasDocumentPendingCount = row.required_document_pending_count !== null && row.required_document_pending_count !== undefined;
  if (Number(row.required_document_pending_count || 0) > 0 || (!hasDocumentPendingCount && hasIssue(row, [/documento/, /document/]))) addOperational('Documento');

  const tussPendingCodes = Array.isArray(row.tuss_pending_reason_codes) ? row.tuss_pending_reason_codes : [];
  const tussPendingLabels = Array.isArray(row.tuss_pending_reasons) ? row.tuss_pending_reasons.join(' ') : '';
  const hasPayer = Boolean(String(row.payer_id || '').trim());
  const hasFinancialPlan = Boolean(String(row.financial_plan_name || '').trim());
  const hasProcedure = Boolean(String(row.internal_procedure_name || row.internal_procedure_code || '').trim());
  const hasTuss = Boolean(String(row.tuss_code || '').trim());
  const hasExpectedAmount = Number(row.billing_amount_cents || row.expected_amount_cents || 0) > 0;
  const hasInsuranceCard = Boolean(String(row.insurance_card_number || '').trim());
  const hasProfessionalRegistry = Boolean(String(row.professional_registry || '').trim());
  const hasProfessionalRegistryField = Object.prototype.hasOwnProperty.call(row, 'professional_registry');
  if (!explicitNonInsuranceContext) {
    if (!hasPayer) addUnique(configuration, 'Pagador');
    if (!hasFinancialPlan) addUnique(configuration, 'Plano financeiro');
    if (!hasProcedure) addUnique(configuration, 'Procedimento');
    if (!hasTuss) addUnique(configuration, 'TUSS');
    if (!hasExpectedAmount) addUnique(configuration, 'Valor');
    if (!hasInsuranceCard && (tussPendingCodes.includes('missing_card_number') || /carteirinha/i.test(tussPendingLabels))) addUnique(configuration, 'Carteirinha');
    if (
      (hasProfessionalRegistryField && !hasProfessionalRegistry) ||
      (!hasProfessionalRegistryField && (tussPendingCodes.includes('missing_professional_registry') || hasIssue(row, [/registro profissional/, /professional registry/, /conselho profissional/])))
    ) addUnique(configuration, 'Registro profissional');
  }

  if (notBillable) {
    addUnique(informational, 'Nao aplicavel ao faturamento');
  } else if (open) {
    addUnique(notApplicable, 'Aguardando realizacao');
  }

  const actionableConfiguration = notBillable ? [] : configuration;
  const blocking = [...actionableConfiguration, ...operational];
  const visible: ConferencePendingDetail[] = [
    ...actionableConfiguration.map((label) => ({ label, category: 'configuration' as const, blocking: true })),
    ...operational.map((label) => ({ label, category: 'operational' as const, blocking: true })),
    ...informational.map((label) => ({ label, category: 'informational' as const, blocking: false })),
    ...notApplicable.map((label) => ({ label, category: 'not_applicable' as const, blocking: false }))
  ];

  return {
    operational,
    configuration: actionableConfiguration,
    informational,
    notApplicable,
    blocking,
    visible
  };
}

export function classifyConferencePendingKinds(row: MonthlyConferenceRow): string[] {
  return classifyConferencePendingDetails(row).blocking;
}

export function formatConferencePendingSummary(row: MonthlyConferenceRow): string {
  const details = classifyConferencePendingDetails(row);
  if (details.blocking.length > 0) return details.blocking.join('; ');
  if (details.informational.length > 0) return details.informational.join('; ');
  if (details.notApplicable.length > 0) return details.notApplicable.join('; ');
  return 'Sem pendencias';
}

function addMinutes(target: any, scheduled: number, actual: number) {
  target.scheduledMinutes = (target.scheduledMinutes || 0) + scheduled;
  target.actualMinutes = (target.actualMinutes || 0) + actual;
}

function sortByCountAndName(rows: any[], countKey = 'totalSessions') {
  return rows.sort((a, b) => {
    const diff = Number(b[countKey] || 0) - Number(a[countKey] || 0);
    if (diff !== 0) return diff;
    return String(a.name || a.serviceType || a.payerName || '').localeCompare(String(b.name || b.serviceType || b.payerName || ''), 'pt-BR');
  });
}

export function buildMonthlyConferenceSummary(rows: MonthlyConferenceRow[]): MonthlyConferenceSummary {
  const safeRows = Array.isArray(rows) ? rows : [];
  const pendingTypeCounts = new Map<string, { type: string; count: number; category: 'configuration' | 'operational' }>();
  const byPatient = new Map<string, any>();
  const byProfessional = new Map<string, any>();
  const byPayer = new Map<string, any>();
  const byServiceType = new Map<string, any>();
  const byProcedure = new Map<string, any>();
  const byTussCode = new Map<string, any>();
  const byGuideType = new Map<string, any>();

  const kpis = {
    totalSessions: safeRows.length,
    ready: 0,
    pending: 0,
    warning: 0,
    notBillable: 0,
    open: 0,
    draft: 0,
    unknown: 0,
    actualMinutes: 0,
    scheduledMinutes: 0,
    pendingSignatures: 0,
    pendingReports: 0,
    pendingGuides: 0,
    pendingAuthorizations: 0,
    pendingDocuments: 0
  };

  for (const row of safeRows) {
    const status = normalizeConferenceStatus(row.readiness_status);
    const scheduled = Math.max(0, Math.round(Number(row.scheduled_minutes || 0)));
    const actual = Math.max(0, Math.round(Number(row.actual_minutes || 0)));
    const pendingDetails = classifyConferencePendingDetails(row);
    const pendingKinds = pendingDetails.blocking;
    const serviceType = String(row.service_type || 'Sessao').trim() || 'Sessao';
    const patientName = String(row.patient_name || 'Paciente').trim() || 'Paciente';
    const professionalName = String(row.professional_name || 'Equipe').trim() || 'Equipe';
    const payerName = String(row.payer_name || row.payer_name_snapshot || 'Sem pagador').trim() || 'Sem pagador';
    const procedureName = String(row.internal_procedure_name || 'Sem procedimento').trim() || 'Sem procedimento';
    const tussCode = String(row.tuss_code || 'Sem TUSS').trim() || 'Sem TUSS';
    const guideType = String(row.guide_type || 'Sem guia provavel').trim() || 'Sem guia provavel';

    if (status === 'READY') kpis.ready += 1;
    else if (status === 'PENDING') kpis.pending += 1;
    else if (status === 'WARNING') kpis.warning += 1;
    else if (status === 'NOT_BILLABLE') kpis.notBillable += 1;
    else if (status === 'DRAFT') {
      kpis.draft += 1;
      kpis.open += 1;
    }
    else kpis.unknown += 1;
    kpis.scheduledMinutes += scheduled;
    if (status !== 'NOT_BILLABLE') kpis.actualMinutes += actual;
    if (pendingDetails.operational.includes('Assinatura')) kpis.pendingSignatures += 1;
    if (pendingDetails.operational.includes('Relatorio')) kpis.pendingReports += 1;
    if (pendingDetails.operational.includes('Guia')) kpis.pendingGuides += 1;
    if (pendingDetails.operational.includes('Autorizacao')) kpis.pendingAuthorizations += 1;
    if (pendingDetails.operational.includes('Documento')) kpis.pendingDocuments += 1;
    const addPendingTypeCount = (kind: string, category: 'configuration' | 'operational') => {
      const current = pendingTypeCounts.get(kind) || { type: kind, count: 0, category };
      pendingTypeCounts.set(kind, { ...current, count: current.count + 1, category: current.category || category });
    };
    pendingDetails.configuration.forEach((kind) => addPendingTypeCount(kind, 'configuration'));
    pendingDetails.operational.forEach((kind) => addPendingTypeCount(kind, 'operational'));

    const patientKey = String(row.patient_id || patientName);
    const patient = byPatient.get(patientKey) || {
      id: patientKey,
      name: patientName,
      totalSessions: 0,
      realizedSessions: 0,
      cancelledSessions: 0,
      noShowSessions: 0,
      readySessions: 0,
      pendingSessions: 0,
      pendingSignatures: 0,
      pendingReports: 0,
      scheduledMinutes: 0,
      actualMinutes: 0,
      serviceTypes: {}
    };
    patient.totalSessions += 1;
    patient.realizedSessions += actual > 0 ? 1 : 0;
    patient.readySessions += status === 'READY' ? 1 : 0;
    patient.pendingSessions += status === 'PENDING' ? 1 : 0;
    patient.pendingSignatures += pendingDetails.operational.includes('Assinatura') ? 1 : 0;
    patient.pendingReports += pendingDetails.operational.includes('Relatorio') ? 1 : 0;
    patient.serviceTypes[serviceType] = (patient.serviceTypes[serviceType] || 0) + actual;
    addMinutes(patient, scheduled, actual);
    byPatient.set(patientKey, patient);

    const professionalKey = String(row.professional_id || professionalName);
    const professional = byProfessional.get(professionalKey) || {
      id: professionalKey,
      name: professionalName,
      workedDays: new Set<string>(),
      totalSessions: 0,
      realizedSessions: 0,
      cancelledSessions: 0,
      noShowSessions: 0,
      pendingReports: 0,
      scheduledMinutes: 0,
      actualMinutes: 0,
      serviceTypes: {}
    };
    professional.totalSessions += 1;
    professional.realizedSessions += actual > 0 ? 1 : 0;
    professional.pendingReports += pendingDetails.operational.includes('Relatorio') ? 1 : 0;
    if (actual > 0 && row.scheduled_start) professional.workedDays.add(String(row.scheduled_start).slice(0, 10));
    professional.serviceTypes[serviceType] = (professional.serviceTypes[serviceType] || 0) + actual;
    addMinutes(professional, scheduled, actual);
    byProfessional.set(professionalKey, professional);

    const payerKey = String(row.payer_id || payerName);
    const payer = byPayer.get(payerKey) || {
      id: payerKey,
      payerName,
      totalSessions: 0,
      ready: 0,
      pending: 0,
      pendingGuides: 0,
      pendingAuthorizations: 0,
      pendingSignatures: 0,
      pendingReports: 0,
      durationWarnings: 0,
      pendingTypes: {}
    };
    payer.totalSessions += 1;
    payer.ready += status === 'READY' ? 1 : 0;
    payer.pending += status === 'PENDING' ? 1 : 0;
    payer.pendingGuides += pendingDetails.operational.includes('Guia') ? 1 : 0;
    payer.pendingAuthorizations += pendingDetails.operational.includes('Autorizacao') ? 1 : 0;
    payer.pendingSignatures += pendingDetails.operational.includes('Assinatura') ? 1 : 0;
    payer.pendingReports += pendingDetails.operational.includes('Relatorio') ? 1 : 0;
    payer.durationWarnings += pendingDetails.operational.includes('Duracao') ? 1 : 0;
    pendingKinds.forEach((kind) => { payer.pendingTypes[kind] = (payer.pendingTypes[kind] || 0) + 1; });
    byPayer.set(payerKey, payer);

    const service = byServiceType.get(serviceType) || {
      serviceType,
      totalSessions: 0,
      realizedSessions: 0,
      scheduledMinutes: 0,
      actualMinutes: 0,
      pending: 0
    };
    service.totalSessions += 1;
    service.realizedSessions += actual > 0 ? 1 : 0;
    service.pending += status === 'PENDING' ? 1 : 0;
    addMinutes(service, scheduled, actual);
    byServiceType.set(serviceType, service);

    const procedure = byProcedure.get(procedureName) || {
      name: procedureName,
      internalCode: row.internal_procedure_code || '',
      totalSessions: 0,
      ready: 0,
      pending: 0,
      expectedAmountCents: 0
    };
    procedure.totalSessions += 1;
    procedure.ready += status === 'READY' ? 1 : 0;
    procedure.pending += pendingKinds.length > 0 ? 1 : 0;
    procedure.expectedAmountCents += Number(row.billing_amount_cents || row.expected_amount_cents || 0) || 0;
    byProcedure.set(procedureName, procedure);

    const tuss = byTussCode.get(tussCode) || {
      code: tussCode,
      description: row.tuss_description || '',
      version: row.tuss_version || '',
      totalSessions: 0,
      ready: 0,
      pending: 0,
      expectedAmountCents: 0
    };
    tuss.totalSessions += 1;
    tuss.ready += status === 'READY' ? 1 : 0;
    tuss.pending += pendingKinds.length > 0 ? 1 : 0;
    tuss.expectedAmountCents += Number(row.billing_amount_cents || row.expected_amount_cents || 0) || 0;
    byTussCode.set(tussCode, tuss);

    const guide = byGuideType.get(guideType) || {
      guideType,
      totalSessions: 0,
      ready: 0,
      pending: 0,
      expectedAmountCents: 0
    };
    guide.totalSessions += 1;
    guide.ready += status === 'READY' ? 1 : 0;
    guide.pending += pendingKinds.length > 0 ? 1 : 0;
    guide.expectedAmountCents += Number(row.billing_amount_cents || row.expected_amount_cents || 0) || 0;
    byGuideType.set(guideType, guide);
  }

  return {
    kpis,
    pendingByType: Array.from(pendingTypeCounts.values()).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type, 'pt-BR')),
    byPatient: sortByCountAndName(Array.from(byPatient.values())),
    byProfessional: sortByCountAndName(Array.from(byProfessional.values()).map((row) => ({
      ...row,
      workedDaysCount: row.workedDays instanceof Set ? row.workedDays.size : Number(row.workedDaysCount || 0),
      workedDays: undefined
    }))),
    byPayer: sortByCountAndName(Array.from(byPayer.values())),
    byServiceType: sortByCountAndName(Array.from(byServiceType.values()), 'actualMinutes'),
    byProcedure: sortByCountAndName(Array.from(byProcedure.values())),
    byTussCode: sortByCountAndName(Array.from(byTussCode.values())),
    byGuideType: sortByCountAndName(Array.from(byGuideType.values()))
  };
}

export const MONTHLY_CONFERENCE_EXPORT_FIELDS = [
  'competenceMonth',
  'clinicName',
  'unitName',
  'scheduledDate',
  'startTime',
  'endTime',
  'patientName',
  'professionalName',
  'professionalRegistry',
  'serviceType',
  'internalProcedureCode',
  'internalProcedureName',
  'tussCode',
  'tussDescription',
  'tussVersion',
  'guideType',
  'billingUnit',
  'billingQuantity',
  'billingUnitAmount',
  'billingExpectedAmount',
  'tussMappingStatus',
  'tussPendingReasons',
  'tussMappingValidFrom',
  'tussMappingValidTo',
  'payerName',
  'financialPlanName',
  'insuranceCardNumber',
  'guideNumber',
  'authorizationCode',
  'copaymentAmount',
  'expectedAmount',
  'financialStatus',
  'scheduledMinutes',
  'actualMinutes',
  'appointmentStatus',
  'readinessStatus',
  'conferenceStatus',
  'exportStatus',
  'signaturePresent',
  'reportPresent',
  'pendingDocuments',
  'pendingDetails',
  'pendingKinds',
  'guideStatus',
  'authorizationStatus',
  'exportedAt',
  'exportedBy',
  'exportId',
  'notes',
  'name',
  'payerName',
  'totalSessions',
  'realizedSessions',
  'ready',
  'pending',
  'workedDaysCount',
  'pendingSignatures',
  'pendingReports',
  'pendingGuides',
  'pendingAuthorizations'
] as const;

export function buildMonthlyConferenceExportRows(rows: MonthlyConferenceRow[]) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const pendingDetails = classifyConferencePendingDetails(row);
    return {
      competenceMonth: competenceMonth(row.scheduled_start),
      clinicName: row.clinic_name || '',
      unitName: row.unit_name || '',
      scheduledDate: clinicDateOnly(row.scheduled_start),
      startTime: formatTimeOnly(row.scheduled_start || row.actual_start),
      endTime: formatTimeOnly(row.scheduled_end || row.actual_end),
      patientName: row.patient_name || 'Paciente',
      professionalName: row.professional_name || 'Equipe',
      professionalRegistry: row.professional_registry || '',
      serviceType: row.service_type || 'Sessao',
      internalProcedureCode: row.internal_procedure_code || '',
      internalProcedureName: row.internal_procedure_name || 'Procedimento nao configurado',
      tussCode: row.tuss_code || 'TUSS nao configurado',
      tussDescription: row.tuss_description || '',
      tussVersion: row.tuss_version || '',
      guideType: row.guide_type || '',
      billingUnit: row.billing_unit || '',
      billingQuantity: row.billing_quantity ?? '',
      billingUnitAmount: row.billing_unit_amount_cents ? formatCurrencyCents(row.billing_unit_amount_cents) : '',
      billingExpectedAmount: row.billing_amount_cents ? formatCurrencyCents(row.billing_amount_cents) : 'Valor nao configurado',
      tussMappingStatus: row.tuss_mapping_status === 'configured' ? 'Configurado' : 'Pendente de configuracao',
      tussPendingReasons: Array.isArray(row.tuss_pending_reasons) ? row.tuss_pending_reasons.join('; ') : '',
      tussMappingValidFrom: row.tuss_mapping_valid_from || '',
      tussMappingValidTo: row.tuss_mapping_valid_to || '',
      payerName: row.payer_name || row.payer_name_snapshot || 'Sem pagador',
      financialPlanName: row.financial_plan_name || '',
      insuranceCardNumber: row.insurance_card_number || '',
      guideNumber: row.guide_number || '',
      authorizationCode: row.authorization_code || '',
      copaymentAmount: formatCurrencyCents(row.copayment_amount_cents),
      expectedAmount: row.expected_amount_cents ? formatCurrencyCents(row.expected_amount_cents) : 'Valor nao configurado',
      financialStatus: row.financial_status || '',
      scheduledMinutes: Math.round(Number(row.scheduled_minutes || 0)),
      actualMinutes: Math.round(Number(row.actual_minutes || 0)),
      appointmentStatus: row.appointment_status || (Number(row.actual_minutes || 0) > 0 ? 'Realizada' : isNotBillableRow(row) ? 'Nao faturavel' : 'Agendada'),
      readinessStatus: normalizeConferenceStatus(row.readiness_status),
      conferenceStatus: row.conference_status_label || row.conference_status || 'A revisar',
      exportStatus: row.export_status || (row.export_id ? 'Exportado' : 'Nao exportado'),
      signaturePresent: pendingDetails.operational.includes('Assinatura') ? 'Nao' : pendingDetails.notApplicable.includes('Assinatura') ? 'Ainda nao aplicavel' : 'Sim',
      reportPresent: pendingDetails.operational.includes('Relatorio') ? 'Nao' : pendingDetails.notApplicable.includes('Relatorio') ? 'Ainda nao aplicavel' : 'Sim',
      pendingDocuments: Math.max(0, Math.round(Number(row.required_document_pending_count || 0))),
      pendingDetails: formatConferencePendingSummary(row),
      pendingKinds: pendingDetails.blocking.join('; '),
      guideStatus: row.guide_number ? 'Informada' : pendingDetails.operational.includes('Guia') ? 'Pendente' : 'Nao exigida/informativa',
      authorizationStatus: row.authorization_code ? 'Informada' : pendingDetails.operational.includes('Autorizacao') ? 'Pendente' : 'Nao exigida/informativa',
      exportedAt: row.exported_at || '',
      exportedBy: row.exported_by_name || '',
      exportId: row.export_id || '',
      notes: row.notes || ''
    };
  });
}

export function rowsToCsv(rows: any[], fields: string[]) {
  const safeFields = fields.filter((field) => MONTHLY_CONFERENCE_EXPORT_FIELDS.includes(field as any));
  const header = safeFields.join(',');
  const escape = (value: any) => {
    const text = String(value ?? '');
    return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = rows.map((row) => safeFields.map((field) => escape(row[field])).join(','));
  return [header, ...body].join('\n');
}
