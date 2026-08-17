import type { CapabilityKey, ClinicBaseRole } from '../constants/authorizationModel';

export type PatientListScopeMode = 'active_clinic' | 'assigned_patients' | 'supervised_cases' | 'assigned_and_supervised' | 'none';

export function resolvePatientListScopeMode(
  roleInput: unknown,
  options: { canSupervise?: boolean } = {},
): PatientListScopeMode {
  const role = String(roleInput ?? '').trim().toLowerCase() as ClinicBaseRole;
  if (role === 'director' || role === 'coordinator' || role === 'receptionist' || role === 'biller') {
    return 'active_clinic';
  }
  if (role === 'therapist') return options.canSupervise === true ? 'assigned_and_supervised' : 'assigned_patients';
  if (role === 'supervisor') return 'assigned_and_supervised';
  return 'none';
}


const BASE_PATIENT_LIST_COLUMNS = [
  'id',
  'name',
  'status',
  'clinic_id',
  'is_demo',
  'patient_profile_type',
  'panel_type',
  'profile_type',
  'profile_picture',
  'profile_picture_path',
  'onboarding_status',
  'relationship_status',
  'is_active',
  'deleted_at',
  'created_at',
  'updated_at',
] as const;

export function patientListColumnsForCapabilities(
  capabilities: ReadonlySet<CapabilityKey>,
): readonly string[] {
  const columns = new Set<string>(BASE_PATIENT_LIST_COLUMNS);
  const add = (...keys: string[]) => keys.forEach((key) => columns.add(key));

  if (capabilities.has('patient.demographics.view')) {
    add('age', 'type', 'social_name', 'birth_date', 'gender', 'patient_group', 'lead_source', 'responsible_birth_date');
  }
  if (capabilities.has('patient.birthdays.view')) add('birth_date');
  if (capabilities.has('patient.contacts.view')) {
    add('email', 'phone', 'responsible_name', 'responsible_phone', 'responsible_email', 'responsible_relationship');
  }
  if (capabilities.has('patient.documents.registration.view')) {
    add('cpf', 'rg', 'cep', 'responsible_cpf');
  }
  if (capabilities.has('patient.insurance.view')) {
    add('insurance_payer_id', 'insurance_type', 'insurance_name', 'insurance_card_number');
  }
  if (capabilities.has('clinical.record.view')) add('diagnosis', 'notes', 'metadata');
  if (capabilities.has('clinical.anamnesis.view')) {
    add('anamnesis_required', 'anamnesis_requested_at', 'anamnesis_submitted_at', 'anamnesis_reviewed_at');
  }
  if (capabilities.has('team.patient_primary.manage')) add('therapist_id');

  return Array.from(columns);
}

export function requiredPatientLinkPermissionForMethod(methodInput: unknown): 'read' | 'write' {
  const method = String(methodInput ?? '').trim().toUpperCase();
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? 'read' : 'write';
}

const hasCapability = (capabilities: ReadonlySet<CapabilityKey>, capability: CapabilityKey) =>
  capabilities.has(capability);

const deleteKeys = (target: Record<string, any>, keys: readonly string[]) => {
  for (const key of keys) delete target[key];
};

/**
 * Redacts patient list rows by capability before they leave the API.
 * Scope decides which patients are visible; this function decides which
 * fields from those patients may be returned.
 */
export function redactPatientListRowForCapabilities<T extends Record<string, any>>(
  patient: T,
  capabilities: ReadonlySet<CapabilityKey>,
): T {
  const output = { ...patient } as Record<string, any>;

  if (!hasCapability(capabilities, 'patient.demographics.view')) {
    deleteKeys(output, [
      'age',
      'type',
      'social_name',
      'gender',
      'patient_group',
      'lead_source',
      'responsible_birth_date',
    ]);
  }

  if (!hasCapability(capabilities, 'patient.birthdays.view')) {
    deleteKeys(output, ['birth_date']);
  }

  if (!hasCapability(capabilities, 'patient.contacts.view')) {
    deleteKeys(output, [
      'email',
      'phone',
      'responsible_name',
      'responsible_phone',
      'responsible_email',
      'responsible_relationship',
    ]);
  }

  if (!hasCapability(capabilities, 'patient.documents.registration.view')) {
    deleteKeys(output, ['cpf', 'rg', 'cep', 'responsible_cpf']);
  }

  if (!hasCapability(capabilities, 'patient.insurance.view')) {
    deleteKeys(output, [
      'insurance_payer_id',
      'insurance_type',
      'insurance_name',
      'insurance_card_number',
    ]);
  }

  if (!hasCapability(capabilities, 'clinical.record.view')) {
    deleteKeys(output, ['diagnosis', 'notes', 'metadata']);
  }

  if (!hasCapability(capabilities, 'clinical.anamnesis.view')) {
    deleteKeys(output, [
      'anamnesis_required',
      'anamnesis_requested_at',
      'anamnesis_submitted_at',
      'anamnesis_reviewed_at',
    ]);
  }

  if (!hasCapability(capabilities, 'team.view')) {
    deleteKeys(output, ['professional_links']);
  }

  return output as T;
}
