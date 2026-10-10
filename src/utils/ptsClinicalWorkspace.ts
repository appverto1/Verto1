export type PtsPriority = 'low' | 'medium' | 'high' | 'critical';
export type PtsItemStatus = 'pending' | 'in_progress' | 'achieved' | 'paused' | 'cancelled';
export type PtsGoalHorizon = 'short' | 'medium' | 'long';
export type PtsGoalType = 'quantitative' | 'qualitative';

export type PtsNeed = {
  id: string;
  title: string;
  domain: string;
  description: string;
  priority: PtsPriority;
  status: PtsItemStatus;
};

export type PtsGoal = {
  id: string;
  title: string;
  description: string;
  horizon: PtsGoalHorizon;
  goalType: PtsGoalType;
  baseline: string;
  target: string;
  currentValue: string;
  unit: string;
  dueDate: string;
  responsibleProfessionalIds: string[];
  specialties: string[];
  status: PtsItemStatus;
};

export type PtsResponsibility = {
  id: string;
  actorType: 'professional' | 'patient' | 'family' | 'school' | 'network';
  actorId: string;
  actorName: string;
  action: string;
  frequency: string;
  dueDate: string;
  status: PtsItemStatus;
};

export type PtsNetworkContact = {
  id: string;
  type: 'family' | 'school' | 'health' | 'social_assistance' | 'justice' | 'community' | 'other';
  name: string;
  role: string;
  contact: string;
  consentStatus: 'not_required' | 'pending' | 'authorized' | 'revoked';
};

export type PtsRisk = {
  id: string;
  title: string;
  description: string;
  severity: PtsPriority;
  responsePlan: string;
  status: 'active' | 'controlled' | 'resolved';
};

export type PtsReview = {
  id: string;
  scheduledFor: string;
  completedAt: string;
  summary: string;
  decisions: string;
  nextReviewDate: string;
  recordedBy: string;
};

export type PtsClinicalPayload = {
  schemaVersion: 1;
  caseManagerId: string;
  startedAt: string;
  summary: string;
  patientVoice: string;
  familyVoice: string;
  strengths: string[];
  needs: PtsNeed[];
  goals: PtsGoal[];
  responsibilities: PtsResponsibility[];
  network: PtsNetworkContact[];
  risks: PtsRisk[];
  reviews: PtsReview[];
  nextReviewDate: string;
  participationStatus: 'not_started' | 'discussed' | 'agreed' | 'declined';
  participationRecordedAt: string;
};

export type NormalizePtsOptions = {
  participantIds?: string[];
  specialties?: string[];
  defaultCaseManagerId?: string;
  defaultStartedAt?: string;
};

const SAFE_ID = /^[a-zA-Z0-9:_-]{1,100}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;

const text = (value: unknown, max = 500) => {
  const normalized = typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\u0000/g, '').trim()
    : '';
  return normalized.slice(0, max);
};

const id = (value: unknown) => {
  const normalized = text(value, 100);
  return SAFE_ID.test(normalized) ? normalized : '';
};

const date = (value: unknown) => {
  const normalized = text(value, 10);
  return DATE.test(normalized) ? normalized : '';
};

const dateTime = (value: unknown) => {
  const normalized = text(value, 40);
  return DATE_TIME.test(normalized) && !Number.isNaN(new Date(normalized).getTime())
    ? new Date(normalized).toISOString()
    : '';
};

const stringList = (value: unknown, maxItems: number, maxLength: number) => (
  Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .slice(0, maxItems)
      .map((item) => text(item, maxLength))
      .filter(Boolean),
  ))
);

const enumValue = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
  const normalized = text(value, 40) as T;
  return allowed.includes(normalized) ? normalized : fallback;
};

const scopedIds = (value: unknown, allowed: Set<string>, maxItems = 10) => (
  Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .slice(0, maxItems)
      .map((item) => id(item))
      .filter((item) => item && allowed.has(item)),
  ))
);

export const emptyPtsClinicalPayload = (options: NormalizePtsOptions = {}): PtsClinicalPayload => {
  const participantIds = new Set((options.participantIds || []).map(String));
  const defaultCaseManagerId = id(options.defaultCaseManagerId);
  return {
    schemaVersion: 1,
    caseManagerId: participantIds.has(defaultCaseManagerId) ? defaultCaseManagerId : '',
    startedAt: date(options.defaultStartedAt) || new Date().toISOString().slice(0, 10),
    summary: '',
    patientVoice: '',
    familyVoice: '',
    strengths: [],
    needs: [],
    goals: [],
    responsibilities: [],
    network: [],
    risks: [],
    reviews: [],
    nextReviewDate: '',
    participationStatus: 'not_started',
    participationRecordedAt: '',
  };
};

