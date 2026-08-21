export type ClinicalOutcomeDirection =
  | 'higher_is_better'
  | 'lower_is_better'
  | 'target_value'
  | 'target_range'
  | 'event'
  | 'no_directional_judgment';

export type ClinicalOutcomeEvidenceState =
  | 'no_data'
  | 'baseline_only'
  | 'preliminary'
  | 'sufficient';

export type ClinicalOutcomeVisualTrend =
  | 'unknown'
  | 'up'
  | 'down'
  | 'stable';

export type ClinicalOutcomeObservation = {
  id: string;
  planId?: string | null;
  planVersion?: number | null;
  goalId?: string | null;
  programId?: string | null;
  itemId?: string | null;
  itemLabel?: string | null;
  metricKey: string;
  metricLabel: string;
  itemLabel: string;
  metricType?: string | null;
  unit?: string | null;
  direction?: ClinicalOutcomeDirection | string | null;
  value?: number | null;
  valueText?: string | null;
  numerator?: number | null;
  denominator?: number | null;
  observedAt: string;
  specialty?: string | null;
  context?: string | null;
  source?: string | null;
  instrumentId?: string | null;
  instrumentVersion?: string | null;
  definitionVersion?: number | null;
  missingReason?: string | null;
  recencyWindowDays?: number | null;
  minimumDataPoints?: number | null;
  metadata?: Record<string, any>;
  projectionStale?: boolean;
  sourceAuthority?: 'canonical' | 'legacy' | string | null;
};

export type ClinicalOutcomeSeriesSummary = {
  key: string;
  metricKey: string;
  metricLabel: string;
  itemLabel: string;
  unit: string;
  direction: ClinicalOutcomeDirection;
  specialty: string;
  context: string;
  source: string;
  observations: ClinicalOutcomeObservation[];
  validObservations: ClinicalOutcomeObservation[];
  evidenceState: ClinicalOutcomeEvidenceState;
  visualTrend: ClinicalOutcomeVisualTrend;
  latestObservation: ClinicalOutcomeObservation | null;
  firstObservation: ClinicalOutcomeObservation | null;
  missingCount: number;
  stale: boolean;
  recencyWindowDays: number;
  minimumDataPoints: number;
};

const text = (value: unknown) => String(value ?? '').trim();

export const normalizeClinicalOutcomeDirection = (value: unknown): ClinicalOutcomeDirection => {
  const normalized = text(value).toLowerCase();
  if (['lower_is_better', 'lower-is-better', 'lower', 'decrease'].includes(normalized)) return 'lower_is_better';
  if (['target_value', 'target-value', 'target'].includes(normalized)) return 'target_value';
  if (['target_range', 'target-range', 'range'].includes(normalized)) return 'target_range';
  if (['event', 'milestone', 'binary'].includes(normalized)) return 'event';
  if (['no_directional_judgment', 'no-directional-judgment', 'neutral', 'none'].includes(normalized)) return 'no_directional_judgment';
  return 'higher_is_better';
};

export const clinicalOutcomeSeriesKey = (observation: ClinicalOutcomeObservation) => {
  const instrumentId = text(observation.instrumentId);
  const groupingInstrumentVersion = instrumentId === 'ABA_V3_PHASE'
    ? ''
    : text(observation.instrumentVersion);
  return [
    text(observation.planId),
    text(observation.goalId),
    text(observation.programId),
    text(observation.itemId),
    text(observation.metricKey),
    text(observation.unit),
    normalizeClinicalOutcomeDirection(observation.direction),
    instrumentId,
    groupingInstrumentVersion,
    String(Number(observation.definitionVersion || 1)),
    text(observation.specialty),
  ].join('::');
};

export const canCombineClinicalOutcomeSeries = (
  left: Pick<ClinicalOutcomeObservation, 'metricKey' | 'unit' | 'direction' | 'instrumentId' | 'instrumentVersion' | 'definitionVersion'>,
  right: Pick<ClinicalOutcomeObservation, 'metricKey' | 'unit' | 'direction' | 'instrumentId' | 'instrumentVersion' | 'definitionVersion'>,
) => (
  text(left.metricKey) === text(right.metricKey)
  && text(left.unit) === text(right.unit)
  && normalizeClinicalOutcomeDirection(left.direction) === normalizeClinicalOutcomeDirection(right.direction)
  && text(left.instrumentId) === text(right.instrumentId)
  && text(left.instrumentVersion) === text(right.instrumentVersion)
  && Number(left.definitionVersion || 1) === Number(right.definitionVersion || 1)
);

const finiteValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const dayDifference = (from: string, to = new Date()) => {
  const parsed = new Date(from);
  if (Number.isNaN(parsed.getTime())) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((to.getTime() - parsed.getTime()) / 86_400_000));
};

const deriveVisualTrend = (rows: ClinicalOutcomeObservation[]): ClinicalOutcomeVisualTrend => {
  if (rows.length < 4) return 'unknown';
  const values = rows.map((row) => finiteValue(row.value)).filter((value): value is number => value !== null);
  if (values.length < 4) return 'unknown';
  const split = Math.max(2, Math.floor(values.length / 2));
  const first = values.slice(0, split);
  const last = values.slice(-split);
  const firstMean = first.reduce((sum, value) => sum + value, 0) / first.length;
  const lastMean = last.reduce((sum, value) => sum + value, 0) / last.length;
  const scale = Math.max(1, ...values.map((value) => Math.abs(value)));
  const delta = lastMean - firstMean;
  if (Math.abs(delta) <= scale * 0.03) return 'stable';
  return delta > 0 ? 'up' : 'down';
};

