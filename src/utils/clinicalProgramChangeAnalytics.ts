import {
  normalizeClinicalOutcomeDirection,
  type ClinicalOutcomeDirection,
  type ClinicalOutcomeObservation,
  type ClinicalOutcomeSeriesSummary,
} from './clinicalOutcomeAnalytics';

const clean = (value: unknown) => String(value ?? '').trim();
const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const objectOrNull = (value: unknown): Record<string, any> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null
);

export type ClinicalProgramDescriptor = {
  id: string;
  name: string;
  therapeuticObjectiveId: string;
  therapeuticPlanId: string;
  measurementType: string;
  masteryCriteria: Record<string, any> | null;
};

export type ClinicalTargetMovement = 'improving' | 'criterion_sustained' | 'stagnant' | 'attention' | 'insufficient';
export type ClinicalMathTrend = 'up' | 'down' | 'flat' | 'unknown';

type ClinicalCriterionKind = 'at_least' | 'at_most' | 'range' | 'target';

type ClinicalCriterion = {
  kind: ClinicalCriterionKind;
  targetValue: number | null;
  targetMin: number | null;
  targetMax: number | null;
  requiredSessions: number;
  label: string;
  source: 'versioned_decision_rule' | 'target_reference' | 'target_mastery_criteria' | 'program_mastery_criteria';
};

export type ClinicalTargetChange = {
  key: string;
  label: string;
  metricLabel: string;
  unit: string;
  direction: ClinicalOutcomeDirection;
  movement: ClinicalTargetMovement;
  previousMovement: ClinicalTargetMovement;
  mathTrend: ClinicalMathTrend;
  valueTrend: ClinicalMathTrend;
  pointCount: number;
  firstValue: number | null;
  latestValue: number | null;
  delta: number | null;
  relativeMagnitude: number;
  semanticStrength: number;
  criterionProgressDelta: number;
  criterionLabel: string;
  criterionSource: ClinicalCriterion['source'] | null;
  criterionMet: boolean;
  criterionMetAtStart: boolean;
  criterionConsecutiveSessions: number;
  criterionRequiredSessions: number;
  highlightPriority: number;
  latestSessionId: string | null;
  latestObservedAt: string | null;
  programId: string | null;
  programName: string | null;
  seriesKey: string;
};

export type ClinicalProgramProgress = {
  id: string;
  name: string;
  targetCount: number;
  improving: number;
  criterionSustained: number;
  stagnant: number;
  attention: number;
  insufficient: number;
  targets: ClinicalTargetChange[];
};

const normalizePrograms = (programs: any[]): ClinicalProgramDescriptor[] => (
  (Array.isArray(programs) ? programs : [])
    .map((program) => ({
      id: clean(program?.id),
      name: clean(program?.name) || 'Programa sem nome',
      therapeuticObjectiveId: clean(program?.therapeuticObjectiveId || program?.therapeutic_objective_id),
      therapeuticPlanId: clean(program?.therapeuticPlanId || program?.therapeutic_plan_id),
      measurementType: clean(program?.measurementType || program?.measurement_type).toLowerCase(),
      masteryCriteria: objectOrNull(program?.masteryCriteria || program?.mastery_criteria),
    }))
    .filter((program) => program.id)
);

