import { evaluateTissPreGuideEligibility } from './tissPreGuideEngine';

export const TISS_PRE_GUIDE_BATCH_ID_CHUNK_SIZE = 150;

type TissPreGuideBatchInput = {
  appointments: any[];
  contextsByAppointment: Map<string, any>;
  financialPlans: any[];
  patients: any[];
  payers: any[];
};

const text = (value: unknown, maxLength = 240) => String(value ?? '').trim().slice(0, maxLength);
const isUuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value, 120));
const normalizedName = (value: unknown) => text(value, 180)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();
const normalizedService = (value: unknown) => {
  const raw = normalizedName(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const aliases: Record<string, string> = {
    aba: 'ABA',
    fono: 'SPEECH_THERAPY',
    fonoaudiologia: 'SPEECH_THERAPY',
    speech_therapy: 'SPEECH_THERAPY',
    psicologia: 'PSYCHOLOGY',
    psychology: 'PSYCHOLOGY',
    terapia_ocupacional: 'OCCUPATIONAL_THERAPY',
    occupational_therapy: 'OCCUPATIONAL_THERAPY',
    to: 'OCCUPATIONAL_THERAPY',
    psicopedagogia: 'PSYCHOPEDAGOGY',
    physiotherapy: 'PHYSIOTHERAPY',
    fisioterapia: 'PHYSIOTHERAPY',
    therapy: 'THERAPY',
    terapia: 'THERAPY'
  };
  return aliases[raw] || raw.toUpperCase();
};
const normalizedContext = (value: unknown) => text(value, 80)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const nonInsuranceContexts = new Set([
  'PRIVATE', 'PARTICULAR', 'PACKAGE', 'PACOTE', 'MONTHLY', 'MONTHLY_PACKAGE',
  'MENSALIDADE', 'COURTESY', 'CORTESIA', 'NO_CHARGE', 'SEM_COBRANCA',
  'NOT_BILLABLE', 'NON_BILLABLE', 'NAO_FATURAVEL'
]);

export function chunkTissPreGuideScopeIds(ids: string[], size = TISS_PRE_GUIDE_BATCH_ID_CHUNK_SIZE): string[][] {
  const safeSize = Math.max(1, Math.min(250, Math.trunc(Number(size) || TISS_PRE_GUIDE_BATCH_ID_CHUNK_SIZE)));
  const uniqueIds = Array.from(new Set((Array.isArray(ids) ? ids : []).filter(isUuid)));
  const chunks: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += safeSize) chunks.push(uniqueIds.slice(index, index + safeSize));
  return chunks;
}

export const tissPatientPayerBatchKey = (patientId: unknown, payerId: unknown) =>
  `${text(patientId, 120)}:${text(payerId, 120)}`;

export type MutableTissAuthorizationBalance = {
  confirmed?: boolean;
  preGuideCount: number;
  officialPreGuideCount: number;
  committedAppointmentIds: Set<string>;
  reserved: number;
  historicalOfficialCommitments: number;
  futureReservations: number;
  available: number | null;
};

/**
 * Advances the request-local authorization snapshot after a newly persisted
 * pre-guide. Revalidation serializes callers of this helper, so the next
 * appointment observes the unit already reserved instead of spending it again.
 */
export function consumeTissAuthorizationBalance(params: {
  balance?: MutableTissAuthorizationBalance | null;
  appointmentId: unknown;
  activePreGuide: boolean;
  officialPreGuide: boolean;
  historical: boolean;
}): boolean {
  const balance = params.balance;
  const appointmentId = text(params.appointmentId, 120);
  if (!balance?.confirmed || !isUuid(appointmentId) || balance.committedAppointmentIds.has(appointmentId)) {
    return false;
  }
  const reservesBalance = (!params.historical && params.activePreGuide) ||
    (params.historical && params.officialPreGuide);

  balance.preGuideCount += params.activePreGuide ? 1 : 0;
  balance.officialPreGuideCount += params.officialPreGuide ? 1 : 0;
  if (!reservesBalance) return false;
  if (typeof balance.available === 'number' && balance.available <= 0) return false;

  balance.committedAppointmentIds.add(appointmentId);
  balance.reserved += 1;
  if (params.historical) balance.historicalOfficialCommitments += 1;
  else balance.futureReservations += 1;
  if (typeof balance.available === 'number') balance.available = Math.max(0, balance.available - 1);
  return true;
}

/**
 * Builds the request-scoped authorization lookup once. Every appointment for
 * the same patient/payer pair reads the same array instead of triggering a
 * new authorization query. Tenant filtering remains the loader's duty.
 */
