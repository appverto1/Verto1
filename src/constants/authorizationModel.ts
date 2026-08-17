export const CANONICAL_CLINIC_BASE_ROLES = [
  'director',
  'coordinator',
  'therapist',
  'receptionist',
  'biller',
] as const;

// `supervisor` remains recognized only for backwards compatibility with
// memberships created before supervision became a contextual capability of a
// professional. New accounts must use `therapist` + `can_supervise`.
export const CLINIC_BASE_ROLES = [
  ...CANONICAL_CLINIC_BASE_ROLES,
  'supervisor',
] as const;

export type ClinicBaseRole = (typeof CLINIC_BASE_ROLES)[number];
export type PortalRole = 'patient';
export type LegacyPlatformRole = 'owner' | 'admin';
export type VertoAuthorizationRole = ClinicBaseRole | PortalRole | LegacyPlatformRole;

export const AUTHORIZATION_SCOPES = [
  'ACTIVE_CLINIC',
  'AUTHORIZED_CLINICS',
  'ASSIGNED_PATIENTS',
  'SUPERVISED_CASES',
  'OWN_RESOURCES',
  'BILLING_SCOPE',
  'SELF_OR_DEPENDENTS',
  'PLATFORM',
] as const;

export type AuthorizationScope = (typeof AUTHORIZATION_SCOPES)[number];

export const CAPABILITY_DOMAINS = [
  'clinic',
  'team',
  'patient',
  'insurance',
  'clinical',
  'treatment',
  'school',
  'aba',
  'calendar',
  'session',
  'finance',
  'billing',
  'documents',
  'communication',
  'reports',
  'portal',
] as const;

export type CapabilityDomain = (typeof CAPABILITY_DOMAINS)[number];

export type CapabilityDefinition = {
  key: string;
  label: string;
  domain: CapabilityDomain;
  delegable: boolean;
  sensitive?: boolean;
};

