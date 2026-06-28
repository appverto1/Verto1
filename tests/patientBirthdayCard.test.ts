import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const coordinatorCode = readFileSync(join(root, 'src/components/CoordinatorDashboard.tsx'), 'utf8');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function sliceFrom(source: string, marker: string, chars = 2400) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return source.slice(start, start + chars);
}

test('comparacao de aniversario usa somente dia e mes de data normalizada', () => {
  const dateHelpers = sliceFrom(coordinatorCode, 'const normalizeBirthDateForStorage', 2200);
  assert.match(dateHelpers, /const isoDateOnly = raw\.match\(\/\^\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)\//);
  assert.match(dateHelpers, /const brazilianDate = raw\.match/);
  assert.match(dateHelpers, /formatBirthDateForInput/);
  assert.match(dateHelpers, /formatBirthDateForDisplay/);
  assert.doesNotMatch(dateHelpers, /toISOString/);

  const birthdayCheck = sliceFrom(coordinatorCode, 'const isBirthdayTodayPatient = (patient: any) => {', 900);
  assert.match(birthdayCheck, /isInactivePatientForDashboard/);
  assert.match(birthdayCheck, /birthDate\?\.day === today\.getDate\(\)/);
  assert.match(birthdayCheck, /birthDate\?\.month === today\.getMonth\(\) \+ 1/);
});

test('card do painel ativa filtro de aniversariantes na lista de pacientes', () => {
  const dashboardCard = sliceFrom(coordinatorCode, 'dashboardDailyStats.map((stat)', 1400);
  assert.match(dashboardCard, /stat\.id === "birthdays"/);
  assert.match(dashboardCard, /setPatientQuickFilter\("birthdaysToday"\)/);
  assert.match(dashboardCard, /navigateToTab\("patients"\)/);

  const visiblePatients = sliceFrom(coordinatorCode, 'const visiblePatients = useMemo', 2200);
  assert.match(visiblePatients, /patientQuickFilter === "birthdaysToday"/);
  assert.match(visiblePatients, /filteredPatients\.filter\(\(patient: any\) => isBirthdayTodayPatient\(patient\)\)/);

  const patientsTab = sliceFrom(coordinatorCode, '{activeTab === "patients" &&', 4200);
  assert.match(patientsTab, /Filtro ativo: Aniversariantes de hoje/);
  assert.match(patientsTab, /Limpar filtro/);
  assert.match(patientsTab, /setPatientQuickFilter\("all"\)/);
  assert.match(patientsTab, /patientQuickFilter === "birthdaysToday"/);
});

test('aba de aniversariantes usa os mesmos pacientes filtrados e nao esta marcada como em breve', () => {
  const birthdayTab = sliceFrom(coordinatorCode, '{activeTab === "birthdays" &&', 3800);
  assert.match(birthdayTab, /Aniversariantes de hoje/);
  assert.match(birthdayTab, /birthdayPatients\.map/);
  assert.match(birthdayTab, /formatBirthDateForDisplay/);
  assert.doesNotMatch(birthdayTab, /EM BREVE|Em Breve/);

  const birthdayMenuItems = coordinatorCode
    .split('id: "birthdays"')
    .slice(1)
    .map((part) => part.slice(0, 180));
  assert.ok(birthdayMenuItems.length >= 2, 'itens de menu de aniversariantes nao encontrados.');
  for (const item of birthdayMenuItems) {
    assert.doesNotMatch(item, /EM BREVE|Em Breve/);
  }
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

console.log(`${passed}/${tests.length} patient birthday card checks passed`);
