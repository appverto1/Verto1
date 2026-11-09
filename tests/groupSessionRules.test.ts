import assert from 'node:assert/strict';
import { canShareGroupBooking, getAppointmentGroupId, groupBookingIncludesPatient, normalizeAppointmentModality } from '../src/utils/groupSessionRules';

const groupId = 'db7f211c-6d4f-4781-930e-9cf0146782a1';
const base = {
  id: 'slot-a', clinic_id: 'clinic-a', patient_id: 'patient-a',
  session_modality: 'GROUP', session_group_id: groupId,
  date: '2026-10-16', time: '21:45', duration_minutes: 50,
  location_type: 'clinica', room_id: 'room-a',
  service_type: 'Fonoaudiologia',
  professional_ids: ['professional-a', 'professional-b']
};
assert.equal(normalizeAppointmentModality(undefined), 'INDIVIDUAL');
assert.equal(normalizeAppointmentModality('GROUP'), 'GROUP');
assert.equal(getAppointmentGroupId({session_group_id:'../fake'}), '');
const second = { ...base, id: 'slot-b', patient_id: 'patient-b', professional_ids: ['professional-b', 'professional-a'] };
assert.equal(canShareGroupBooking(base, second), true);
assert.equal(groupBookingIncludesPatient([base], second), false);
assert.equal(groupBookingIncludesPatient([base], { ...second, patient_id: 'patient-a' }), true);
for (const change of [
  { clinic_id: 'clinic-other' }, { session_modality: 'INDIVIDUAL' }, { session_group_id: null },
  { date: '2026-10-17' }, { time: '22:00' }, { duration_minutes: 30 },
  { room_id: 'room-b' }, { location_type: 'escola' },
  { service_type: 'Terapia ocupacional' }, { professional_ids: ['professional-a'] },
]) {
  assert.equal(canShareGroupBooking(base, { ...second, ...change }), false, JSON.stringify(change));
}
assert.equal(canShareGroupBooking(base, { ...second, session_group_id: groupId.replace('db7f','aa7f') }), false);
console.log('groupSessionRules.test.ts: ok');