export const CAPABILITY_CATALOG = [
  { key: 'clinic.view', label: 'Visualizar dados da unidade', domain: 'clinic', delegable: true },
  { key: 'clinic.edit', label: 'Editar dados da unidade', domain: 'clinic', delegable: true, sensitive: true },
  { key: 'clinic.settings.view', label: 'Visualizar configurações da clínica', domain: 'clinic', delegable: true },
  { key: 'clinic.settings.edit', label: 'Editar configurações da clínica', domain: 'clinic', delegable: false, sensitive: true },
  { key: 'clinic.rooms.manage', label: 'Gerenciar salas e locais de atendimento', domain: 'clinic', delegable: true },
  { key: 'clinic.indicators.view', label: 'Visualizar indicadores gerais da clínica', domain: 'clinic', delegable: true },
  { key: 'workspace.switch', label: 'Alternar entre unidades autorizadas', domain: 'clinic', delegable: true },
  { key: 'workspace.multiclinic.analytics', label: 'Visualizar dados consolidados de múltiplas unidades', domain: 'clinic', delegable: true, sensitive: true },

  { key: 'team.view', label: 'Visualizar equipe da clínica', domain: 'team', delegable: true },
  { key: 'team.invite', label: 'Convidar profissionais', domain: 'team', delegable: false, sensitive: true },
  { key: 'team.edit', label: 'Editar profissionais', domain: 'team', delegable: true, sensitive: true },
  { key: 'team.deactivate', label: 'Desativar profissionais', domain: 'team', delegable: true, sensitive: true },
  { key: 'team.permissions.manage', label: 'Definir papéis e permissões', domain: 'team', delegable: true, sensitive: true },
  { key: 'team.case.manage', label: 'Gerenciar equipe do caso dos pacientes', domain: 'team', delegable: true, sensitive: true },
  { key: 'team.patient_primary.manage', label: 'Definir profissional responsável pelo paciente', domain: 'team', delegable: true, sensitive: true },
  { key: 'team.supervision.manage', label: 'Gerenciar vínculos de supervisão', domain: 'team', delegable: true, sensitive: true },

  { key: 'patient.list', label: 'Visualizar lista de pacientes', domain: 'patient', delegable: true },
  { key: 'patient.create', label: 'Cadastrar pacientes', domain: 'patient', delegable: true },
  { key: 'patient.demographics.view', label: 'Visualizar dados cadastrais do paciente', domain: 'patient', delegable: true },
  { key: 'patient.demographics.edit', label: 'Editar dados cadastrais do paciente', domain: 'patient', delegable: true },
  { key: 'patient.contacts.view', label: 'Visualizar contatos e responsáveis', domain: 'patient', delegable: true },
  { key: 'patient.birthdays.view', label: 'Visualizar aniversários', domain: 'patient', delegable: true },
  { key: 'patient.documents.registration.view', label: 'Visualizar documentos cadastrais', domain: 'patient', delegable: true },
  { key: 'patient.clinic_link.manage', label: 'Gerenciar vínculo do paciente com a clínica', domain: 'patient', delegable: true, sensitive: true },
  { key: 'patient.archive', label: 'Arquivar ou desativar paciente', domain: 'patient', delegable: true, sensitive: true },

  { key: 'patient.insurance.view', label: 'Visualizar convênio do paciente', domain: 'insurance', delegable: true },
  { key: 'patient.insurance.create', label: 'Cadastrar convênio do paciente', domain: 'insurance', delegable: true },
  { key: 'patient.insurance.edit', label: 'Editar dados do convênio', domain: 'insurance', delegable: true },
  { key: 'patient.insurance.card.view', label: 'Visualizar carteirinha e validade', domain: 'insurance', delegable: true },
  { key: 'patient.insurance.authorization.view', label: 'Visualizar autorizações', domain: 'insurance', delegable: true },
  { key: 'patient.insurance.authorization.edit', label: 'Editar autorizações', domain: 'insurance', delegable: true, sensitive: true },
  { key: 'patient.insurance.eligibility.view', label: 'Visualizar elegibilidade e observações de convênio', domain: 'insurance', delegable: true },

  { key: 'clinical.record.view', label: 'Abrir prontuário do paciente', domain: 'clinical', delegable: true, sensitive: true },
  { key: 'clinical.history.view', label: 'Visualizar histórico clínico', domain: 'clinical', delegable: true, sensitive: true },
  { key: 'clinical.evolution.create', label: 'Criar evolução clínica', domain: 'clinical', delegable: true, sensitive: true },
  { key: 'clinical.evolution.own_edit', label: 'Editar evolução própria', domain: 'clinical', delegable: true, sensitive: true },
  { key: 'clinical.evolution.team_view', label: 'Visualizar evoluções de outros profissionais do caso', domain: 'clinical', delegable: true, sensitive: true },
  { key: 'clinical.notes.create', label: 'Adicionar notas clínicas', domain: 'clinical', delegable: true, sensitive: true },
  { key: 'clinical.documents.view', label: 'Visualizar documentos clínicos', domain: 'clinical', delegable: true, sensitive: true },
  { key: 'clinical.documents.upload', label: 'Enviar documentos ao prontuário', domain: 'clinical', delegable: true, sensitive: true },
  { key: 'clinical.anamnesis.view', label: 'Visualizar anamnese', domain: 'clinical', delegable: true, sensitive: true },
  { key: 'clinical.anamnesis.edit', label: 'Preencher ou editar anamnese', domain: 'clinical', delegable: true, sensitive: true },

  { key: 'treatment_plan.view', label: 'Visualizar plano terapêutico', domain: 'treatment', delegable: true, sensitive: true },
  { key: 'treatment_plan.create', label: 'Criar plano terapêutico', domain: 'treatment', delegable: true, sensitive: true },
  { key: 'treatment_plan.edit', label: 'Editar plano terapêutico', domain: 'treatment', delegable: true, sensitive: true },
  { key: 'treatment_plan.approve', label: 'Aprovar plano terapêutico', domain: 'treatment', delegable: true, sensitive: true },
  { key: 'treatment_goal.view', label: 'Visualizar metas e objetivos', domain: 'treatment', delegable: true, sensitive: true },
  { key: 'treatment_goal.manage', label: 'Criar ou editar metas e objetivos', domain: 'treatment', delegable: true, sensitive: true },

  { key: 'school.view', label: 'Visualizar informações escolares', domain: 'school', delegable: true, sensitive: true },
  { key: 'school.manage', label: 'Gerenciar escolas, unidades, contatos e vínculos escolares', domain: 'school', delegable: true, sensitive: true },
  { key: 'school.meetings.manage', label: 'Gerenciar reuniões e acompanhamento escolar', domain: 'school', delegable: true, sensitive: true },

  { key: 'aba.program.view', label: 'Visualizar programas ABA', domain: 'aba', delegable: true, sensitive: true },
  { key: 'aba.program.create', label: 'Criar programas ABA', domain: 'aba', delegable: true, sensitive: true },
  { key: 'aba.program.edit', label: 'Editar programas ABA', domain: 'aba', delegable: true, sensitive: true },
  { key: 'aba.trial.record', label: 'Registrar tentativas ou trials', domain: 'aba', delegable: true, sensitive: true },
  { key: 'aba.behavior.record', label: 'Registrar eventos comportamentais', domain: 'aba', delegable: true, sensitive: true },
  { key: 'aba.analytics.view', label: 'Visualizar gráficos e evolução ABA', domain: 'aba', delegable: true, sensitive: true },
  { key: 'aba.mastery.view', label: 'Visualizar critérios de domínio', domain: 'aba', delegable: true, sensitive: true },
  { key: 'aba.maintenance.manage', label: 'Gerenciar manutenção de habilidades', domain: 'aba', delegable: true, sensitive: true },
  { key: 'aba.suggestions.view', label: 'Visualizar sugestões clínicas', domain: 'aba', delegable: true, sensitive: true },
  { key: 'aba.suggestions.apply', label: 'Aplicar sugestões ao próximo atendimento', domain: 'aba', delegable: true, sensitive: true },
  { key: 'aba.next_session.view', label: 'Visualizar plano da próxima sessão', domain: 'aba', delegable: true, sensitive: true },

  { key: 'calendar.clinic.view', label: 'Visualizar agenda da clínica', domain: 'calendar', delegable: true },
  { key: 'calendar.own.view', label: 'Visualizar somente a própria agenda', domain: 'calendar', delegable: true },
  { key: 'calendar.team.view', label: 'Visualizar agenda de outros profissionais', domain: 'calendar', delegable: true },
  { key: 'calendar.appointment.create', label: 'Criar agendamentos', domain: 'calendar', delegable: true },
  { key: 'calendar.appointment.edit', label: 'Editar agendamentos', domain: 'calendar', delegable: true },
  { key: 'calendar.appointment.cancel', label: 'Cancelar agendamentos', domain: 'calendar', delegable: true },
  { key: 'calendar.appointment.reschedule', label: 'Remarcar atendimentos', domain: 'calendar', delegable: true },
  { key: 'calendar.attendance.confirm', label: 'Confirmar presença do paciente', domain: 'calendar', delegable: true },
  { key: 'calendar.no_show.record', label: 'Registrar falta', domain: 'calendar', delegable: true },
  { key: 'calendar.requests.manage', label: 'Gerenciar solicitações de remarcação ou cancelamento', domain: 'calendar', delegable: true },

  { key: 'session.start', label: 'Iniciar sessão clínica', domain: 'session', delegable: true, sensitive: true },
  { key: 'session.finish', label: 'Encerrar sessão clínica', domain: 'session', delegable: true, sensitive: true },
  { key: 'session.data.write', label: 'Registrar dados da sessão', domain: 'session', delegable: true, sensitive: true },
  { key: 'session.history.view', label: 'Visualizar sessões anteriores', domain: 'session', delegable: true, sensitive: true },
  { key: 'session.closed.edit_own', label: 'Editar sessão própria encerrada', domain: 'session', delegable: true, sensitive: true },
  { key: 'session.no_show.classify', label: 'Classificar falta ou ausência', domain: 'session', delegable: true },
  { key: 'session.billing_evidence.generate', label: 'Gerar evidências para faturamento', domain: 'session', delegable: true, sensitive: true },

  { key: 'finance.payments.view', label: 'Visualizar pagamentos de pacientes', domain: 'finance', delegable: true, sensitive: true },
  { key: 'finance.payments.receive', label: 'Registrar recebimento', domain: 'finance', delegable: true, sensitive: true },
  { key: 'finance.payments.edit', label: 'Editar recebimento', domain: 'finance', delegable: true, sensitive: true },
  { key: 'finance.delinquency.view', label: 'Visualizar inadimplência', domain: 'finance', delegable: true, sensitive: true },
  { key: 'finance.entries.view', label: 'Visualizar contas e lançamentos financeiros', domain: 'finance', delegable: true, sensitive: true },
  { key: 'finance.entries.manage', label: 'Criar ou editar lançamentos financeiros', domain: 'finance', delegable: true, sensitive: true },
  { key: 'finance.reports.view', label: 'Visualizar relatórios financeiros', domain: 'finance', delegable: true, sensitive: true },
  { key: 'finance.indicators.view', label: 'Visualizar indicadores financeiros consolidados', domain: 'finance', delegable: true, sensitive: true },

  { key: 'billing.sessions.view', label: 'Visualizar atendimentos faturáveis', domain: 'billing', delegable: true, sensitive: true },
  { key: 'billing.preguide.view', label: 'Visualizar pré-guias', domain: 'billing', delegable: true, sensitive: true },
  { key: 'billing.preguide.manage', label: 'Criar ou revisar pré-guias', domain: 'billing', delegable: true, sensitive: true },
  { key: 'billing.mapping.manage', label: 'Gerenciar De/Para TISS', domain: 'billing', delegable: true, sensitive: true },
  { key: 'billing.tuss.manage', label: 'Gerenciar códigos TUSS', domain: 'billing', delegable: true, sensitive: true },
  { key: 'billing.antiglosa.view', label: 'Visualizar checklist antiglosa', domain: 'billing', delegable: true, sensitive: true },
  { key: 'billing.antiglosa.manage', label: 'Corrigir pendências antiglosa', domain: 'billing', delegable: true, sensitive: true },
  { key: 'billing.batch.create', label: 'Criar lotes de faturamento', domain: 'billing', delegable: true, sensitive: true },
  { key: 'billing.xml.generate', label: 'Gerar XML TISS', domain: 'billing', delegable: true, sensitive: true },
  { key: 'billing.xml.validate', label: 'Validar XML TISS', domain: 'billing', delegable: true, sensitive: true },
  { key: 'billing.xml.export', label: 'Enviar ou exportar XML TISS', domain: 'billing', delegable: true, sensitive: true },
  { key: 'billing.operator_return.manage', label: 'Registrar retorno da operadora', domain: 'billing', delegable: true, sensitive: true },
  { key: 'billing.amount.submitted', label: 'Registrar valor apresentado', domain: 'billing', delegable: true, sensitive: true },
  { key: 'billing.amount.paid', label: 'Registrar valor pago', domain: 'billing', delegable: true, sensitive: true },
  { key: 'billing.denial.manage', label: 'Registrar glosa', domain: 'billing', delegable: true, sensitive: true },
  { key: 'billing.financial_settlement', label: 'Fazer baixa financeira do convênio', domain: 'billing', delegable: true, sensitive: true },

  { key: 'patient.files.view', label: 'Visualizar arquivos do paciente', domain: 'documents', delegable: true, sensitive: true },
  { key: 'patient.files.upload', label: 'Enviar arquivos do paciente', domain: 'documents', delegable: true, sensitive: true },
  { key: 'patient.files.archive', label: 'Excluir ou arquivar arquivos', domain: 'documents', delegable: true, sensitive: true },
  { key: 'documents.patient_share', label: 'Compartilhar documentos com paciente ou responsável', domain: 'documents', delegable: true, sensitive: true },

  { key: 'communication.reminders.send', label: 'Enviar lembretes de consulta', domain: 'communication', delegable: true },
  { key: 'communication.clinic_notifications.manage', label: 'Gerenciar notificações da clínica', domain: 'communication', delegable: true },

  { key: 'reports.dashboard.view', label: 'Visualizar dashboard da unidade', domain: 'reports', delegable: true },
  { key: 'reports.productivity.view', label: 'Visualizar produtividade dos profissionais', domain: 'reports', delegable: true, sensitive: true },
  { key: 'reports.appointments.view', label: 'Visualizar volume de atendimentos', domain: 'reports', delegable: true },
  { key: 'reports.billing.view', label: 'Visualizar indicadores de faturamento', domain: 'reports', delegable: true, sensitive: true },
  { key: 'reports.clinical.indicators', label: 'Visualizar indicadores clínicos consolidados', domain: 'reports', delegable: true, sensitive: true },
  { key: 'reports.view', label: 'Visualizar relatórios', domain: 'reports', delegable: true },
  { key: 'reports.generate', label: 'Gerar relatórios', domain: 'reports', delegable: true },
  { key: 'reports.export', label: 'Exportar relatórios', domain: 'reports', delegable: true, sensitive: true },

  { key: 'portal.view', label: 'Visualizar portal do paciente', domain: 'portal', delegable: false },
  { key: 'portal.self_data.view', label: 'Visualizar dados próprios no portal', domain: 'portal', delegable: false },
  { key: 'portal.appointments.view', label: 'Visualizar próximos atendimentos', domain: 'portal', delegable: false },
  { key: 'portal.attendance.confirm', label: 'Confirmar presença pelo portal', domain: 'portal', delegable: false },
  { key: 'portal.reschedule.request', label: 'Solicitar remarcação pelo portal', domain: 'portal', delegable: false },
  { key: 'portal.cancel.request', label: 'Solicitar cancelamento pelo portal', domain: 'portal', delegable: false },
  { key: 'portal.notifications.view', label: 'Visualizar notificações', domain: 'portal', delegable: false },
  { key: 'portal.notification_preferences.manage', label: 'Gerenciar próprias preferências de notificação', domain: 'portal', delegable: false },
  { key: 'portal.appointment_volume.view', label: 'Visualizar o próprio volume de atendimentos', domain: 'portal', delegable: false },
] as const satisfies readonly CapabilityDefinition[];

