import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const appCode = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const coordinatorCode = readFileSync(
  join(root, 'src/components/CoordinatorDashboard.tsx'),
  'utf8',
);
const calendarCode = readFileSync(
  join(root, 'src/components/Calendar.tsx'),
  'utf8',
);
const serverCode = readFileSync(join(root, 'server.ts'), 'utf8');
const patientPreferenceCode = readFileSync(
  join(root, 'src/utils/patientViewPreference.ts'),
  'utf8',
);

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

test('formulário usa ID canônico do profissional e mantém nome como snapshot', () => {
  assert.match(
    coordinatorCode,
    /const \[sessionProfessionalId, setSessionProfessionalId\] = useState\(""\)/,
  );
  assert.match(coordinatorCode, /value=\{sessionProfessionalId\}/);
  assert.match(coordinatorCode, /<option key=\{member\.id\} value=\{member\.id\}>/);
  assert.match(
    coordinatorCode,
    /therapist_id: selectedSessionProfessional\?\.id \|\| sessionProfessionalId/,
  );
  assert.doesNotMatch(
    coordinatorCode,
    /<option key=\{member\.id\} value=\{member\.label\}>/,
  );
});

test('backend exige profissional real e não usa ator como fallback', () => {
  const prepareStart = serverCode.indexOf('const prepareAppointmentForWrite');
  const prepareEnd = serverCode.indexOf('const readPersistedAppointmentRows', prepareStart);
  const prepareBlock = serverCode.slice(prepareStart, prepareEnd);
  assert.match(
    prepareBlock,
    /Selecione um profissional responsável para este agendamento/,
  );
  assert.doesNotMatch(
    prepareBlock,
    /\)\s*\|\|\s*sanitizeString\(actor\?\.id/,
  );
  assert.doesNotMatch(prepareBlock, /\|\| 'Equipe'/);
});

test('sala selecionada prevalece sobre location_type legado', () => {
  assert.match(
    coordinatorCode,
    /const nextLocationType = appointmentRoomId\s*\?\s*"clinica"/,
  );
  assert.match(appCode, /const locationType = requestedRoomId\s*\?\s*'clinica'/);
  assert.match(serverCode, /const locationType = roomId\s*\?\s*'clinica'/);
  assert.match(serverCode, /if \(expectedRoomId && sanitizeString\(row\?\.room_id/);
});

test('calendar events devolve sala e profissional sem Equipe artificial', () => {
  assert.match(serverCode, /responsible_professional_id: therapistId/);
  assert.match(serverCode, /responsible_professional_name: therapistName/);
  assert.match(serverCode, /roomId: roomId \|\| null/);
  assert.match(calendarCode, /Profissional não definido/);
  assert.doesNotMatch(
    calendarCode,
    /const therapistName = [\s\S]{0,300}\|\| 'Equipe'/,
  );
});

test('recorrência separa autorização e guia por decisão explícita', () => {
  assert.match(coordinatorCode, /Aplicar esta autorização às \{sessionNumSessions\} sessões/);
  assert.match(coordinatorCode, /Usar esta mesma guia em todas as sessões/);
  assert.match(coordinatorCode, /As demais ficam com guia pendente por ocorrência/);
  assert.match(appCode, /const recurringAuthorizationEnabled/);
  assert.match(appCode, /const recurringGuideReuseEnabled/);
  assert.match(appCode, /resolveRecurringAppointmentBillingFields/);
  assert.match(appCode, /applyAuthorizationToRecurrence: recurringAuthorizationEnabled/);
  assert.match(appCode, /reuseGuideAcrossRecurrence: recurringGuideReuseEnabled/);
});

test('fechamento consulta perfil profissional e diferencia ausência de registro', () => {
  assert.match(serverCode, /fetchClosureProfessional = async \(professionalId: string, clinicId: string\)/);
  assert.match(serverCode, /fetchProfessionalProfileWithSchemaFallback/);
  assert.match(serverCode, /from\('professional_billing_profiles'\)/);
  assert.match(
    serverCode,
    /fetchClosureProfessional\(professionalId, clinicId\)/,
  );
});

test('visualização de pacientes oferece cards e lista com preferência persistente', () => {
  assert.match(coordinatorCode, /Visualizar pacientes em cards/);
  assert.match(coordinatorCode, /Visualizar pacientes em lista/);
  assert.match(coordinatorCode, /handlePatientViewModeChange\("cards"\)/);
  assert.match(coordinatorCode, /handlePatientViewModeChange\("list"\)/);
  assert.match(patientPreferenceCode, /verto:patients:view:/);
  assert.match(patientPreferenceCode, /patients:lastViewMode/);
  assert.match(patientPreferenceCode, /window\.localStorage\.setItem\(key, mode\)/);
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

console.log(`${passed}/${tests.length} appointment care team and recurrence tests passed`);
