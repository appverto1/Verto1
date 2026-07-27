import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  FileCheck2,
  Filter,
  History,
  Loader2,
  Paperclip,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  ShieldCheck,
  Tag,
  X
} from 'lucide-react';
import { dataService } from '../services/dataService';
import { PrivatePricingManagement } from './PrivatePricingManagement';
import { formatDisplayDate, formatDisplayDateTime } from '../utils/dateFormatting';
import { normalizePatientFinancialPlans } from '../utils/patientFinancialPlan';
import {
  PATIENT_FINANCIAL_STATUS_CLASSES,
  PATIENT_FINANCIAL_STATUS_LABELS,
  buildPatientFinancialAppointmentRows,
  buildPatientFinancialChargeRows,
  patientFinancialTransactionLabel,
  resolvePatientFinancialStatus,
  type PatientFinancialStatus
} from '../utils/patientFinancialLedger';

type FinanceOperation =
  | 'charge'
  | 'payment'
  | 'partial_payment'
  | 'discount'
  | 'courtesy'
  | 'refund'
  | 'receipt'
  | 'due_date'
  | 'cancel';

type LaunchRequest = {
  key: string;
  appointmentId?: string;
  chargeId?: string;
  action?: FinanceOperation | 'history';
} | null;

type Props = {
  activeSection: string;
  month: string;
  patients: any[];
  professionals: any[];
  currentUser?: any;
  launchRequest?: LaunchRequest;
  onLaunchHandled?: () => void;
  onPaymentsLoaded?: (payments: any[]) => void;
  onToast?: (message: string, type?: 'success' | 'error') => void;
};

const emptyLedger = {
  charges: [],
  items: [],
  transactions: [],
  events: [],
  appointments: [],
  privateSnapshots: [],
  billingContexts: [],
  policy: null
};

const operationLabels: Record<FinanceOperation, string> = {
  charge: 'Criar cobrança',
  payment: 'Registrar pagamento',
  partial_payment: 'Registrar pagamento parcial',
  discount: 'Aplicar desconto',
  courtesy: 'Marcar como cortesia',
  refund: 'Estornar pagamento',
  receipt: 'Emitir recibo',
  due_date: 'Alterar vencimento',
  cancel: 'Cancelar cobrança'
};

const operationDescriptions: Record<FinanceOperation, string> = {
  charge: 'Cria a obrigação financeira sem marcar valor como recebido.',
  payment: 'Baixa integralmente uma cobrança ou cria e recebe em uma única operação.',
  partial_payment: 'Registra o valor recebido e mantém o saldo restante em aberto.',
  discount: 'Reduz o saldo com registro auditável do motivo.',
  courtesy: 'Regulariza a cobrança como cortesia sem registrar recebimento.',
  refund: 'Estorna até o limite efetivamente recebido.',
  receipt: 'Emite um recibo para o pagamento confirmado e mantém o documento vinculado à operação.',
  due_date: 'Altera o vencimento preservando o histórico anterior.',
  cancel: 'Cancela a cobrança sem apagar lançamentos ou auditoria.'
};

