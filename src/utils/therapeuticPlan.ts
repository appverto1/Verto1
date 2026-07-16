export type TherapeuticProgramStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'teaching'
  | 'maintenance'
  | 'paused'
  | 'completed'
  | 'archived';

export type TherapeuticMeasurementType =
  | 'independent_prompted_no_response'
  | 'correct_incorrect'
  | 'frequency'
  | 'duration'
  | 'latency'
  | 'task_analysis'
  | 'percentage';

export const THERAPEUTIC_PROGRAM_STATUS_LABELS: Record<TherapeuticProgramStatus, string> = {
  draft: 'Rascunho',
  awaiting_approval: 'Aguardando aprovação',
  teaching: 'Em ensino',
  maintenance: 'Manutenção',
  paused: 'Pausado',
  completed: 'Concluído',
  archived: 'Arquivado',
};

export const THERAPEUTIC_MEASUREMENT_OPTIONS: Array<{
  value: TherapeuticMeasurementType;
  label: string;
  sessionPreview: string[];
}> = [
  {
    value: 'independent_prompted_no_response',
    label: 'Independente / Com ajuda / Não respondeu',
    sessionPreview: ['Independente', 'Com ajuda', 'Não respondeu'],
  },
  {
    value: 'correct_incorrect',
    label: 'Acerto / Erro',
    sessionPreview: ['Acerto', 'Erro'],
  },
  { value: 'frequency', label: 'Frequência', sessionPreview: ['+1'] },
  { value: 'duration', label: 'Duração', sessionPreview: ['Iniciar', 'Pausar', 'Finalizar'] },
  { value: 'latency', label: 'Tempo de resposta', sessionPreview: ['Iniciar', 'Responder'] },
  { value: 'task_analysis', label: 'Etapas concluídas', sessionPreview: ['Concluída', 'Com ajuda', 'Não realizada'] },
  { value: 'percentage', label: 'Percentual', sessionPreview: ['0%', '50%', '100%'] },
];

export const THERAPEUTIC_RECOMMENDATION_TYPE_LABELS: Record<string, string> = {
  MAINTENANCE_PROBE: 'Sondagem de manutenção',
  REGRESSION_ATTENTION: 'Regressão',
  MASTERY_REVIEW: 'Aquisição',
  CONTINUE_TRAINING: 'Aquisição',
  INTRODUCE_NEW_TARGET: 'Aquisição',
  BEHAVIOR_MONITORING: 'Monitoramento',
  ABC_COLLECTION: 'Coleta ABC',
  PROMPT_FADING: 'Redução de ajuda',
  GENERALIZATION: 'Generalização',
};

export type TherapeuticRecommendationFilters = {
  query?: string;
  scope?: 'all' | 'untreated' | 'recent';
  type?: string;
  origin?: 'all' | 'protocol' | 'program';
  professionalId?: string;
  periodDays?: number | null;
  now?: string | Date;
};

export type TherapeuticRecommendationGroup = {
  key: string;
  representative: any;
  occurrences: any[];
  occurrenceCount: number;
  convertedProgram: any | null;
  canCreateProgram: boolean;
  latestCreatedAt: string | null;
};

const safeText = (value: unknown) => String(value ?? '').trim();

const recommendationContext = (recommendation: any) => recommendation?.clinical_context || recommendation?.clinicalContext || {};

const recommendationCreatedAt = (recommendation: any) => safeText(recommendation?.created_at || recommendation?.createdAt);

export const recommendationHasTrustedProgramOrigin = (recommendation: any) => {
  const context = recommendationContext(recommendation);
  return Boolean(
    recommendation?.can_create_program ??
    recommendation?.canCreateProgram ??
    (context?.target?.id && !context?.convertedProgram && !context?.converted_program),
  );
};