export type CapabilityKey = (typeof CAPABILITY_CATALOG)[number]['key'];

const internal = (...keys: CapabilityKey[]) => keys;

export const SUPERVISION_CAPABILITY_OVERLAY = internal(
  'patient.demographics.view',
  'treatment_plan.create','treatment_plan.edit','treatment_plan.approve','treatment_goal.manage',
  'aba.program.create','aba.program.edit','aba.maintenance.manage',
  'calendar.team.view',
  'reports.clinical.indicators',
);

const COORDINATOR_DEFAULTS = internal(
  'clinic.view','clinic.edit','clinic.settings.view','clinic.settings.edit','clinic.rooms.manage','clinic.indicators.view',
  'team.view','team.edit','team.deactivate','team.permissions.manage','team.case.manage','team.patient_primary.manage','team.supervision.manage',
  'patient.list','patient.create','patient.demographics.view','patient.demographics.edit','patient.contacts.view','patient.birthdays.view','patient.documents.registration.view','patient.clinic_link.manage','patient.archive',
  'patient.insurance.view','patient.insurance.create','patient.insurance.edit','patient.insurance.card.view','patient.insurance.authorization.view','patient.insurance.authorization.edit','patient.insurance.eligibility.view',
  'clinical.record.view','clinical.history.view','clinical.evolution.create','clinical.evolution.own_edit','clinical.evolution.team_view','clinical.notes.create','clinical.documents.view','clinical.documents.upload','clinical.anamnesis.view','clinical.anamnesis.edit',
  'treatment_plan.view','treatment_plan.create','treatment_plan.edit','treatment_plan.approve','treatment_goal.view','treatment_goal.manage',
  'school.view','school.manage','school.meetings.manage',
  'aba.program.view','aba.program.create','aba.program.edit','aba.trial.record','aba.behavior.record','aba.analytics.view','aba.mastery.view','aba.maintenance.manage','aba.suggestions.view','aba.suggestions.apply','aba.next_session.view',
  'calendar.clinic.view','calendar.own.view','calendar.team.view','calendar.appointment.create','calendar.appointment.edit','calendar.appointment.cancel','calendar.appointment.reschedule','calendar.attendance.confirm','calendar.no_show.record','calendar.requests.manage',
  'session.start','session.finish','session.data.write','session.history.view','session.closed.edit_own','session.no_show.classify','session.billing_evidence.generate',
  'finance.payments.view','finance.payments.receive','finance.payments.edit','finance.delinquency.view','finance.entries.view','finance.entries.manage','finance.reports.view','finance.indicators.view',
  'billing.sessions.view','billing.preguide.view','billing.preguide.manage','billing.mapping.manage','billing.tuss.manage','billing.antiglosa.view','billing.antiglosa.manage','billing.batch.create','billing.xml.generate','billing.xml.validate','billing.xml.export','billing.operator_return.manage','billing.amount.submitted','billing.amount.paid','billing.denial.manage','billing.financial_settlement',
  'patient.files.view','patient.files.upload','patient.files.archive','documents.patient_share',
  'communication.reminders.send','communication.clinic_notifications.manage',
  'reports.dashboard.view','reports.productivity.view','reports.appointments.view','reports.billing.view','reports.clinical.indicators','reports.view','reports.generate','reports.export',
);