const currency = (value: any) =>
  (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const parseMoney = (value: any) => {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const parsed = Number(raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const moneyInput = (value: any) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return '';
  return parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const MAX_FINANCE_DOCUMENT_BYTES = 1_400_000;
const ALLOWED_FINANCE_DOCUMENT_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

const normalizePdfDataUri = (value: any) => String(value || '')
  .replace(/^data:application\/pdf;filename=[^;]+;base64,/i, 'data:application/pdf;base64,');

const readFinanceDocument = (file: File) => new Promise<{ url: string; name: string; type: string }>((resolve, reject) => {
  const contentType = String(file.type || '').toLowerCase();
  if (!ALLOWED_FINANCE_DOCUMENT_TYPES.has(contentType)) {
    reject(new Error('Envie uma imagem PNG, JPG, WebP ou um arquivo PDF.'));
    return;
  }
  if (file.size <= 0 || file.size > MAX_FINANCE_DOCUMENT_BYTES) {
    reject(new Error('O comprovante deve ter no máximo 1,4 MB.'));
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('Não foi possível ler este comprovante.'));
  reader.onload = () => resolve({
    url: String(reader.result || ''),
    name: file.name.slice(0, 240),
    type: contentType
  });
  reader.readAsDataURL(file);
});

const createOperationKey = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `patient-finance-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const isCompletedAppointment = (status: any) => {
  const normalized = String(status || '').toLowerCase();
  return ['completed', 'complete', 'concluida', 'concluída', 'realizada'].some((value) => normalized.includes(value));
};

const methodLabel = (method: any) => ({
  pix: 'Pix',
  card: 'Cartão',
  cash: 'Dinheiro',
  boleto: 'Boleto',
  transfer: 'Transferência'
} as Record<string, string>)[String(method || '').toLowerCase()] || String(method || 'Não informado');

const monthKeyFor = (value: any) => {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}(?:-|$)/.test(raw) && !raw.includes('T')) return raw.slice(0, 7);
  const parsed = value instanceof Date ? value : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(parsed);
  const year = parts.find((part) => part.type === 'year')?.value;
  const monthPart = parts.find((part) => part.type === 'month')?.value;
  return year && monthPart ? `${year}-${monthPart}` : '';
};

const auditEventLabel = (value: any) => ({
  CHARGE_CREATED: 'Cobrança criada',
  PAYMENT_RECORDED: 'Pagamento registrado',
  DISCOUNT_APPLIED: 'Desconto aplicado',
  COURTESY_APPLIED: 'Cortesia aplicada',
  PAYMENT_REFUNDED: 'Pagamento estornado',
  RECEIPT_ISSUED: 'Recibo emitido',
  DUE_DATE_CHANGED: 'Vencimento alterado',
  CHARGE_CANCELED: 'Cobrança cancelada',
  CHARGE_ACTIVATED_BY_APPOINTMENT: 'Cobrança efetivada pela sessão',
  CHARGE_CANCELED_BY_APPOINTMENT: 'Cobrança cancelada pela política da clínica',
  CHARGE_CANCELED_BY_RESCHEDULE: 'Cobrança anterior encerrada após remarcação',
  CHARGE_RECREATED_AFTER_RESCHEDULE: 'Cobrança recriada após remarcação'
} as Record<string, string>)[String(value || '').toUpperCase()] || 'Atualização financeira';

const documentStatusLabel = (status: any) => ({
  PENDING: 'Documento pendente',
  PROVIDED: 'Comprovante anexado',
  VALIDATED: 'Comprovante validado',
  REJECTED: 'Comprovante recusado',
  ISSUED: 'Recibo emitido'
} as Record<string, string>)[String(status || 'PENDING').toUpperCase()] || 'Documento pendente';

const StatusBadge = ({ status }: { status: PatientFinancialStatus }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${PATIENT_FINANCIAL_STATUS_CLASSES[status]}`}>
    {PATIENT_FINANCIAL_STATUS_LABELS[status]}
  </span>
);

export function PatientFinanceWorkspace({
  activeSection,
  month,
  patients,
  professionals,
  currentUser,
  launchRequest,
  onLaunchHandled,
  onPaymentsLoaded,
  onToast
}: Props) {
  const [ledger, setLedger] = useState<any>(emptyLedger);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [operation, setOperation] = useState<FinanceOperation | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedAppointmentIds, setSelectedAppointmentIds] = useState<string[]>([]);
  const [selectedChargeId, setSelectedChargeId] = useState('');
  const [amount, setAmount] = useState('');
  const [additionalAmount, setAdditionalAmount] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('pix');
  const [notes, setNotes] = useState('');
  const [proof, setProof] = useState<{ url: string; name: string; type: string } | null>(null);
  const [manualCompetence, setManualCompetence] = useState(false);
  const [saving, setSaving] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(createOperationKey());
  const [expandedChargeId, setExpandedChargeId] = useState('');
  const handledLaunchKeyRef = useRef('');

  const [search, setSearch] = useState('');
  const [patientFilter, setPatientFilter] = useState('all');
  const [professionalFilter, setProfessionalFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [payerFilter, setPayerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [onlyCompleted, setOnlyCompleted] = useState(false);
  const [onlyUncharged, setOnlyUncharged] = useState(false);
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  const [onlyPartial, setOnlyPartial] = useState(false);

  const [policy, setPolicy] = useState<any>(null);
  const [policySaving, setPolicySaving] = useState(false);
  const [sendingReminderChargeId, setSendingReminderChargeId] = useState('');

  const canManagePolicy = ['owner', 'admin', 'coordinator'].includes(String(currentUser?.role || '').toLowerCase());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    dataService.getPatientFinanceLedger(month).then((result: any) => {
      if (cancelled) return;
      if (!result?.success) {
        setLoadError(result?.error || 'Não foi possível carregar o financeiro de pacientes.');
        setLoading(false);
        return;
      }
      const next = { ...emptyLedger, ...(result.data || {}) };
      setLedger(next);
      setPolicy(next.policy || null);
      onPaymentsLoaded?.(next.charges || []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const appointmentRows = useMemo(() => buildPatientFinancialAppointmentRows({
    appointments: ledger.appointments,
    charges: ledger.charges,
    items: ledger.items,
    billingContexts: ledger.billingContexts,
    privateSnapshots: ledger.privateSnapshots,
    patients,
    professionals
  }), [ledger.appointments, ledger.billingContexts, ledger.charges, ledger.items, ledger.privateSnapshots, patients, professionals]);

  const chargeRows = useMemo(
    () => buildPatientFinancialChargeRows(ledger, patients),
    [ledger, patients]
  );

  const chargesById = useMemo(
    () => new Map(chargeRows.map((charge: any) => [String(charge.id), charge])),
    [chargeRows]
  );

  const appointmentsById = useMemo(
    () => new Map((ledger.appointments || []).map((appointment: any) => [String(appointment?.id || ''), appointment])),
    [ledger.appointments]
  );

  const suggestedAmountForAppointment = (row: any) => {
    const patient = patients.find((item: any) => String(item?.id || '') === String(row?.patientId || ''));
    const plans = normalizePatientFinancialPlans(patient?.financialPlans || patient?.financial_plans || [], patient || {});
    const privateSessionPlans = plans.filter((plan: any) =>
      plan.billingMode === 'PRIVATE' &&
      String(plan.quantityPeriod || 'SESSION').toUpperCase() === 'SESSION' &&
      Number(plan.amountCents || 0) > 0
    );
    const serviceKey = String(row?.serviceType || '').trim().toLocaleLowerCase('pt-BR');
    const exact = privateSessionPlans.find((plan: any) =>
      [plan.specialty, plan.customServiceName, plan.serviceType]
        .some((value) => String(value || '').trim().toLocaleLowerCase('pt-BR') === serviceKey)
    );
    const selectedPlan = exact || (privateSessionPlans.length === 1 ? privateSessionPlans[0] : null);
    return selectedPlan ? Number(selectedPlan.amountCents || 0) / 100 : 0;
  };

  const filteredAppointments = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
    return appointmentRows.filter((row: any) => {
      if (/^\d{4}-\d{2}$/.test(month) && monthKeyFor(row.scheduledAt) !== month) return false;
      if (normalizedSearch && !`${row.patientName} ${row.serviceType} ${row.professionalName}`.toLocaleLowerCase('pt-BR').includes(normalizedSearch)) return false;
      if (patientFilter !== 'all' && row.patientId !== patientFilter) return false;
      if (professionalFilter !== 'all' && row.professionalId !== professionalFilter) return false;
      if (serviceFilter !== 'all' && row.serviceType !== serviceFilter) return false;
      if (payerFilter !== 'all' && row.payerName !== payerFilter) return false;
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (methodFilter !== 'all' && String(row.method || '').toLowerCase() !== methodFilter) return false;
      if (onlyCompleted && !isCompletedAppointment(row.clinicalStatus)) return false;
      if (onlyUncharged && row.status !== 'no_charge') return false;
      if (onlyUnpaid && !['pending', 'partial', 'overdue'].includes(row.status)) return false;
      if (onlyPartial && row.status !== 'partial') return false;
      return true;
    });
  }, [appointmentRows, methodFilter, month, onlyCompleted, onlyPartial, onlyUncharged, onlyUnpaid, patientFilter, payerFilter, professionalFilter, search, serviceFilter, statusFilter]);

  const openOperation = (nextOperation: FinanceOperation, source?: any) => {
    const sourceRow = source?.appointment || source?.charge ? source : null;
    const sourceCharge = sourceRow?.charge || source?.charge || (source?.id ? source : null);
    setOperation(nextOperation);
    setSelectedPatientId(String(sourceRow?.patientId || sourceCharge?.patient_id || source?.patientId || ''));
    setSelectedAppointmentIds(sourceRow?.appointmentId ? [String(sourceRow.appointmentId)] : []);
    setSelectedChargeId(String(sourceRow?.chargeId || sourceCharge?.id || source?.id || ''));
    const sourceBalance = Number(sourceRow?.balance ?? source?.balance ?? sourceCharge?.balance_amount ?? 0);
    const sourcePaid = Number(sourceRow?.paidGross ?? source?.paidGross ?? sourceCharge?.paid_amount ?? 0);
    const suggestedAmount = !sourceRow?.chargeId && sourceRow?.appointmentId
      ? suggestedAmountForAppointment(sourceRow)
      : 0;
    setAmount(moneyInput(nextOperation === 'refund' ? sourcePaid : sourceBalance || sourceRow?.total || source?.total || suggestedAmount));
    setAdditionalAmount('');
    setDiscountAmount('');
    setDueDate(String(sourceRow?.dueDate || source?.dueDate || sourceCharge?.due_date || new Date().toISOString().slice(0, 10)).slice(0, 10));
    setMethod(String(sourceRow?.method || source?.method || sourceCharge?.method || 'pix'));
    setNotes('');
    setProof(null);
    setManualCompetence(false);
    setOperationError('');
    setSaving(false);
    setIdempotencyKey(createOperationKey());
  };

  const closeOperation = () => {
    if (saving) return;
    setOperation(null);
    setOperationError('');
  };

  useEffect(() => {
    if (!launchRequest?.key || loading || handledLaunchKeyRef.current === launchRequest.key) return;
    const appointmentRow = launchRequest.appointmentId
      ? appointmentRows.find((row: any) => String(row.appointmentId) === String(launchRequest.appointmentId))
      : null;
    const chargeRow = launchRequest.chargeId ? chargesById.get(String(launchRequest.chargeId)) : null;
    if (launchRequest.action === 'history') {
      setExpandedChargeId(String(chargeRow?.id || appointmentRow?.chargeId || ''));
    } else {
      openOperation((launchRequest.action || (appointmentRow?.chargeId ? 'payment' : 'charge')) as FinanceOperation, appointmentRow || chargeRow);
    }
    handledLaunchKeyRef.current = launchRequest.key;
    onLaunchHandled?.();
  }, [appointmentRows, chargesById, launchRequest, loading]);

  const operationAppointments = useMemo(
    () => appointmentRows.filter((row: any) => !selectedPatientId || row.patientId === selectedPatientId),
    [appointmentRows, selectedPatientId]
  );
  const operationCharges = useMemo(
    () => chargeRows.filter((charge: any) => !selectedPatientId || charge.patientId === selectedPatientId),
    [chargeRows, selectedPatientId]
  );
  const selectedCharge = selectedChargeId ? chargesById.get(selectedChargeId) : null;
  const selectedAppointments = operationAppointments.filter((row: any) => selectedAppointmentIds.includes(row.appointmentId));
  const selectedTotal = parseMoney(amount);
  const selectedAdditional = parseMoney(additionalAmount);
  const selectedDiscount = parseMoney(discountAmount);

  useEffect(() => {
    if (selectedChargeId || !['charge', 'payment'].includes(String(operation || '')) || selectedAppointments.length === 0) return;
    const suggestedTotal = selectedAppointments.reduce(
      (sum: number, row: any) => sum + suggestedAmountForAppointment(row),
      0
    );
    if (suggestedTotal > 0) setAmount(moneyInput(suggestedTotal));
  }, [operation, selectedAppointmentIds.join('|'), selectedChargeId]);

  const mergePersistedPayload = (payload: any) => {
    const charge = payload?.charge;
    if (!charge?.id) return;
    const paymentId = String(charge.id);
    setLedger((current: any) => {
      const next = {
        ...current,
        charges: [charge, ...(current.charges || []).filter((item: any) => String(item.id) !== paymentId)],
        items: [
          ...(payload.items || []),
          ...(current.items || []).filter((item: any) => String(item.payment_id || item.paymentId) !== paymentId)
        ],
        transactions: [
          ...(payload.transactions || []),
          ...(current.transactions || []).filter((item: any) => String(item.payment_id || item.paymentId) !== paymentId)
        ],
        events: [
          ...(payload.events || []),
          ...(current.events || []).filter((item: any) => String(item.payment_id || item.paymentId) !== paymentId)
        ]
      };
      onPaymentsLoaded?.(next.charges);
      return next;
    });
  };

  const submitOperation = async () => {
    if (!operation || saving) return;
    setOperationError('');
    const requiresExistingCharge = ['partial_payment', 'discount', 'courtesy', 'refund', 'receipt', 'due_date', 'cancel'].includes(operation);
    if (requiresExistingCharge && !selectedChargeId) {
      setOperationError('Selecione a cobrança que será alterada.');
      return;
    }
    if (['charge', 'payment'].includes(operation) && !selectedChargeId && selectedAppointmentIds.length === 0 && !manualCompetence) {
      setOperationError('Selecione pelo menos uma sessão ou marque o lançamento por competência.');
      return;
    }
    if (!selectedPatientId && !selectedChargeId) {
      setOperationError('Selecione o paciente.');
      return;
    }
    if (!['courtesy', 'receipt', 'due_date', 'cancel'].includes(operation) && selectedTotal <= 0) {
      setOperationError('Informe um valor maior que zero.');
      return;
    }
    if (operation === 'charge' && !dueDate) {
      setOperationError('Informe o vencimento da cobrança.');
      return;
    }
    if (operation === 'payment' && selectedCharge && Math.abs(selectedTotal - Number(selectedCharge.balance || 0)) > 0.009) {
      setOperationError(`Para pagamento integral, informe exatamente o saldo de ${currency(selectedCharge.balance)}. Use pagamento parcial para outro valor.`);
      return;
    }
    if (operation === 'partial_payment' && selectedCharge && selectedTotal >= Number(selectedCharge.balance || 0)) {
      setOperationError('O pagamento parcial deve ser menor que o saldo. Para quitar, use Registrar pagamento.');
      return;
    }
    if (['discount', 'courtesy', 'refund', 'cancel'].includes(operation) && !notes.trim()) {
      setOperationError('Informe o motivo desta operação para preservar a trilha financeira.');
      return;
    }

    setSaving(true);
    try {
      let result: any;
      if (!selectedChargeId && ['charge', 'payment'].includes(operation)) {
        const perAppointment = selectedAppointmentIds.length ? selectedTotal / selectedAppointmentIds.length : selectedTotal;
        result = await dataService.createPatientFinancialCharge({
          patientId: selectedPatientId,
          items: selectedAppointments.map((row: any) => ({
            appointmentId: row.appointmentId,
            unitAmount: Number(perAppointment.toFixed(2)),
            serviceType: row.serviceType,
            specialty: row.specialty
          })),
          originalAmount: selectedTotal,
          additionalAmount: selectedAdditional,
          discountAmount: selectedDiscount,
          dueDate,
          method,
          source: manualCompetence
            ? 'MONTHLY_COMPETENCE'
            : selectedAppointmentIds.length > 1
              ? 'GROUPED_APPOINTMENTS'
              : 'APPOINTMENT',
          competenceMonth: month ? `${month}-01` : null,
          notes,
          initialPaymentAmount: operation === 'charge' ? 0 : selectedTotal,
          transactionAt: new Date().toISOString(),
          proofUrl: proof?.url || null,
          proofFileName: proof?.name || null,
          proofContentType: proof?.type || null,
          idempotencyKey
        });
      } else {
        const operationMap: Record<FinanceOperation, string> = {
          charge: 'PAYMENT',
          payment: 'PAYMENT',
          partial_payment: 'PARTIAL_PAYMENT',
          discount: 'DISCOUNT',
          courtesy: 'COURTESY',
          refund: 'REFUND',
          receipt: 'ISSUE_RECEIPT',
          due_date: 'DUE_DATE_CHANGE',
          cancel: 'CANCEL'
        };
        let receiptUrl: string | null = null;
        if (operation === 'receipt') {
          const { jsPDF } = await import('jspdf');
          const document = new jsPDF({ unit: 'mm', format: 'a4' });
          const clinicName = String(
            currentUser?.clinicDisplayName ||
            currentUser?.clinicName ||
            currentUser?.clinic?.display_name ||
            currentUser?.clinic?.name ||
            'Clínica'
          ).trim();
          document.setFont('helvetica', 'normal');
          document.setFontSize(16);
          document.text('Recibo de pagamento', 20, 24);
          document.setFontSize(10);
          document.text(clinicName, 20, 32);
          document.line(20, 37, 190, 37);
          document.setFontSize(11);
          document.text(`Paciente: ${selectedCharge?.patientName || 'Paciente'}`, 20, 49);
          document.text(`Valor recebido: ${currency(selectedCharge?.paid || 0)}`, 20, 58);
          document.text(`Data de emissão: ${formatDisplayDateTime(new Date(), { separator: ', ' })}`, 20, 67);
          document.text(`Referência: ${selectedCharge?.items?.length || 0} sessão(s) vinculada(s)`, 20, 76);
          document.setFontSize(9);
          document.text('Documento emitido a partir do histórico financeiro registrado na Verto.', 20, 92);
          receiptUrl = normalizePdfDataUri(document.output('datauristring'));
        }
        result = await dataService.applyPatientFinancialOperation(selectedChargeId, {
          operation: operationMap[operation],
          amount: selectedTotal,
          dueDate,
          method,
          transactionAt: new Date().toISOString(),
          proofUrl: receiptUrl || proof?.url || null,
          proofFileName: receiptUrl ? `recibo-${selectedChargeId}.pdf` : proof?.name || null,
          proofContentType: receiptUrl ? 'application/pdf' : proof?.type || null,
          notes,
          idempotencyKey
        });
      }
      if (!result?.success) {
        setOperationError(result?.error || 'Não foi possível concluir a operação.');
        setSaving(false);
        return;
      }
      mergePersistedPayload(result.data || {});
      onToast?.(`${operationLabels[operation]} concluído.`, 'success');
      setOperation(null);
    } catch {
      setOperationError('Não foi possível concluir a operação financeira agora.');
    } finally {
      setSaving(false);
    }
  };

  const savePolicy = async () => {
    if (!policy || policySaving) return;
    setPolicySaving(true);
    const result = await dataService.updatePatientFinancePolicy({
      receivableTrigger: policy.receivable_trigger,
      createForecastOnSchedule: policy.create_forecast_on_schedule,
      cancellationPolicy: policy.cancellation_policy,
      cancellationPercentage: Number(policy.cancellation_percentage || 0),
      cancellationToleranceHours: Number(policy.cancellation_tolerance_hours || 0),
      chargeNoShow: Boolean(policy.charge_no_show),
      rescheduleKeepsCharge: policy.reschedule_keeps_charge !== false
    });
    setPolicySaving(false);
    if (!result?.success) {
      onToast?.(result?.error || 'Não foi possível salvar a política.', 'error');
      return;
    }
    setPolicy(result.data);
    onToast?.('Política financeira salva.', 'success');
  };

  const sendChargeReminder = async (chargeId: string) => {
    if (!chargeId || sendingReminderChargeId) return;
    setSendingReminderChargeId(chargeId);
    const result = await dataService.sendPatientFinancialReminder(chargeId);
    setSendingReminderChargeId('');
    if (!result?.success) {
      onToast?.(result?.error || 'Não foi possível enviar o lembrete.', 'error');
      return;
    }
    onToast?.(result?.message || 'Lembrete financeiro enviado.', 'success');
  };

  const activeView = activeSection === 'Recebimentos de pacientes'
    ? 'receipts'
    : activeSection === 'Cobranças'
      ? 'charges'
      : activeSection === 'Pendências de pacientes'
        ? 'pending'
        : activeSection === 'Recibos'
          ? 'documents'
          : 'appointments';

  const visibleChargeRows = chargeRows.filter((charge: any) => {
    if (activeView === 'pending' && !['pending', 'partial', 'overdue'].includes(charge.status)) return false;
    if (activeView === 'charges' && /^\d{4}-\d{2}$/.test(month)) {
      const referenceMonths = [
        charge.competenceMonth,
        charge.dueDate,
        charge.charge?.created_at,
        ...charge.items.map((item: any) => item.appointment_scheduled_at)
      ].map(monthKeyFor).filter(Boolean);
      if (!referenceMonths.includes(month)) return false;
    }
    if (patientFilter !== 'all' && charge.patientId !== patientFilter) return false;
    if (statusFilter !== 'all' && charge.status !== statusFilter) return false;
    if (methodFilter !== 'all' && String(charge.method || '').toLowerCase() !== methodFilter) return false;
    if (professionalFilter !== 'all' && !charge.items.some((item: any) => String(item.professional_id || '') === professionalFilter)) return false;
    if (serviceFilter !== 'all' && !charge.items.some((item: any) => String(item.service_type_snapshot || '') === serviceFilter)) return false;
    if (payerFilter !== 'all' && String(charge.payerName || '') !== payerFilter) return false;
    if (onlyCompleted && !charge.items.some((item: any) => isCompletedAppointment(appointmentsById.get(String(item.appointment_id || ''))?.status))) return false;
    if (onlyUncharged) return false;
    if (onlyUnpaid && !['pending', 'partial', 'overdue'].includes(charge.status)) return false;
    if (onlyPartial && charge.status !== 'partial') return false;
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
    if (normalizedSearch) {
      const searchable = `${charge.patientName} ${charge.items.map((item: any) => `${item.service_type_snapshot || ''} ${item.professional_name_snapshot || ''}`).join(' ')}`.toLocaleLowerCase('pt-BR');
      if (!searchable.includes(normalizedSearch)) return false;
    }
    return true;
  });
  const transactionMatchesFilters = (transaction: any) => {
    const charge: any = chargesById.get(String(transaction?.payment_id || transaction?.paymentId || ''));
    if (!charge) return false;
    if (/^\d{4}-\d{2}$/.test(month) && monthKeyFor(transaction?.transaction_at || transaction?.created_at) !== month) return false;
    if (patientFilter !== 'all' && charge.patientId !== patientFilter) return false;
    if (professionalFilter !== 'all' && !charge.items.some((item: any) => String(item.professional_id || '') === professionalFilter)) return false;
    if (serviceFilter !== 'all' && !charge.items.some((item: any) => String(item.service_type_snapshot || '') === serviceFilter)) return false;
    if (payerFilter !== 'all' && String(charge.payerName || '') !== payerFilter) return false;
    if (methodFilter !== 'all' && String(transaction?.method || charge.method || '').toLowerCase() !== methodFilter) return false;
    if (statusFilter !== 'all' && charge.status !== statusFilter) return false;
    if (onlyUncharged) return false;
    if (onlyUnpaid && !['pending', 'partial', 'overdue'].includes(charge.status)) return false;
    if (onlyPartial && charge.status !== 'partial') return false;
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
    if (normalizedSearch) {
      const searchable = `${charge.patientName} ${charge.items.map((item: any) => `${item.service_type_snapshot || ''} ${item.professional_name_snapshot || ''}`).join(' ')}`.toLocaleLowerCase('pt-BR');
      if (!searchable.includes(normalizedSearch)) return false;
    }
    return true;
  };
  const receiptTransactions = (ledger.transactions || []).filter((transaction: any) =>
    ['PAYMENT', 'REFUND'].includes(String(transaction?.transaction_type || '').toUpperCase()) &&
    transactionMatchesFilters(transaction)
  );
  const documentTransactions = (ledger.transactions || []).filter((transaction: any) =>
    transactionMatchesFilters(transaction) && (
      transaction?.proof_url ||
      transaction?.receipt_url ||
      String(transaction?.document_status || '').toUpperCase() !== 'PENDING'
    )
  );
  const auditActorLabel = (actorId: any) => {
    const normalized = String(actorId || '').trim();
    if (!normalized) return 'Sistema';
    if (normalized === String(currentUser?.id || '')) return currentUser?.name || currentUser?.fullName || 'Usuário atual';
    const professional = professionals.find((item: any) =>
      [item?.id, item?.user_id, item?.userId, item?.professional_id, item?.professionalId]
        .some((value) => String(value || '') === normalized)
    );
    return professional?.name || professional?.displayName || professional?.label || 'Usuário da clínica';
  };

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-3xl border border-slate-100 bg-white p-8 text-sm text-slate-500">
        <Loader2 size={18} className="mr-2 animate-spin text-violet-600" /> Carregando financeiro por sessão...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-3xl border border-rose-100 bg-rose-50 p-5 text-sm text-rose-700">
        <div className="flex items-start gap-3"><AlertCircle size={18} className="mt-0.5" /><p>{loadError}</p></div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-patient-finance-workspace>
      <PrivatePricingManagement
        patients={patients}
        currentUser={currentUser}
        onToast={onToast}
      />
      <div className="flex flex-col gap-3 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Financeiro por sessão</h3>
          <p className="mt-1 text-sm text-slate-500">Cobranças, pagamentos e documentos ligados ao atendimento que originou o valor.</p>
        </div>
        <button type="button" onClick={() => openOperation('charge')} className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700">
          <Plus size={17} /> Nova operação
        </button>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <label className="relative xl:col-span-2">
            <Search size={16} className="absolute left-3 top-3 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Paciente, serviço ou profissional" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-violet-400" />
          </label>
          <select value={patientFilter} onChange={(event) => setPatientFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600">
            <option value="all">Todos os pacientes</option>
            {patients.map((patient: any) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}
          </select>
          <select value={professionalFilter} onChange={(event) => setProfessionalFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600">
            <option value="all">Todos os profissionais</option>
            {Array.from(new Map(appointmentRows.map((row: any) => [row.professionalId, row.professionalName])).entries()).filter(([id]) => id).map(([id, name]) => <option key={String(id)} value={String(id)}>{String(name)}</option>)}
          </select>
          <select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600">
            <option value="all">Todos os serviços</option>
            {Array.from(new Set(appointmentRows.map((row: any) => row.serviceType))).filter(Boolean).map((service) => <option key={String(service)} value={String(service)}>{String(service)}</option>)}
          </select>
          <select value={payerFilter} onChange={(event) => setPayerFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600">
            <option value="all">Todos os pagadores</option>
            {Array.from(new Set(chargeRows.map((row: any) => String(row.payerName || '')).filter(Boolean))).map((payer) => <option key={payer} value={payer}>{payer}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600">
            <option value="all">Todos os status</option>
            {Object.entries(PATIENT_FINANCIAL_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1 text-slate-400"><Filter size={14} /> Filtros rápidos:</span>
          {[
            [onlyCompleted, setOnlyCompleted, 'Sessões realizadas'],
            [onlyUncharged, setOnlyUncharged, 'Sem cobrança'],
            [onlyUnpaid, setOnlyUnpaid, 'Sem pagamento'],
            [onlyPartial, setOnlyPartial, 'Pagamento parcial']
          ].map(([checked, setter, label]: any) => (
            <label key={label} className={`cursor-pointer rounded-full border px-3 py-1.5 ${checked ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white'}`}>
              <input type="checkbox" checked={checked} onChange={(event) => setter(event.target.checked)} className="sr-only" />{label}
            </label>
          ))}
          <select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
            <option value="all">Todos os métodos</option><option value="pix">Pix</option><option value="card">Cartão</option><option value="cash">Dinheiro</option><option value="boleto">Boleto</option><option value="transfer">Transferência</option>
          </select>
        </div>
      </div>

      {activeView === 'appointments' && (
        <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
          <div className="hidden grid-cols-[150px_minmax(170px,1.2fr)_minmax(130px,1fr)_minmax(130px,1fr)_110px_110px_110px_130px_80px] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-[11px] font-medium text-slate-500 xl:grid">
            <span>Sessão</span><span>Paciente / serviço</span><span>Profissional</span><span>Valores</span><span>Vencimento</span><span>Status</span><span>Método</span><span>Saldo</span><span>Ações</span>
          </div>
          <div className="divide-y divide-slate-100">
            {filteredAppointments.map((row: any) => (
              <div key={row.appointmentId} className="grid gap-3 px-4 py-4 text-sm xl:grid-cols-[150px_minmax(170px,1.2fr)_minmax(130px,1fr)_minmax(130px,1fr)_110px_110px_110px_130px_80px] xl:items-center">
                <div><p className="font-medium text-slate-800">{row.appointmentDateLabel}</p><p className="mt-1 text-xs text-slate-400">{row.clinicalStatus}</p></div>
                <div><p className="font-medium text-slate-900">{row.patientName}</p><p className="mt-1 text-xs text-slate-500">{row.serviceType}</p></div>
                <p className="text-slate-600">{row.professionalName}</p>
                <div className="text-xs text-slate-500"><p>Cobrado: <span className="text-slate-800">{currency(row.total)}</span></p><p>Pago: <span className="text-emerald-700">{currency(row.paid)}</span></p></div>
                <p className="text-slate-600">{row.dueDateLabel}</p>
                <StatusBadge status={row.status} />
                <p className="text-slate-600">{methodLabel(row.method)}</p>
                <p className={`font-semibold ${row.balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{currency(row.balance)}</p>
                <div className="relative group">
                  <button type="button" className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:border-violet-200 hover:text-violet-600" aria-label="Ações financeiras"><ChevronDown size={16} /></button>
                  <div className="invisible absolute right-0 top-9 z-20 w-52 rounded-xl border border-slate-100 bg-white p-1.5 opacity-0 shadow-xl transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                    {!row.chargeId ? <button onClick={() => openOperation('charge', row)} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50">Criar cobrança</button> : null}
                    {row.chargeId && row.balance > 0 ? <button onClick={() => openOperation('payment', row)} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50">Registrar pagamento</button> : null}
                    {row.chargeId && row.balance > 0 ? <button onClick={() => openOperation('partial_payment', row)} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50">Pagamento parcial</button> : null}
                    {row.chargeId ? <button onClick={() => openOperation('discount', row)} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50">Aplicar desconto</button> : null}
                    {row.chargeId && row.balance > 0 ? <button onClick={() => openOperation('courtesy', row)} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50">Marcar como cortesia</button> : null}
                    {row.chargeId && row.paid > 0 ? <button onClick={() => openOperation('receipt', row)} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50">Emitir recibo</button> : null}
                    {row.chargeId && row.paid > 0 ? <button onClick={() => openOperation('refund', row)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-rose-600 hover:bg-rose-50">Estornar</button> : null}
                    {row.chargeId && row.balance > 0 ? <button onClick={() => openOperation('due_date', row)} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50">Alterar vencimento</button> : null}
                    {row.chargeId && row.balance > 0 ? <button disabled={Boolean(sendingReminderChargeId)} onClick={() => sendChargeReminder(row.chargeId)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50 disabled:opacity-50">{sendingReminderChargeId === row.chargeId ? <Loader2 size={13} className="animate-spin" /> : <Bell size={13} />} Enviar lembrete</button> : null}
                    {row.chargeId && row.paid <= 0 && !['canceled', 'refunded'].includes(row.status) ? <button onClick={() => openOperation('cancel', row)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-rose-600 hover:bg-rose-50">Cancelar cobrança</button> : null}
                    {row.chargeId ? <button onClick={() => setExpandedChargeId(row.chargeId)} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50">Ver composição e histórico</button> : null}
                  </div>
                </div>
              </div>
            ))}
            {!filteredAppointments.length && <p className="p-6 text-sm text-slate-500">Nenhuma sessão corresponde aos filtros selecionados.</p>}
          </div>
        </div>
      )}

      {(activeView === 'charges' || activeView === 'pending') && (
        <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
          <div className="hidden grid-cols-[minmax(180px,1.2fr)_minmax(180px,1.3fr)_minmax(180px,1.2fr)_115px_120px_120px_80px] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-[11px] font-medium text-slate-500 xl:grid">
            <span>Paciente / origem</span><span>Composição</span><span>Valores</span><span>Vencimento</span><span>Status</span><span>Saldo</span><span>Ações</span>
          </div>
          <div className="divide-y divide-slate-100">
            {visibleChargeRows.map((charge: any) => {
              const services = Array.from(new Set(charge.items.map((item: any) => String(item.service_type_snapshot || 'Sessão'))));
              const origin = charge.items.length
                ? `${charge.items.length} sessão${charge.items.length === 1 ? '' : 's'} vinculada${charge.items.length === 1 ? '' : 's'}`
                : charge.competenceMonth
                  ? `Competência ${formatDisplayDate(charge.competenceMonth)}`
                  : 'Lançamento legado';
              return <div key={charge.id} className="grid gap-3 px-4 py-4 text-sm xl:grid-cols-[minmax(180px,1.2fr)_minmax(180px,1.3fr)_minmax(180px,1.2fr)_115px_120px_120px_80px] xl:items-center">
                <div><p className="font-medium text-slate-900">{charge.patientName}</p><p className="mt-1 text-xs text-slate-500">{origin}</p></div>
                <div><p className="text-slate-700">{services.join(', ') || 'Sem sessão vinculada'}</p><p className="mt-1 text-xs text-slate-400">{charge.items.length ? charge.items.map((item: any) => formatDisplayDateTime(item.appointment_scheduled_at, { separator: ', ' })).join(' · ') : 'Histórico preservado sem associação inferida'}</p></div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500"><span>Original</span><span className="text-right text-slate-800">{currency(charge.original)}</span><span>Desconto</span><span className="text-right">{currency(charge.discount)}</span><span>Pago</span><span className="text-right text-emerald-700">{currency(charge.paid)}</span></div>
                <p className="text-slate-600">{charge.dueDateLabel}</p>
                <StatusBadge status={charge.status} />
                <p className={`font-semibold ${charge.balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{currency(charge.balance)}</p>
                <div className="relative group">
                  <button type="button" className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:border-violet-200 hover:text-violet-600" aria-label="Ações da cobrança"><ChevronDown size={16} /></button>
                  <div className="invisible absolute right-0 top-9 z-20 w-52 rounded-xl border border-slate-100 bg-white p-1.5 opacity-0 shadow-xl transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                    {charge.balance > 0 && !['canceled', 'refunded'].includes(charge.status) && <button onClick={() => openOperation('payment', charge)} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50">Registrar pagamento</button>}
                    {charge.balance > 0 && !['canceled', 'refunded'].includes(charge.status) && <button onClick={() => openOperation('partial_payment', charge)} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50">Pagamento parcial</button>}
                    {charge.balance > 0 && !['canceled', 'refunded'].includes(charge.status) && <button onClick={() => openOperation('discount', charge)} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50">Aplicar desconto</button>}
                    {charge.balance > 0 && !['canceled', 'refunded'].includes(charge.status) && <button onClick={() => openOperation('courtesy', charge)} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50">Marcar como cortesia</button>}
                    {charge.paid > 0 && <button onClick={() => openOperation('receipt', charge)} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50">Emitir recibo</button>}
                    {charge.paid > 0 && <button onClick={() => openOperation('refund', charge)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-rose-600 hover:bg-rose-50">Estornar</button>}
                    {charge.balance > 0 && <button onClick={() => openOperation('due_date', charge)} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50">Alterar vencimento</button>}
                    {charge.balance > 0 && <button disabled={Boolean(sendingReminderChargeId)} onClick={() => sendChargeReminder(charge.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50 disabled:opacity-50">{sendingReminderChargeId === charge.id ? <Loader2 size={13} className="animate-spin" /> : <Bell size={13} />} Enviar lembrete</button>}
                    {charge.paid <= 0 && !['canceled', 'refunded'].includes(charge.status) && <button onClick={() => openOperation('cancel', charge)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-rose-600 hover:bg-rose-50">Cancelar cobrança</button>}
                    <button onClick={() => setExpandedChargeId(charge.id)} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50">Ver composição e histórico</button>
                  </div>
                </div>
              </div>;
            })}
            {!visibleChargeRows.length && <p className="p-6 text-sm text-slate-500">Nenhuma cobrança corresponde aos filtros selecionados.</p>}
          </div>
        </div>
      )}

      {activeView === 'receipts' && (
        <div className="grid gap-3 lg:grid-cols-2">
          {receiptTransactions.map((transaction: any) => {
            const charge = chargesById.get(String(transaction.payment_id || transaction.paymentId));
            return <div key={transaction.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-slate-900">{charge?.patientName || 'Paciente'}</p><p className="mt-1 text-xs text-slate-500">{patientFinancialTransactionLabel(transaction)} · {formatDisplayDateTime(transaction.transaction_at, { separator: ', ' })}</p></div><p className={String(transaction.transaction_type).toUpperCase() === 'REFUND' ? 'font-semibold text-rose-600' : 'font-semibold text-emerald-600'}>{currency(transaction.amount)}</p></div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500"><span>{methodLabel(transaction.method)}</span><span>•</span><span>{charge?.items?.length || 0} sessão(s)</span><span>•</span><span>{transaction.proof_url ? 'Comprovante anexado' : 'Comprovante pendente'}</span></div>
              <div className="mt-3 flex flex-wrap gap-2">{transaction.proof_url && <a href={transaction.proof_url} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:border-violet-200 hover:text-violet-700">Abrir comprovante</a>}{charge?.paid > 0 && !transaction.receipt_url && <button type="button" onClick={() => openOperation('receipt', charge)} className="rounded-lg border border-violet-200 px-3 py-1.5 text-xs text-violet-700 hover:bg-violet-50">Emitir recibo</button>}{transaction.receipt_url && <a href={transaction.receipt_url} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50">Abrir recibo</a>}</div>
            </div>;
          })}
          {!receiptTransactions.length && <p className="rounded-2xl border border-slate-100 bg-white p-5 text-sm text-slate-500">Nenhum recebimento confirmado no período.</p>}
        </div>
      )}

      {activeView === 'documents' && (
        <div className="grid gap-3 lg:grid-cols-2">
          {documentTransactions.map((transaction: any) => {
            const charge = chargesById.get(String(transaction.payment_id || transaction.paymentId));
            const hasReceipt = Boolean(transaction.receipt_url || transaction.receipt_number);
            return <div key={transaction.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-slate-900">{charge?.patientName || 'Paciente'}</p><p className="mt-1 text-xs text-slate-500">Pagamento de {currency(transaction.amount)} · {formatDisplayDate(transaction.transaction_at)}</p></div><FileCheck2 size={18} className={hasReceipt ? 'text-emerald-600' : 'text-amber-500'} /></div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><span className="rounded-lg bg-slate-50 p-2">{documentStatusLabel(transaction.document_status)}</span><span className="rounded-lg bg-slate-50 p-2">Recibo: {hasReceipt ? 'emitido' : 'pendente'}</span></div>
              <div className="mt-3 flex flex-wrap gap-2">{transaction.proof_url && <a href={transaction.proof_url} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:border-violet-200 hover:text-violet-700">Visualizar comprovante</a>}{transaction.receipt_url && <a href={transaction.receipt_url} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50">Visualizar recibo</a>}{!hasReceipt && charge?.paid > 0 && <button type="button" onClick={() => openOperation('receipt', charge)} className="rounded-lg border border-violet-200 px-3 py-1.5 text-xs text-violet-700 hover:bg-violet-50">Emitir recibo</button>}</div>
            </div>;
          })}
          {!documentTransactions.length && <p className="rounded-2xl border border-slate-100 bg-white p-5 text-sm text-slate-500">Nenhum recibo ou comprovante vinculado a pagamento.</p>}
        </div>
      )}

      {expandedChargeId && chargesById.get(expandedChargeId) && (() => {
        const charge: any = chargesById.get(expandedChargeId);
        return <div className="rounded-3xl border border-violet-100 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4"><div><h4 className="font-semibold text-slate-900">Composição e histórico</h4><p className="mt-1 text-sm text-slate-500">{charge.patientName} · vencimento {charge.dueDateLabel}</p></div><button onClick={() => setExpandedChargeId('')} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50"><X size={18} /></button></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-5">
            {[['Original', charge.original], ['Adicional', charge.additional], ['Desconto', charge.discount], ['Pago', charge.paid], ['Saldo', charge.balance]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-900">{currency(value)}</p></div>)}
          </div>
          {charge.snapshot && <div className="mt-4 grid gap-3 rounded-2xl border border-violet-100 bg-violet-50/50 p-4 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
            <div><p className="text-slate-400">Origem congelada</p><p className="mt-1 font-medium text-slate-800">{charge.priceSourceLabel || charge.priceSource}</p></div>
            <div><p className="text-slate-400">Pagador</p><p className="mt-1 font-medium text-slate-800">{charge.payerName || 'Paciente/responsável'}</p></div>
            <div><p className="text-slate-400">Cancelamento gratuito até</p><p className="mt-1 font-medium text-slate-800">{formatDisplayDateTime(charge.snapshot.cancellation_free_until, { separator: ', ' })}</p></div>
            <div><p className="text-slate-400">Snapshot</p><p className="mt-1 font-medium text-slate-800">versão {charge.snapshot.snapshot_version} · {charge.snapshot.snapshot_event}</p></div>
          </div>}
          <div className="mt-4 grid gap-4 lg:grid-cols-2"><div><p className="text-xs font-medium text-slate-500">Sessões incluídas</p><div className="mt-2 space-y-2">{charge.items.map((item: any) => <div key={item.id} className="rounded-xl border border-slate-100 p-3 text-sm"><p className="font-medium text-slate-800">{item.service_type_snapshot || 'Sessão'}</p><p className="mt-1 text-xs text-slate-500">{formatDisplayDateTime(item.appointment_scheduled_at, { separator: ', ' })} · {currency(item.subtotal)}</p></div>)}{!charge.items.length && <p className="rounded-xl border border-slate-100 p-3 text-sm text-slate-500">Cobrança por competência, sem sessão específica vinculada.</p>}</div></div><div><p className="text-xs font-medium text-slate-500">Trilha financeira</p><div className="mt-2 space-y-2">{charge.events.map((event: any) => <div key={event.id} className="rounded-xl border border-slate-100 p-3 text-sm"><p className="font-medium text-slate-800">{auditEventLabel(event.event_type)}</p><p className="mt-1 text-xs text-slate-500">{formatDisplayDateTime(event.created_at, { separator: ', ' })} · {auditActorLabel(event.created_by)}{event.notes ? ` · ${event.notes}` : ''}</p></div>)}{!charge.events.length && <p className="rounded-xl border border-slate-100 p-3 text-sm text-slate-500">Nenhum evento auditável registrado.</p>}</div></div></div>
        </div>;
      })()}

      <details className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer list-none"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">Política de recebíveis e cancelamento</p><p className="mt-1 text-xs text-slate-500">O padrão manual preserva o comportamento atual. Nenhum plano vira pagamento automaticamente.</p></div><ShieldCheck size={18} className="text-violet-600" /></div></summary>
        {policy && <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs text-slate-500">Recebível efetivo em<select disabled={!canManagePolicy} value={policy.receivable_trigger || 'MANUAL'} onChange={(event) => setPolicy({ ...policy, receivable_trigger: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm text-slate-700"><option value="MANUAL">Ação manual</option><option value="SCHEDULED">Ao agendar</option><option value="CONFIRMED">Ao confirmar</option><option value="STARTED">Ao iniciar</option><option value="COMPLETED">Ao concluir</option></select></label>
          <label className="text-xs text-slate-500">Cancelamento<select disabled={!canManagePolicy} value={policy.cancellation_policy || 'NO_CHARGE'} onChange={(event) => setPolicy({ ...policy, cancellation_policy: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm text-slate-700"><option value="NO_CHARGE">Sem cobrança</option><option value="FULL_CHARGE">Cobrança integral</option><option value="PARTIAL_CHARGE">Cobrança parcial</option></select></label>
          <label className="text-xs text-slate-500">Percentual na cobrança parcial<input disabled={!canManagePolicy} type="number" min="0" max="100" value={policy.cancellation_percentage || 0} onChange={(event) => setPolicy({ ...policy, cancellation_percentage: Number(event.target.value) })} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm text-slate-700" /></label>
          <label className="text-xs text-slate-500">Tolerância em horas<input disabled={!canManagePolicy} type="number" min="0" max="720" value={policy.cancellation_tolerance_hours || 0} onChange={(event) => setPolicy({ ...policy, cancellation_tolerance_hours: Number(event.target.value) })} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm text-slate-700" /></label>
          <label className="flex items-start gap-3 rounded-xl border border-slate-100 p-3 text-sm text-slate-600"><input disabled={!canManagePolicy} type="checkbox" checked={policy.create_forecast_on_schedule !== false} onChange={(event) => setPolicy({ ...policy, create_forecast_on_schedule: event.target.checked })} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600" /><span>Criar previsão ao agendar<span className="mt-1 block text-xs text-slate-400">Resolve acordo, serviço, especialidade ou padrão da clínica e não registra pagamento.</span></span></label>
          <label className="flex items-start gap-3 rounded-xl border border-slate-100 p-3 text-sm text-slate-600"><input disabled={!canManagePolicy} type="checkbox" checked={Boolean(policy.charge_no_show)} onChange={(event) => setPolicy({ ...policy, charge_no_show: event.target.checked })} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600" /><span>Cobrar falta<span className="mt-1 block text-xs text-slate-400">Efetiva a cobrança prevista quando a sessão vira falta.</span></span></label>
          <label className="flex items-start gap-3 rounded-xl border border-slate-100 p-3 text-sm text-slate-600"><input disabled={!canManagePolicy} type="checkbox" checked={policy.reschedule_keeps_charge !== false} onChange={(event) => setPolicy({ ...policy, reschedule_keeps_charge: event.target.checked })} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600" /><span>Remarcação mantém a cobrança<span className="mt-1 block text-xs text-slate-400">Preserva a mesma obrigação financeira quando apenas o horário muda.</span></span></label>
          {canManagePolicy && <button type="button" disabled={policySaving} onClick={savePolicy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">{policySaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Salvar política</button>}
        </div>}
      </details>

      {operation && <div className="fixed inset-0 z-[170] flex items-start justify-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-sm sm:items-center" onMouseDown={(event) => { if (event.target === event.currentTarget) closeOperation(); }}>
        <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4"><div><h3 className="text-lg font-semibold text-slate-900">{operationLabels[operation]}</h3><p className="mt-1 text-sm text-slate-500">{operationDescriptions[operation]}</p></div><button onClick={closeOperation} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50"><X size={19} /></button></div>
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(['charge', 'payment', 'partial_payment', 'discount', 'courtesy', 'refund'] as FinanceOperation[]).map((item) => <button key={item} type="button" onClick={() => openOperation(item)} className={`rounded-xl border p-3 text-left transition ${operation === item ? 'border-violet-400 bg-violet-50 text-violet-800' : 'border-slate-200 text-slate-600 hover:border-violet-200'}`}><span className="text-sm font-medium">{operationLabels[item]}</span></button>)}
            </div>

            <label className="block text-sm text-slate-600">Paciente<select value={selectedPatientId} onChange={(event) => { setSelectedPatientId(event.target.value); setSelectedAppointmentIds([]); setSelectedChargeId(''); }} disabled={Boolean(selectedChargeId)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"><option value="">Selecione o paciente</option>{patients.map((patient: any) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></label>

            {['charge', 'payment'].includes(operation) && !selectedChargeId && <div className="space-y-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={manualCompetence}
                  onChange={(event) => {
                    setManualCompetence(event.target.checked);
                    if (event.target.checked) setSelectedAppointmentIds([]);
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600"
                />
                <span>
                  Lançamento por competência
                  <span className="mt-1 block text-xs text-slate-400">Use somente para uma cobrança mensal ou agrupada que não possa ser ligada a sessões específicas.</span>
                </span>
              </label>
              {!manualCompetence ? <>
                <div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-800">Sessões</p><span className="text-xs text-slate-400">Selecione uma ou várias</span></div>
                <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-slate-100 p-2">{operationAppointments.map((row: any) => { const disabled = Boolean(row.chargeId); const selected = selectedAppointmentIds.includes(row.appointmentId); return <label key={row.appointmentId} className={`flex items-start gap-3 rounded-lg p-3 ${disabled ? 'cursor-not-allowed bg-slate-50 opacity-60' : 'cursor-pointer hover:bg-slate-50'}`}><input type="checkbox" disabled={disabled} checked={selected} onChange={(event) => setSelectedAppointmentIds((current) => event.target.checked ? [...current, row.appointmentId] : current.filter((id) => id !== row.appointmentId))} className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600" /><span className="min-w-0"><span className="block text-sm font-medium text-slate-800">{row.appointmentDateLabel} · {row.serviceType}</span><span className="mt-1 block text-xs text-slate-500">{row.professionalName}{disabled ? ` · ${row.statusLabel}` : ''}</span></span></label>; })}{selectedPatientId && !operationAppointments.length && <p className="p-3 text-sm text-slate-500">Nenhuma sessão particular encontrada para este paciente no intervalo carregado.</p>}</div>
              </> : <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-4 text-sm text-violet-800">Competência: {formatDisplayDate(`${month}-01`)}. O lançamento ficará identificado como mensal e não será apresentado como pagamento de uma sessão específica.</div>}
            </div>}

            {operation !== 'charge' && operationCharges.length > 0 && <label className="block text-sm text-slate-600">Cobrança existente<select value={selectedChargeId} onChange={(event) => { const next = chargesById.get(event.target.value); setSelectedChargeId(event.target.value); if (next) { setSelectedPatientId(next.patientId); setAmount(moneyInput(operation === 'refund' ? next.paidGross : next.balance)); setDueDate(String(next.dueDate || '').slice(0, 10)); } }} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"><option value="">Selecione a cobrança</option>{operationCharges.map((charge: any) => <option key={charge.id} value={charge.id}>{charge.patientName} · {charge.dueDateLabel} · saldo {currency(charge.balance)}</option>)}</select></label>}

            {selectedCharge && <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-4">{[['Total', selectedCharge.total], ['Pago', selectedCharge.paid], ['Estornado', selectedCharge.refunded], ['Saldo', selectedCharge.balance]].map(([label, value]) => <div key={String(label)}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-900">{currency(value)}</p></div>)}</div>}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {!['courtesy', 'receipt', 'due_date', 'cancel'].includes(operation) && <label className="text-sm text-slate-600">Valor (R$)<input value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.,]/g, ''))} onBlur={() => setAmount(moneyInput(parseMoney(amount)))} inputMode="decimal" className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm" placeholder="0,00" /></label>}
              {operation === 'charge' && <><label className="text-sm text-slate-600">Adicional (R$)<input value={additionalAmount} onChange={(event) => setAdditionalAmount(event.target.value.replace(/[^\d.,]/g, ''))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm" placeholder="0,00" /></label><label className="text-sm text-slate-600">Desconto inicial (R$)<input value={discountAmount} onChange={(event) => setDiscountAmount(event.target.value.replace(/[^\d.,]/g, ''))} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm" placeholder="0,00" /></label></>}
              {['charge', 'due_date'].includes(operation) && <label className="text-sm text-slate-600">Vencimento<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm" /></label>}
              {['charge', 'payment', 'partial_payment', 'refund'].includes(operation) && <label className="text-sm text-slate-600">Forma de pagamento<select value={method} onChange={(event) => setMethod(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"><option value="pix">Pix</option><option value="card">Cartão</option><option value="cash">Dinheiro</option><option value="boleto">Boleto</option><option value="transfer">Transferência</option></select></label>}
            </div>

            {operation === 'charge' && selectedAppointmentIds.length > 0 && <div className="rounded-xl border border-slate-100 p-4"><p className="text-sm font-medium text-slate-800">Composição</p><div className="mt-2 space-y-2 text-sm text-slate-600">{selectedAppointments.map((row: any) => <div key={row.appointmentId} className="flex justify-between gap-4"><span>{row.appointmentDateLabel} · {row.serviceType}</span><span>{currency(selectedTotal / Math.max(selectedAppointmentIds.length, 1))}</span></div>)}<div className="flex justify-between border-t border-slate-100 pt-2 font-medium text-slate-900"><span>Total</span><span>{currency(selectedTotal + selectedAdditional - selectedDiscount)}</span></div></div></div>}

            {['payment', 'partial_payment'].includes(operation) && <label className="block text-sm text-slate-600">Comprovante<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="mt-1 block w-full rounded-xl border border-dashed border-slate-200 p-3 text-sm" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setOperationError(''); try { setProof(await readFinanceDocument(file)); } catch (error: any) { setProof(null); setOperationError(error?.message || 'Comprovante inválido.'); event.target.value = ''; } }} />{proof && <span className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-700"><Paperclip size={13} /> {proof.name}</span>}</label>}
            <label className="block text-sm text-slate-600">Observação / motivo{['discount', 'courtesy', 'refund', 'cancel'].includes(operation) && <span className="text-rose-500"> *</span>}<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-1 w-full resize-none rounded-xl border border-slate-200 p-3 text-sm" placeholder="Registre o contexto desta operação" /></label>
            {operationError && <div className="flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700"><AlertCircle size={17} className="mt-0.5" />{operationError}</div>}
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-white p-4"><button type="button" disabled={saving} onClick={closeOperation} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600">Cancelar</button><button type="button" disabled={saving} onClick={submitOperation} className="inline-flex min-w-40 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">{saving ? <><Loader2 size={16} className="animate-spin" /> Salvando...</> : operationLabels[operation]}</button></div>
        </div>
      </div>}
    </div>
  );
}