export function groupTissRowsByPatientAndPayer(rows: any[]): Map<string, any[]> {
  const grouped = new Map<string, any[]>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const patientId = text(row?.patientId || row?.patient_id, 120);
    const payerId = text(row?.payerId || row?.payer_id, 120);
    if (!isUuid(patientId) || !isUuid(payerId)) continue;
    const key = tissPatientPayerBatchKey(patientId, payerId);
    const current = grouped.get(key) || [];
    current.push(row);
    grouped.set(key, current);
  }
  return grouped;
}

const appointmentIdOf = (appointment: any) => text(appointment?.id || appointment?.appointment_id, 120);
const patientIdOf = (appointment: any, context?: any) => text(
  appointment?.patient_id || appointment?.patientId || context?.patient_id || context?.patientId,
  120
);
const payerIdOf = (appointment: any, context?: any) => text(
  context?.payer_id || context?.payerId || appointment?.payer_id || appointment?.payerId,
  120
);
const payerNameOf = (appointment: any, context?: any) => text(
  context?.payer_name_snapshot || context?.payerName || context?.payer_name ||
    appointment?.payer_name_snapshot || appointment?.payerName || appointment?.payer_name,
  180
);
const serviceTypeOf = (appointment: any, context?: any) => text(
  context?.service_type || context?.serviceType || appointment?.service_type ||
    appointment?.serviceType || appointment?.approach || appointment?.type,
  120
);

const financialContextOf = (appointment: any, context?: any) => normalizedContext(
  context?.payer_type || context?.financial_context_type || appointment?.financial_context_type || appointment?.payer_type
);

export function tissPreGuideContextNeedsBatchResolution(appointment: any, context?: any): boolean {
  const eligibility = evaluateTissPreGuideEligibility({ appointment, billingContext: context || {} });
  if (eligibility.eligible || eligibility.reason === 'not_applicable') return false;
  return eligibility.reason === 'missing_financial_context' || eligibility.reason === 'missing_payer';
}

const planMatchesService = (plan: any, serviceType: string) => {
  if (!serviceType) return true;
  const requested = normalizedService(serviceType);
  const candidates = [plan?.service_type, plan?.service_name_snapshot, plan?.custom_service_name]
    .map(normalizedService)
    .filter(Boolean);
  return candidates.includes(requested);
};

const selectPlan = (plans: any[], appointment: any, context: any) => {
  const requestedPayerId = payerIdOf(appointment, context);
  const requestedPayerName = normalizedName(payerNameOf(appointment, context));
  const serviceType = serviceTypeOf(appointment, context);
  const usable = plans.filter((plan) =>
    normalizedContext(plan?.status) === 'ACTIVE' &&
    normalizedContext(plan?.billing_mode) === 'INSURANCE' &&
    (isUuid(plan?.payer_id) || Boolean(text(plan?.payer_name_snapshot, 180)))
  );
  const payerScoped = isUuid(requestedPayerId)
    ? usable.filter((plan) => text(plan?.payer_id, 120) === requestedPayerId)
    : requestedPayerName
      ? usable.filter((plan) => normalizedName(plan?.payer_name_snapshot) === requestedPayerName)
      : usable;
  const serviceMatches = serviceType ? payerScoped.filter((plan) => planMatchesService(plan, serviceType)) : [];
  if (serviceMatches.length === 1) return serviceMatches[0];
  if (!serviceType && payerScoped.length === 1) return payerScoped[0];
  return null;
};

const activePayer = (payer: any) => !['INACTIVE', 'INATIVO', 'ARCHIVED', 'DELETED'].includes(normalizedContext(payer?.status));

/**
 * Resolves only the financial fields required to decide TISS eligibility.
 * Authorization, balance and TUSS details remain in the full per-appointment
 * revalidation path and are deliberately not queried by this batch projection.
 */