export const ROLE_DEFAULT_CAPABILITIES: Record<ClinicBaseRole | PortalRole, readonly CapabilityKey[]> = {
  director: [...COORDINATOR_DEFAULTS, 'team.invite', 'workspace.switch', 'workspace.multiclinic.analytics'],
  coordinator: COORDINATOR_DEFAULTS,
  supervisor: internal(
    'team.view',
    'patient.list','patient.demographics.view','patient.documents.registration.view',
    'clinical.record.view','clinical.history.view','clinical.evolution.create','clinical.evolution.own_edit','clinical.evolution.team_view','clinical.notes.create','clinical.documents.view','clinical.documents.upload','clinical.anamnesis.view','clinical.anamnesis.edit',
    'treatment_plan.view','treatment_plan.create','treatment_plan.edit','treatment_plan.approve','treatment_goal.view','treatment_goal.manage',
    'school.view','school.meetings.manage',
    'aba.program.view','aba.program.create','aba.program.edit','aba.analytics.view','aba.mastery.view','aba.maintenance.manage','aba.suggestions.view','aba.suggestions.apply','aba.next_session.view',
    'calendar.own.view','calendar.team.view',
    'session.history.view',
    'patient.files.view','reports.view','reports.generate','reports.clinical.indicators',
  ),
  therapist: internal(
    'team.view',
    'patient.list','patient.birthdays.view','patient.documents.registration.view',
    'clinical.record.view','clinical.history.view','clinical.evolution.create','clinical.evolution.own_edit','clinical.evolution.team_view','clinical.notes.create','clinical.documents.view','clinical.documents.upload','clinical.anamnesis.view','clinical.anamnesis.edit',
    'treatment_plan.view','treatment_goal.view',
    'school.view','school.meetings.manage',
    'aba.program.view','aba.trial.record','aba.behavior.record','aba.analytics.view','aba.mastery.view','aba.suggestions.view','aba.suggestions.apply','aba.next_session.view',
    'calendar.own.view',
    'session.start','session.finish','session.data.write','session.history.view','session.closed.edit_own','session.billing_evidence.generate',
    'patient.files.view','reports.view','reports.generate','documents.patient_share',
  ),
  receptionist: internal(
    'patient.list','patient.create','patient.demographics.view','patient.demographics.edit','patient.contacts.view','patient.birthdays.view','patient.documents.registration.view',
    'calendar.clinic.view','calendar.team.view','calendar.appointment.create','calendar.appointment.edit','calendar.appointment.cancel','calendar.appointment.reschedule','calendar.attendance.confirm','calendar.no_show.record','calendar.requests.manage',
    'finance.payments.view','finance.payments.receive','finance.payments.edit','finance.delinquency.view','finance.entries.view','finance.entries.manage','finance.reports.view','finance.indicators.view',
    'documents.patient_share',
  ),
  biller: internal(
    'clinic.view','workspace.switch','team.view',
    'patient.list','patient.demographics.view','patient.contacts.view','patient.documents.registration.view',
    'patient.insurance.view','patient.insurance.edit','patient.insurance.card.view','patient.insurance.authorization.view','patient.insurance.authorization.edit','patient.insurance.eligibility.view',
    'billing.sessions.view','billing.preguide.view','billing.preguide.manage','billing.mapping.manage','billing.tuss.manage','billing.antiglosa.view','billing.antiglosa.manage','billing.batch.create','billing.xml.generate','billing.xml.validate','billing.xml.export','billing.operator_return.manage','billing.amount.submitted','billing.amount.paid','billing.denial.manage','billing.financial_settlement',
  ),
  patient: [
    'portal.view','portal.self_data.view','portal.appointments.view','portal.attendance.confirm','portal.reschedule.request','portal.cancel.request','portal.notifications.view','portal.notification_preferences.manage','portal.appointment_volume.view',
  ],
};

