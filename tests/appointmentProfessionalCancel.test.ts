import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const coordinatorCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');
const calendarCode = readFileSync(join(root, 'src/components/Calendar.tsx'), 'utf8');
const appCode = readFileSync(join(root, 'src/App.tsx'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('rota permite cancelamento por profissional e escopa a consulta pela clinica', () => {
  assert.match(serverCode, /app\.patch\('\/api\/appointments\/:appointmentId\/status', checkAuth, handleAppointmentStatusUpdate\)/);
  assert.match(serverCode, /const isProfessionalActor = \['coordinator', 'receptionist', 'therapist', 'admin', 'owner'\]\.includes\(actorRole\)/);
  assert.match(serverCode, /!isPatientActor && !isProfessionalActor/);
  assert.match(serverCode, /tableAppointmentQuery = tableAppointmentQuery\.eq\('clinic_id', clinicId\)/);
  assert.match(serverCode, /const canCancelFutureRecurrence = isProfessionalActor/);
  assert.match(serverCode, /isFutureRecurringCancellation && !canCancelFutureRecurrence/);
  assert.match(serverCode, /status: tableStatus/);
});

test('paciente nao consegue usar a rota para status administrativo', () => {
  assert.match(serverCode, /isPatientActor && !\['confirmed', 'reschedule', 'canceled'\]\.includes\(normalizedStatus\)/);
  assert.match(serverCode, /Consulta n.o pertence a este paciente|Consulta não pertence a este paciente/);
});

test('painel profissional e recepcao usam o fluxo de cancelamento recorrente', () => {
  assert.match(appCode, /user\.role === 'coordinator' \|\| user\.role === 'receptionist' \|\| user\.role === 'therapist'/);
  assert.match(coordinatorCode, /onCancelAppointment=\{handleCancelAppointmentFromAgenda\}/);
  assert.match(coordinatorCode, /requestAppointmentCancellation\(appointment/);
  assert.match(coordinatorCode, /handleStatusUpdate\(appointment\.id, "canceled"/);
  assert.match(coordinatorCode, /recurrenceScope: "single"/);
  assert.match(coordinatorCode, /const canCancelRecurringAppointments = \["coordinator", "receptionist", "therapist", "admin", "owner"\]\.includes\(role\.toLowerCase\(\)\)/);
  assert.match(coordinatorCode, /canCancelRecurringAppointments && isRecurringAppointment\(appointment\)/);
  assert.match(coordinatorCode, /submitRecurringCancellation\("future"\)/);
  assert.match(coordinatorCode, /fixed inset-0 z-\[180\][^"]*pendingRecurringCancellation|pendingRecurringCancellation[\s\S]{0,180}z-\[180\]/);
});

test('agenda clinica reconcilia cancelamento local com cache remoto', () => {
  assert.match(calendarCode, /const agendaVersion = useMemo/);
  assert.match(calendarCode, /cacheRef\.current\.clear\(\)/);
  assert.match(calendarCode, /const mergeLocalAppointment = \(event: any\) =>/);
  assert.match(calendarCode, /setRemoteEvents\(\(prev\) =>/);
  assert.match(calendarCode, /setSelectedEvent\(\(prev: any\) =>/);
  assert.match(calendarCode, /setEventDetail\(\(prev: any\) =>/);
  assert.match(calendarCode, /onCancelAppointment\?\.\(detailEvent\)/);
});

let passed = 0;
for (const item of tests) {
  try {
    item.fn();
    passed += 1;
    console.log(`ok - ${item.name}`);
  } catch (error) {
    console.error(`not ok - ${item.name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} appointment professional cancel tests passed`);