export const groupTherapeuticRecommendations = (recommendations: any[]): TherapeuticRecommendationGroup[] => {
  const grouped = new Map<string, any[]>();
  for (const recommendation of Array.isArray(recommendations) ? recommendations : []) {
    const context = recommendationContext(recommendation);
    const targetId = safeText(recommendation?.target_id || recommendation?.targetId || context?.target?.id);
    const behaviorId = safeText(recommendation?.behavior_id || recommendation?.behaviorId || context?.behavior?.id);
    const programId = safeText(recommendation?.program_id || recommendation?.programId || context?.program?.id);
    const protocolId = safeText(context?.protocol?.id || context?.target?.protocol_id || context?.target?.protocolId);
    const type = safeText(recommendation?.recommendation_type || recommendation?.recommendationType).toUpperCase() || 'UNKNOWN';
    const sourceKey = targetId ? `target:${targetId}` : behaviorId ? `behavior:${behaviorId}` : `recommendation:${safeText(recommendation?.id)}`;
    const key = `${type}|${sourceKey}|program:${programId || '-'}|protocol:${protocolId || '-'}`;
    const rows = grouped.get(key) || [];
    rows.push(recommendation);
    grouped.set(key, rows);
  }

  const priorityWeight: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  return Array.from(grouped.entries()).map(([key, rows]) => {
    const occurrences = [...rows].sort((left, right) => {
      const dateDelta = new Date(recommendationCreatedAt(right) || 0).getTime() - new Date(recommendationCreatedAt(left) || 0).getTime();
      if (dateDelta !== 0) return dateDelta;
      return (priorityWeight[safeText(right?.priority).toUpperCase()] || 0) - (priorityWeight[safeText(left?.priority).toUpperCase()] || 0);
    });
    const convertedOccurrence = occurrences.find((item) => {
      const context = recommendationContext(item);
      return context?.converted_program?.id || context?.convertedProgram?.id;
    });
    const convertedContext = recommendationContext(convertedOccurrence);
    const convertedProgram = convertedContext?.converted_program || convertedContext?.convertedProgram || null;
    return {
      key,
      representative: occurrences[0],
      occurrences,
      occurrenceCount: occurrences.length,
      convertedProgram,
      canCreateProgram: !convertedProgram && occurrences.some(recommendationHasTrustedProgramOrigin),
      latestCreatedAt: recommendationCreatedAt(occurrences[0]) || null,
    };
  }).sort((left, right) => {
    if (Boolean(left.convertedProgram) !== Boolean(right.convertedProgram)) return left.convertedProgram ? 1 : -1;
    const dateDelta = new Date(right.latestCreatedAt || 0).getTime() - new Date(left.latestCreatedAt || 0).getTime();
    if (dateDelta !== 0) return dateDelta;
    const priorityDelta = (priorityWeight[safeText(right.representative?.priority).toUpperCase()] || 0)
      - (priorityWeight[safeText(left.representative?.priority).toUpperCase()] || 0);
    if (priorityDelta !== 0) return priorityDelta;
    if (left.canCreateProgram !== right.canCreateProgram) return left.canCreateProgram ? -1 : 1;
    return left.key.localeCompare(right.key);
  });
};

export const filterTherapeuticRecommendationGroups = (
  groups: TherapeuticRecommendationGroup[],
  filters: TherapeuticRecommendationFilters = {},
) => {
  const needle = safeText(filters.query).toLocaleLowerCase('pt-BR');
  const now = filters.now instanceof Date ? filters.now : new Date(filters.now || Date.now());
  const threshold = filters.periodDays && filters.periodDays > 0
    ? now.getTime() - filters.periodDays * 24 * 60 * 60 * 1000
    : null;

  return (Array.isArray(groups) ? groups : []).filter((group) => {
    const recommendation = group.representative;
    const context = recommendationContext(recommendation);
    const type = safeText(recommendation?.recommendation_type || recommendation?.recommendationType).toUpperCase();
    const createdAt = new Date(group.latestCreatedAt || 0).getTime();
    const professionalId = safeText(context?.responsible_professional?.id || context?.responsibleProfessional?.id);
    const hasProtocol = Boolean(context?.protocol?.id || context?.target?.protocol_id || context?.target?.protocolId);
    const hasProgram = Boolean(context?.program?.id || recommendation?.program_id || recommendation?.programId);
    const scopeMatches = filters.scope !== 'untreated' || !group.convertedProgram;
    const recentMatches = filters.scope !== 'recent' || createdAt >= now.getTime() - 30 * 24 * 60 * 60 * 1000;
    const typeMatches = !filters.type || filters.type === 'all' || type === filters.type;
    const originMatches = !filters.origin || filters.origin === 'all'
      || (filters.origin === 'protocol' && hasProtocol)
      || (filters.origin === 'program' && hasProgram);
    const professionalMatches = !filters.professionalId || filters.professionalId === 'all' || professionalId === filters.professionalId;
    const periodMatches = threshold === null || createdAt >= threshold;
    const searchable = [
      recommendation?.title,
      recommendation?.summary,
      recommendation?.rationale,
      context?.target?.name,
      context?.program?.name,
      context?.protocol?.title,
      context?.domain?.name,
      context?.responsible_professional?.display_name,
      context?.responsibleProfessional?.displayName,
    ].map(safeText).join(' ').toLocaleLowerCase('pt-BR');
    return scopeMatches && recentMatches && typeMatches && originMatches && professionalMatches && periodMatches && (!needle || searchable.includes(needle));
  });
};

