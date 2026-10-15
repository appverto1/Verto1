import assert from 'node:assert/strict';
import { checkNewGroupSlotAgainstAppointments } from '../services/groupSessions/groupSessionAvailability';

const params = {
  authenticatedClinicId: 'clinic-a', patientIds: ['patient-new-a','patient-new-b'],
  professionalIds: ['therapist-a','therapist-b'], roomId: 'room-a',
  roomPreventsOverlap: true, scheduledStartAt: '2026-10-16T21:45:00-03:00',
  scheduledEndAt: '2026-10-16T22:35:00-03:00',
  existingAppointments: [] as any[],
};
const entry = {
  id: 'session-old', clinic_id: 'clinic-a', patient_id: 'patient-old',
  therapist_id: 'therapist-a', room_id: 'room-a', status: 'scheduled',
  scheduled_start_at: '2026-10-17T00:45:00Z',
  scheduled_end_at: '2026-10-17T01:35:00Z',
};
const check = (overrides: any = {}) => checkNewGroupSlotAgainstAppointments({ ...params, ...overrides });
assert.deepEqual(check(),{ok:true,code:'GROUP_SLOT_AVAILABLE'});
assert.equal(check({existingAppointments:[entry]}).code,'GROUP_PROFESSIONAL_BUSY',
  'the same clinician cannot be booked into another independently created group');
assert.equal(check({existingAppointments:[{
  ...entry, therapist_id:'therapist-c', source_payload:{teamProfessionalIds:['therapist-b']}
}]}).code,'GROUP_PROFESSIONAL_BUSY',
  'a secondary team member cannot be double-booked even if therapist_id differs');
assert.equal(check({existingAppointments:[{...entry,source_payload:'bad-payload'}]}).code,
  'GROUP_SLOT_UNVERIFIABLE','invalid persisted team payload must fail closed');
assert.equal(check({existingAppointments:[{...entry,therapist_id:'therapist-c'}]}).code,'GROUP_ROOM_BUSY',
  'a room prohibiting overlaps is still protected');
assert.equal(check({existingAppointments:[{...entry,therapist_id:'therapist-c'}],roomPreventsOverlap:false}).ok,true,
  'a shared room permits different clinicians/patients');
assert.equal(check({existingAppointments:[{...entry,patient_id:'patient-new-b',therapist_id:'therapist-c'}],roomPreventsOverlap:false}).code,'GROUP_PATIENT_BUSY');
assert.equal(check({existingAppointments:[{...entry,clinic_id:'clinic-other'}]}).code,'GROUP_SLOT_SCOPE_MISMATCH');
assert.equal(check({existingAppointments:[{...entry,status:'canceled'}]}).ok,true);
assert.equal(check({existingAppointments:[{...entry,deleted_at:'2026-10-16T12:00:00Z'}]}).ok,true);
assert.equal(check({existingAppointments:[{...entry,scheduled_end_at:null,duration_minutes:0}]}).code,'GROUP_SLOT_UNVERIFIABLE');
assert.equal(check({existingAppointments:[{...entry,scheduled_end_at:null,duration_minutes:50}]}).code,'GROUP_PROFESSIONAL_BUSY');
assert.equal(check({scheduledStartAt:'2026-10-16T21:45:00',existingAppointments:[]}).code,'GROUP_SLOT_INVALID',
  'timezone-free timestamps must not depend on the server TZ');
assert.equal(check({patientIds:['patient-new-a','patient-new-a']}).code,'GROUP_SLOT_INVALID');
assert.equal(check({existingAppointments:[entry],scheduledStartAt:'2026-10-17T01:35:00Z',scheduledEndAt:'2026-10-17T02:25:00Z'}).ok,true,
  'contiguous sessions at boundary do not overlap');
assert.equal(check({existingAppointments:[entry],scheduledStartAt:'2026-10-17T01:20:00Z',scheduledEndAt:'2026-10-17T02:10:00Z'}).code,'GROUP_PROFESSIONAL_BUSY');
console.log('groupSessionAvailability.test.ts: ok');
