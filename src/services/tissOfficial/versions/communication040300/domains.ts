export type TissDomainOption = {
  code: string;
  label: string;
  description?: string;
};

export type PayerAttendanceProfileField040300 =
  | "defaultAttendanceType"
  | "defaultAttendanceRegime"
  | "defaultAttendanceCharacter";

export type PayerAttendanceProfileIssue040300 = {
  field: PayerAttendanceProfileField040300;
  reason: "required" | "unsupported";
  message: string;
};

export const attendanceTypes040300: TissDomainOption[] = [
  { code: "01", label: "Remoção" },
  { code: "02", label: "Pequena cirurgia" },
  { code: "03", label: "Outras terapias" },
  { code: "04", label: "Consulta" },
  { code: "08", label: "Quimioterapia" },
  { code: "09", label: "Radioterapia" },
  { code: "10", label: "Terapia renal substitutiva" },
  { code: "13", label: "Pequenos atendimentos" },
  { code: "23", label: "Exame" },
];

export const attendanceRegimes040300: TissDomainOption[] = [
  { code: "01", label: "Ambulatorial" },
  { code: "02", label: "Domiciliar" },
  { code: "03", label: "Internação" },
  { code: "04", label: "Pronto-socorro" },
  { code: "05", label: "Telessaúde" },
];

export const attendanceCharacters040300: TissDomainOption[] = [
  { code: "1", label: "Eletiva" },
  { code: "2", label: "Urgência/Emergência" },
];

export const guideTypes040300: TissDomainOption[] = [
  { code: "sp_sadt", label: "Guia SP/SADT", description: "Tipo de guia implementado para XML oficial neste marco." },
];

const normalizeCode = (value: unknown, size?: number) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return size ? digits.padStart(size, "0").slice(-size) : digits;
};

export function normalizeAttendanceType040300(value: unknown) {
  return normalizeCode(value, 2);
}

export function normalizeAttendanceRegime040300(value: unknown) {
  return normalizeCode(value, 2);
}

export function normalizeAttendanceCharacter040300(value: unknown) {
  return normalizeCode(value, 1);
}

export function isSupportedAttendanceType040300(value: unknown) {
  const normalized = normalizeAttendanceType040300(value);
  return attendanceTypes040300.some((item) => item.code === normalized);
}

export function isSupportedAttendanceRegime040300(value: unknown) {
  const normalized = normalizeAttendanceRegime040300(value);
  return attendanceRegimes040300.some((item) => item.code === normalized);
}

export function isSupportedAttendanceCharacter040300(value: unknown) {
  const normalized = normalizeAttendanceCharacter040300(value);
  return attendanceCharacters040300.some((item) => item.code === normalized);
}

/**
 * Validates the three official SP/SADT attendance defaults as one contract.
 * An incomplete profile may still be persisted as a draft, but it must never
 * be presented as ready for pre-guide/XML generation.
 */
export function validatePayerAttendanceProfile040300(input: {
  defaultAttendanceType?: unknown;
  defaultAttendanceRegime?: unknown;
  defaultAttendanceCharacter?: unknown;
}): PayerAttendanceProfileIssue040300[] {
  const fields = [
    {
      field: "defaultAttendanceType" as const,
      value: normalizeAttendanceType040300(input.defaultAttendanceType),
      supported: isSupportedAttendanceType040300,
      label: "tipo de atendimento",
    },
    {
      field: "defaultAttendanceRegime" as const,
      value: normalizeAttendanceRegime040300(input.defaultAttendanceRegime),
      supported: isSupportedAttendanceRegime040300,
      label: "regime de atendimento",
    },
    {
      field: "defaultAttendanceCharacter" as const,
      value: normalizeAttendanceCharacter040300(input.defaultAttendanceCharacter),
      supported: isSupportedAttendanceCharacter040300,
      label: "caráter de atendimento",
    },
  ];

  const issues: PayerAttendanceProfileIssue040300[] = [];
  for (const { field, value, supported, label } of fields) {
    if (!value) {
      issues.push({
        field,
        reason: "required",
        message: `Selecione o ${label} TISS oficial.`,
      });
      continue;
    }
    if (!supported(value)) {
      issues.push({
        field,
        reason: "unsupported",
        message: `O ${label} informado não é suportado pelo XML TISS 04.03.00.`,
      });
    }
  }
  return issues;
}
