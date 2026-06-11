import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const serverCode = read('server.ts');
const dataServiceCode = read('src/services/dataService.ts');
const coordinatorCode = read('src/components/CoordinatorDashboard.tsx');
const anamnesisCode = read('src/components/Anamnesis.tsx');
const migrationCode = read('supabase/migrations/20260531150000_patient_registration_anamnesis_age_templates.sql');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function sliceFrom(source: string, marker: string, chars = 2600) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return source.slice(start, start + chars);
}

test('migration tem tabela aditiva para templates por idade e RLS ligada', () => {
  assert.match(migrationCode, /create table if not exists public\.anamnesis_templates/i);
  assert.match(migrationCode, /age_min_months integer/i);
  assert.match(migrationCode, /age_max_months integer/i);
  assert.match(migrationCode, /patient_profile_type text/i);
  assert.match(migrationCode, /questions jsonb not null default '\{\}'::jsonb/i);
  assert.match(migrationCode, /alter table public\.anamnesis_templates enable row level security/i);
});

test('backend lista, salva e remove fichas personalizadas sem select star', () => {
  const getRoute = sliceFrom(serverCode, "app.get('/api/clinic/anamnesis-templates'", 2500);
  const postRoute = sliceFrom(serverCode, "app.post('/api/clinic/anamnesis-templates'", 5200);
  const deleteRoute = sliceFrom(serverCode, "app.delete('/api/clinic/anamnesis-templates/:templateId'", 2200);
  assert.match(getRoute, /ANAMNESIS_TEMPLATE_SELECT/);
  assert.match(getRoute, /\.eq\('organization_id', clinicId\)/);
  assert.match(getRoute, /\.eq\('is_active', true\)/);
  assert.doesNotMatch(getRoute + postRoute + deleteRoute, /select\(['"`]\*['"`]\)/);

  assert.match(postRoute, /activeRows\.length >= 5/);
  assert.match(postRoute, /Limite de 5 fichas salvas atingido/);
  assert.match(postRoute, /normalizeAnamnesisTemplateAgeMonth/);
  assert.match(postRoute, /normalizeAnamnesisPatientProfileType/);
  assert.match(postRoute, /Não foi possível confirmar a persistência da ficha/);
  assert.match(postRoute, /\.select\(ANAMNESIS_TEMPLATE_SELECT\)/);

  assert.match(deleteRoute, /is_active:\s*false/);
  assert.match(deleteRoute, /\.eq\('organization_id', clinicId\)/);
});

test('dataService expoe CRUD das fichas sem tocar no endpoint legado', () => {
  for (const method of [
    'getClinicAnamnesisTemplates',
    'saveClinicAnamnesisTemplateRecord',
    'deleteClinicAnamnesisTemplateRecord'
  ]) {
    assert.match(dataServiceCode, new RegExp(method));
  }
  assert.match(dataServiceCode, /\/api\/clinic\/anamnesis-templates/);
  assert.match(dataServiceCode, /\/api\/clinic\/anamnesis-template'/);
});

test('dashboard carrega lista persistida e salva registro selecionavel', () => {
  assert.match(coordinatorCode, /const \[anamnesisTemplates, setAnamnesisTemplates\]/);
  assert.match(coordinatorCode, /normalizeAnamnesisTemplateForEditor/);
  assert.match(coordinatorCode, /dataService\.getClinicAnamnesisTemplates/);
  assert.match(coordinatorCode, /dataService\.saveClinicAnamnesisTemplateRecord/);
  assert.match(coordinatorCode, /dataService\.deleteClinicAnamnesisTemplateRecord/);
  assert.match(coordinatorCode, /savedTemplates=\{anamnesisTemplates\}/);
  assert.match(coordinatorCode, /onTemplateSelect=\{handleSelectClinicAnamnesisTemplate\}/);
  assert.match(coordinatorCode, /onTemplateDelete=\{handleDeleteClinicAnamnesisTemplate\}/);
});

test('editor cria ficha do zero com nome, idade, perfil, secoes e limite de cinco', () => {
  for (const token of [
    'savedTemplates',
    'createBlankAnamnesisTemplate',
    'Nova ficha do zero',
    'Nome da ficha',
    'Idade mín.',
    'Idade máx.',
    'Adicionar seção',
    'Limite de 5 fichas salvas atingido',
    'Remover ficha salva'
  ]) {
    assert.match(anamnesisCode, new RegExp(token));
  }
  assert.match(anamnesisCode, /templateName:\s*cleanName/);
  assert.match(anamnesisCode, /ageMinMonths:\s*yearsInputToMonths/);
  assert.match(anamnesisCode, /patientProfileType:\s*templatePatientProfileType/);
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

console.log(`${passed}/${tests.length} anamnesis template customization checks passed`);
