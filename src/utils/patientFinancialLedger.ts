import { formatDisplayDate, formatDisplayDateTime } from './dateFormatting';
import { normalizeAppointmentFinancialContextType } from './appointmentFinancialContext';

/**
 * Rótulo de atendimento para a visualização financeira.
 * Os valores persistidos/API continuam intactos: traduzimos apenas a apresentação.
 * Nunca exibimos o código interno bruto ao usuário.
 */
export const patientFinanceClinicalStatusLabel = (value: unknown): string => {
  const raw = String(value || '').trim().toLowerCase();
  const key = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s-]+/g, '_');
  const labels: Record<string, string> = {
    scheduled: 'Agendada',
    agendada: 'Agendada',
    confirmed: 'Confirmada',
    confirmada: 'Confirmada',
    pending: 'Pendente',
    pendente: 'Pendente',
    requested: 'Solicitada',
    in_progress: 'Em andamento',
    ongoing: 'Em andamento',
    started: 'Em andamento',
    em_andamento: 'Em andamento',
    completed: 'Realizada',
    complete: 'Realizada',
    finished: 'Realizada',
    concluded: 'Realizada',
    concluida: 'Realizada',
    realizada: 'Realizada',
    reschedule: 'Remarcação solicitada',
    reschedule_requested: 'Remarcação solicitada',
    rescheduled: 'Remarcada',
    remarcada: 'Remarcada',
    canceled: 'Cancelada',
    cancelled: 'Cancelada',
    canceled_clinic: 'Cancelada pela clínica',
    cancelled_clinic: 'Cancelada pela clínica',
    canceled_patient: 'Cancelada pelo paciente',
    cancelled_patient: 'Cancelada pelo paciente',
    cancel_requested: 'Cancelamento solicitado',
    no_show: 'Não compareceu',
    no_show_patient: 'Paciente não compareceu',
    absent: 'Não compareceu',
    missed: 'Não compareceu'
  };
  return labels[key] || 'Status não identificado';
};

export type PatientFinancialStatus =
  | 'no_charge'
  | 'forecast'
  | 'pending'
  | 'partial'
  | 'paid'
  | 'overdue'
  | 'courtesy'
  | 'exempt'
  | 'cancelled_no_charge'
  | 'late_cancellation'
  | 'no_show_charge'
  | 'canceled'
  | 'refunded'
  | 'voided';

export const PATIENT_FINANCIAL_STATUS_LABELS: Record<PatientFinancialStatus, string> = {
  no_charge: 'Sem cobrança',
  forecast: 'Previsão',
  pending: 'Pendente',
  partial: 'Parcialmente pago',
  paid: 'Pago',
  overdue: 'Vencido',
  courtesy: 'Cortesia',
  exempt: 'Isento',
  cancelled_no_charge: 'Cancelado sem cobrança',
  late_cancellation: 'Cancelamento tardio',
  no_show_charge: 'Falta com cobrança',
  canceled: 'Cancelado',
  refunded: 'Estornado',
  voided: 'Anulado'
};

export const PATIENT_FINANCIAL_STATUS_CLASSES: Record<PatientFinancialStatus, string> = {
  no_charge: 'border-slate-200 bg-slate-50 text-slate-600',
  forecast: 'border-sky-200 bg-sky-50 text-sky-700',
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  partial: 'border-orange-200 bg-orange-50 text-orange-700',
  paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  overdue: 'border-rose-200 bg-rose-50 text-rose-700',
  courtesy: 'border-violet-200 bg-violet-50 text-violet-700',
  exempt: 'border-slate-200 bg-slate-50 text-slate-600',
  cancelled_no_charge: 'border-slate-200 bg-slate-50 text-slate-600',
  late_cancellation: 'border-amber-200 bg-amber-50 text-amber-800',
  no_show_charge: 'border-orange-200 bg-orange-50 text-orange-800',
  canceled: 'border-slate-200 bg-slate-100 text-slate-500',
  refunded: 'border-rose-200 bg-rose-50 text-rose-700',
  voided: 'border-slate-200 bg-slate-100 text-slate-500'
};

