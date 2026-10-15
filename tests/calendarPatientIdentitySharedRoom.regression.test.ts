import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkLocalScheduleConflicts } from '../src/utils/scheduling.ts';

const patientA = '11111111-1111-4111-8111-111111111111';
const patientB = '22222222-2222-4222-8222-222222222222';
const professionalA = '33333333-3333-4333-8333-333333333333';
const professionalB = '44444444-4444-4444-8444-444444444444';
const roomId = '55555555-5555-4555-8555-555555555555';
const event = {
  id: '66666666-6666-4666-8666-666666666666',
  patient_id: patientA,
  patient_name: 'Paciente Teste', // Mesmo nome de exibição, cadastros distintos.
  therapist_id: professionalA,
  professional_id: professionalA,
  room_id: roomId,
  date: '2026-10-15',
  time: '21:45',
  scheduled_at: '2026-10-16T00:45:00.000Z',
  duration_minutes: 50,
  status: 'scheduled',
  service_type: 'Fonoaudiologia'
};
function check(overrides: Record<string, unknown> = {}, roomBlocksOverlap = false) {
  return checkLocalScheduleConflicts({
    appointments: [event],
    rooms: [{ id: roomId, name: 'Sala compartilhada', prevent_overlapping_appointments: roomBlocksOverlap }],
    patient_id: patientB,
    patient_name: 'Paciente Teste',
    professional_ids: [professionalB],
    room_id: roomId,
    room_name: 'Sala compartilhada',
    location_type: 'clinica',
    date: '2026-10-15',
    start_time: '22:00',
    duration_minutes: 50,
    service_type: 'Fonoaudiologia',
    ...overrides
  });
}
const simultaneous = check();
assert.equal(simultaneous.blocking, false, 'pacientes/profissionais diferentes podem compartilhar sala liberada');
assert.equal(simultaneous.conflicts.length, 0, 'nome igual não significa mesmo paciente quando IDs diferem');
const samePatient = check({ patient_id: patientA });
assert.equal(samePatient.blocking, true);
assert.ok(samePatient.conflicts.some((conflict) => ['patient', 'specialty'].includes(conflict.conflictType)));
const sameProfessional = check({ professional_ids: [professionalA] });
assert.equal(sameProfessional.blocking, true);
assert.ok(sameProfessional.conflicts.some((conflict) => conflict.conflictType === 'professional'));
const privateRoom = check({}, true);
assert.equal(privateRoom.blocking, true);
assert.ok(privateRoom.conflicts.some((conflict) => conflict.conflictType === 'room'));

const page = readFileSync(new URL('../src/components/CoordinatorDashboard.tsx', import.meta.url), 'utf8');
assert.ok(page.includes('const [sessionPatientId, setSessionPatientId] = useState("")'));
assert.ok(page.includes('onClick={() => selectPatientForSession(p)}'));
assert.ok(page.includes('setSessionPatientId(patientId)'));
assert.ok(page.includes('setSessionPatientId("")'));
assert.ok(page.includes('allPatients.find((patient: any) => String(patient?.id || "").trim() === id)'));
assert.ok(!page.includes('onClick={() => selectPatientForSession(p.name)}'));
console.log('calendar patient identity and shared room conflict regression: PASS');