export const ROLE_DEFAULT_SCOPES: Record<ClinicBaseRole | PortalRole, readonly AuthorizationScope[]> = {
  director: ['AUTHORIZED_CLINICS', 'ACTIVE_CLINIC'],
  coordinator: ['ACTIVE_CLINIC'],
  supervisor: ['SUPERVISED_CASES', 'OWN_RESOURCES'],
  therapist: ['ASSIGNED_PATIENTS', 'OWN_RESOURCES'],
  receptionist: ['ACTIVE_CLINIC'],
  biller: ['AUTHORIZED_CLINICS', 'BILLING_SCOPE'],
  patient: ['SELF_OR_DEPENDENTS'],
};

export function getDefaultScopesForRole(
  role: ClinicBaseRole | PortalRole,
  options: { canSupervise?: boolean } = {},
): readonly AuthorizationScope[] {
  if (role === 'therapist' && options.canSupervise === true) {
    return ['ASSIGNED_PATIENTS', 'SUPERVISED_CASES', 'OWN_RESOURCES'];
  }
  return ROLE_DEFAULT_SCOPES[role];
}

const CAPABILITY_KEYS = new Set<string>(CAPABILITY_CATALOG.map((item) => item.key));
const CLINIC_ROLE_KEYS = new Set<string>(CLINIC_BASE_ROLES);

export function isCapabilityKey(value: unknown): value is CapabilityKey {
  return CAPABILITY_KEYS.has(String(value ?? '').trim());
}

export function isClinicBaseRole(value: unknown): value is ClinicBaseRole {
  return CLINIC_ROLE_KEYS.has(String(value ?? '').trim().toLowerCase());
}

export function getDefaultCapabilitiesForRole(role: ClinicBaseRole | PortalRole): ReadonlySet<CapabilityKey> {
  return new Set(ROLE_DEFAULT_CAPABILITIES[role]);
}

export function roleHasDefaultCapability(role: ClinicBaseRole | PortalRole, capability: CapabilityKey): boolean {
  return ROLE_DEFAULT_CAPABILITIES[role].includes(capability);
}

export function isDelegableCapability(capability: CapabilityKey): boolean {
  return CAPABILITY_CATALOG.find((item) => item.key === capability)?.delegable === true;
}
