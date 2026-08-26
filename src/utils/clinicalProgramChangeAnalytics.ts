import {
  normalizeClinicalOutcomeDirection,
  type ClinicalOutcomeDirection,
  type ClinicalOutcomeObservation,
  type ClinicalOutcomeSeriesSummary,
} from './clinicalOutcomeAnalytics';

const clean = (value: unknown) => String(value ?? '').trim();
const finite = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export type ClinicalProgramDescriptor = {
  id: string;
  name: string;
  therapeuticObjectiveId: string;
  therapeuticPlanId: string;
};

export type ClinicalTargetMovement = 'improving' | 'stable' | 'attention' | 'insufficient';

export type ClinicalTargetChange = {
  key: string;
  label: string;
  metricLabel: string;
  unit: string;
  direction: ClinicalOutcomeDirection;
  movement: ClinicalTargetMovement;
  pointCount: number;
  firstValue: number | null;
  latestValue: number | null;
  delta: number | null;
  relativeMagnitude: number;
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
  stable: number;
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
  const directionalPenalty = ['no_directional_judgment', 'event', 'target_value', 'target_range'].includes(direction) ? 100 : 0;
  if (key.includes('PRIMARY_INDEPENDENCE')) return directionalPenalty + 0;
  if (key.includes('INDEPENDENCE')) return directionalPenalty + 1;
  if (key.includes('ACCURACY')) return directionalPenalty + 2;
  if (key.includes('FREQUENCY') || key.includes('RATE_PER_HOUR')) return directionalPenalty + 3;
  if (key.includes('INTERVAL_OCCURRENCE')) return directionalPenalty + 4;
  if (key.includes('DURATION_AVG')) return directionalPenalty + 5;
  if (key.includes('DURATION_TOTAL') || key.includes('DURATION_SECONDS')) return directionalPenalty + 6;
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
    const explicit = clean(
      row.metadata?.abaTargetId
      || row.metadata?.aba_target_id
      || row.metadata?.valueDetails?.abaTargetId
      || row.metadata?.valueDetails?.aba_target_id,
    );
    if (explicit) return explicit;
    const metricTarget = programTargetIdFromMetric(row.metricKey);
    if (metricTarget) return metricTarget;
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

const classifyMovement = (
  direction: ClinicalOutcomeDirection,
  values: Array<{ value: number }>,
): { movement: ClinicalTargetMovement; delta: number | null; relativeMagnitude: number } => {
  if (values.length < 3) return { movement: 'insufficient', delta: null, relativeMagnitude: 0 };
  if (['no_directional_judgment', 'event', 'target_value', 'target_range'].includes(direction)) {
    return { movement: 'insufficient', delta: null, relativeMagnitude: 0 };
  }
  const firstValue = values[0].value;
  const latestValue = values[values.length - 1].value;
  const delta = latestValue - firstValue;
  const scale = Math.max(Math.abs(firstValue), Math.abs(latestValue), 1);
  const tolerance = Math.max(0.0001, scale * 0.02);
  const relativeMagnitude = Math.abs(delta) / scale;
  if (Math.abs(delta) <= tolerance) return { movement: 'stable', delta, relativeMagnitude };
  const favorable = direction === 'lower_is_better' ? delta < 0 : delta > 0;
  return { movement: favorable ? 'improving' : 'attention', delta, relativeMagnitude };
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
    const direction = normalizeClinicalOutcomeDirection(entry.series.direction);
    const classification = classifyMovement(direction, points);
    const firstValue = points[0]?.value ?? null;
    const latest = points[points.length - 1];
    return {
      key,
      label: clean(entry.series.itemLabel) || clean(entry.series.metricLabel) || 'Alvo clínico',
      metricLabel: clean(entry.series.metricLabel) || clean(entry.series.metricKey) || 'Métrica clínica',
      unit: clean(entry.series.unit),
      direction,
      movement: classification.movement,
      pointCount: points.length,
      firstValue,
      latestValue: latest?.value ?? null,
      delta: classification.delta,
      relativeMagnitude: classification.relativeMagnitude,
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
        stable: targets.filter((target) => target.movement === 'stable').length,
        attention: targets.filter((target) => target.movement === 'attention').length,
        insufficient: targets.filter((target) => target.movement === 'insufficient').length,
        targets,
      };
    })
    .filter((program) => program.targetCount > 0)
    .sort((left, right) => right.attention - left.attention || right.improving - left.improving || left.name.localeCompare(right.name, 'pt-BR'));

  const highConfidence = targetChanges.filter((target) => target.pointCount >= 3 && target.movement !== 'insufficient');
  const improvingTargets = highConfidence
    .filter((target) => target.movement === 'improving')
    .sort((left, right) => right.relativeMagnitude - left.relativeMagnitude || right.pointCount - left.pointCount)
    .slice(0, 4);
  const attentionTargets = highConfidence
    .filter((target) => target.movement === 'attention')
    .sort((left, right) => right.relativeMagnitude - left.relativeMagnitude || right.pointCount - left.pointCount)
    .slice(0, 4);

  return { programs: programRows, targets: targetChanges, improvingTargets, attentionTargets };
};
