import {
  SALES_OPERATION_TYPES,
  type SalesOperationType,
} from "../constants/salesCommercial";

export const BRAZILIAN_STATE_CODES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT",
  "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO",
  "RR", "SC", "SP", "SE", "TO",
] as const;

export type SalesLeadPayload = {
  name: string;
  phone: string;
  clinicName?: string;
  email?: string;
  professionalRegistry?: string;
  city?: string;
  state?: string;
  estimatedActivePatients?: number | null;
  estimatedProfessionals?: number | null;
  operationType?: SalesOperationType;
  acquisitionChannel?: string;
  preferredContactPeriod?: string;
  roleTitle?: string;
  notes?: string;
  contactConsent?: boolean;
  website?: string;
};

export type ValidatedSalesLead = {
  value: SalesLeadPayload & { phone: string };
  errors: Record<string, string>;
};

const cleanText = (value: unknown, maxLength: number) =>
  String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

export const normalizeSalesLeadEmail = (value: unknown) =>
  cleanText(value, 254).toLocaleLowerCase("pt-BR");

export const normalizeSalesLeadPhone = (value: unknown) => {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 15);
  if (!digits) return "";
  if (digits.length <= 11) return `+55${digits}`;
  return digits.startsWith("55") ? `+${digits}` : "";
};

export const validateSalesLeadPayload = (
  input: Partial<SalesLeadPayload>,
): ValidatedSalesLead => {
  const name = cleanText(input.name, 180);
  const email = normalizeSalesLeadEmail(input.email);
  const phone = normalizeSalesLeadPhone(input.phone);
  const professionalRegistry = cleanText(input.professionalRegistry, 80);
  const clinicName = cleanText(input.clinicName, 180);
  const city = cleanText(input.city, 120);
  const state = cleanText(input.state, 2).toUpperCase();
  const requestedOperationType = cleanText(
    input.operationType,
    40,
  ) as SalesOperationType;
  const operationType = (
    SALES_OPERATION_TYPES as readonly string[]
  ).includes(requestedOperationType)
    ? requestedOperationType
    : clinicName
      ? "clinic"
      : "independent_professional";
  const hasEstimatedActivePatients =
    input.estimatedActivePatients !== null &&
    input.estimatedActivePatients !== undefined &&
    String(input.estimatedActivePatients).trim() !== "";
  const estimatedActivePatients = hasEstimatedActivePatients
    ? Number(input.estimatedActivePatients)
    : null;
  const hasEstimatedProfessionals =
    input.estimatedProfessionals !== null &&
    input.estimatedProfessionals !== undefined &&
    String(input.estimatedProfessionals).trim() !== "";
  const estimatedProfessionals = hasEstimatedProfessionals
    ? Number(input.estimatedProfessionals)
    : null;
  const errors: Record<string, string> = {};

  if (name.length < 2) errors.name = "Informe seu nome.";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Informe um e-mail válido.";
  }
  const phoneLength = phone.replace(/\D/g, "").length;
  if (phoneLength < 12 || phoneLength > 13) {
    errors.phone = "Informe um WhatsApp com DDD.";
  }
  if (clinicName && clinicName.length < 2) {
    errors.clinicName = "Revise o nome da clínica.";
  }
  if (
    state &&
    !(BRAZILIAN_STATE_CODES as readonly string[]).includes(state)
  ) {
    errors.state = "Selecione um estado válido.";
  }
  if (
    estimatedActivePatients !== null &&
    (!Number.isInteger(estimatedActivePatients) ||
      estimatedActivePatients < 0 ||
      estimatedActivePatients > 100000)
  ) {
    errors.estimatedActivePatients =
      "Informe uma quantidade entre 0 e 100.000.";
  }
  if (
    estimatedProfessionals !== null &&
    (!Number.isInteger(estimatedProfessionals) ||
      estimatedProfessionals < 0 ||
      estimatedProfessionals > 10000)
  ) {
    errors.estimatedProfessionals =
      "Informe uma quantidade entre 0 e 10.000.";
  }

  return {
    errors,
    value: {
      name,
      email,
      phone,
      professionalRegistry,
      clinicName,
      city,
      state,
      estimatedActivePatients:
        estimatedActivePatients !== null &&
        Number.isFinite(estimatedActivePatients)
          ? estimatedActivePatients
          : null,
      estimatedProfessionals:
        estimatedProfessionals !== null &&
        Number.isFinite(estimatedProfessionals)
          ? estimatedProfessionals
          : null,
      operationType,
      acquisitionChannel: cleanText(input.acquisitionChannel, 120),
      preferredContactPeriod: cleanText(input.preferredContactPeriod, 120),
      roleTitle: cleanText(input.roleTitle, 120),
      notes: cleanText(input.notes, 1500),
      website: cleanText(input.website, 180),
    },
  };
};