const observationValue = (row: ClinicalOutcomeObservation) => finite(row.value);
const sessionKey = (row: ClinicalOutcomeObservation) => clean(row.sessionId) || `observed:${clean(row.observedAt)}`;
const observationTime = (row: ClinicalOutcomeObservation) => {
  const parsed = new Date(clean(row.observedAt));
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const metricPriority = (series: ClinicalOutcomeSeriesSummary) => {
  const key = clean(series.metricKey).toUpperCase();
  const direction = normalizeClinicalOutcomeDirection(series.direction);
  const directionalPenalty = ['no_directional_judgment', 'event'].includes(direction) ? 100 : 0;
  if (key.includes('PRIMARY_INDEPENDENCE')) return directionalPenalty + 0;
  if (key.includes('INDEPENDENCE')) return directionalPenalty + 1;
  if (key.includes('ACCURACY')) return directionalPenalty + 2;
  if (key.includes('FREQUENCY') || key.includes('RATE_PER_HOUR')) return directionalPenalty + 3;
  if (key.includes('INTERVAL_OCCURRENCE')) return directionalPenalty + 4;
  if (key.includes('DURATION_AVG')) return directionalPenalty + 5;
  if (key.includes('DURATION_TOTAL') || key.includes('DURATION_SECONDS') || key.includes(':DURATION')) return directionalPenalty + 6;
  if (key.includes('LATENCY')) return directionalPenalty + 6;
  if (key.includes('DURATION_EPISODES')) return directionalPenalty + 7;
  if (key.includes('MASTERY')) return directionalPenalty + 20;
  if (key.includes('MAINTENANCE')) return directionalPenalty + 21;
  if (key.includes('TRIAL') || key.includes('ATTEMPT')) return directionalPenalty + 90;
  return directionalPenalty + 50;
};

const programTargetIdFromMetric = (metricKey: unknown) => {
  const match = clean(metricKey).match(/^program_target:([^:]+):/i);
  return match?.[1] || '';
};

const targetIdentity = (series: ClinicalOutcomeSeriesSummary) => {
  const rows = Array.isArray(series.observations) ? series.observations : [];
  for (const row of rows) {
    const metricTarget = programTargetIdFromMetric(row.metricKey);
    if (metricTarget) return metricTarget;
    const explicit = clean(
      row.metadata?.abaTargetId
      || row.metadata?.aba_target_id
      || row.metadata?.valueDetails?.abaTargetId
      || row.metadata?.valueDetails?.aba_target_id,
    );
    if (explicit) return explicit;
  }
  const sample = series.latestObservation || rows[rows.length - 1] || rows[0];
  return clean(sample?.itemId) || clean(series.itemLabel) || clean(series.key);
};

const seriesProgram = (
  series: ClinicalOutcomeSeriesSummary,
  byId: Map<string, ClinicalProgramDescriptor>,
  byObjectiveId: Map<string, ClinicalProgramDescriptor>,
): ClinicalProgramDescriptor | null => {
  const rows = Array.isArray(series.observations) ? series.observations : [];
  for (const row of rows) {
    const directProgramId = clean(row.programId || row.metadata?.programId || row.metadata?.program_id);
    if (directProgramId && byId.has(directProgramId)) return byId.get(directProgramId) || null;
  }
  for (const row of rows) {
    const objectiveId = clean(
      row.goalId
      || row.metadata?.goalId
      || row.metadata?.goal_id
      || row.metadata?.therapeuticObjectiveId
      || row.metadata?.therapeutic_objective_id,
    );
    if (objectiveId && byObjectiveId.has(objectiveId)) return byObjectiveId.get(objectiveId) || null;
  }
  return null;
};

const sessionValues = (series: ClinicalOutcomeSeriesSummary) => {
  const groups = new Map<string, ClinicalOutcomeObservation[]>();
  for (const row of Array.isArray(series.validObservations) ? series.validObservations : []) {
    if (observationValue(row) === null) continue;
    const key = sessionKey(row);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  return Array.from(groups.values())
    .map((rows) => {
      const sorted = rows.slice().sort((left, right) => observationTime(left) - observationTime(right));
      const latest = sorted[sorted.length - 1];
      const values = rows.map(observationValue).filter((value): value is number => value !== null);
      if (!values.length) return null;
      return {
        value: values.reduce((sum, value) => sum + value, 0) / values.length,
        sessionId: clean(latest?.sessionId) || null,
        observedAt: clean(latest?.observedAt) || null,
        sortTime: observationTime(latest),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((left, right) => left.sortTime - right.sortTime);
};

const metricMatchesMeasure = (measure: string, series: ClinicalOutcomeSeriesSummary) => {
  const normalized = clean(measure).toLowerCase();
  const metric = `${clean(series.metricKey)} ${clean(series.metricLabel)} ${clean(series.unit)}`.toLowerCase();
  if (!normalized) return true;
  if (normalized === 'duration_seconds') return metric.includes('duration') || metric.includes('duração');
  if (normalized === 'latency_seconds') return metric.includes('latency') || metric.includes('latência') || metric.includes('tempo de resposta');
  if (normalized === 'frequency') return metric.includes('frequency') || metric.includes('frequência') || metric.includes('rate');
  if (normalized === 'accuracy_percent') return metric.includes('accuracy') || metric.includes('acurácia') || metric.includes('independence') || metric.includes('independência') || metric.includes('percent');
  if (normalized === 'steps_percent') return metric.includes('step') || metric.includes('etapa');
  if (normalized === 'independent_responses') return metric.includes('independence') || metric.includes('independência');
  return false;
};

const operatorToCriterionKind = (operator: unknown): ClinicalCriterionKind | null => {
  const normalized = clean(operator).toLowerCase();
  if (['gte', 'gt', '>=', '>', 'at_least', 'minimum'].includes(normalized)) return 'at_least';
  if (['lte', 'lt', '<=', '<', 'at_most', 'maximum'].includes(normalized)) return 'at_most';
  if (['eq', '=', 'target', 'equals'].includes(normalized)) return 'target';
  return null;
};

const directionToCriterionKind = (direction: unknown): ClinicalCriterionKind | null => {
  const normalized = normalizeClinicalOutcomeDirection(direction);
  if (normalized === 'higher_is_better') return 'at_least';
  if (normalized === 'lower_is_better') return 'at_most';
  if (normalized === 'target_value') return 'target';
  if (normalized === 'target_range') return 'range';
  return null;
};

const criterionFromDecisionRules = (
  rulesValue: unknown,
  series: ClinicalOutcomeSeriesSummary,
): ClinicalCriterion | null => {
  const rules = objectOrNull(rulesValue);
  if (!rules) return null;
  const nested = objectOrNull(rules.criterion || rules.target || rules.goal);
  if (nested && nested !== rules) {
    const nestedCriterion = criterionFromDecisionRules({ ...rules, ...nested, criterion: undefined, target: undefined, goal: undefined }, series);
    if (nestedCriterion) return nestedCriterion;
  }
  const rangeValue = rules.targetRange ?? rules.target_range ?? rules.range;
  const rangeObject = objectOrNull(rangeValue);
  const arrayRange = Array.isArray(rangeValue) ? rangeValue : null;
  const targetMin = finite(rules.targetMin ?? rules.target_min ?? rangeObject?.min ?? rangeObject?.minimum ?? arrayRange?.[0]);
  const targetMax = finite(rules.targetMax ?? rules.target_max ?? rangeObject?.max ?? rangeObject?.maximum ?? arrayRange?.[1]);
  const targetValue = finite(rules.targetThreshold ?? rules.target_threshold ?? rules.threshold ?? rules.targetValue ?? rules.target_value ?? rules.value);
  const requiredSessions = Math.max(1, Math.min(30, Number(rules.requiredSessions ?? rules.required_sessions ?? rules.minimumComparableSessions ?? rules.minimum_comparable_sessions ?? 2) || 2));
  const label = clean(rules.criterionLabel ?? rules.criterion_label ?? rules.label);
  if (targetMin !== null && targetMax !== null) {
    return { kind: 'range', targetValue: null, targetMin: Math.min(targetMin, targetMax), targetMax: Math.max(targetMin, targetMax), requiredSessions, label, source: 'versioned_decision_rule' };
  }
  if (targetValue === null) return null;
  const kind = operatorToCriterionKind(rules.operator)
    || directionToCriterionKind(rules.directionality ?? rules.direction)
    || directionToCriterionKind(series.direction)
    || 'target';
  return { kind, targetValue, targetMin: null, targetMax: null, requiredSessions, label, source: 'versioned_decision_rule' };
};

const criterionFromDirectReference = (metadata: Record<string, any>, series: ClinicalOutcomeSeriesSummary): ClinicalCriterion | null => {
  const range = objectOrNull(metadata.targetRange ?? metadata.target_range);
  const targetMin = finite(metadata.targetMin ?? metadata.target_min ?? range?.min ?? range?.minimum);
  const targetMax = finite(metadata.targetMax ?? metadata.target_max ?? range?.max ?? range?.maximum);
  const targetValue = finite(metadata.targetValue ?? metadata.target_value ?? metadata.targetThreshold ?? metadata.target_threshold);
  const requiredSessions = Math.max(1, Math.min(30, Number(metadata.requiredSessions ?? metadata.required_sessions ?? 2) || 2));
  const label = clean(metadata.criterionLabel ?? metadata.criterion_label);
  if (targetMin !== null && targetMax !== null) {
    return { kind: 'range', targetValue: null, targetMin: Math.min(targetMin, targetMax), targetMax: Math.max(targetMin, targetMax), requiredSessions, label, source: 'target_reference' };
  }
  if (targetValue === null) return null;
  const kind = operatorToCriterionKind(metadata.operator)
    || directionToCriterionKind(metadata.directionality ?? metadata.direction)
    || directionToCriterionKind(series.direction)
    || 'target';
  return { kind, targetValue, targetMin: null, targetMax: null, requiredSessions, label, source: 'target_reference' };
};

const criterionFromMastery = (
  criteriaValue: unknown,
  series: ClinicalOutcomeSeriesSummary,
  source: 'target_mastery_criteria' | 'program_mastery_criteria',
): ClinicalCriterion | null => {
  const criteria = objectOrNull(criteriaValue);
  if (!criteria) return null;
  const measure = clean(criteria.measure || criteria.customMeasure || criteria.custom_measure).toLowerCase();
  if (measure && !metricMatchesMeasure(measure, series)) return null;
  const requiredSessions = Math.max(1, Math.min(30, Number(criteria.requiredSessions ?? criteria.required_sessions ?? 2) || 2));
  const operator = operatorToCriterionKind(criteria.operator);
  const genericValue = finite(criteria.value);
  if (measure && genericValue !== null) {
    const kind = operator || (measure === 'latency_seconds' ? 'at_most' : 'at_least');
    return { kind, targetValue: genericValue, targetMin: null, targetMax: null, requiredSessions, label: clean(criteria.criterionLabel ?? criteria.criterion_label), source };
  }
  const accuracy = finite(criteria.minAccuracyPercent ?? criteria.min_accuracy_percent);
  if (accuracy !== null && metricMatchesMeasure('accuracy_percent', series)) {
    return { kind: 'at_least', targetValue: accuracy, targetMin: null, targetMax: null, requiredSessions, label: `≥ ${accuracy}%`, source };
  }
  const duration = finite(criteria.durationSeconds ?? criteria.duration_seconds);
  if (duration !== null && metricMatchesMeasure('duration_seconds', series)) {
    return { kind: operator || 'at_least', targetValue: duration, targetMin: null, targetMax: null, requiredSessions, label: `${operator === 'at_most' ? '≤' : '≥'} ${duration} s`, source };
  }
  const latency = finite(criteria.maxLatencySeconds ?? criteria.max_latency_seconds);
  if (latency !== null && metricMatchesMeasure('latency_seconds', series)) {
    return { kind: 'at_most', targetValue: latency, targetMin: null, targetMax: null, requiredSessions, label: `≤ ${latency} s`, source };
  }
  const frequency = finite(criteria.requiredFrequency ?? criteria.required_frequency);
  if (frequency !== null && metricMatchesMeasure('frequency', series)) {
    return { kind: operator || 'at_least', targetValue: frequency, targetMin: null, targetMax: null, requiredSessions, label: `${operator === 'at_most' ? '≤' : '≥'} ${frequency}`, source };
  }
  return null;
};

const seriesCriterion = (series: ClinicalOutcomeSeriesSummary, program: ClinicalProgramDescriptor | null): ClinicalCriterion | null => {
  for (const observation of Array.isArray(series.observations) ? series.observations : []) {
    const metadata = objectOrNull(observation.metadata) || {};
    const rules = metadata.clinicalDecisionRules ?? metadata.clinical_decision_rules ?? metadata.semanticContract?.clinicalDecisionRules ?? metadata.semantic_contract?.clinical_decision_rules;
    const versioned = criterionFromDecisionRules(rules, series);
    if (versioned) return versioned;
    const direct = criterionFromDirectReference(metadata, series);
    if (direct) return direct;
    const targetCriteria = metadata.masteryCriteria ?? metadata.mastery_criteria;
    const fromTarget = criterionFromMastery(targetCriteria, series, 'target_mastery_criteria');
    if (fromTarget) return fromTarget;
    const inheritedCriteria = metadata.programMasteryCriteria ?? metadata.program_mastery_criteria;
    const fromInherited = criterionFromMastery(inheritedCriteria, series, 'program_mastery_criteria');
    if (fromInherited) return fromInherited;
  }
  return criterionFromMastery(program?.masteryCriteria, series, 'program_mastery_criteria');
};

const effectiveDirection = (series: ClinicalOutcomeSeriesSummary, criterion: ClinicalCriterion | null): ClinicalOutcomeDirection => {
  if (criterion?.kind === 'at_least') return 'higher_is_better';
  if (criterion?.kind === 'at_most') return 'lower_is_better';
  if (criterion?.kind === 'range') return 'target_range';
  if (criterion?.kind === 'target') return 'target_value';
  for (const observation of Array.isArray(series.observations) ? series.observations : []) {
    const metadata = objectOrNull(observation.metadata) || {};
    const rules = objectOrNull(metadata.clinicalDecisionRules ?? metadata.clinical_decision_rules ?? metadata.semanticContract?.clinicalDecisionRules ?? metadata.semantic_contract?.clinical_decision_rules);
    const ruleDirection = clean(rules?.directionality ?? rules?.direction);
    if (ruleDirection) return normalizeClinicalOutcomeDirection(ruleDirection);
  }
  return normalizeClinicalOutcomeDirection(series.direction);
};

const criterionLabel = (criterion: ClinicalCriterion | null, unit: string) => {
  if (!criterion) return '';
  if (criterion.label) return criterion.label;
  const suffix = clean(unit) ? ` ${clean(unit)}` : '';
  if (criterion.kind === 'range') return `${criterion.targetMin}${suffix}–${criterion.targetMax}${suffix}`;
  if (criterion.kind === 'at_most') return `≤ ${criterion.targetValue}${suffix}`;
  if (criterion.kind === 'at_least') return `≥ ${criterion.targetValue}${suffix}`;
  return `Meta ${criterion.targetValue}${suffix}`;
};

const criterionDistance = (criterion: ClinicalCriterion, value: number) => {
  const tolerance = Math.max(0.0001, Math.max(Math.abs(criterion.targetValue || 0), Math.abs(criterion.targetMin || 0), Math.abs(criterion.targetMax || 0), 1) * 0.01);
  if (criterion.kind === 'at_least') return Math.max(0, Number(criterion.targetValue) - value);
  if (criterion.kind === 'at_most') return Math.max(0, value - Number(criterion.targetValue));
  if (criterion.kind === 'range') {
    if (value < Number(criterion.targetMin)) return Number(criterion.targetMin) - value;
    if (value > Number(criterion.targetMax)) return value - Number(criterion.targetMax);
    return 0;
  }
  return Math.max(0, Math.abs(value - Number(criterion.targetValue)) - tolerance);
};

const criterionIsMet = (criterion: ClinicalCriterion, value: number) => criterionDistance(criterion, value) <= 0;

const linearSlope = (values: number[]) => {
  if (values.length < 2) return 0;
  const meanX = (values.length - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    const dx = index - meanX;
    numerator += dx * (value - meanY);
    denominator += dx * dx;
  });
  return denominator > 0 ? numerator / denominator : 0;
};

const endpointTrend = (firstValue: number | null, latestValue: number | null): ClinicalMathTrend => {
  if (firstValue === null || latestValue === null) return 'unknown';
  const delta = latestValue - firstValue;
  const scale = Math.max(Math.abs(firstValue), Math.abs(latestValue), 1);
  const tolerance = Math.max(0.0001, scale * 0.001);
  if (Math.abs(delta) <= tolerance) return 'flat';
  return delta > 0 ? 'up' : 'down';
};

type MovementClassification = {
  movement: ClinicalTargetMovement;
  delta: number | null;
  relativeMagnitude: number;
  semanticStrength: number;
  criterionProgressDelta: number;
  mathTrend: ClinicalMathTrend;
  criterionMet: boolean;
  criterionConsecutiveSessions: number;
  criterionRequiredSessions: number;
};

const classifyMovement = (
  direction: ClinicalOutcomeDirection,
  values: Array<{ value: number }>,
  criterion: ClinicalCriterion | null,
): MovementClassification => {
  const empty: MovementClassification = {
    movement: 'insufficient', delta: null, relativeMagnitude: 0, semanticStrength: 0, criterionProgressDelta: 0,
    mathTrend: 'unknown', criterionMet: false, criterionConsecutiveSessions: 0, criterionRequiredSessions: criterion?.requiredSessions || 2,
  };
  if (values.length < 3) return empty;
  const numericValues = values.map((row) => row.value);
  const firstValue = numericValues[0];
  const latestValue = numericValues[numericValues.length - 1];
  const delta = latestValue - firstValue;
  const scale = Math.max(...numericValues.map((value) => Math.abs(value)), 1);
  const projectedSlope = linearSlope(numericValues) * Math.max(1, numericValues.length - 1);
  const trendTolerance = Math.max(0.0001, scale * 0.02);
  const mathTrend: ClinicalMathTrend = Math.abs(projectedSlope) <= trendTolerance ? 'flat' : projectedSlope > 0 ? 'up' : 'down';
  const relativeMagnitude = Math.abs(delta) / scale;

  if (criterion) {
    const distances = numericValues.map((value) => criterionDistance(criterion, value));
    const latestDistance = distances[distances.length - 1];
    const firstDistance = distances[0];
    const distanceScale = Math.max(...distances, Math.abs(criterion.targetValue || 0), Math.abs(criterion.targetMin || 0), Math.abs(criterion.targetMax || 0), 1);
    const distanceSlope = linearSlope(distances) * Math.max(1, distances.length - 1);
    const distanceTolerance = Math.max(0.0001, distanceScale * 0.02);
    const latestMet = criterionIsMet(criterion, latestValue);
    let consecutive = 0;
    for (let index = numericValues.length - 1; index >= 0; index -= 1) {
      if (!criterionIsMet(criterion, numericValues[index])) break;
      consecutive += 1;
    }
    const requiredSessions = Math.max(2, criterion.requiredSessions || 2);
    const criterionProgressDelta = Math.max(0, firstDistance - latestDistance) / Math.max(firstDistance, distanceScale, 1);
    const semanticStrength = Math.abs(distanceSlope) / Math.max(distanceScale, 1);
    if (latestMet) {
      return {
        movement: consecutive >= requiredSessions ? 'criterion_sustained' : 'improving',
        delta,
        relativeMagnitude,
        semanticStrength,
        criterionProgressDelta,
        mathTrend,
        criterionMet: true,
        criterionConsecutiveSessions: consecutive,
        criterionRequiredSessions: requiredSessions,
      };
    }
    if (Math.abs(distanceSlope) <= distanceTolerance) {
      return { movement: 'stagnant', delta, relativeMagnitude, semanticStrength, criterionProgressDelta, mathTrend, criterionMet: false, criterionConsecutiveSessions: 0, criterionRequiredSessions: requiredSessions };
    }
    return {
      movement: distanceSlope < 0 ? 'improving' : 'attention',
      delta,
      relativeMagnitude,
      semanticStrength,
      criterionProgressDelta,
      mathTrend,
      criterionMet: false,
      criterionConsecutiveSessions: 0,
      criterionRequiredSessions: requiredSessions,
    };
  }

  if (['no_directional_judgment', 'event', 'target_value', 'target_range'].includes(direction)) return { ...empty, delta, relativeMagnitude, mathTrend };
  const semanticStrength = Math.abs(projectedSlope) / Math.max(scale, 1);
  if (mathTrend === 'flat') return { ...empty, movement: 'stagnant', delta, relativeMagnitude, semanticStrength, mathTrend };
  const favorable = direction === 'lower_is_better' ? mathTrend === 'down' : mathTrend === 'up';
  return { ...empty, movement: favorable ? 'improving' : 'attention', delta, relativeMagnitude, semanticStrength, mathTrend };
};

const improvementTransitionPriority = (current: ClinicalTargetMovement, previous: ClinicalTargetMovement) => {
  if (current === 'criterion_sustained' && ['attention', 'stagnant'].includes(previous)) return 600;
  if (current === 'improving' && ['attention', 'stagnant'].includes(previous)) return 550;
  if (current === 'criterion_sustained' && previous === 'improving') return 500;
  if (current === 'improving' && previous === 'insufficient') return 350;
  if (current === 'criterion_sustained' && previous === 'insufficient') return 300;
  if (current === 'improving') return 250;
  return 0;
};

const attentionTransitionPriority = (current: ClinicalTargetMovement, previous: ClinicalTargetMovement) => {
  if (current !== 'attention') return 0;
  if (previous === 'criterion_sustained') return 650;
  if (previous === 'improving') return 600;
  if (previous === 'stagnant') return 550;
  if (previous === 'insufficient') return 400;
  return 300;
};

export const buildClinicalProgramChangeOverview = (
  seriesRows: ClinicalOutcomeSeriesSummary[],
  programs: any[],
) => {
  const descriptors = normalizePrograms(programs);
  const byId = new Map(descriptors.map((program) => [program.id, program]));
  const byObjectiveId = new Map(descriptors.filter((program) => program.therapeuticObjectiveId).map((program) => [program.therapeuticObjectiveId, program]));

  const representativeByTarget = new Map<string, { series: ClinicalOutcomeSeriesSummary; program: ClinicalProgramDescriptor | null }>();
  for (const series of Array.isArray(seriesRows) ? seriesRows : []) {
    const program = seriesProgram(series, byId, byObjectiveId);
    const identity = `${program?.id || 'unassigned'}::${targetIdentity(series)}`;
    const current = representativeByTarget.get(identity);
    if (!current || metricPriority(series) < metricPriority(current.series)) representativeByTarget.set(identity, { series, program });
  }

  const targetChanges: ClinicalTargetChange[] = Array.from(representativeByTarget.entries()).map(([key, entry]) => {
    const points = sessionValues(entry.series);
    const criterion = seriesCriterion(entry.series, entry.program);
    const direction = effectiveDirection(entry.series, criterion);
    const classification = classifyMovement(direction, points, criterion);
    const previousClassification = classifyMovement(direction, points.slice(0, -1), criterion);
    const firstValue = points[0]?.value ?? null;
    const latest = points[points.length - 1];
    const improvementPriority = improvementTransitionPriority(classification.movement, previousClassification.movement);
    const attentionPriority = attentionTransitionPriority(classification.movement, previousClassification.movement);
    return {
      key,
      label: clean(entry.series.itemLabel) || clean(entry.series.metricLabel) || 'Alvo clínico',
      metricLabel: clean(entry.series.metricLabel) || clean(entry.series.metricKey) || 'Métrica clínica',
      unit: clean(entry.series.unit),
      direction,
      movement: classification.movement,
      previousMovement: previousClassification.movement,
      mathTrend: classification.mathTrend,
      valueTrend: endpointTrend(firstValue, latest?.value ?? null),
      pointCount: points.length,
      firstValue,
      latestValue: latest?.value ?? null,
      delta: classification.delta,
      relativeMagnitude: classification.relativeMagnitude,
      semanticStrength: classification.semanticStrength,
      criterionProgressDelta: classification.criterionProgressDelta,
      criterionLabel: criterionLabel(criterion, clean(entry.series.unit)),
      criterionSource: criterion?.source || null,
      criterionMet: classification.criterionMet,
      criterionMetAtStart: Boolean(criterion && firstValue !== null && criterionIsMet(criterion, firstValue)),
      criterionConsecutiveSessions: classification.criterionConsecutiveSessions,
      criterionRequiredSessions: classification.criterionRequiredSessions,
      highlightPriority: Math.max(improvementPriority, attentionPriority),
      latestSessionId: latest?.sessionId || null,
      latestObservedAt: latest?.observedAt || null,
      programId: entry.program?.id || null,
      programName: entry.program?.name || null,
      seriesKey: entry.series.key,
    };
  });

  const programRows: ClinicalProgramProgress[] = descriptors
    .map((program) => {
      const targets = targetChanges.filter((target) => target.programId === program.id);
      return {
        id: program.id,
        name: program.name,
        targetCount: targets.length,
        improving: targets.filter((target) => target.movement === 'improving').length,
        criterionSustained: targets.filter((target) => target.movement === 'criterion_sustained').length,
        stagnant: targets.filter((target) => target.movement === 'stagnant').length,
        attention: targets.filter((target) => target.movement === 'attention').length,
        insufficient: targets.filter((target) => target.movement === 'insufficient').length,
        targets,
      };
    })
    .filter((program) => program.targetCount > 0)
    .sort((left, right) => right.attention - left.attention || right.stagnant - left.stagnant || right.improving - left.improving || left.name.localeCompare(right.name, 'pt-BR'));

  const highConfidence = targetChanges.filter((target) => target.pointCount >= 3 && target.movement !== 'insufficient');
  const improvingTargets = highConfidence
    .filter((target) => {
      const semanticallyImproving = target.movement === 'improving'
        || (target.movement === 'criterion_sustained' && target.highlightPriority > 0);
      if (!semanticallyImproving) return false;

      // A highlight is a change, not merely a good status. Targets that already
      // started at criterion and remain there belong to mastery/maintenance.
      if (target.criterionMetAtStart && target.criterionMet) return false;

      // Flat endpoints (for example 100% -> 100%) cannot occupy a "major
      // evolution" slot even when intermediate sessions fluctuated.
      if (target.valueTrend === 'flat' || target.valueTrend === 'unknown') return false;

      // When a criterion exists, require real net approximation to that
      // criterion. This prevents above-threshold growth from inflating rank.
      if (target.criterionLabel && target.criterionProgressDelta <= 0) return false;
      return true;
    })
    .sort((left, right) => right.highlightPriority - left.highlightPriority || right.criterionProgressDelta - left.criterionProgressDelta || right.semanticStrength - left.semanticStrength || right.pointCount - left.pointCount)
    .slice(0, 4);
  const attentionTargets = highConfidence
    .filter((target) => target.movement === 'attention')
    .sort((left, right) => right.highlightPriority - left.highlightPriority || right.semanticStrength - left.semanticStrength || right.pointCount - left.pointCount)
    .slice(0, 4);

  return { programs: programRows, targets: targetChanges, improvingTargets, attentionTargets };
};
