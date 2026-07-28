export type AbaSpecialtyPoint = {
  specialty?: string | null;
  professionalId?: string | null;
  metricType?: string | null;
  value?: number | string | null;
  metricValue?: number | string | null;
  attemptsCount?: number | null;
  changedAt?: string | null;
};

export type AbaSpecialtyMetric = {
  specialty: string;
  metricType: string;
  value: number;
  recordCount: number;
  aggregation: 'sum' | 'weighted_average' | 'average' | 'latest';
};

const numericValue = (point: AbaSpecialtyPoint) => {
  const value = Number(point.value ?? point.metricValue);
  return Number.isFinite(value) ? value : null;
};

const SUM_METRICS = new Set([
  'BEHAVIOR_FREQUENCY',
  'BEHAVIOR_DURATION_EPISODES',
  'BEHAVIOR_DURATION_TOTAL',
  'TARGET_TRIAL_COUNT',
  'TRIAL_COUNT',
  'INTERVAL_TOTAL_COUNT',
  'INTERVAL_YES_COUNT',
  'ABC_COUNT'
]);

const LATEST_METRICS = new Set([
  'MASTERY_STATUS',
  'MAINTENANCE_STATUS',
  'REGRESSION_RISK',
  'GENERALIZATION_STATUS'
]);

export function aggregateAbaPointsBySpecialty(
  points: AbaSpecialtyPoint[]
): AbaSpecialtyMetric[] {
  const groups = new Map<string, AbaSpecialtyPoint[]>();
  for (const point of points) {
    const metricType = String(point.metricType || '').trim().toUpperCase();
    const specialty = String(point.specialty || 'Especialidade não informada').trim() || 'Especialidade não informada';
    if (!metricType || numericValue(point) === null) continue;
    const key = `${specialty}\u0000${metricType}`;
    groups.set(key, [...(groups.get(key) || []), point]);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const [specialty, metricType] = key.split('\u0000');
    const values = rows.map((row) => Number(numericValue(row)));
    if (SUM_METRICS.has(metricType)) {
      return { specialty, metricType, value: values.reduce((sum, value) => sum + value, 0), recordCount: rows.length, aggregation: 'sum' as const };
    }
    if (LATEST_METRICS.has(metricType)) {
      const latest = rows.slice().sort((left, right) => Date.parse(String(right.changedAt || '')) - Date.parse(String(left.changedAt || '')))[0];
      return { specialty, metricType, value: Number(numericValue(latest)), recordCount: rows.length, aggregation: 'latest' as const };
    }
    const weightedRows = rows.filter((row) => Number.isFinite(Number(row.attemptsCount)) && Number(row.attemptsCount) > 0);
    if (weightedRows.length === rows.length && rows.length > 0) {
      const weight = weightedRows.reduce((sum, row) => sum + Number(row.attemptsCount), 0);
      const total = weightedRows.reduce((sum, row) => sum + Number(numericValue(row)) * Number(row.attemptsCount), 0);
      return { specialty, metricType, value: weight > 0 ? total / weight : 0, recordCount: rows.length, aggregation: 'weighted_average' as const };
    }
    return { specialty, metricType, value: values.reduce((sum, value) => sum + value, 0) / values.length, recordCount: rows.length, aggregation: 'average' as const };
  }).sort((left, right) => left.specialty.localeCompare(right.specialty, 'pt-BR') || left.metricType.localeCompare(right.metricType));
}

export function filterAbaPointsByHistoricalScope(
  points: AbaSpecialtyPoint[],
  filters: { specialty?: string; professionalId?: string }
) {
  return points.filter((point) =>
    (!filters.specialty || String(point.specialty || 'Especialidade não informada') === filters.specialty) &&
    (!filters.professionalId || String(point.professionalId || '') === filters.professionalId)
  );
}