export const summarizeClinicalOutcomeSeries = (
  observations: ClinicalOutcomeObservation[],
  now = new Date(),
): ClinicalOutcomeSeriesSummary[] => {
  const groups = new Map<string, ClinicalOutcomeObservation[]>();
  for (const observation of Array.isArray(observations) ? observations : []) {
    const key = clinicalOutcomeSeriesKey(observation);
    const current = groups.get(key) || [];
    current.push(observation);
    groups.set(key, current);
  }

  return Array.from(groups.entries()).map(([key, rows]) => {
    const ordered = rows.slice().sort((left, right) => new Date(left.observedAt).getTime() - new Date(right.observedAt).getTime());
    const valid = ordered.filter((row) => (
      !row.missingReason
      && (finiteValue(row.value) !== null || Boolean(text(row.valueText)))
    ));
    const minimumDataPoints = Math.max(4, Number(ordered.find((row) => Number(row.minimumDataPoints) > 0)?.minimumDataPoints || 4));
    const recencyWindowDays = Math.max(1, Number(ordered.find((row) => Number(row.recencyWindowDays) > 0)?.recencyWindowDays || 30));
    const evidenceState: ClinicalOutcomeEvidenceState = valid.length === 0
      ? 'no_data'
      : valid.length === 1
        ? 'baseline_only'
        : valid.length < minimumDataPoints
          ? 'preliminary'
          : 'sufficient';
    const latest = valid.length ? valid[valid.length - 1] : null;
    const sample = ordered[0];
    const contexts = Array.from(new Set(ordered.map((row) => text(row.context)).filter(Boolean)));
    const sources = Array.from(new Set(ordered.map((row) => text(row.source)).filter(Boolean)));
    return {
      key,
      metricKey: text(sample.metricKey),
      metricLabel: text(sample.metricLabel) || text(sample.metricKey) || 'Métrica clínica',
      itemLabel: text(sample.itemLabel),
      unit: text(sample.unit),
      direction: normalizeClinicalOutcomeDirection(sample.direction),
      specialty: text(sample.specialty) || 'Sem especialidade',
      context: contexts.length === 1 ? contexts[0] : contexts.length > 1 ? 'Múltiplos contextos' : 'Contexto não informado',
      source: sources.length === 1 ? sources[0] : sources.length > 1 ? 'V3 + histórico' : 'Registro clínico',
      observations: ordered,
      validObservations: valid,
      evidenceState,
      visualTrend: evidenceState === 'sufficient' ? deriveVisualTrend(valid) : 'unknown',
      latestObservation: latest,
      firstObservation: valid.length ? valid[0] : null,
      missingCount: ordered.length - valid.length,
      stale: latest ? Boolean(latest.projectionStale) || dayDifference(latest.observedAt, now) > recencyWindowDays : true,
      recencyWindowDays,
      minimumDataPoints,
    };
  }).sort((left, right) => {
    const leftDate = left.latestObservation?.observedAt || '';
    const rightDate = right.latestObservation?.observedAt || '';
    return rightDate.localeCompare(leftDate);
  });
};

export const formatClinicalOutcomeValue = (observation: ClinicalOutcomeObservation | null): string => {
  if (!observation) return 'Sem evidência';
  if (observation.missingReason) return 'Dado não coletado';
  const value = finiteValue(observation.value);
  const categoricalValue = text(observation.valueText);
  if (value === null) return categoricalValue || 'Sem evidência';
  const unit = text(observation.unit);
  const unitSuffix = unit ? (/^[%°]/.test(unit) ? unit : ` ${unit}`) : '';
  const rounded = Math.round(value * 10) / 10;
  const numerator = finiteValue(observation.numerator);
  const denominator = finiteValue(observation.denominator);
  if (numerator !== null && denominator !== null && denominator > 0) {
    return `${numerator} de ${denominator} — ${rounded}${unitSuffix}`;
  }
  if (denominator !== null && denominator > 0) {
    return `${rounded}${unitSuffix} · ${denominator} oportunidade(s)`;
  }
  return `${rounded}${unitSuffix}`;
};

export const clinicalOutcomeEvidenceLabel = (state: ClinicalOutcomeEvidenceState) => {
  if (state === 'no_data') return 'Sem dados';
  if (state === 'baseline_only') return 'Medida inicial';
  if (state === 'preliminary') return 'Evidência preliminar';
  return 'Série com dados suficientes';
};

export const clinicalOutcomeDirectionLabel = (direction: ClinicalOutcomeDirection) => {
  if (direction === 'lower_is_better') return 'Menor valor é desejável';
  if (direction === 'target_value') return 'Aproximar-se do valor-alvo';
  if (direction === 'target_range') return 'Permanecer na faixa-alvo';
  if (direction === 'event') return 'Atingir o evento definido';
  if (direction === 'no_directional_judgment') return 'Sem direção clínica automática';
  return 'Maior valor é desejável';
};
