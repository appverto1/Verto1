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
  sessionId?: string | null;
  professionalId?: string | null;
  itemId?: string | null;
  itemLabel?: string | null;
  metricKey: string;
  metricLabel: string;
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

export type ClinicalOutcomePeriodStats = {
  observationCount: number;
  sessionCount: number;
  opportunityCount: number;
  numeratorTotal: number | null;
  denominatorTotal: number | null;
  meanValue: number | null;
};

export type ClinicalOutcomePeriodComparison = {
  current: ClinicalOutcomePeriodStats;
  previous: ClinicalOutcomePeriodStats;
  delta: number | null;
  deltaLabel: string;
  movement: 'favorable' | 'unfavorable' | 'stable' | 'unknown';
};

export type ClinicalOutcomeTargetReference = {
  targetValue: number | null;
  targetMin: number | null;
  targetMax: number | null;
  criterionLabel: string;
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

const clinicalOutcomeSeriesSemanticValues = (
  series: ClinicalOutcomeSeriesSummary,
  selector: (row: ClinicalOutcomeObservation) => unknown[],
) => Array.from(new Set(
  (Array.isArray(series?.observations) ? series.observations : [])
    .flatMap((row) => selector(row).map(text))
    .filter(Boolean),
));

export const isClinicalOutcomeInterferingBehaviorSeries = (
  series: ClinicalOutcomeSeriesSummary | null | undefined,
) => {
  if (!series) return false;
  const metricTokens = [
    text(series.metricKey),
    text(series.metricLabel),
    ...clinicalOutcomeSeriesSemanticValues(series, (row) => [
      row.metricKey,
      row.metricType,
      row.metadata?.metricKey,
      row.metadata?.metric_key,
    ]),
  ].map((value) => value.toUpperCase());

  if (metricTokens.some((value) => value.startsWith('BEHAVIOR_'))) return true;

  const sourceFamilies = clinicalOutcomeSeriesSemanticValues(series, (row) => [
    row.metadata?.sourceFamily,
    row.metadata?.source_family,
    row.metadata?.valueDetails?.sourceFamily,
    row.metadata?.valueDetails?.source_family,
  ]).map((value) => value.toUpperCase());

  return sourceFamilies.includes('BEHAVIOR');
};

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
    text(observation.itemId) || text(observation.itemLabel),
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

const finiteMetadataNumber = (value: unknown): number | null => finiteValue(value);

const meanClinicalOutcomeValue = (rows: ClinicalOutcomeObservation[]) => {
  const values = rows
    .map((row) => finiteValue(row.value))
    .filter((value): value is number => value !== null);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const clinicalOutcomeContextLabel = (value: unknown) => {
  const normalized = text(value).toLowerCase();
  if (!normalized) return 'Contexto não informado';
  if (normalized === 'clinic' || normalized === 'clinica' || normalized === 'clínica') return 'Clínica';
  if (normalized === 'home' || normalized === 'casa') return 'Casa';
  if (normalized === 'school' || normalized === 'escola') return 'Escola';
  return text(value);
};

export const clinicalOutcomeSourceLabel = (value: unknown) => {
  const normalized = text(value).toLowerCase();
  if (!normalized) return 'Registro clínico';
  if (normalized.includes('aba v3')) return 'ABA V3 canônico';
  if (normalized === 'v3 canônico' || normalized === 'v3 canonico') return 'V3 canônico';
  if (normalized.includes('aba_session_metric_snapshot') || normalized.includes('aba snapshot')) return 'Histórico ABA';
  if (normalized.includes('professional_observation') || normalized.includes('registro profissional')) return 'Registro profissional';
  if (normalized.includes('clinical_observation')) return 'Histórico clínico';
  if (normalized.includes('v3 + histórico') || normalized.includes('v3 + historico')) return 'V3 + histórico';
  return text(value);
};

export const clinicalOutcomeMetricDisplayLabel = (metricKey: unknown, metricLabel: unknown, itemLabel: unknown = '') => {
  const key = text(metricKey).toUpperCase();
  const provided = text(metricLabel);
  const item = text(itemLabel);
  const known: Record<string, string> = {
    TARGET_ACCURACY: 'Acurácia',
    TARGET_INDEPENDENCE: 'Independência',
    TARGET_TRIAL_COUNT: 'Tentativas registradas',
    PRIMARY_INDEPENDENCE_PERCENT: 'Independência primária',
    FINAL_COMPLETION_ACCURACY_PERCENT: 'Acurácia final',
    EFFECTIVE_TRIAL_COUNT: 'Tentativas registradas',
    TASK_INDEPENDENT_STEPS_PERCENT: 'Passos independentes',
    MAINTENANCE_PRIMARY_INDEPENDENCE_PERCENT: 'Independência em manutenção',
    BEHAVIOR_FREQUENCY_COUNT: 'Frequência',
    BEHAVIOR_RATE_PER_HOUR: 'Taxa por hora',
    BEHAVIOR_DURATION_SECONDS: 'Duração total',
    BEHAVIOR_FREQUENCY: 'Frequência',
    BEHAVIOR_DURATION_EPISODES: 'Episódios de duração',
    BEHAVIOR_DURATION_TOTAL: 'Duração total',
    BEHAVIOR_DURATION_AVG: 'Duração média',
    BEHAVIOR_DURATION_MAX: 'Duração máxima',
    BEHAVIOR_INTERVAL_OCCURRENCE: 'Ocorrência por intervalos',
    MASTERY_STATUS: 'Status de maestria',
    MASTERY_CONSECUTIVE_DAYS: 'Dias consecutivos',
    MASTERY_VALID_ATTEMPTS: 'Tentativas válidas',
    MASTERY_READY_FOR_REVIEW: 'Pronto para revisão',
    MAINTENANCE_STATUS: 'Status de manutenção',
    MAINTENANCE_ACCURACY: 'Acurácia de manutenção',
    MAINTENANCE_INDEPENDENCE: 'Independência de manutenção',
    MAINTENANCE_FAILURES: 'Falhas consecutivas',
    MAINTENANCE_DAYS_SINCE_PROBE: 'Dias desde última sondagem',
    REGRESSION_RISK: 'Risco de regressão',
  };
  if (known[key]) return known[key];
  if (provided && provided.toLocaleLowerCase('pt-BR') !== item.toLocaleLowerCase('pt-BR')) return provided;
  return provided || key || 'Métrica clínica';
};

export const clinicalOutcomeUnitLabel = (
  unit: unknown,
  metricKey: unknown = '',
  values: Array<number | null | undefined> = [],
) => {
  const raw = text(unit);
  const normalized = raw.toLowerCase();
  const metric = text(metricKey).toLowerCase();
  if (raw === '%' || normalized.includes('percent')) return 'Percentual (%)';
  if (['eventos/h', 'events_per_hour', 'rate_per_hour'].includes(normalized) || metric.includes('rate')) return 'Taxa (eventos/h)';
  if (
    ['count', 'contagem', 'tentativas', 'tentativa', 'ocorrências', 'ocorrencias', 'ocorrência', 'ocorrencia'].includes(normalized)
    || metric.includes('count')
    || metric.includes('trial_count')
    || metric.includes('attempt')
  ) return raw && raw !== 'count' ? raw : 'Contagem';
  if (['s', 'sec', 'seg', 'segundos', 'second', 'seconds'].includes(normalized) || metric.includes('duration') || metric.includes('latency')) return 'Tempo (s)';
  if (['ms', 'millisecond', 'milliseconds'].includes(normalized)) return 'Tempo (ms)';
  if (['min', 'minuto', 'minutos', 'minute', 'minutes'].includes(normalized)) return 'Tempo (min)';
  if (raw) return raw;
  const finite = values.filter((value): value is number => Number.isFinite(Number(value))).map(Number);
  if (finite.length && finite.every((value) => value >= 0 && value <= 1)) return 'Pontuação (0–1)';
  return 'Valor clínico';
};

export const clinicalOutcomeEvidenceSampleLabel = (series: ClinicalOutcomeSeriesSummary) => {
  const rows = series.validObservations;
  const sessionIds = Array.from(new Set(rows.map((row) => text(row.sessionId)).filter(Boolean)));
  const opportunityCount = rows.reduce((sum, row) => {
    const denominator = finiteValue(row.denominator);
    return sum + (denominator !== null && denominator > 0 ? denominator : 0);
  }, 0);
  const base = sessionIds.length > 0
    ? `${sessionIds.length} ${sessionIds.length === 1 ? 'sessão' : 'sessões'}`
    : `${rows.length} ${rows.length === 1 ? 'registro' : 'registros'}`;
  const opportunities = Math.round(opportunityCount);
  return opportunities > 0 ? `${base} · ${opportunities} ${opportunities === 1 ? 'oportunidade' : 'oportunidades'}` : base;
};

export const summarizeClinicalOutcomePeriod = (series: ClinicalOutcomeSeriesSummary | null | undefined): ClinicalOutcomePeriodStats => {
  const rows = series?.validObservations || [];
  const sessionIds = Array.from(new Set(rows.map((row) => text(row.sessionId)).filter(Boolean)));
  let numeratorTotal = 0;
  let denominatorTotal = 0;
  let hasNumerator = false;
  let hasDenominator = false;
  for (const row of rows) {
    const numerator = finiteValue(row.numerator);
    const denominator = finiteValue(row.denominator);
    if (numerator !== null) {
      numeratorTotal += numerator;
      hasNumerator = true;
    }
    if (denominator !== null && denominator > 0) {
      denominatorTotal += denominator;
      hasDenominator = true;
    }
  }
  const unit = text(series?.unit).toLowerCase();
  const metricKey = text(series?.metricKey).toUpperCase();
  let meanValue = meanClinicalOutcomeValue(rows);
  if (hasNumerator && hasDenominator && denominatorTotal > 0) {
    if (unit === '%' || unit.includes('percent')) {
      meanValue = (numeratorTotal / denominatorTotal) * 100;
    } else if (metricKey.includes('RATE') || ['eventos/h', 'events_per_hour', 'rate_per_hour'].includes(unit)) {
      meanValue = (numeratorTotal * 3600) / denominatorTotal;
    } else if (metricKey.includes('DURATION_AVG')) {
      meanValue = numeratorTotal / denominatorTotal;
    }
  }
  return {
    observationCount: rows.length,
    sessionCount: sessionIds.length,
    opportunityCount: hasDenominator ? denominatorTotal : 0,
    numeratorTotal: hasNumerator ? numeratorTotal : null,
    denominatorTotal: hasDenominator ? denominatorTotal : null,
    meanValue,
  };
};

export const compareClinicalOutcomePeriods = (
  currentSeries: ClinicalOutcomeSeriesSummary,
  previousSeries: ClinicalOutcomeSeriesSummary | null | undefined,
): ClinicalOutcomePeriodComparison => {
  const current = summarizeClinicalOutcomePeriod(currentSeries);
  const previous = summarizeClinicalOutcomePeriod(previousSeries);
  const delta = current.meanValue !== null && previous.meanValue !== null
    ? current.meanValue - previous.meanValue
    : null;
  const unit = text(currentSeries.unit);
  const roundedDelta = delta === null ? null : Math.round(delta * 10) / 10;
  const deltaLabel = roundedDelta === null
    ? 'Sem período anterior comparável'
    : unit === '%'
      ? `${roundedDelta > 0 ? '+' : ''}${roundedDelta} p.p.`
      : `${roundedDelta > 0 ? '+' : ''}${roundedDelta}${unit ? ` ${unit}` : ''}`;
  let movement: ClinicalOutcomePeriodComparison['movement'] = 'unknown';
  if (delta !== null) {
    const scale = Math.max(1, Math.abs(current.meanValue || 0), Math.abs(previous.meanValue || 0));
    if (Math.abs(delta) <= scale * 0.03) movement = 'stable';
    else if (currentSeries.direction === 'higher_is_better') movement = delta > 0 ? 'favorable' : 'unfavorable';
    else if (currentSeries.direction === 'lower_is_better') movement = delta < 0 ? 'favorable' : 'unfavorable';
  }
  return { current, previous, delta, deltaLabel, movement };
};

const criterionMeasureMatchesMetric = (measure: string, metricKey: string) => {
  const metric = metricKey.toLowerCase();
  if (measure === 'accuracy_percent') return metric.includes('accuracy');
  if (measure === 'steps_percent') return metric.includes('step') && metric.includes('percent');
  if (measure === 'frequency') return metric.includes('frequency') || metric.includes('count');
  if (measure === 'duration_seconds') return metric.includes('duration');
  if (measure === 'latency_seconds') return metric.includes('latency');
  return false;
};

export const clinicalOutcomeTargetReference = (series: ClinicalOutcomeSeriesSummary): ClinicalOutcomeTargetReference => {
  for (const observation of series.observations) {
    const metadata = observation.metadata || {};
    const targetValue = finiteMetadataNumber(metadata.targetValue ?? metadata.target_value);
    const targetMin = finiteMetadataNumber(metadata.targetMin ?? metadata.target_min);
    const targetMax = finiteMetadataNumber(metadata.targetMax ?? metadata.target_max);
    const criterionLabel = text(metadata.criterionLabel ?? metadata.criterion_label);
    if (targetValue !== null || targetMin !== null || targetMax !== null) {
      return { targetValue, targetMin, targetMax, criterionLabel };
    }

    const criteria = metadata.masteryCriteria && typeof metadata.masteryCriteria === 'object'
      ? metadata.masteryCriteria
      : metadata.mastery_criteria && typeof metadata.mastery_criteria === 'object'
        ? metadata.mastery_criteria
        : null;
    if (!criteria) continue;
    const measure = text(criteria.measure);
    const value = finiteMetadataNumber(criteria.value);
    const metricKey = text(series.metricKey);
    if (measure && value !== null && criterionMeasureMatchesMetric(measure, metricKey)) {
      const operator = ({ gte: '≥', gt: '>', eq: '=', lte: '≤' } as Record<string, string>)[text(criteria.operator)] || '≥';
      const isPercent = ['accuracy_percent', 'steps_percent'].includes(measure);
      return {
        targetValue: value,
        targetMin: null,
        targetMax: null,
        criterionLabel: `${operator} ${value}${isPercent ? '%' : ''}`,
      };
    }
    const accuracy = finiteMetadataNumber(criteria.minAccuracyPercent ?? criteria.min_accuracy_percent);
    if (accuracy !== null && text(series.metricKey).toLowerCase().includes('accuracy')) {
      return { targetValue: accuracy, targetMin: null, targetMax: null, criterionLabel: `≥ ${accuracy}%` };
    }
  }
  return { targetValue: null, targetMin: null, targetMax: null, criterionLabel: '' };
};

export const clinicalOutcomeBaselineValue = (series: ClinicalOutcomeSeriesSummary) => {
  const explicit = series.observations
    .map((row) => finiteMetadataNumber(row.metadata?.baselineValue ?? row.metadata?.baseline_value))
    .find((value) => value !== null);
  if (explicit !== undefined && explicit !== null) return explicit;
  const baselineRows = series.validObservations.filter((row) => {
    const phaseType = text(row.metadata?.phaseType ?? row.metadata?.phase_type).toLowerCase();
    const phaseLabel = text(row.metadata?.phaseLabel ?? row.metadata?.phase_label).toLowerCase();
    return phaseType === 'baseline' || phaseLabel.includes('linha de base') || phaseLabel === 'baseline';
  });
  return meanClinicalOutcomeValue(baselineRows);
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
      metricLabel: clinicalOutcomeMetricDisplayLabel(sample.metricKey, sample.metricLabel, sample.itemLabel),
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
