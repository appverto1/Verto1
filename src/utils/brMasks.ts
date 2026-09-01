export type BrazilianDocumentType = "CPF" | "CNPJ" | "OTHER" | string;

export function onlyDigits(value: unknown, maxLength?: number): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return typeof maxLength === "number" ? digits.slice(0, maxLength) : digits;
}

export function maskCpf(value: unknown): string {
  const digits = onlyDigits(value, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function maskCnpj(value: unknown): string {
  const digits = onlyDigits(value, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function maskCpfCnpj(value: unknown): string {
  const digits = onlyDigits(value, 14);
  return digits.length > 11 ? maskCnpj(digits) : maskCpf(digits);
}

export function maskPhoneBR(value: unknown): string {
  const digits = onlyDigits(value, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function maskCep(value: unknown): string {
  const digits = onlyDigits(value, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function formatDocument(value: unknown, documentType?: BrazilianDocumentType): string {
  const type = String(documentType || "").toUpperCase();
  if (type === "CPF") return maskCpf(value);
  if (type === "CNPJ") return maskCnpj(value);
  if (type === "OTHER") {
    return String(value ?? "")
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
      .normalize("NFC")
      .replace(/\s+/g, " ")
      .replace(/[^\p{L}\p{M}\p{N} .,/\\_#:+()\-]/gu, "")
      .trimStart()
      .slice(0, 80);
  }
  return maskCpfCnpj(value);
}

export function parseDocumentForStorage(value: unknown): string {
  return onlyDigits(value, 14);
}