export const normalizeTherapeuticProgramStatus = (value: unknown): TherapeuticProgramStatus => {
  const normalized = safeText(value).toLowerCase();
  if (normalized === 'active' || normalized === 'in_progress') return 'teaching';
  if (normalized === 'on_hold') return 'paused';
  if (
    normalized === 'draft' ||
    normalized === 'awaiting_approval' ||
    normalized === 'teaching' ||
    normalized === 'maintenance' ||
    normalized === 'paused' ||
    normalized === 'completed' ||
    normalized === 'archived'
  ) return normalized;
  return 'draft';
};

export const normalizeTherapeuticTargetStatus = (target: any) => {
  const phase = safeText(target?.phase || target?.status || target?.clinical_status).toLowerCase();
  if (['mastered', 'completed', 'acquired'].includes(phase)) return 'mastered';
  if (['maintenance', 'generalization'].includes(phase)) return 'maintenance';
  if (['on_hold', 'paused', 'discontinued'].includes(phase)) return 'paused';
  if (['teaching', 'baseline'].includes(phase)) return 'teaching';
  return 'not_started';
};

export const normalizeTherapeuticPrograms = (payload: any) => {
  const programs = Array.isArray(payload?.programs)
    ? payload.programs
    : Array.isArray(payload?.data?.programs)
      ? payload.data.programs
      : [];
  const targets = Array.isArray(payload?.targets)
    ? payload.targets
    : Array.isArray(payload?.data?.targets)
      ? payload.data.targets
      : [];
  const targetsByProgram = new Map<string, any[]>();
  targets.forEach((target: any) => {
    const programId = safeText(target?.program_id || target?.programId);
    if (!programId) return;
    const list = targetsByProgram.get(programId) || [];
    list.push(target);
    targetsByProgram.set(programId, list);
  });

  return programs.map((program: any) => {
    const programId = safeText(program?.id);
    const nestedTargets = Array.isArray(program?.targets) ? program.targets : targetsByProgram.get(programId) || [];
    const normalizedTargets = nestedTargets
      .map((target: any) => ({ ...target, normalizedStatus: normalizeTherapeuticTargetStatus(target) }))
      .sort((a: any, b: any) => Number(a?.sort_order ?? a?.sortOrder ?? 0) - Number(b?.sort_order ?? b?.sortOrder ?? 0));
    return {
      ...program,
      id: programId,
      status: normalizeTherapeuticProgramStatus(program?.status),
      objective: safeText(program?.objective || program?.description),
      category: safeText(program?.category || program?.domain_name || program?.domainName || 'Outro'),
      measurementType: safeText(program?.measurement_type || program?.measurementType || 'independent_prompted_no_response'),
      targets: normalizedTargets,
      masteredTargetCount: normalizedTargets.filter((target: any) => target.normalizedStatus === 'mastered').length,
      lastAppliedAt: program?.last_applied_at || program?.lastAppliedAt || null,
    };
  });
};

export const buildTherapeuticPlanSummary = (programs: any[], objectives: any[] = []) => {
  const safePrograms = Array.isArray(programs) ? programs : [];
  const allTargets = safePrograms.flatMap((program: any) => Array.isArray(program?.targets) ? program.targets : []);
  const reviewDates = safePrograms
    .map((program: any) => safeText(program?.review_due_date || program?.reviewDueDate))
    .concat((Array.isArray(objectives) ? objectives : []).map((objective: any) => safeText(objective?.review_due_date || objective?.reviewDueDate)))
    .filter(Boolean)
    .sort();
  return {
    teaching: safePrograms.filter((program: any) => normalizeTherapeuticProgramStatus(program?.status) === 'teaching').length,
    maintenance: safePrograms.filter((program: any) => normalizeTherapeuticProgramStatus(program?.status) === 'maintenance').length,
    completed: safePrograms.filter((program: any) => normalizeTherapeuticProgramStatus(program?.status) === 'completed').length,
    masteredTargets: allTargets.filter((target: any) => normalizeTherapeuticTargetStatus(target) === 'mastered').length,
    nextReview: reviewDates[0] || null,
  };
};

