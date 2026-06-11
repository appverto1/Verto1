import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const coordinatorCode = read('src/components/CoordinatorDashboard.tsx');
const settingsMenuCode = read('src/components/SettingsMenu.tsx');
const appCode = read('src/App.tsx');
const serverCode = read('server.ts');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function sliceFrom(source: string, marker: string, chars = 2600) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return source.slice(start, start + chars);
}

test('configuracoes saem do menu lateral e ficam apenas na engrenagem', () => {
  const navigationGroups = sliceFrom(coordinatorCode, 'const navigationGroups', 1800);
  assert.doesNotMatch(navigationGroups, /id:\s*"settings"/);
  assert.match(settingsMenuCode, /<Settings size=\{20\}/);
  assert.match(settingsMenuCode, /Perfil e clínica/);
  assert.match(coordinatorCode, /onViewProfile=\{\(\) => navigateToTab\("settings"\)\}/);
});

test('perfil profissional e dados da clinica aparecem como blocos separados', () => {
  for (const label of [
    'Perfil do profissional responsável',
    'Dados da clínica',
    'Nome da Clínica',
    'CPF',
    'CRP / Registro profissional',
    'Telefone da Clínica',
    'E-mail institucional',
    'Endereço da Clínica'
  ]) {
    assert.match(coordinatorCode, new RegExp(label));
  }
});

test('contexto do prontuario usa dados da clinica sem cair na foto/nome do profissional', () => {
  const context = sliceFrom(coordinatorCode, 'clinicContext={{', 1400);
  assert.match(context, /clinicName:\s*[\s\S]*user\?\.clinicSettings\?\.clinicName/);
  assert.match(context, /user\?\.workspaceName/);
  assert.doesNotMatch(context, /clinicName:[\s\S]*user\?\.name[\s\S]*cnpj:/);
  assert.match(context, /logoUrl:\s*user\?\.clinicSettings\?\.clinicLogoUrl \|\| null/);
  assert.doesNotMatch(context, /logoUrl:[\s\S]*user\?\.profilePicture/);
  assert.match(context, /professionalName:\s*user\?\.name \|\| "Profissional responsável"/);
});

test('backend persiste campos profissionais e institucionais de forma tolerante ao schema', () => {
  const route = sliceFrom(serverCode, "app.post('/api/profile/:userId'", 14000);
  for (const token of [
    'professionalProfileInput',
    'clinicSettingsInput',
    'professionalCpf',
    'professionalPhone',
    'professionalRoleTitle',
    'clinicName',
    'clinicPhone',
    'clinicEmail',
    'clinicAddress',
    'professional_profile',
    'clinic_settings',
    'patchTableSafely'
  ]) {
    assert.match(route, new RegExp(token));
  }
  assert.match(route, /cpf:\s*professionalCpf/);
  assert.match(route, /clinic_name:\s*clinicName/);
  assert.match(route, /clinic_email:\s*clinicEmail/);
  assert.match(serverCode, /clinicEmail:\s*sanitizeEmail\(settings\.clinicEmail\)/);
});

test('relogin reidrata perfil profissional e dados da clinica pelo professional_profiles', () => {
  const refresh = sliceFrom(appCode, 'const professionalProfile = profileResult?.data?.professional_profile', 3600);
  for (const token of [
    'professionalMetadata',
    'cpf',
    'phone',
    'professionalRoleTitle',
    'professionalProfile',
    'clinicName',
    'clinicPhone',
    'clinicEmail',
    'clinicAddress'
  ]) {
    assert.match(refresh, new RegExp(token));
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

console.log(`${passed}/${tests.length} profile/clinic settings checks passed`);
