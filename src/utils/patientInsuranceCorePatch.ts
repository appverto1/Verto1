/**
 * Preserve canonical TISS data in storage while omitting unchanged operational
 * insurance fields from a generic patient/financial save. The server remains
 * the authority: explicit TISS changes still require patient.insurance.edit.
 */
export const PATIENT_TISS_OPERATIONAL_PATCH_KEYS = [
  'insuranceCardNumber', 'insurance_card_number', 'cardNumber', 'convenioCarteirinha',
  'insuranceCardValidUntil', 'insurance_card_valid_until', 'convenioCarteirinhaValidade',
  'insurancePlanCategory', 'insurance_plan_category', 'convenioPlanoCategoria',
  'insuranceHolderName', 'insurance_holder_name', 'convenioTitularNome',
  'insuranceHolderCpf', 'insurance_holder_cpf', 'convenioTitularCpf',
  'insuranceHolderRelationship', 'insurance_holder_relationship', 'convenioTitularRelacao',
  'insuranceEligibilityNotes', 'eligibilityNotes', 'eligibility_notes', 'convenioElegibilidadeObs',
] as const;

const protectedKeys = new Set<string>(PATIENT_TISS_OPERATIONAL_PATCH_KEYS);

export const hasExplicitPatientTissOperationalPatch = (value: unknown): boolean =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    PATIENT_TISS_OPERATIONAL_PATCH_KEYS.some(key => Object.prototype.hasOwnProperty.call(value, key)));

/** Strip only unintended TISS echoes from the generic record patch (max two levels). */
export const omitImplicitPatientTissOperationalFields = (value: any): any => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result: Record<string, any> = { ...value };
  for (const key of protectedKeys) delete result[key];
  for (const nestedKey of ['anamnese', 'anamnesisData', 'anamnesis_data']) {
    const nested = result[nestedKey];
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
    result[nestedKey] = { ...nested };
    for (const key of protectedKeys) delete result[nestedKey][key];
  }
  return result;
};
