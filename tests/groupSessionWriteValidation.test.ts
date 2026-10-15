import assert from 'node:assert/strict';
import { authorizeExistingGroupJoin, createServerGroupSessionId } from '../services/groupSessions/groupSessionWriteValidation';

const clinic = 'b138ce3b-e24e-4c26-918b-6b72f8c51f47';
const otherClinic = 'd745a2f6-3e82-455c-b7bb-5853bf53e15b';
const patient1 = '5502e3c5-f4c1-4a18-ae65-714180e38b92';
const patient2 = '46b81ab1-d910-4b87-90d3-30d0f0d5886f';
const professional = '9128fd0a-9e77-42f9-98c9-d86403d6f7b0';
const groupId = 'db7f211c-6d4f-4781-930e-9cf0146782a1';
const current = {
  id: 'a-2', clinic_id: clinic, patient_id: patient2, session_modality: 'GROUP',
  session_group_id: groupId, professional_ids: [professional],
  date: '2026-10-16', time: '21:45', duration_minutes: 50,
  location_type: 'clinica', room_id: 'room-a', service_type: 'Fonoaudiologia'
};
const existing = {
  ...current, id: 'a-1', patient_id: patient1, status: 'scheduled',
};
const input = {
  authenticatedClinicId: clinic, requestedGroupId: groupId,
  candidateAppointment: current, existingGroupAppointments: [existing],
  clinicPatientRows: [
    { id: patient1, clinic_id: clinic },
    { id: patient2, clinic_id: clinic },
  ],
  clinicProfessionalRows: [{ id: professional, clinic_id: clinic, is_active: true }],
  patientIds: [patient2], professionalIds: [professional],
};
assert.equal(authorizeExistingGroupJoin(input).ok, true);
assert.match(createServerGroupSessionId(), /^[0-9a-f-]{36}$/);
assert.equal(authorizeExistingGroupJoin({...input, existingGroupAppointments: []}).ok, false);
assert.equal(authorizeExistingGroupJoin({...input, candidateAppointment: { ...current, clinic_id: otherClinic }}).ok, false);
assert.equal(authorizeExistingGroupJoin({...input, existingGroupAppointments: [{...existing,clinic_id:otherClinic}]}).ok, false);
assert.equal(authorizeExistingGroupJoin({...input, patientIds: [patient1]}).ok, false);
assert.equal(authorizeExistingGroupJoin({...input, patientIds: [patient2,patient2]}).ok, false);
assert.equal(authorizeExistingGroupJoin({...input, clinicPatientRows: [{id:patient2,clinic_id:otherClinic}]}).ok, false);
assert.equal(authorizeExistingGroupJoin({...input, clinicProfessionalRows: [{id:professional,clinic_id:clinic,is_active:false}]}).ok, false);
assert.equal(authorizeExistingGroupJoin({...input, existingGroupAppointments:[{...existing,status:'canceled'}]}).ok, false);
assert.equal(authorizeExistingGroupJoin({...input, candidateAppointment:{...current,time:'22:00'}}).ok, false);
assert.equal(authorizeExistingGroupJoin({...input, requestedGroupId:'not-a-uuid'}).ok, false);
console.log('groupSessionWriteValidation.test.ts: ok');