export function normalizePtsClinicalPayload(
  raw: unknown,
  options: NormalizePtsOptions = {},
): PtsClinicalPayload {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, any>
    : {};
  const participantIds = new Set((options.participantIds || []).map(String).filter(Boolean));
  const allowedSpecialties = new Set((options.specialties || []).map((item) => text(item, 120)).filter(Boolean));
  const fallback = emptyPtsClinicalPayload(options);
  const caseManagerId = id(source.caseManagerId || source.case_manager_id || options.defaultCaseManagerId);

  const needs: PtsNeed[] = (Array.isArray(source.needs) ? source.needs : [])
    .slice(0, 30)
    .map((item: any) => ({
      id: id(item?.id),
      title: text(item?.title, 180),
      domain: text(item?.domain, 100),
      description: text(item?.description, 1500),
      priority: enumValue(item?.priority, ['low', 'medium', 'high', 'critical'] as const, 'medium'),
      status: enumValue(item?.status, ['pending', 'in_progress', 'achieved', 'paused', 'cancelled'] as const, 'pending'),
    }))
    .filter((item) => item.id);

  const goals: PtsGoal[] = (Array.isArray(source.goals) ? source.goals : [])
    .slice(0, 40)
    .map((item: any) => ({
      id: id(item?.id),
      title: text(item?.title, 220),
      description: text(item?.description, 1800),
      horizon: enumValue(item?.horizon, ['short', 'medium', 'long'] as const, 'short'),
      goalType: enumValue(item?.goalType || item?.goal_type, ['quantitative', 'qualitative'] as const, 'qualitative'),
      baseline: text(item?.baseline, 300),
      target: text(item?.target, 300),
      currentValue: text(item?.currentValue ?? item?.current_value, 300),
      unit: text(item?.unit, 80),
      dueDate: date(item?.dueDate || item?.due_date),
      responsibleProfessionalIds: scopedIds(
        item?.responsibleProfessionalIds || item?.responsible_professional_ids,
        participantIds,
        5,
      ),
      specialties: stringList(item?.specialties, 10, 120)
        .filter((specialty) => allowedSpecialties.size === 0 || allowedSpecialties.has(specialty)),
      status: enumValue(item?.status, ['pending', 'in_progress', 'achieved', 'paused', 'cancelled'] as const, 'pending'),
    }))
    .filter((item) => item.id);

  const responsibilities: PtsResponsibility[] = (Array.isArray(source.responsibilities) ? source.responsibilities : [])
    .slice(0, 60)
    .map((item: any) => {
      const actorType = enumValue(item?.actorType || item?.actor_type, ['professional', 'patient', 'family', 'school', 'network'] as const, 'professional');
      const actorId = id(item?.actorId || item?.actor_id);
      return {
        id: id(item?.id),
        actorType,
        actorId: actorType === 'professional' && participantIds.has(actorId) ? actorId : '',
        actorName: text(item?.actorName || item?.actor_name, 180),
        action: text(item?.action, 1200),
        frequency: text(item?.frequency, 180),
        dueDate: date(item?.dueDate || item?.due_date),
        status: enumValue(item?.status, ['pending', 'in_progress', 'achieved', 'paused', 'cancelled'] as const, 'pending'),
      };
    })
    .filter((item) => item.id);

  const network: PtsNetworkContact[] = (Array.isArray(source.network) ? source.network : [])
    .slice(0, 30)
    .map((item: any) => ({
      id: id(item?.id),
      type: enumValue(item?.type, ['family', 'school', 'health', 'social_assistance', 'justice', 'community', 'other'] as const, 'other'),
      name: text(item?.name, 180),
      role: text(item?.role, 180),
      contact: text(item?.contact, 240),
      consentStatus: enumValue(item?.consentStatus || item?.consent_status, ['not_required', 'pending', 'authorized', 'revoked'] as const, 'pending'),
    }))
    .filter((item) => item.id);

  const risks: PtsRisk[] = (Array.isArray(source.risks) ? source.risks : [])
    .slice(0, 20)
    .map((item: any) => ({
      id: id(item?.id),
      title: text(item?.title, 180),
      description: text(item?.description, 1200),
      severity: enumValue(item?.severity, ['low', 'medium', 'high', 'critical'] as const, 'medium'),
      responsePlan: text(item?.responsePlan || item?.response_plan, 1800),
      status: enumValue(item?.status, ['active', 'controlled', 'resolved'] as const, 'active'),
    }))
    .filter((item) => item.id);

  const reviews: PtsReview[] = (Array.isArray(source.reviews) ? source.reviews : [])
    .slice(0, 40)
    .map((item: any) => ({
      id: id(item?.id),
      scheduledFor: date(item?.scheduledFor || item?.scheduled_for),
      completedAt: dateTime(item?.completedAt || item?.completed_at),
      summary: text(item?.summary, 2000),
      decisions: text(item?.decisions, 2000),
      nextReviewDate: date(item?.nextReviewDate || item?.next_review_date),
      recordedBy: id(item?.recordedBy || item?.recorded_by),
    }))
    .filter((item) => item.id && (item.scheduledFor || item.completedAt || item.summary || item.decisions));

  return {
    schemaVersion: 1,
    caseManagerId: participantIds.has(caseManagerId) ? caseManagerId : fallback.caseManagerId,
    startedAt: date(source.startedAt || source.started_at) || fallback.startedAt,
    summary: text(source.summary, 3000),
    patientVoice: text(source.patientVoice || source.patient_voice, 2200),
    familyVoice: text(source.familyVoice || source.family_voice, 2200),
    strengths: stringList(source.strengths, 30, 300),
    needs,
    goals,
    responsibilities,
    network,
    risks,
    reviews,
    nextReviewDate: date(source.nextReviewDate || source.next_review_date),
    participationStatus: enumValue(source.participationStatus || source.participation_status, ['not_started', 'discussed', 'agreed', 'declined'] as const, 'not_started'),
    participationRecordedAt: dateTime(source.participationRecordedAt || source.participation_recorded_at),
  };
}

