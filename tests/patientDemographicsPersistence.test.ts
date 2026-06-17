import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const serverCode = read('server.ts');
const appCode = read('src/App.tsx');
const coordinatorCode = read('src/components/CoordinatorDashboard.tsx');
const dataServiceCode = read('src/services/dataService.ts');
const routeSchemaCode = read('src/utils/routeSchemaFallbacks.ts');
const migrationCode = read('supabase/migrations/20260531150000_patient_registration_anamnesis_age_templates.sql');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function sliceFrom(source: string, marker: string, chars = 2400) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return source.slice(start, start + chars);
}

test('data de nascimento percorre formulario, payload, backend, select e hidratacao', () => {
  assert.match(migrationCode, /add column if not exists birth_date date/i);
  assert.match(routeSchemaCode, /'birth_date'/);

  const newPatientPayload = sliceFrom(coordinatorCode, 'const normalizedBirthDate = normalizeBirthDateForStorage', 2200);
  for (const field of ['birthDate', 'birth_date', 'dataNascimento']) {
    assert.match(newPatientPayload, new RegExp(`${field}:\\s*normalizedBirthDate`));
  }

  const editHydration = sliceFrom(coordinatorCode, 'const handleEditPatient = (patient: any) => {', 1800);
  assert.match(editHydration, /formatBirthDateForInput\(/);
  assert.match(editHydration, /patient\.birth_date/);
  assert.match(editHydration, /patient\.anamnesisData\?\.dataNascimento/);

  const appCreatePayload = sliceFrom(appCode, 'dataService.createPatientUser(', 1800);
  assert.match(appCreatePayload, /birthDate:\s*resolvedBirthDate/);
  assert.match(appCreatePayload, /birth_date:\s*resolvedBirthDate/);

  const appUpdatePayload = sliceFrom(appCode, 'const handleUpdatePatient = async', 6200);
  assert.match(appUpdatePayload, /birthDate:\s*updatedData\.birthDate \|\| updatedData\.dataNascimento/);
  assert.match(appUpdatePayload, /birth_date:\s*updatedData\.birthDate \|\| updatedData\.dataNascimento/);

  const serverIdentity = sliceFrom(serverCode, 'function sanitizeIsoDateOnly', 1800);
  assert.match(serverIdentity, /raw\.match\(\/\^\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)\//);
  assert.match(serverIdentity, /raw\.match\(\/\^\(\\d\{2\}\)\\\/\(\\d\{2\}\)\\\/\(\\d\{4\}\)\$\/\)/);
  assert.doesNotMatch(serverIdentity, /toISOString/);

  const dataHydration = sliceFrom(dataServiceCode, 'hydratedPatients.push', 2600);
  assert.match(dataHydration, /birthDate:\s*recordPayload\?\.dataNascimento \|\| patient\?\.birth_date/);
});

test('cpf tem mascara no front, normalizacao no backend e nao aparece em cards principais', () => {
  assert.match(coordinatorCode, /const normalizeCpfInput = \(value: string\)/);
  assert.match(coordinatorCode, /const formatCpf = \(value: string\)/);
  assert.match(coordinatorCode, /return `\$\{v\.slice\(0, 3\)\}\.\$\{v\.slice\(3, 6\)\}\.\$\{v\.slice\(6, 9\)\}-\$\{v\.slice\(9, 11\)\}`/);
  assert.match(coordinatorCode, /field === "cpf" \|\| field === "responsavelCpf" \|\| field === "convenioTitularCpf"/);

  const editHydration = sliceFrom(coordinatorCode, 'const handleEditPatient = (patient: any) => {', 3200);
  assert.match(editHydration, /cpf:\s*formatCpf\(patient\.cpf/);
  assert.match(editHydration, /responsavelCpf:\s*formatCpf\(patient\.guardian\?\.cpf/);

  const createPayload = sliceFrom(coordinatorCode, 'const normalizedBirthDate = normalizeBirthDateForStorage', 5200);
  assert.match(createPayload, /cpf:\s*normalizedCpf \|\| null/);
  assert.doesNotMatch(createPayload, /formatCpf\(/);

  const serverCpf = sliceFrom(serverCode, 'function normalizeCpf', 500);
  assert.match(serverCpf, /replace\(\/\\D\/g, ''\)/);
  assert.match(serverCpf, /digits\.length !== 11/);

  const patientCard = sliceFrom(coordinatorCode, '{visiblePatients.map((patient, i) => (', 2600);
  assert.doesNotMatch(patientCard, /\.cpf|CPF/);
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

console.log(`${passed}/${tests.length} patient demographics persistence checks passed`);
