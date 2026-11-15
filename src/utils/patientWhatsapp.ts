// Patient phone numbers remain stored as entered; normalize only when opening WhatsApp.
const isBrazilianNumberWithAreaCode = (digits: string): boolean =>
  /^[1-9][1-9]\d{8,9}$/.test(digits);

export const getPatientWhatsAppUrl = (phone: unknown): string | null => {
  if (typeof phone !== 'string') return null;
  const raw = phone.trim();
  if (!raw || !/^\+?[\d\s().-]+$/.test(raw)) return null;

  const digits = raw.replace(/\D/g, '');
  let internationalNumber: string;

  if (raw.startsWith('+')) {
    // Never reinterpret an explicitly international number as a Brazilian DDD.
    if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
    if (digits.startsWith('55') && !isBrazilianNumberWithAreaCode(digits.slice(2))) return null;
    internationalNumber = digits;
  } else if (isBrazilianNumberWithAreaCode(digits)) {
    // DDD 55 is valid: use length, not startsWith('55'), to distinguish it from country 55.
    internationalNumber = '55' + digits;
  } else if (digits.startsWith('55') && isBrazilianNumberWithAreaCode(digits.slice(2))) {
    internationalNumber = digits;
  } else if (digits.startsWith('0') && isBrazilianNumberWithAreaCode(digits.slice(1))) {
    // Accept a domestic trunk prefix, but do not infer a missing DDD.
    internationalNumber = '55' + digits.slice(1);
  } else {
    return null;
  }

  return 'https://wa.me/' + internationalNumber;
};
