export type AppointmentFinancialContextType =
  | "INSURANCE"
  | "PRIVATE"
  | "PACKAGE"
  | "COURTESY"
  | "NO_CHARGE"
  | "NOT_BILLABLE";

export const APPOINTMENT_FINANCIAL_CONTEXT_REQUIRED_MESSAGE =
  "Defina o contexto financeiro do atendimento: convênio, particular, pacote, cortesia, sem cobrança ou não faturável.";

export const APPOINTMENT_FINANCIAL_CONTEXT_OPTIONS: Array<{
  value: AppointmentFinancialContextType;
  label: string;
  description: string;
}> = [
  {
    value: "INSURANCE",
    label: "Convênio",
    description: "Exige pagador/convênio cadastrado para pré-faturamento.",
  },
  {
    value: "PRIVATE",
    label: "Particular",
    description: "Atendimento particular, sem pagador de convênio.",
  },
  {
    value: "PACKAGE",
    label: "Pacote/mensalidade",
    description: "Cobrança vinculada a pacote ou mensalidade.",
  },
  {
    value: "COURTESY",
    label: "Cortesia",
    description: "Atendimento sem cobrança por cortesia.",
  },
  {
    value: "NO_CHARGE",
    label: "Sem cobrança",
    description: "Não entra no fluxo de cobrança.",
  },
  {
    value: "NOT_BILLABLE",
    label: "Não faturável",
    description: "Fica fora da resolução TUSS e de faturamento.",
  },
];

export const NON_INSURANCE_APPOINTMENT_FINANCIAL_CONTEXT_OPTIONS =
  APPOINTMENT_FINANCIAL_CONTEXT_OPTIONS.filter((option) => option.value !== "INSURANCE");

export const normalizeAppointmentFinancialContextType = (
  value: any,
): AppointmentFinancialContextType | "" => {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const aliases: Record<string, AppointmentFinancialContextType> = {
    CONVENIO: "INSURANCE",
    CONVENIO_PAGADOR: "INSURANCE",
    INSURANCE: "INSURANCE",
    PRIVATE: "PRIVATE",
    PARTICULAR: "PRIVATE",
    PACKAGE: "PACKAGE",
    PACOTE: "PACKAGE",
    PACOTE_MENSALIDADE: "PACKAGE",
    MONTHLY: "PACKAGE",
    MENSALIDADE: "PACKAGE",
    COURTESY: "COURTESY",
    CORTESIA: "COURTESY",
    NO_CHARGE: "NO_CHARGE",
    SEM_COBRANCA: "NO_CHARGE",
    NOT_BILLABLE: "NOT_BILLABLE",
    NAO_FATURAVEL: "NOT_BILLABLE",
    NAO_FATURAVEL_: "NOT_BILLABLE",
  };
  return aliases[normalized] || "";
};

export const appointmentFinancialContextRequiresPayer = (value: any) =>
  normalizeAppointmentFinancialContextType(value) === "INSURANCE";

export const appointmentFinancialContextSkipsInsurance = (value: any) => {
  const normalized = normalizeAppointmentFinancialContextType(value);
  return Boolean(normalized && normalized !== "INSURANCE");
};

export const getAppointmentFinancialContextLabel = (value: any) => {
  const normalized = normalizeAppointmentFinancialContextType(value);
  return APPOINTMENT_FINANCIAL_CONTEXT_OPTIONS.find((option) => option.value === normalized)?.label || "";
};
