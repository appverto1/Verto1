import { decodeClinicalTextEntities, normalizeClinicalTextRecord } from './clinicalText';

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

export const therapeuticMeasurementDefaultMasteryMeasure = (measurementType: unknown) => {
  const normalized = safeText(measurementType).toLowerCase() as TherapeuticMeasurementType;
  const defaults: Partial<Record<TherapeuticMeasurementType, string>> = {
    independent_prompted_no_response: 'accuracy_percent',
    correct_incorrect: 'accuracy_percent',
    frequency: 'frequency',
    duration: 'duration_seconds',
    latency: 'latency_seconds',
    task_analysis: 'steps_percent',
    percentage: 'accuracy_percent',
  };
  return defaults[normalized] || 'accuracy_percent';
};

export const isTherapeuticMasteryCriteriaCompatible = (measurementType: unknown, criteria: any) => {
  const normalizedMeasurement = safeText(measurementType).toLowerCase() as TherapeuticMeasurementType;
  const source = criteria && typeof criteria === 'object' ? criteria : {};
  const type = safeText(source.type).toLowerCase();
  const customMeasure = safeText(source.measure || source.customMeasure || source.custom_measure).toLowerCase();

  if (customMeasure) {
    const allowedMeasures: Partial<Record<TherapeuticMeasurementType, Set<string>>> = {
      independent_prompted_no_response: new Set(['accuracy_percent', 'independent_responses']),
      correct_incorrect: new Set(['accuracy_percent']),
      frequency: new Set(['frequency']),
      duration: new Set(['duration_seconds']),
      latency: new Set(['latency_seconds']),
      task_analysis: new Set(['steps_percent']),
      percentage: new Set(['accuracy_percent']),
    };
    return allowedMeasures[normalizedMeasurement]?.has(customMeasure) === true;
  }

  if (type === 'steps_independent') return normalizedMeasurement === 'task_analysis';
  if (Number(source.requiredIndependentCorrectTrials ?? source.required_independent_correct_trials) > 0) {
    return normalizedMeasurement === 'independent_prompted_no_response';
  }
  if (Number(source.minAccuracyPercent ?? source.min_accuracy_percent) >= 0 && (
    source.minAccuracyPercent !== undefined || source.min_accuracy_percent !== undefined
  )) {
    return ['independent_prompted_no_response', 'correct_incorrect', 'percentage'].includes(normalizedMeasurement);
  }
  return true;
};


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

export const THERAPEUTIC_PROGRAM_CREATION_RECOMMENDATION_TYPES = new Set(['INTRODUCE_NEW_TARGET']);

export type TherapeuticRecommendationActionKind =
  | 'create_program'
  | 'open_program'
  | 'review_regression'
  | 'configure_generalization'
  | 'schedule_maintenance'
  | 'review_prompt_fading'
  | 'review_acquisition'
  | 'apply_next_session'
  | 'complete_origin';

export type TherapeuticRecommendationActionPolicy = {
  primaryAction: TherapeuticRecommendationActionKind;
  primaryLabel: string;
  secondaryAction?: TherapeuticRecommendationActionKind;
  secondaryLabel?: string;
  destination: string;
  contextComplete: boolean;
  programId: string;
  targetId: string;
  detailTab?: 'overview' | 'targets' | 'procedure' | 'progress';
  advancedSection?: 'procedure' | 'support' | 'generalization' | 'management';
};