export const therapeuticProgramsToSessionGoals = (programs: any[]) => {
  const seenTargetIds = new Set<string>();
  return (Array.isArray(programs) ? programs : []).flatMap((program: any) => {
    const programStatus = normalizeTherapeuticProgramStatus(program?.status);
    if (!['teaching', 'maintenance'].includes(programStatus)) return [];
    return (Array.isArray(program?.targets) ? program.targets : []).flatMap((target: any) => {
      const targetStatus = normalizeTherapeuticTargetStatus(target);
      if (['paused', 'mastered'].includes(targetStatus) && programStatus !== 'maintenance') return [];
      const targetId = safeText(target?.id || target?.target_id || target?.targetId);
      if (!targetId || seenTargetIds.has(targetId)) return [];
      seenTargetIds.add(targetId);
      const name = safeText(target?.name || target?.target_name || target?.targetName) || 'Alvo do programa';
      const masteryCriteria = target?.mastery_criteria || target?.masteryCriteria || program?.mastery_criteria || program?.masteryCriteria || {};
      return [{
        id: targetId,
        target_id: targetId,
        targetId,
        name,
        targetName: name,
        target_name: name,
        programId: safeText(program?.id) || null,
        program_id: safeText(program?.id) || null,
        programName: safeText(program?.name) || null,
        program_name: safeText(program?.name) || null,
        protocolId: safeText(program?.protocol_id || program?.protocolId) || null,
        protocolTitle: safeText(program?.protocol_title || program?.protocolTitle) || null,
        domainId: safeText(program?.domain_id || program?.domainId) || null,
        domainName: safeText(program?.domain_name || program?.domainName || program?.category) || null,
        objective: safeText(program?.objective || program?.description),
        status: programStatus === 'maintenance' ? 'maintenance' : 'in_progress',
        phase: target?.phase || (programStatus === 'maintenance' ? 'maintenance' : 'teaching'),
        masteryCriteria,
        mastery_criteria: masteryCriteria,
        measurementType: program?.measurement_type || program?.measurementType || 'independent_prompted_no_response',
        measurement_type: program?.measurement_type || program?.measurementType || 'independent_prompted_no_response',
        maxScore: 1,
        source: 'therapeutic_program',
        isTherapeuticProgramTarget: true,
      }];
    });
  });
};

export const mergeLegacyAndTherapeuticSessionGoals = (legacyGoals: any[], therapeuticGoals: any[]) => {
  const merged = new Map<string, any>();
  (Array.isArray(therapeuticGoals) ? therapeuticGoals : []).forEach((goal: any) => {
    const key = safeText(goal?.targetId || goal?.target_id || goal?.id || goal?.name).toLowerCase();
    if (key) merged.set(key, goal);
  });
  (Array.isArray(legacyGoals) ? legacyGoals : []).forEach((goal: any) => {
    const key = safeText(goal?.targetId || goal?.target_id || goal?.id || goal?.name).toLowerCase();
    if (key && !merged.has(key)) merged.set(key, goal);
  });
  return Array.from(merged.values());
};

export const formatTherapeuticPlanDate = (value: unknown) => {
  const raw = safeText(value);
  if (!raw) return 'Não definida';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const date = dateOnly ? new Date(`${raw}T12:00:00`) : new Date(raw);
  if (Number.isNaN(date.getTime())) return 'Não definida';
  return new Intl.DateTimeFormat('pt-BR').format(date);
};

export const masteryCriterionLabel = (criteria: any) => {
  const source = criteria && typeof criteria === 'object' ? criteria : {};
  const accuracy = Number(source.minAccuracyPercent ?? source.min_accuracy_percent);
  const sessions = Number(source.requiredSessions ?? source.required_sessions);
  if (Number.isFinite(accuracy) && Number.isFinite(sessions) && accuracy > 0 && sessions > 0) {
    return `${accuracy}% em ${sessions} sessões`;
  }
  const responses = Number(source.requiredIndependentCorrectTrials ?? source.required_independent_correct_trials);
  if (Number.isFinite(responses) && responses > 0) return `${responses} respostas independentes`;
  const duration = Number(source.durationSeconds ?? source.duration_seconds);
  const opportunities = Number(source.requiredOpportunities ?? source.required_opportunities);
  if (Number.isFinite(duration) && duration > 0) {
    return `${duration} segundos${Number.isFinite(opportunities) && opportunities > 0 ? ` em ${opportunities} oportunidades` : ''}`;
  }
  return 'Critério personalizado';
};
