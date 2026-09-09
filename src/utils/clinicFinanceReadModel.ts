import {
  PATIENT_FINANCIAL_SERVICE_OPTIONS,
  normalizePatientFinancialServiceType,
} from './patientFinancialPlan';

const normalizeLookup = (value: any) =>
  String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const financialServiceByValue = new Map(
  PATIENT_FINANCIAL_SERVICE_OPTIONS.map((option) => [String(option.value), option.label]),
);
const financialServiceByLabel = new Map(
  PATIENT_FINANCIAL_SERVICE_OPTIONS.map((option) => [normalizeLookup(option.label), option.label]),
);

/**
 * Accepts only the financial service taxonomy. Unknown professional titles/roles
 * intentionally return null instead of creating artificial chart categories.
 */
export function normalizeFinancialSpecialtyLabel(value: any): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const exactValue = financialServiceByValue.get(raw.toUpperCase());
  if (exactValue) return exactValue;
  const exactLabel = financialServiceByLabel.get(normalizeLookup(raw));
  if (exactLabel) return exactLabel;

  const normalizedType = normalizePatientFinancialServiceType(raw);
  if (!normalizedType || normalizedType === 'CUSTOM') return null;
  return financialServiceByValue.get(normalizedType) || null;
}

export type ClinicExpenseSemanticStatus = 'pending' | 'overdue' | 'paid' | 'canceled';

export function resolveClinicExpenseSemanticStatus(
  entry: any,
  todayIso = new Date().toISOString().slice(0, 10),
): ClinicExpenseSemanticStatus {
  const raw = String(entry?.status || '').trim().toLowerCase();
  if (['canceled', 'cancelled', 'cancelado'].includes(raw)) return 'canceled';
  if (['paid', 'pago', 'realizado'].includes(raw)) return 'paid';
  const dueDate = String(entry?.due_date || entry?.dueDate || entry?.occurred_on || entry?.occurredOn || '')
    .slice(0, 10);
  if (dueDate && dueDate < todayIso) return 'overdue';
  return 'pending';
}

export function clinicExpenseCompetenceKey(entry: any): string {
  return String(
    entry?.competence_month ||
      entry?.competenceMonth ||
      entry?.due_date ||
      entry?.dueDate ||
      entry?.occurred_on ||
      entry?.occurredOn ||
      '',
  ).slice(0, 7);
}

export function clinicExpenseCashMonthKey(entry: any): string {
  return String(entry?.paid_on || entry?.paidOn || entry?.occurred_on || entry?.occurredOn || '').slice(0, 7);
}

export function clinicExpenseExpectedAmount(entry: any): number {
  const value = Number(entry?.expected_amount ?? entry?.expectedAmount ?? entry?.amount ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function clinicExpenseActualAmount(entry: any): number {
  const value = Number(entry?.amount ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function buildFinancialSpecialtySeriesRow(input: {
  name: string;
  revenue: number;
  professionalTransfers: number;
  allocatedExpenses: number;
}) {
  const revenue = Math.max(0, Number(input.revenue) || 0);
  const professionalTransfers = Math.max(0, Number(input.professionalTransfers) || 0);
  const allocatedExpenses = Math.max(0, Number(input.allocatedExpenses) || 0);
  const result = revenue - professionalTransfers - allocatedExpenses;
  return {
    name: input.name,
    Receita: revenue,
    Repasses: -professionalTransfers,
    'Despesas alocadas': -allocatedExpenses,
    Resultado: result,
    'Margem %': revenue > 0 ? (result / revenue) * 100 : 0,
  };
}