export function ptsCommonObjectives(payload: PtsClinicalPayload): string[] {
  return payload.goals
    .filter((goal) => !['cancelled'].includes(goal.status))
    .map((goal) => goal.title)
    .filter(Boolean);
}

export function ptsSpecialtyObjectives(payload: PtsClinicalPayload): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const goal of payload.goals) {
    if (goal.status === 'cancelled') continue;
    for (const specialty of goal.specialties) {
      grouped[specialty] = Array.from(new Set([...(grouped[specialty] || []), goal.title]));
    }
  }
  return grouped;
}

export function ptsLastReviewedAt(payload: PtsClinicalPayload): string | null {
  const completed = payload.reviews
    .map((review) => review.completedAt)
    .filter(Boolean)
    .sort();
  return completed.length ? completed[completed.length - 1] : null;
}

export function hydratePtsClinicalPayloadFromPlan(scope: any): PtsClinicalPayload {
  const participantIds: string[] = Array.from(new Set<string>([
    String(scope?.responsible_professional_id || ''),
    ...(Array.isArray(scope?.participant_professional_ids) ? scope.participant_professional_ids.map(String) : []),
  ].filter(Boolean)));
  const specialties: string[] = Array.from(new Set<string>(
    (Array.isArray(scope?.participant_specialties) ? scope.participant_specialties : [])
      .map(String)
      .filter(Boolean),
  ));
  const existing = normalizePtsClinicalPayload(scope?.pts_payload, {
    participantIds,
    specialties,
    defaultCaseManagerId: String(scope?.responsible_professional_id || ''),
    defaultStartedAt: String(scope?.created_at || '').slice(0, 10),
  });
  if (existing.goals.length > 0) return existing;

  const legacyCommon = Array.isArray(scope?.common_objectives) ? scope.common_objectives : [];
  const legacySpecialty = scope?.specialty_objectives && typeof scope.specialty_objectives === 'object'
    ? scope.specialty_objectives
    : {};
  const legacyGoals: PtsGoal[] = [];
  let index = 0;
  for (const objective of legacyCommon) {
    const title = text(typeof objective === 'string' ? objective : objective?.title || objective?.description, 220);
    if (!title) continue;
    index += 1;
    legacyGoals.push({
      id: `legacy-common-${index}`,
      title,
      description: '',
      horizon: 'short',
      goalType: 'qualitative',
      baseline: '',
      target: '',
      currentValue: '',
      unit: '',
      dueDate: '',
      responsibleProfessionalIds: participantIds.slice(0, 1),
      specialties: [],
      status: 'pending',
    });
  }
  for (const [specialty, objectives] of Object.entries(legacySpecialty)) {
    for (const objective of Array.isArray(objectives) ? objectives : []) {
      const title = text(typeof objective === 'string' ? objective : (objective as any)?.title || (objective as any)?.description, 220);
      if (!title) continue;
      index += 1;
      legacyGoals.push({
        id: `legacy-specialty-${index}`,
        title,
        description: '',
        horizon: 'short',
        goalType: 'qualitative',
        baseline: '',
        target: '',
        currentValue: '',
        unit: '',
        dueDate: '',
        responsibleProfessionalIds: participantIds.slice(0, 1),
        specialties: specialties.includes(specialty) ? [specialty] : [],
        status: 'pending',
      });
    }
  }
  return { ...existing, goals: legacyGoals };
}
export type PtsActivationValidation = {
  valid: boolean;
  sectionErrors: Record<string, string[]>;
  firstFieldId: string | null;
};

/**
 * Content is optional when publishing a PTS. The authenticated server keeps
 * ownership, scope, revision (CAS) and JSON-shape checks as hard invariants.
 * Clinical information can be added in a later version without blocking care.
 */
export function validatePtsDraftForActivation(_payload: PtsClinicalPayload): PtsActivationValidation {
  return { valid: true, sectionErrors: {}, firstFieldId: null };
}

/**
 * Progress is evidence, not plan definition. Preserve compatibility when
 * reading legacy payloads, but never carry a mutable "current result" into a
 * newly persisted draft definition.
 */
export function stripPtsTrackingFieldsForDraft(payload: PtsClinicalPayload): PtsClinicalPayload {
  return {
    ...payload,
    goals: payload.goals.map((goal) => ({ ...goal, currentValue: '' })),
    reviews: [],
  };
}