const numberValue = (value: any) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const dateOnlyKey = (value: any) => {
  const raw = String(value || '').trim();
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const currentLocalDateKey = (now = new Date()) => {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const resolvePatientFinancialStatus = (charge: any, now = new Date()): PatientFinancialStatus => {
  if (!charge) return 'no_charge';
  const raw = String(charge?.financial_status || charge?.financialStatus || charge?.status || 'pending').trim().toLowerCase();
  const classification = String(charge?.private_financial_classification || charge?.privateFinancialClassification || '').trim().toLowerCase();
  if (raw === 'cancelled_no_charge' || classification === 'cancelled_no_charge') return 'cancelled_no_charge';
  if (raw === 'late_cancellation_charge' || classification === 'late_cancellation_charge') return 'late_cancellation';
  if (raw === 'no_show_charge' || classification === 'no_show_charge') return 'no_show_charge';
  if (['exempt', 'contractual_free', 'no_show_no_charge'].includes(raw) || ['exempt', 'contractual_free', 'no_show_no_charge'].includes(classification)) return 'exempt';
  if (raw === 'voided' || classification === 'voided') return 'voided';
  if (charge?.canceled_at || charge?.canceledAt || ['canceled', 'cancelled', 'cancelado'].includes(raw)) return 'canceled';
  if (charge?.is_courtesy || charge?.isCourtesy || raw === 'courtesy') return 'courtesy';
  if (['refunded', 'estornado'].includes(raw)) return 'refunded';

  const total = numberValue(charge?.amount ?? charge?.total_amount ?? charge?.totalAmount);
  const paid = numberValue(
    charge?.paid_amount ??
    charge?.paidAmount ??
    (raw === 'paid' ? total : 0)
  );
  const refunded = numberValue(charge?.refunded_amount ?? charge?.refundedAmount);
  const balance = numberValue(
    charge?.balance_amount ??
    charge?.balanceAmount ??
    Math.max(total - paid + refunded, 0)
  );
  if (paid > 0 && refunded >= paid) return 'refunded';
  if (balance <= 0 && (total > 0 || paid > 0)) return 'paid';
  if (paid - refunded > 0 || ['partial', 'partially_paid'].includes(raw)) return 'partial';
  if (raw === 'forecast') return 'forecast';
  const dueDate = dateOnlyKey(charge?.due_date || charge?.dueDate);
  if (dueDate && dueDate < currentLocalDateKey(now)) return 'overdue';
  return 'pending';
};

export const getPatientFinanceAmounts = (charge: any) => {
  const original = numberValue(charge?.original_amount ?? charge?.originalAmount ?? charge?.base_amount ?? charge?.baseAmount ?? charge?.amount);
  const additional = numberValue(charge?.additional_amount ?? charge?.additionalAmount);
  const discount = numberValue(charge?.discount_amount ?? charge?.discountAmount);
  const total = numberValue(charge?.amount ?? charge?.total_amount ?? charge?.totalAmount ?? Math.max(original + additional - discount, 0));
  const paidGross = numberValue(charge?.paid_amount ?? charge?.paidAmount ?? (String(charge?.status || '').toLowerCase() === 'paid' ? total : 0));
  const refunded = numberValue(charge?.refunded_amount ?? charge?.refundedAmount);
  const paid = Math.max(paidGross - refunded, 0);
  const balance = numberValue(charge?.balance_amount ?? charge?.balanceAmount ?? Math.max(total - paid, 0));
  return { original, additional, discount, total, paidGross, refunded, paid, balance };
};

const pickPatientName = (patient: any, fallback: any) =>
  String(patient?.name || patient?.full_name || patient?.fullName || fallback || 'Paciente').trim() || 'Paciente';

const pickProfessionalLabel = (professional: any, fallback: any) =>
  String(
    professional?.label ||
    professional?.displayLabel ||
    professional?.professionalDisplayName ||
    professional?.name ||
    fallback ||
    'Profissional não informado'
  ).trim() || 'Profissional não informado';

const appointmentStart = (appointment: any) =>
  appointment?.scheduled_start_at ||
  appointment?.scheduledStartAt ||
  appointment?.scheduled_at ||
  appointment?.scheduledAt ||
  (appointment?.date && appointment?.time ? `${appointment.date}T${appointment.time}` : appointment?.date);

export const isPrivatePatientFinanceAppointment = (appointment: any, billingContext?: any) => {
  const context = normalizeAppointmentFinancialContextType(
    billingContext?.financial_context_type ||
    billingContext?.financialContextType ||
    billingContext?.payer_type ||
    billingContext?.payerType ||
    appointment?.financial_context_type ||
    appointment?.financialContextType ||
    appointment?.payer_type ||
    appointment?.payerType
  );
  return !context || ['PRIVATE', 'COURTESY', 'OTHER'].includes(context);
};

export const buildPatientFinancialAppointmentRows = (params: {
  appointments?: any[];
  charges?: any[];
  items?: any[];
  billingContexts?: any[];
  patients?: any[];
  professionals?: any[];
  privateSnapshots?: any[];
  now?: Date;
}) => {
  const charges = Array.isArray(params.charges) ? params.charges : [];
  const items = Array.isArray(params.items) ? params.items : [];
  const patientsById = new Map((params.patients || []).map((patient: any) => [String(patient?.id || ''), patient]));
  const professionalsById = new Map<string, any>();
  (params.professionals || []).forEach((professional: any) => {
    [professional?.id, professional?.user_id, professional?.userId, professional?.professional_id, professional?.professionalId]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .forEach((id) => professionalsById.set(id, professional));
  });
  const chargesById = new Map(charges.map((charge: any) => [String(charge?.id || ''), charge]));
  const itemByAppointmentId = new Map<string, any>();
  items.filter((item: any) => item?.active !== false).forEach((item: any) => {
    const appointmentId = String(item?.appointment_id || item?.appointmentId || '').trim();
    if (appointmentId) itemByAppointmentId.set(appointmentId, item);
  });
  const billingByAppointmentId = new Map((params.billingContexts || []).map((context: any) => [String(context?.appointment_id || context?.appointmentId || ''), context]));
  const snapshotByAppointmentId = new Map<string, any>();
  (params.privateSnapshots || []).forEach((snapshot: any) => {
    const appointmentId = String(snapshot?.appointment_id || snapshot?.appointmentId || '');
    const current = snapshotByAppointmentId.get(appointmentId);
    if (!current || Number(snapshot?.snapshot_version || 0) > Number(current?.snapshot_version || 0)) {
      snapshotByAppointmentId.set(appointmentId, snapshot);
    }
  });

  return (params.appointments || [])
    .filter((appointment: any) => isPrivatePatientFinanceAppointment(appointment, billingByAppointmentId.get(String(appointment?.id || ''))))
    .map((appointment: any) => {
      const appointmentId = String(appointment?.id || '').trim();
      const item = itemByAppointmentId.get(appointmentId);
      const charge = item ? chargesById.get(String(item?.payment_id || item?.paymentId || '')) : null;
      const snapshot = snapshotByAppointmentId.get(appointmentId) || null;
      const patientId = String(appointment?.patient_id || appointment?.patientId || item?.patient_id || '').trim();
      const professionalId = String(appointment?.therapist_id || appointment?.therapistId || appointment?.professional_id || appointment?.professionalId || item?.professional_id || '').trim();
      const amounts = getPatientFinanceAmounts(charge);
      const status = resolvePatientFinancialStatus(charge, params.now);
      const start = appointmentStart(appointment);
      return {
        appointmentId,
        chargeId: charge?.id || null,
        patientId,
        professionalId,
        patientName: pickPatientName(patientsById.get(patientId), item?.patient_name_snapshot || appointment?.patient_name || appointment?.patientName),
        professionalName: pickProfessionalLabel(professionalsById.get(professionalId), item?.professional_name_snapshot || appointment?.therapist_name || appointment?.therapistName),
        serviceType: String(item?.service_type_snapshot || appointment?.service_type || appointment?.serviceType || appointment?.approach || 'Sessão'),
        specialty: String(snapshot?.specialty_name || item?.specialty_snapshot || charge?.specialty || ''),
        payerId: String(snapshot?.payer_id || charge?.payer_id || ''),
        payerName: String(snapshot?.payer_name || charge?.payer_name || ''),
        priceSource: snapshot?.price_source || charge?.private_price_source || null,
        priceSourceLabel: snapshot?.price_source_label || charge?.private_price_source_label || null,
        financialClassification: snapshot?.financial_classification || charge?.private_financial_classification || null,
        scheduledAt: start || item?.appointment_scheduled_at || null,
        appointmentDateLabel: formatDisplayDateTime(start || item?.appointment_scheduled_at, { separator: ', ' }),
        clinicalStatus: String(appointment?.status || 'scheduled'),
        dueDate: charge?.due_date || charge?.dueDate || null,
        dueDateLabel: formatDisplayDate(charge?.due_date || charge?.dueDate, 'Não definido'),
        method: charge?.method || null,
        lastPaymentAt: charge?.last_payment_at || charge?.lastPaymentAt || null,
        status,
        statusLabel: PATIENT_FINANCIAL_STATUS_LABELS[status],
        ...amounts,
        charge,
        snapshot,
        item,
        appointment
      };
    })
    .sort((left: any, right: any) => String(right.scheduledAt || '').localeCompare(String(left.scheduledAt || '')));
};

export const buildPatientFinancialChargeRows = (ledger: any, patients: any[] = []) => {
  const patientById = new Map((patients || []).map((patient: any) => [String(patient?.id || ''), patient]));
  const itemsByChargeId = new Map<string, any[]>();
  (ledger?.items || []).forEach((item: any) => {
    const paymentId = String(item?.payment_id || item?.paymentId || '');
    const current = itemsByChargeId.get(paymentId) || [];
    current.push(item);
    itemsByChargeId.set(paymentId, current);
  });
  const transactionsByChargeId = new Map<string, any[]>();
  (ledger?.transactions || []).forEach((transaction: any) => {
    const paymentId = String(transaction?.payment_id || transaction?.paymentId || '');
    const current = transactionsByChargeId.get(paymentId) || [];
    current.push(transaction);
    transactionsByChargeId.set(paymentId, current);
  });
  const eventsByChargeId = new Map<string, any[]>();
  (ledger?.events || []).forEach((event: any) => {
    const paymentId = String(event?.payment_id || event?.paymentId || '');
    const current = eventsByChargeId.get(paymentId) || [];
    current.push(event);
    eventsByChargeId.set(paymentId, current);
  });
  const snapshotByChargeId = new Map<string, any>();
  (ledger?.privateSnapshots || []).forEach((snapshot: any) => {
    const paymentId = String(snapshot?.payment_id || snapshot?.paymentId || '');
    const current = snapshotByChargeId.get(paymentId);
    if (!current || Number(snapshot?.snapshot_version || 0) > Number(current?.snapshot_version || 0)) {
      snapshotByChargeId.set(paymentId, snapshot);
    }
  });

  return (ledger?.charges || []).map((charge: any) => {
    const id = String(charge?.id || '');
    const patientId = String(charge?.patient_id || charge?.patientId || '');
    const status = resolvePatientFinancialStatus(charge);
    const snapshot = snapshotByChargeId.get(id) || null;
    const items = itemsByChargeId.get(id) || [];
    const firstItemWithPayer = items.find((item: any) => String(item?.payer_name_snapshot || '').trim());
    const firstItemWithSpecialty = items.find((item: any) => String(item?.specialty_snapshot || '').trim());
    const firstItemWithService = items.find((item: any) => String(item?.service_type_snapshot || '').trim());
    const payerId = snapshot?.payer_id || charge?.payer_id || firstItemWithPayer?.payer_id_snapshot || null;
    const payerName = String(
      snapshot?.payer_name ||
      charge?.payer_name ||
      charge?.insurance_name ||
      firstItemWithPayer?.payer_name_snapshot ||
      ''
    ).trim() || null;
    const source = String(charge?.source || 'LEGACY');
    const billingFrequency = charge?.billing_frequency || charge?.billingFrequency || null;
    const pricingUnit = charge?.pricing_unit || charge?.pricingUnit || null;
    const aggregationMethod = charge?.aggregation_method || charge?.aggregationMethod || null;
    const isMonthlySession =
      source === 'MONTHLY_SESSION_AGGREGATE' ||
      (String(billingFrequency || '').toUpperCase() === 'MONTHLY' &&
        String(pricingUnit || '').toUpperCase() === 'SESSION' &&
        String(aggregationMethod || '').toUpperCase() === 'ELIGIBLE_COMPLETED_SESSIONS');
    const monthlySessionCount = Number(charge?.monthly_session_count ?? charge?.monthlySessionCount ?? items.length ?? 0) || items.length || 0;
    return {
      id,
      patientId,
      patientName: pickPatientName(patientById.get(patientId), charge?.patient_name || charge?.patientName),
      status,
      statusLabel: PATIENT_FINANCIAL_STATUS_LABELS[status],
      dueDate: charge?.due_date || charge?.dueDate || null,
      dueDateLabel: formatDisplayDate(charge?.due_date || charge?.dueDate, 'Não definido'),
      competenceMonth: charge?.competence_month || charge?.competenceMonth || items[0]?.competence_month || null,
      method: charge?.method || null,
      source,
      specialty: snapshot?.specialty_name || charge?.specialty || firstItemWithSpecialty?.specialty_snapshot || null,
      serviceName: snapshot?.service_name || charge?.service_type || firstItemWithService?.service_type_snapshot || null,
      payerId,
      payerName,
      billingOrigin: payerName ? 'INSURANCE' : 'PRIVATE',
      originLabel: payerName ? `Convênio · ${payerName}` : 'Particular',
      priceSource: snapshot?.price_source || charge?.private_price_source || null,
      priceSourceLabel: snapshot?.price_source_label || charge?.private_price_source_label || null,
      financialClassification: snapshot?.financial_classification || charge?.private_financial_classification || null,
      billingFrequency,
      pricingUnit,
      aggregationMethod,
      isMonthlySession,
      billingModelLabel: isMonthlySession ? 'Mensal por sessões' : null,
      monthlySessionCount,
      sessionCount: items.length || monthlySessionCount,
      monthlyAdjustmentRequired: charge?.monthly_adjustment_required === true || charge?.monthlyAdjustmentRequired === true,
      items,
      transactions: transactionsByChargeId.get(id) || [],
      events: eventsByChargeId.get(id) || [],
      snapshot,
      ...getPatientFinanceAmounts(charge),
      charge
    };
  });
};

export const patientFinancialTransactionLabel = (transaction: any) => {
  const type = String(transaction?.transaction_type || transaction?.transactionType || '').toUpperCase();
  return ({
    PAYMENT: 'Pagamento recebido',
    DISCOUNT: 'Desconto aplicado',
    COURTESY: 'Cortesia',
    REFUND: 'Estorno',
    ADJUSTMENT: 'Ajuste'
  } as Record<string, string>)[type] || 'Operação financeira';
};

export const privateAppointmentFinancialReadinessLabel = (summary: any) => {
  const status = resolvePatientFinancialStatus(summary);
  if (status === 'no_charge' || status === 'forecast') return 'Pronta para cobrança';
  if (status === 'pending') return 'Cobrança pendente';
  if (status === 'partial') return 'Pagamento parcial';
  if (status === 'overdue') return 'Cobrança vencida';
  if (status === 'paid') return 'Pagamento recebido';
  if (status === 'courtesy') return 'Financeiro regularizado';
  if (status === 'refunded') return 'Pagamento estornado';
  return 'Sem cobrança';
};