export type TherapeuticRecommendationFilters = {
  query?: string;
  scope?: 'all' | 'untreated' | 'recent' | 'incomplete' | 'treated';
  type?: string;
  origin?: 'all' | 'protocol' | 'program';
  assessmentId?: string;
  domainId?: string;
  programId?: string;
  professionalId?: string;
  status?: string;
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

const safeText = (value: unknown) => decodeClinicalTextEntities(value).trim();

const recommendationContext = (recommendation: any) => recommendation?.clinical_context || recommendation?.clinicalContext || {};

const recommendationCreatedAt = (recommendation: any) => safeText(recommendation?.created_at || recommendation?.createdAt);

const recommendationTypeOf = (recommendation: any) => safeText(
  recommendation?.recommendation_type || recommendation?.recommendationType,
).toUpperCase();

const recommendationStatusOf = (recommendation: any) => safeText(recommendation?.status).toUpperCase();

const recommendationConvertedProgram = (recommendation: any) => {
  const context = recommendationContext(recommendation);
  return context?.converted_program || context?.convertedProgram || null;
};

export const recommendationHasTrustedProgramOrigin = (recommendation: any) => {
  const context = recommendationContext(recommendation);
  const explicitPermission = recommendation?.can_create_program ?? recommendation?.canCreateProgram;
  const type = recommendationTypeOf(recommendation);
  const sourceProgramId = safeText(context?.program?.id || recommendation?.program_id || recommendation?.programId);
  return Boolean(
    explicitPermission === true
    && THERAPEUTIC_PROGRAM_CREATION_RECOMMENDATION_TYPES.has(type)
    && context?.target?.id
    && !sourceProgramId
    && !recommendationConvertedProgram(recommendation),
  );
};

export const resolveTherapeuticRecommendationActionPolicy = (
  recommendation: any,
): TherapeuticRecommendationActionPolicy => {
  const context = recommendationContext(recommendation);
  const type = recommendationTypeOf(recommendation);
  const convertedProgram = recommendationConvertedProgram(recommendation);
  const programId = safeText(convertedProgram?.id || context?.program?.id || recommendation?.program_id || recommendation?.programId);
  const targetId = safeText(context?.target?.id || recommendation?.target_id || recommendation?.targetId);
  const behaviorId = safeText(context?.behavior?.id || recommendation?.behavior_id || recommendation?.behaviorId);
  const incomplete = (label = 'Completar origem'): TherapeuticRecommendationActionPolicy => ({
    primaryAction: 'complete_origin',
    primaryLabel: label,
    destination: 'context_review',
    contextComplete: false,
    programId,
    targetId,
  });

  if (convertedProgram?.id) {
    return {
      primaryAction: 'open_program',
      primaryLabel: 'Abrir programa',
      destination: 'converted_program',
      contextComplete: true,
      programId,
      targetId,
      detailTab: 'overview',
    };
  }

  if (type === 'INTRODUCE_NEW_TARGET') {
    if (programId) {
      return {
        primaryAction: 'open_program',
        primaryLabel: 'Abrir programa existente',
        secondaryAction: 'apply_next_session',
        secondaryLabel: 'Aplicar à próxima sessão',
        destination: 'existing_program',
        contextComplete: Boolean(targetId),
        programId,
        targetId,
        detailTab: 'targets',
      };
    }
    if (recommendationHasTrustedProgramOrigin(recommendation)) {
      return {
        primaryAction: 'create_program',
        primaryLabel: 'Criar programa',
        secondaryAction: 'apply_next_session',
        secondaryLabel: 'Aplicar à próxima sessão',
        destination: 'new_program',
        contextComplete: true,
        programId,
        targetId,
      };
    }
    return incomplete('Vincular habilidade');
  }

  if (type === 'REGRESSION_ATTENTION') {
    if (!programId || !targetId) return incomplete();
    return {
      primaryAction: 'review_regression',
      primaryLabel: 'Revisar regressão',
      secondaryAction: 'apply_next_session',
      secondaryLabel: 'Acompanhar na próxima sessão',
      destination: 'existing_program_progress',
      contextComplete: true,
      programId,
      targetId,
      detailTab: 'progress',
    };
  }

  if (type === 'GENERALIZATION') {
    if (!programId || !targetId) return incomplete();
    return {
      primaryAction: 'configure_generalization',
      primaryLabel: 'Configurar generalização',
      secondaryAction: 'open_program',
      secondaryLabel: 'Abrir programa',
      destination: 'program_generalization',
      contextComplete: true,
      programId,
      targetId,
      detailTab: 'procedure',
      advancedSection: 'generalization',
    };
  }

  if (type === 'MAINTENANCE_PROBE') {
    if (!targetId) return incomplete('Vincular habilidade');
    return {
      primaryAction: 'schedule_maintenance',
      primaryLabel: 'Agendar manutenção',
      secondaryAction: programId ? 'open_program' : undefined,
      secondaryLabel: programId ? 'Abrir programa' : undefined,
      destination: 'target_maintenance',
      contextComplete: true,
      programId,
      targetId,
      detailTab: 'targets',
    };
  }

  if (type === 'PROMPT_FADING') {
    if (!programId || !targetId) return incomplete();
    return {
      primaryAction: 'review_prompt_fading',
      primaryLabel: 'Revisar hierarquia de ajuda',
      secondaryAction: 'open_program',
      secondaryLabel: 'Abrir procedimento',
      destination: 'program_prompt_fading',
      contextComplete: true,
      programId,
      targetId,
      detailTab: 'procedure',
      advancedSection: 'support',
    };
  }

  if (type === 'MASTERY_REVIEW' || type === 'CONTINUE_TRAINING') {
    if (!programId || !targetId) return incomplete();
    return {
      primaryAction: 'review_acquisition',
      primaryLabel: type === 'MASTERY_REVIEW' ? 'Revisar aquisição' : 'Abrir programa',
      secondaryAction: 'apply_next_session',
      secondaryLabel: 'Aplicar à próxima sessão',
      destination: 'existing_program',
      contextComplete: true,
      programId,
      targetId,
      detailTab: type === 'MASTERY_REVIEW' ? 'progress' : 'targets',
    };
  }

  if (type === 'BEHAVIOR_MONITORING' || type === 'ABC_COLLECTION') {
    if (!behaviorId && !targetId) return incomplete('Vincular contexto clínico');
    return {
      primaryAction: 'apply_next_session',
      primaryLabel: 'Adicionar ao planejamento',
      destination: 'next_session_plan',
      contextComplete: true,
      programId,
      targetId,
    };
  }

  if (programId) {
    return {
      primaryAction: 'open_program',
      primaryLabel: 'Abrir programa',
      destination: 'existing_program',
      contextComplete: true,
      programId,
      targetId,
      detailTab: 'overview',
    };
  }
  return incomplete();
};

export const groupTherapeuticRecommendations = (recommendations: any[]): TherapeuticRecommendationGroup[] => {
  const grouped = new Map<string, any[]>();
  for (const rawRecommendation of Array.isArray(recommendations) ? recommendations : []) {
    const recommendation = normalizeClinicalTextRecord(rawRecommendation);
    const context = recommendationContext(recommendation);
    const targetId = safeText(recommendation?.target_id || recommendation?.targetId || context?.target?.id);
    const behaviorId = safeText(recommendation?.behavior_id || recommendation?.behaviorId || context?.behavior?.id);
    const programId = safeText(recommendation?.program_id || recommendation?.programId || context?.program?.id);
    const protocolId = safeText(context?.protocol?.id || context?.target?.protocol_id || context?.target?.protocolId);
    const type = safeText(recommendation?.recommendation_type || recommendation?.recommendationType).toUpperCase() || 'UNKNOWN';
    const evidence = recommendation?.evidence && typeof recommendation.evidence === 'object' ? recommendation.evidence : {};
    const ruleCode = safeText(context?.rule?.code || evidence?.ruleCode || evidence?.rule_code || type);
    const ruleVersion = safeText(context?.rule?.version || evidence?.ruleVersion || evidence?.rule_version || '1');
    const sourceKey = targetId ? `target:${targetId}` : behaviorId ? `behavior:${behaviorId}` : `recommendation:${safeText(recommendation?.id)}`;
    const key = `${type}|${sourceKey}|program:${programId || '-'}|protocol:${protocolId || '-'}|rule:${ruleCode || '-'}@${ruleVersion || '-'}`;
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
    const status = recommendationStatusOf(recommendation);
    const createdAt = new Date(group.latestCreatedAt || 0).getTime();
    const professionalId = safeText(context?.responsible_professional?.id || context?.responsibleProfessional?.id);
    const assessmentId = safeText(context?.assessment?.id);
    const domainId = safeText(context?.domain?.id);
    const programId = safeText(context?.program?.id || recommendation?.program_id || recommendation?.programId);
    const hasProtocol = Boolean(context?.protocol?.id || context?.target?.protocol_id || context?.target?.protocolId);
    const hasProgram = Boolean(programId);
    const treated = Boolean(group.convertedProgram) || ['ACCEPTED', 'APPLIED_TO_NEXT_SESSION', 'REJECTED', 'EXPIRED'].includes(status);
    const actionPolicy = resolveTherapeuticRecommendationActionPolicy(recommendation);
    const scopeMatches = filters.scope === 'treated'
      ? treated
      : filters.scope === 'incomplete'
        ? !actionPolicy.contextComplete
        : filters.scope !== 'untreated' || !treated;
    const recentMatches = filters.scope !== 'recent' || createdAt >= now.getTime() - 30 * 24 * 60 * 60 * 1000;
    const typeMatches = !filters.type || filters.type === 'all'
      || type === filters.type
      || (filters.type === 'ACQUISITION' && ['INTRODUCE_NEW_TARGET', 'MASTERY_REVIEW', 'CONTINUE_TRAINING'].includes(type))
      || (filters.type === 'HELP' && type === 'PROMPT_FADING');
    const originMatches = !filters.origin || filters.origin === 'all'
      || (filters.origin === 'protocol' && hasProtocol)
      || (filters.origin === 'program' && hasProgram);
    const professionalMatches = !filters.professionalId || filters.professionalId === 'all' || professionalId === filters.professionalId;
    const assessmentMatches = !filters.assessmentId || filters.assessmentId === 'all' || assessmentId === filters.assessmentId;
    const domainMatches = !filters.domainId || filters.domainId === 'all' || domainId === filters.domainId;
    const programMatches = !filters.programId || filters.programId === 'all' || programId === filters.programId;
    const statusMatches = !filters.status || filters.status === 'all' || status === filters.status;
    const periodMatches = threshold === null || createdAt >= threshold;
    const searchable = [
      recommendation?.title,
      recommendation?.summary,
      recommendation?.rationale,
      context?.target?.name,
      context?.program?.name,
      context?.protocol?.title,
      context?.domain?.name,
      context?.assessment?.label,
      context?.responsible_professional?.display_name,
      context?.responsibleProfessional?.displayName,
    ].map(safeText).join(' ').toLocaleLowerCase('pt-BR');
    return scopeMatches && recentMatches && typeMatches && originMatches && professionalMatches
      && assessmentMatches && domainMatches && programMatches && statusMatches
      && periodMatches && (!needle || searchable.includes(needle));
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
    const normalizedProgram = normalizeClinicalTextRecord(program);
    const programId = safeText(normalizedProgram?.id);
    const nestedTargets = Array.isArray(normalizedProgram?.targets) ? normalizedProgram.targets : targetsByProgram.get(programId) || [];
    const normalizedTargets = nestedTargets
      .map((target: any) => {
        const normalizedTarget = normalizeClinicalTextRecord(target);
        return { ...normalizedTarget, normalizedStatus: normalizeTherapeuticTargetStatus(normalizedTarget) };
      })
      .sort((a: any, b: any) => Number(a?.sort_order ?? a?.sortOrder ?? 0) - Number(b?.sort_order ?? b?.sortOrder ?? 0));
    return {
      ...normalizedProgram,
      id: programId,
      status: normalizeTherapeuticProgramStatus(normalizedProgram?.status),
      objective: safeText(normalizedProgram?.objective || normalizedProgram?.description),
      category: safeText(normalizedProgram?.category || normalizedProgram?.domain_name || normalizedProgram?.domainName || 'Outro'),
      measurementType: safeText(normalizedProgram?.measurement_type || normalizedProgram?.measurementType || 'independent_prompted_no_response'),
      targets: normalizedTargets,
      masteredTargetCount: normalizedTargets.filter((target: any) => target.normalizedStatus === 'mastered').length,
      lastAppliedAt: normalizedProgram?.last_applied_at || normalizedProgram?.lastAppliedAt || null,
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
      const isActiveSessionTarget = programStatus === 'maintenance'
        ? targetStatus === 'maintenance'
        : targetStatus === 'teaching';
      if (!isActiveSessionTarget) return [];
      const targetId = safeText(target?.id || target?.target_id || target?.targetId);
      if (!targetId || seenTargetIds.has(targetId)) return [];
      seenTargetIds.add(targetId);
      const name = safeText(target?.name || target?.target_name || target?.targetName) || 'Alvo do programa';
      const targetMasteryCriteria = target?.mastery_criteria && typeof target.mastery_criteria === 'object' && !Array.isArray(target.mastery_criteria)
        ? target.mastery_criteria
        : target?.masteryCriteria && typeof target.masteryCriteria === 'object' && !Array.isArray(target.masteryCriteria)
          ? target.masteryCriteria
          : null;
      const programMasteryCriteria = program?.mastery_criteria && typeof program.mastery_criteria === 'object' && !Array.isArray(program.mastery_criteria)
        ? program.mastery_criteria
        : program?.masteryCriteria && typeof program.masteryCriteria === 'object' && !Array.isArray(program.masteryCriteria)
          ? program.masteryCriteria
          : null;
      const hasTargetMasteryCriteria = Boolean(targetMasteryCriteria && Object.keys(targetMasteryCriteria).length > 0);
      const hasProgramMasteryCriteria = Boolean(programMasteryCriteria && Object.keys(programMasteryCriteria).length > 0);
      const masteryCriteria = hasTargetMasteryCriteria
        ? targetMasteryCriteria
        : hasProgramMasteryCriteria
          ? {
              ...programMasteryCriteria,
              source: programMasteryCriteria?.source || programMasteryCriteria?.criterionSource || programMasteryCriteria?.criterion_source || 'program_inherited',
              sourceLabel: programMasteryCriteria?.sourceLabel || programMasteryCriteria?.source_label || 'Critério do programa',
            }
          : {};
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
  const canonicalTherapeuticGoals = Array.isArray(therapeuticGoals) ? therapeuticGoals : [];
  if (canonicalTherapeuticGoals.length > 0) {
    return canonicalTherapeuticGoals;
  }

  const merged = new Map<string, any>();
  canonicalTherapeuticGoals.forEach((goal: any) => {
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
  const customMeasure = safeText(source.measure);
  const customValue = Number(source.value);
  if (customMeasure && Number.isFinite(customValue)) {
    const measureLabels: Record<string, string> = {
      accuracy_percent: 'de acerto',
      independent_responses: 'respostas independentes',
      frequency: 'ocorrências',
      duration_seconds: 'segundos de duração',
      latency_seconds: 'segundos de latência',
      steps_percent: 'de etapas concluídas',
    };
    const operatorLabels: Record<string, string> = { gte: '≥', gt: '>', eq: '=', lte: '≤' };
    const unitValue = ['accuracy_percent', 'steps_percent'].includes(customMeasure) ? `${customValue}%` : String(customValue);
    const requiredSessions = Number(source.requiredSessions ?? source.required_sessions);
    const sessionMode = safeText(source.sessionMode || source.session_mode) === 'cumulative' ? 'acumuladas' : 'consecutivas';
    return `${operatorLabels[safeText(source.operator)] || '≥'} ${unitValue} ${measureLabels[customMeasure] || customMeasure}${Number.isFinite(requiredSessions) && requiredSessions > 0 ? ` em ${requiredSessions} sessões ${sessionMode}` : ''}`;
  }
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
