export const APPOINTMENT_CONFIRMATION_CANONICAL_KEYS = [
  'patient_confirmation_status',
  'patientConfirmationStatus',
  'patient_response',
  'patientResponse',
  'patient_responded_at',
  'patientRespondedAt',
  'patient_confirmation_at',
  'patientConfirmationAt',
  'patient_confirmation_by',
  'patientConfirmationBy',
  'patient_confirmation_source',
  'patientConfirmationSource',
] as const;

export const hasAnyOwnProperty = (record: any, keys: readonly string[]) =>
  Boolean(
    record &&
      typeof record === 'object' &&
      keys.some((key) => Object.prototype.hasOwnProperty.call(record, key)),
  );

const readFirstOwnValue = (record: any, keys: readonly string[]) => {
  if (!record || typeof record !== 'object') return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }
  return undefined;
};

/**
 * Canonical appointment columns may intentionally contain null after a schedule
 * change. In that case an older source_payload/local snapshot must not restore
 * the previous patient response.
 */
export const readCanonicalNullableValue = (
  primary: any,
  primaryKeys: readonly string[],
  fallback?: any,
  fallbackKeys: readonly string[] = primaryKeys,
  canonicalPresenceKeys: readonly string[] = primaryKeys,
) => {
  if (hasAnyOwnProperty(primary, canonicalPresenceKeys)) {
    return readFirstOwnValue(primary, primaryKeys) ?? null;
  }
  return readFirstOwnValue(fallback, fallbackKeys) ?? null;
};

export const resolveAppointmentConfirmationSnapshot = (primary: any, fallback?: any) => ({
  hasCanonicalState: hasAnyOwnProperty(primary, APPOINTMENT_CONFIRMATION_CANONICAL_KEYS),
  response: readCanonicalNullableValue(
    primary,
    ['patient_response', 'patientResponse'],
    fallback,
    ['patient_response', 'patientResponse'],
    APPOINTMENT_CONFIRMATION_CANONICAL_KEYS,
  ),
  confirmationStatus: readCanonicalNullableValue(
    primary,
    ['patient_confirmation_status', 'patientConfirmationStatus'],
    fallback,
    ['patient_confirmation_status', 'patientConfirmationStatus'],
    APPOINTMENT_CONFIRMATION_CANONICAL_KEYS,
  ),
  respondedAt: readCanonicalNullableValue(
    primary,
    ['patient_responded_at', 'patientRespondedAt'],
    fallback,
    ['patient_responded_at', 'patientRespondedAt'],
    APPOINTMENT_CONFIRMATION_CANONICAL_KEYS,
  ),
  confirmationAt: readCanonicalNullableValue(
    primary,
    ['patient_confirmation_at', 'patientConfirmationAt'],
    fallback,
    ['patient_confirmation_at', 'patientConfirmationAt'],
    APPOINTMENT_CONFIRMATION_CANONICAL_KEYS,
  ),
  source: readCanonicalNullableValue(
    primary,
    ['patient_confirmation_source', 'patientConfirmationSource'],
    fallback,
    ['patient_confirmation_source', 'patientConfirmationSource'],
    APPOINTMENT_CONFIRMATION_CANONICAL_KEYS,
  ),
  label: readCanonicalNullableValue(
    primary,
    ['patient_confirmation_label', 'patientConfirmationLabel'],
    fallback,
    ['patient_confirmation_label', 'patientConfirmationLabel'],
    APPOINTMENT_CONFIRMATION_CANONICAL_KEYS,
  ),
  color: readCanonicalNullableValue(
    primary,
    ['patient_confirmation_color', 'patientConfirmationColor'],
    fallback,
    ['patient_confirmation_color', 'patientConfirmationColor'],
    APPOINTMENT_CONFIRMATION_CANONICAL_KEYS,
  ),
});

export const resolveAppointmentPatientDisplayStatus = (appointment: any, fallback?: any) => {
  const snapshot = resolveAppointmentConfirmationSnapshot(appointment, fallback);
  return snapshot.confirmationStatus ?? snapshot.response ?? appointment?.status ?? fallback?.status ?? 'pending';
};
