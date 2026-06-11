export type MonthlyConferenceStatus = 'READY' | 'PENDING' | 'WARNING' | 'NOT_BILLABLE' | 'DRAFT' | 'UNKNOWN';

export type MonthlyConferenceRow = {
  appointment_id?: string | null;
  patient_id?: string | null;
  patient_name?: string | null;
  professional_id?: string | null;
  professional_name?: string | null;
  service_type?: string | null;
  payer_id?: string | null;
  payer_name?: string | null;
  payer_name_snapshot?: string | null;
  clinic_name?: string | null;
  unit_name?: string | null;
  financial_plan_name?: string | null;
  insurance_card_number?: string | null;
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
  pendingByType: Array<{ type: string; count: number }>;
  byPatient: any[];
  byProfessional: any[];
  byPayer: any[];
  byServiceType: any[];
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
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(11, 16);
}

function competenceMonth(value: any): string {
  const text = String(value || '');
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

export function classifyConferencePendingKinds(row: MonthlyConferenceRow): string[] {
  const kinds = new Set<string>();
  if (hasIssue(row, [/assinatura/, /signature/])) kinds.add('Assinatura');
  if (hasIssue(row, [/relatorio/, /evolucao/, /report/])) kinds.add('Relatorio');
  if (!String(row.guide_number || '').trim() && hasIssue(row, [/guia/, /guide/])) kinds.add('Guia');
  if (!String(row.authorization_code || '').trim() && hasIssue(row, [/autorizacao/, /authorization/])) kinds.add('Autorizacao');
  if (hasIssue(row, [/duracao/, /duration/])) kinds.add('Duracao');
  if (hasIssue(row, [/profissional/, /professional/])) kinds.add('Profissional');
  if (hasIssue(row, [/pagador/, /convenio/, /payer/])) kinds.add('Pagador');
  if (Number(row.required_document_pending_count || 0) > 0 || hasIssue(row, [/documento/, /document/])) kinds.add('Documento');
  return Array.from(kinds);
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
  const pendingTypeCounts = new Map<string, number>();
  const byPatient = new Map<string, any>();
  const byProfessional = new Map<string, any>();
  const byPayer = new Map<string, any>();
  const byServiceType = new Map<string, any>();

  const kpis = {
    totalSessions: safeRows.length,
    ready: 0,
    pending: 0,
    warning: 0,
    notBillable: 0,
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
    const pendingKinds = classifyConferencePendingKinds(row);
    const serviceType = String(row.service_type || 'Sessao').trim() || 'Sessao';
    const patientName = String(row.patient_name || 'Paciente').trim() || 'Paciente';
    const professionalName = String(row.professional_name || 'Equipe').trim() || 'Equipe';
    const payerName = String(row.payer_name || row.payer_name_snapshot || 'Sem pagador').trim() || 'Sem pagador';

    if (status === 'READY') kpis.ready += 1;
    else if (status === 'PENDING') kpis.pending += 1;
    else if (status === 'WARNING') kpis.warning += 1;
    else if (status === 'NOT_BILLABLE') kpis.notBillable += 1;
    else if (status === 'DRAFT') kpis.draft += 1;
    else kpis.unknown += 1;
    kpis.scheduledMinutes += scheduled;
    if (status !== 'NOT_BILLABLE') kpis.actualMinutes += actual;
    if (pendingKinds.includes('Assinatura')) kpis.pendingSignatures += 1;
    if (pendingKinds.includes('Relatorio')) kpis.pendingReports += 1;
    if (pendingKinds.includes('Guia')) kpis.pendingGuides += 1;
    if (pendingKinds.includes('Autorizacao')) kpis.pendingAuthorizations += 1;
    if (pendingKinds.includes('Documento')) kpis.pendingDocuments += 1;
    pendingKinds.forEach((kind) => pendingTypeCounts.set(kind, (pendingTypeCounts.get(kind) || 0) + 1));

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
    patient.pendingSignatures += pendingKinds.includes('Assinatura') ? 1 : 0;
    patient.pendingReports += pendingKinds.includes('Relatorio') ? 1 : 0;
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
    professional.pendingReports += pendingKinds.includes('Relatorio') ? 1 : 0;
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
    payer.pendingGuides += pendingKinds.includes('Guia') ? 1 : 0;
    payer.pendingAuthorizations += pendingKinds.includes('Autorizacao') ? 1 : 0;
    payer.pendingSignatures += pendingKinds.includes('Assinatura') ? 1 : 0;
    payer.pendingReports += pendingKinds.includes('Relatorio') ? 1 : 0;
    payer.durationWarnings += pendingKinds.includes('Duracao') ? 1 : 0;
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
  }

  return {
    kpis,
    pendingByType: Array.from(pendingTypeCounts.entries()).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    byPatient: sortByCountAndName(Array.from(byPatient.values())),
    byProfessional: sortByCountAndName(Array.from(byProfessional.values()).map((row) => ({
      ...row,
      workedDaysCount: row.workedDays instanceof Set ? row.workedDays.size : Number(row.workedDaysCount || 0),
      workedDays: undefined
    }))),
    byPayer: sortByCountAndName(Array.from(byPayer.values())),
    byServiceType: sortByCountAndName(Array.from(byServiceType.values()), 'actualMinutes')
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
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    competenceMonth: competenceMonth(row.scheduled_start),
    clinicName: row.clinic_name || '',
    unitName: row.unit_name || '',
    scheduledDate: String(row.scheduled_start || '').slice(0, 10),
    startTime: formatTimeOnly(row.scheduled_start || row.actual_start),
    endTime: formatTimeOnly(row.scheduled_end || row.actual_end),
    patientName: row.patient_name || 'Paciente',
    professionalName: row.professional_name || 'Equipe',
    professionalRegistry: row.professional_registry || '',
    serviceType: row.service_type || 'Sessao',
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
    appointmentStatus: row.appointment_status || (Number(row.actual_minutes || 0) > 0 ? 'Realizada' : 'Agendada'),
    readinessStatus: normalizeConferenceStatus(row.readiness_status),
    conferenceStatus: row.conference_status_label || row.conference_status || 'A revisar',
    exportStatus: row.export_status || (row.export_id ? 'Exportado' : 'Nao exportado'),
    signaturePresent: classifyConferencePendingKinds(row).includes('Assinatura') ? 'Nao' : 'Sim',
    reportPresent: classifyConferencePendingKinds(row).includes('Relatorio') ? 'Nao' : 'Sim',
    pendingDocuments: Math.max(0, Math.round(Number(row.required_document_pending_count || 0))),
    pendingDetails: Array.isArray(row.main_issues) ? row.main_issues.join('; ') : '',
    pendingKinds: classifyConferencePendingKinds(row).join('; '),
    guideStatus: row.guide_number ? 'Informada' : 'Pendente/nao exigida',
    authorizationStatus: row.authorization_code ? 'Informada' : 'Pendente/nao exigida',
    exportedAt: row.exported_at || '',
    exportedBy: row.exported_by_name || '',
    exportId: row.export_id || '',
    notes: row.notes || ''
  }));
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
