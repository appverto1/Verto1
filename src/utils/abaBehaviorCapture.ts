export const ABA_BEHAVIOR_MEASUREMENT_TYPES = [
  'frequency',
  'duration',
  'rate',
  'partial_interval',
  'whole_interval',
  'momentary_time_sampling',
  'abc'
] as const;

export type AbaBehaviorMeasurementType = typeof ABA_BEHAVIOR_MEASUREMENT_TYPES[number];

const MEASUREMENT_ALIASES: Record<string, AbaBehaviorMeasurementType> = {
  frequency: 'frequency',
  frequencia: 'frequency',
  occurrence: 'frequency',
  ocorrencia: 'frequency',
  duration: 'duration',
  duracao: 'duration',
  rate: 'rate',
  taxa: 'rate',
  interval_partial: 'partial_interval',
  partial_interval: 'partial_interval',
  intervalo_parcial: 'partial_interval',
  interval_whole: 'whole_interval',
  whole_interval: 'whole_interval',
  intervalo_total: 'whole_interval',
  momentary_time_sampling: 'momentary_time_sampling',
  momentary: 'momentary_time_sampling',
  mts: 'momentary_time_sampling',
  amostragem_momentanea: 'momentary_time_sampling',
  abc: 'abc',
  abc_only: 'abc'
};

const normalizeToken = (value: unknown) => String(value ?? '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

export const normalizeBehaviorMeasurementType = (
  value: unknown,
  fallback: AbaBehaviorMeasurementType = 'frequency'
): AbaBehaviorMeasurementType => {
  const normalized = normalizeToken(value);
  return MEASUREMENT_ALIASES[normalized] || fallback;
};

export const isIntervalMeasurementType = (value: unknown) => (
  normalizeBehaviorMeasurementType(value) === 'partial_interval' ||
  normalizeBehaviorMeasurementType(value) === 'whole_interval' ||
  normalizeBehaviorMeasurementType(value) === 'momentary_time_sampling'
);

export const getBehaviorAllowedMeasurements = (behavior: any): AbaBehaviorMeasurementType[] => {
  const rawAllowed = behavior?.allowedMeasurements || behavior?.allowed_measurements || behavior?.measurementTypes || behavior?.measurement_types;
  const allowed = Array.isArray(rawAllowed)
    ? rawAllowed.map((item) => normalizeBehaviorMeasurementType(item, 'frequency'))
    : [];
  const uniqueAllowed = Array.from(new Set(allowed));
  if (uniqueAllowed.length > 0) return uniqueAllowed;
  return [normalizeBehaviorMeasurementType(
    behavior?.measurement_type || behavior?.measurementType || behavior?.defaultMeasurement || behavior?.default_measurement,
    'frequency'
  )];
};

export const getBehaviorDefaultMeasurement = (behavior: any): AbaBehaviorMeasurementType => {
  const allowed = getBehaviorAllowedMeasurements(behavior);
  const explicitDefault = normalizeBehaviorMeasurementType(
    behavior?.defaultMeasurement || behavior?.default_measurement || behavior?.measurement_type || behavior?.measurementType,
    allowed[0] || 'frequency'
  );
  return allowed.includes(explicitDefault) ? explicitDefault : allowed[0] || 'frequency';
};

export const behaviorAllowsMeasurement = (behavior: any, measurementType: unknown) => {
  const normalized = normalizeBehaviorMeasurementType(measurementType);
  return getBehaviorAllowedMeasurements(behavior).includes(normalized);
};

export const isDurationOnlyBehavior = (behavior: any) => {
  const allowed = getBehaviorAllowedMeasurements(behavior);
  return allowed.length === 1 && allowed[0] === 'duration';
};

export const resolveBehaviorMeasurementForAction = (
  behavior: any,
  requestedMeasurement: unknown
): AbaBehaviorMeasurementType => {
  const requested = normalizeBehaviorMeasurementType(requestedMeasurement, getBehaviorDefaultMeasurement(behavior));
  const allowed = getBehaviorAllowedMeasurements(behavior);
  if (allowed.includes(requested)) return requested;
  if ((requested === 'frequency' || requested === 'rate') && isDurationOnlyBehavior(behavior)) return 'duration';
  return getBehaviorDefaultMeasurement(behavior);
};

const formatDuration = (durationSeconds: unknown) => {
  const safeSeconds = Math.max(0, Math.round(Number(durationSeconds) || 0));
  const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, '0');
  const seconds = (safeSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const joinPresent = (parts: Array<string | number | null | undefined>) => (
  parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' · ')
);

export const formatBehaviorHistoryDetail = ({
  measurementType,
  durationSeconds,
  countDelta,
  location,
  severity,
  status
}: {
  measurementType: unknown;
  durationSeconds?: unknown;
  countDelta?: unknown;
  location?: unknown;
  severity?: unknown;
  status?: unknown;
}) => {
  const method = normalizeBehaviorMeasurementType(measurementType);
  const normalizedStatus = String(status || '').trim().toUpperCase();
  const base = method === 'duration'
    ? normalizedStatus === 'IN_PROGRESS' || durationSeconds === null || durationSeconds === undefined
      ? 'Duração em andamento'
      : `Duração ${formatDuration(durationSeconds)}`
    : method === 'frequency'
      ? `${Number(countDelta || 1) > 0 ? '+' : ''}${Number(countDelta || 1)} ocorrência`
      : method === 'rate'
        ? 'Taxa'
        : method === 'abc'
          ? 'ABC'
          : 'Intervalo';
  return joinPresent([
    base,
    severity !== null && severity !== undefined && severity !== '' ? `severidade ${severity}` : '',
    location === null || location === undefined ? '' : String(location)
  ]);
};