export function buildTissPreGuideEligibilityContexts(input: TissPreGuideBatchInput): Map<string, any> {
  const contexts = new Map<string, any>();
  const patientsById = new Map((input.patients || []).map((patient) => [text(patient?.id, 120), patient]));
  const plansByPatient = new Map<string, any[]>();
  for (const plan of input.financialPlans || []) {
    const patientId = text(plan?.patient_id, 120);
    if (!patientId) continue;
    const rows = plansByPatient.get(patientId) || [];
    rows.push(plan);
    plansByPatient.set(patientId, rows);
  }
  const activePayers = (input.payers || []).filter(activePayer);
  const payersById = new Map(activePayers.map((payer) => [text(payer?.id, 120), payer]));
  const payersByName = new Map<string, any[]>();
  for (const payer of activePayers) {
    const key = normalizedName(payer?.name);
    if (!key) continue;
    const rows = payersByName.get(key) || [];
    rows.push(payer);
    payersByName.set(key, rows);
  }

  const resolvePayer = (payerId: string, payerName: string) => {
    if (isUuid(payerId)) {
      return {
        payer: payersById.get(payerId) || { id: payerId, name: payerName || null },
        status: 'matched',
        reasonCode: 'OK'
      };
    }
    const matches = payersByName.get(normalizedName(payerName)) || [];
    if (matches.length === 1) return { payer: matches[0], status: 'matched', reasonCode: 'OK' };
    if (matches.length > 1) return { payer: null, status: 'ambiguous', reasonCode: 'AMBIGUOUS_PAYER_NAME' };
    return { payer: null, status: 'not_found', reasonCode: 'PAYER_NAME_NOT_FOUND' };
  };

  for (const appointment of input.appointments || []) {
    const appointmentId = appointmentIdOf(appointment);
    if (!appointmentId) continue;
    const base = input.contextsByAppointment.get(appointmentId) || {};
    const directEligibility = evaluateTissPreGuideEligibility({ appointment, billingContext: base });
    if (directEligibility.eligible) {
      const directPayerId = text(directEligibility.payerId || payerIdOf(appointment, base), 120);
      const directPayerName = payerNameOf(appointment, base);
      const directPayerResolution = resolvePayer(directPayerId, directPayerName);
      contexts.set(appointmentId, {
        ...base,
        payer_id: directPayerId,
        payer_name_snapshot: text(directPayerResolution.payer?.name || directPayerName, 180) || null,
        payer_type: 'INSURANCE',
        financial_context_type: 'INSURANCE',
        service_type: serviceTypeOf(appointment, base) || null,
        payer_resolution_source: base?.payer_resolution_source || (directPayerResolution.status === 'matched' ? 'batch_id_match' : null),
        payer_resolution_status: base?.payer_resolution_status || directPayerResolution.status,
        payer_resolution_reason_code: base?.payer_resolution_reason_code || directPayerResolution.reasonCode
      });
      continue;
    }
    if (directEligibility.reason === 'not_applicable') {
      contexts.set(appointmentId, base);
      continue;
    }

    const patientId = patientIdOf(appointment, base);
    const patient = patientsById.get(patientId) || {};
    const plan = selectPlan(plansByPatient.get(patientId) || [], appointment, base);
    const requestedPayerId = payerIdOf(appointment, base);
    const requestedPayerName = payerNameOf(appointment, base);
    const patientInsuranceType = normalizedContext(patient?.insurance_type);
    const patientInsuranceName = text(patient?.insurance_name, 180);
    const explicitNonInsurance = nonInsuranceContexts.has(financialContextOf(appointment, base));

    if (explicitNonInsurance) {
      contexts.set(appointmentId, base);
      continue;
    }

    const candidatePayerId = text(plan?.payer_id || requestedPayerId, 120);
    const candidatePayerName = text(plan?.payer_name_snapshot || requestedPayerName || patientInsuranceName, 180);
    const patientHasInsuranceFallback = Boolean(patientInsuranceName) && !['PRIVATE', 'PARTICULAR'].includes(patientInsuranceType);
    const hasInsuranceSignal = Boolean(plan || candidatePayerId || requestedPayerName || patientHasInsuranceFallback);
    if (!hasInsuranceSignal) {
      contexts.set(appointmentId, base);
      continue;
    }

    const payerResolution = resolvePayer(candidatePayerId, candidatePayerName);
    const payer = payerResolution.payer;
    const resolvedPayerId = text(payer?.id || candidatePayerId, 120);
    const resolvedPayerName = text(payer?.name || candidatePayerName, 180);
    contexts.set(appointmentId, {
      ...base,
      patient_id: patientId || base?.patient_id || null,
      payer_id: isUuid(resolvedPayerId) ? resolvedPayerId : null,
      payer_name_snapshot: resolvedPayerName || null,
      payer_type: 'INSURANCE',
      financial_context_type: 'INSURANCE',
      service_type: serviceTypeOf(appointment, base) || text(plan?.service_type, 120) || null,
      insurance_card_number: text(base?.insurance_card_number || patient?.insurance_card_number, 120) || null,
      insurance_plan_name: text(base?.insurance_plan_name || plan?.insurance_plan_name || patient?.insurance_plan_category, 160) || null,
      authorization_code: text(base?.authorization_code || plan?.authorization_code, 120) || null,
      guide_number: text(base?.guide_number, 120) || null,
      source: text(base?.source || (plan || patientHasInsuranceFallback ? 'PATIENT_DEFAULT' : 'APPOINTMENT_CONTEXT'), 60),
      payer_resolution_source: base?.payer_resolution_source || (payerResolution.status === 'matched' ? 'batch_unique_match' : null),
      payer_resolution_status: base?.payer_resolution_status || payerResolution.status,
      payer_resolution_reason_code: base?.payer_resolution_reason_code || payerResolution.reasonCode
    });
  }

  return contexts;
}
