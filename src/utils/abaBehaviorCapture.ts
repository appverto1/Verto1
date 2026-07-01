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

export type BehaviorEventContextSnapshot = {
  location?: string;
  severity?: number | null;
  intensity?: number | null;
  durationSeconds?: number | null;
  quantity?: number | null;
  alertTarget?: string | null;
  collectionMethod?: string;
  behaviorName?: string;
  behaviorId?: string | null;
  activityName?: string | null;
  goalName?: string | null;
  sessionId?: string | null;
  patientId?: string | null;
  professionalId?: string | null;
  timestamp?: string;
  abc?: {
    antecedent?: string;
    behavior?: string;
    consequence?: string;
  };
};

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

const firstPresent = (...values: unknown[]) => {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return undefined;
};

const optionalString = (value: unknown) => {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
};

const optionalNumber = (value: unknown): number | null | undefined => {
  if (value === null) return null;
  if (value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

export const buildBehaviorEventContextSnapshot = (input: any = {}): BehaviorEventContextSnapshot => {
  const snapshot: BehaviorEventContextSnapshot = {
    location: optionalString(input.location),
    severity: optionalNumber(input.severity),
    intensity: optionalNumber(input.intensity),
    durationSeconds: optionalNumber(input.durationSeconds ?? input.duration_seconds),
    quantity: optionalNumber(input.quantity ?? input.countDelta ?? input.count_delta),
    alertTarget: optionalString(input.alertTarget ?? input.alert_target),
    collectionMethod: optionalString(input.collectionMethod ?? input.collection_method ?? input.measurementType ?? input.measurement_type ?? input.method),
    behaviorName: optionalString(input.behaviorName ?? input.behavior_name),
    behaviorId: optionalString(input.behaviorId ?? input.behavior_id) || null,
    activityName: optionalString(input.activityName ?? input.activity_name) || null,
    goalName: optionalString(input.goalName ?? input.goal_name ?? input.targetName ?? input.target_name) || null,
    sessionId: optionalString(input.sessionId ?? input.session_id) || null,
    patientId: optionalString(input.patientId ?? input.patient_id) || null,
    professionalId: optionalString(input.professionalId ?? input.professional_id ?? input.therapistId ?? input.therapist_id) || null,
    timestamp: optionalString(input.timestamp ?? input.occurredAt ?? input.occurred_at),
    abc: {
      antecedent: optionalString(input.abc?.antecedent ?? input.antecedent),
      behavior: optionalString(input.abc?.behavior ?? input.behaviorName ?? input.behavior_name),
      consequence: optionalString(input.abc?.consequence ?? input.consequence)
    }
  };
  if (!snapshot.abc?.antecedent && !snapshot.abc?.behavior && !snapshot.abc?.consequence) delete snapshot.abc;
  Object.keys(snapshot).forEach((key) => {
    const value = snapshot[key as keyof BehaviorEventContextSnapshot];
    if (value === undefined || value === '') delete snapshot[key as keyof BehaviorEventContextSnapshot];
  });
  return snapshot;
};

export const readBehaviorEventContextSnapshot = (event: any = {}): BehaviorEventContextSnapshot | null => {
  const rawPayload = event?.raw_payload || event?.rawPayload || {};
  const context = event?.contextSnapshot ||
    event?.context_snapshot ||
    rawPayload?.contextSnapshot ||
    rawPayload?.context_snapshot ||
    rawPayload?.behaviorEventContext ||
    rawPayload?.eventContext ||
    {};
  if (!context || typeof context !== 'object') return null;
  return buildBehaviorEventContextSnapshot({
    ...context,
    location: firstPresent(context.location, event.location),
    severity: firstPresent(context.severity, event.severity),
    durationSeconds: firstPresent(context.durationSeconds, context.duration_seconds, event.duration_seconds, event.durationSeconds),
    quantity: firstPresent(context.quantity, event.count_delta, event.countDelta),
    collectionMethod: firstPresent(context.collectionMethod, context.collection_method, event.measurement_type, event.measurementType),
    behaviorName: firstPresent(context.behaviorName, context.behavior_name, event.behavior_name, event.behaviorName),
    behaviorId: firstPresent(context.behaviorId, context.behavior_id, event.behavior_id, event.behaviorId),
    sessionId: firstPresent(context.sessionId, context.session_id, event.session_id, event.sessionId),
    patientId: firstPresent(context.patientId, context.patient_id, event.patient_id, event.patientId),
    professionalId: firstPresent(context.professionalId, context.therapistId, event.therapist_id, event.therapistId),
    timestamp: firstPresent(context.timestamp, event.occurred_at, event.occurredAt, event.timestamp, event.created_at, event.createdAt),
    abc: {
      ...(typeof context.abc === 'object' && context.abc ? context.abc : {}),
      antecedent: firstPresent(context?.abc?.antecedent, event.antecedent),
      behavior: firstPresent(context?.abc?.behavior, context.behaviorName, event.behavior_name, event.behaviorName),
      consequence: firstPresent(context?.abc?.consequence, event.consequence)
    }
  });
};

export const formatBehaviorContextSummary = (context: BehaviorEventContextSnapshot | null | undefined) => {
  if (!context) return '';
  return joinPresent([
    context.location ? `Local: ${context.location}` : '',
    context.severity !== null && context.severity !== undefined ? `Severidade: ${context.severity}` : '',
    context.collectionMethod ? `Coleta: ${context.collectionMethod}` : ''
  ]);
};

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
