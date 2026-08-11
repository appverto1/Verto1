import assert from 'node:assert/strict';
import { getDefaultCapabilitiesForRole } from '../src/constants/authorizationModel';
import {
  patientListColumnsForCapabilities,
  redactPatientListRowForCapabilities,
  requiredPatientLinkPermissionForMethod,
  resolvePatientListScopeMode,
} from '../src/utils/patientAuthorization';

assert.equal(resolvePatientListScopeMode('director'), 'active_clinic');
assert.equal(resolvePatientListScopeMode('coordinator'), 'active_clinic');
assert.equal(resolvePatientListScopeMode('receptionist'), 'active_clinic');
assert.equal(resolvePatientListScopeMode('biller'), 'active_clinic');
assert.equal(resolvePatientListScopeMode('therapist'), 'assigned_patients');
assert.equal(resolvePatientListScopeMode('supervisor'), 'supervised_cases');
assert.equal(resolvePatientListScopeMode('owner'), 'none');

assert.equal(requiredPatientLinkPermissionForMethod('GET'), 'read');
assert.equal(requiredPatientLinkPermissionForMethod('HEAD'), 'read');
assert.equal(requiredPatientLinkPermissionForMethod('POST'), 'write');
assert.equal(requiredPatientLinkPermissionForMethod('PATCH'), 'write');
assert.equal(requiredPatientLinkPermissionForMethod('DELETE'), 'write');

const billerCapabilities = getDefaultCapabilitiesForRole('biller');
const billerColumns = new Set(patientListColumnsForCapabilities(billerCapabilities));
assert.equal(billerColumns.has('insurance_card_number'), true);
assert.equal(billerColumns.has('email'), true);
assert.equal(billerColumns.has('diagnosis'), false);
assert.equal(billerColumns.has('notes'), false);
assert.equal(billerColumns.has('anamnesis_submitted_at'), false);

const receptionistCapabilities = getDefaultCapabilitiesForRole('receptionist');
const receptionistColumns = new Set(patientListColumnsForCapabilities(receptionistCapabilities));
assert.equal(receptionistColumns.has('email'), true);
assert.equal(receptionistColumns.has('insurance_name'), true);
assert.equal(receptionistColumns.has('diagnosis'), false);
assert.equal(receptionistColumns.has('metadata'), false);

const therapistCapabilities = getDefaultCapabilitiesForRole('therapist');
const therapistColumns = new Set(patientListColumnsForCapabilities(therapistCapabilities));
assert.equal(therapistColumns.has('diagnosis'), true);
assert.equal(therapistColumns.has('birth_date'), true);
assert.equal(therapistColumns.has('email'), false);
assert.equal(therapistColumns.has('phone'), false);

const sample = {
  id: 'patient-1',
  name: 'Paciente Teste',
  email: 'patient@example.com',
  phone: '11999999999',
  cpf: '12345678900',
  diagnosis: 'Dado clínico',
  notes: 'Nota clínica',
  metadata: { internal: true },
  insurance_name: 'Operadora',
  insurance_card_number: 'CARD-1',
  professional_links: [{ professional_id: 'professional-1' }],
};

const billerRow = redactPatientListRowForCapabilities(sample, billerCapabilities);
assert.equal(billerRow.email, 'patient@example.com');
assert.equal(billerRow.insurance_name, 'Operadora');
assert.equal('diagnosis' in billerRow, false);
assert.equal('notes' in billerRow, false);
assert.equal('metadata' in billerRow, false);

const receptionistRow = redactPatientListRowForCapabilities(sample, receptionistCapabilities);
assert.equal(receptionistRow.email, 'patient@example.com');
assert.equal('diagnosis' in receptionistRow, false);
assert.equal('metadata' in receptionistRow, false);
assert.equal('professional_links' in receptionistRow, false);

const therapistRow = redactPatientListRowForCapabilities(
  { ...sample, birth_date: '2015-02-03' },
  therapistCapabilities,
);
assert.equal(therapistRow.birth_date, '2015-02-03');
assert.equal('email' in therapistRow, false);
assert.equal(therapistRow.diagnosis, 'Dado clínico');

console.log('patientAuthorization.test.ts: ok');
