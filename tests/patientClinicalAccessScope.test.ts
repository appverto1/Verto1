import assert from 'node:assert/strict';
import { evaluatePatientClinicalAccess } from '../src/utils/patientClinicalAccess';

const clinicId = '11111111-1111-4111-8111-111111111111';
const patientId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';

const membership = (role: string, status = 'active') => ({
  user_id: actorId,
  clinic_id: clinicId,
  role,
  status,
});

const base = {
  actorId,
  actorClinicId: clinicId,
  patientId,
  patientClinicId: clinicId,
  requiredPermission: 'read' as const,
};

assert.equal(
  evaluatePatientClinicalAccess({
    ...base,
    actorRole: 'director',
    activeManagerMembership: membership('director'),
  }),
  true,
  'diretor ativo acessa a unidade atual',
);

assert.equal(
  evaluatePatientClinicalAccess({
    ...base,
    actorRole: 'coordinator',
    activeManagerMembership: membership('coordinator'),
  }),
  true,
  'coordenador ativo acessa a própria unidade',
);

assert.equal(
  evaluatePatientClinicalAccess({
    ...base,
    actorRole: 'owner',
    activeManagerMembership: null,
  }),
  false,
  'owner legado não recebe bypass clínico',
);

assert.equal(
  evaluatePatientClinicalAccess({
    ...base,
    actorRole: 'supervisor',
    activeProfessionalMembership: membership('supervisor'),
    activeSupervisionLink: {
      clinic_id: clinicId,
      supervisor_user_id: actorId,
      patient_id: patientId,
      status: 'active',
    },
  }),
  true,
  'supervisor acessa caso explicitamente supervisionado',
);

assert.equal(
  evaluatePatientClinicalAccess({
    ...base,
    actorRole: 'supervisor',
    activeProfessionalMembership: membership('supervisor'),
    activeSupervisionLink: null,
  }),
  false,
  'supervisor sem vínculo explícito não acessa o caso',
);

assert.equal(
  evaluatePatientClinicalAccess({
    ...base,
    actorRole: 'therapist',
    activeProfessionalMembership: {
      ...membership('therapist'),
      can_supervise: true,
    },
    activeSupervisionLink: {
      clinic_id: clinicId,
      supervisor_user_id: actorId,
      patient_id: patientId,
      status: 'active',
    },
  }),
  true,
  'profissional habilitado acessa apenas o caso explicitamente supervisionado',
);

assert.equal(
  evaluatePatientClinicalAccess({
    ...base,
    actorRole: 'therapist',
    activeProfessionalMembership: {
      ...membership('therapist'),
      can_supervise: false,
    },
    activeSupervisionLink: {
      clinic_id: clinicId,
      supervisor_user_id: actorId,
      patient_id: patientId,
      status: 'active',
    },
  }),
  false,
  'marcação de profissional sem can_supervise não deve aceitar um vínculo de supervisão injetado',
);

assert.equal(
  evaluatePatientClinicalAccess({
    ...base,
    actorRole: 'biller',
    activeProfessionalMembership: membership('biller'),
  }),
  false,
  'faturista não recebe prontuário clínico pelo papel',
);

assert.equal(
  evaluatePatientClinicalAccess({
    ...base,
    actorRole: 'receptionist',
    activeProfessionalMembership: membership('receptionist'),
  }),
  false,
  'recepção não recebe prontuário clínico pelo papel',
);

assert.equal(
  evaluatePatientClinicalAccess({
    ...base,
    actorRole: 'director',
    actorClinicId: '44444444-4444-4444-8444-444444444444',
    activeManagerMembership: membership('director'),
  }),
  false,
  'nem diretor atravessa tenant/unidade',
);

console.log('patientClinicalAccessScope.test.ts: ok');
