import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const serverCode = read('server.ts');
const appCode = read('src/App.tsx');
const dataServiceCode = read('src/services/dataService.ts');
const coordinatorCode = read('src/components/CoordinatorDashboard.tsx');
const patientDashboardCode = read('src/components/PatientDashboard.tsx');
const routeSchemaCode = read('src/utils/routeSchemaFallbacks.ts');
const migrationCode = read('supabase/migrations/20260531150000_patient_registration_anamnesis_age_templates.sql');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function sliceFrom(source: string, marker: string, chars = 2400) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return source.slice(start, start + chars);
}

test('cadastro persiste campos editaveis por migration, backend, payload e hidratacao', () => {
  for (const column of [
    'birth_date',
    'cpf',
    'phone',
    'patient_profile_type',
    'panel_type',
    'responsible_email',
    'responsible_relationship',
    'notes'
  ]) {
    assert.match(migrationCode, new RegExp(`add column if not exists ${column}`, 'i'));
    assert.match(routeSchemaCode, new RegExp(`'${column}'`));
  }

  const identityBuilder = sliceFrom(serverCode, 'function buildPatientIdentityPersistenceFields', 3600);
  assert.match(identityBuilder, /birth_date:\s*sanitizeIsoDateOnly/);
  assert.match(identityBuilder, /responsible_email:\s*sanitizeEmail/);
  assert.match(identityBuilder, /responsible_relationship:\s*sanitizeString/);
  assert.match(identityBuilder, /notes:\s*sanitizeTextField/);
  assert.match(identityBuilder, /registrationNotes/);

  const mutationSelect = sliceFrom(serverCode, 'const PATIENT_MUTATION_SELECT', 900);
  for (const column of ['birth_date', 'cpf', 'phone', 'patient_profile_type', 'responsible_email', 'notes']) {
    assert.match(mutationSelect, new RegExp(`'${column}'`));
  }

  const createUserPayload = sliceFrom(appCode, 'dataService.createPatientUser(', 1700);
  for (const field of ['birthDate', 'birth_date', 'responsibleEmail', 'responsibleRelationship', 'patientProfileType']) {
    assert.match(createUserPayload, new RegExp(field));
  }

  const savePatientPayload = sliceFrom(appCode, 'const fbResult = await dataService.savePatient', 2200);
  for (const field of ['birthDate', 'birth_date', 'cpf', 'phone', 'responsibleEmail', 'responsibleRelationship']) {
    assert.match(savePatientPayload, new RegExp(field));
  }

  const hydration = sliceFrom(dataServiceCode, 'hydratedPatients.push', 3200);
  assert.match(hydration, /birthDate:\s*recordPayload\?\.dataNascimento \|\| patient\?\.birth_date/);
  assert.match(hydration, /patient\?\.responsible_email/);
  assert.match(hydration, /patient\?\.responsible_relationship/);
  assert.match(hydration, /patient\?\.patient_profile_type/);
});

test('status clinico nao ativa paciente com anamnese obrigatoria pendente', () => {
  const patientPost = sliceFrom(serverCode, "app.post('/api/patients'", 4200);
  assert.match(patientPost, /const initialPatientStatus[\s\S]*PATIENT_STATUS_PENDING_ANAMNESIS/);
  assert.match(patientPost, /status:\s*!anamnesisRequired \? \(requestedPatientStatus \|\| initialPatientStatus\) : initialPatientStatus/);

  const patientPatch = sliceFrom(serverCode, "app.patch('/api/patients/:id'", 4200);
  assert.match(patientPatch, /const safeStatusPatch/);
  assert.match(patientPatch, /PATIENT_STATUS_PENDING_ANAMNESIS/);
  assert.match(patientPatch, /READY_FOR_CARE/);

  const reviewRoute = sliceFrom(serverCode, "app.post('/api/patients/:patientId/anamnesis/review'", 3000);
  assert.match(reviewRoute, /PATIENT_STATUS_ACTIVE/);
  assert.match(reviewRoute, /ONBOARDING_READY_FOR_CARE/);
  assert.match(reviewRoute, /reviewed_at/);

  assert.match(coordinatorCode, /const getPatientClinicalStatusLabel/);
  for (const label of ['Anamnese pendente', 'Ficha enviada à família', 'Anamnese em preenchimento', 'Aguardando revisão', 'Paciente ativo']) {
    assert.match(coordinatorCode, new RegExp(label));
  }
});

test('aniversariantes usam data local, contam dia e mes e filtram a lista', () => {
  assert.match(coordinatorCode, /parsePatientBirthDateParts/);
  assert.match(coordinatorCode, /\^\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)\$/);
  assert.match(coordinatorCode, /birthDate\?\.day === today\.getDate\(\)/);
  assert.match(coordinatorCode, /birthdayPatients = useMemo/);
  assert.match(coordinatorCode, /birthdayTodayCount/);
  assert.match(coordinatorCode, /setPatientQuickFilter\("birthdaysToday"\)/);
  assert.match(coordinatorCode, /navigateToTab\("patients"\)/);
  assert.match(coordinatorCode, /activeTab === "birthdays"/);
  assert.match(coordinatorCode, /Aniversariantes de hoje/);
  assert.match(coordinatorCode, /birthdayPatients\.map/);
  assert.match(coordinatorCode, /Limpar filtro/);
  assert.doesNotMatch(sliceFrom(coordinatorCode, 'label: "Aniversariantes"', 350), /EM BREVE|Em Breve/);
});

test('anamnese escolhe template por faixa etaria sem expor ids de template no payload publico', () => {
  assert.match(migrationCode, /create table if not exists public\.anamnesis_templates/i);
  assert.match(migrationCode, /age_min_months integer/);
  assert.match(migrationCode, /age_max_months integer/);
  assert.match(migrationCode, /patient_profile_type text/);
  assert.match(migrationCode, /alter table public\.anamnesis_templates enable row level security/i);
  for (const templateName of ['Infantil 0-5 anos', 'Infantil 6-11 anos', 'Adolescente 12-17 anos', 'Adulto ABA 18+', 'Adulto convencional 18+']) {
    assert.match(migrationCode, new RegExp(templateName));
  }

  assert.match(serverCode, /function calculateAgeMonthsFromDateOnly/);
  assert.match(serverCode, /function fetchAnamnesisTemplateForPatient/);
  assert.match(serverCode, /anamnesisTemplateMatchesPatient/);
  assert.match(serverCode, /exactCompatible/);
  assert.match(serverCode, /template_id:\s*isUuid\(resolvedTemplateId\)/);
  assert.match(serverCode, /Cadastre um responsável com e-mail antes de enviar a ficha/);

  const publicTemplate = sliceFrom(serverCode, 'function buildPublicAnamnesisTemplate', 1300);
  assert.match(publicTemplate, /compatibleTemplates/);
  assert.doesNotMatch(publicTemplate, /selectedTemplateId/);
});

test('portal bloqueia reenvio, revisao versiona e ficha final aparece em Arquivos', () => {
  const portalDraft = sliceFrom(serverCode, "app.patch('/api/portal/patients/:patientId/anamnesis/draft'", 2800);
  const portalSubmit = sliceFrom(serverCode, "app.post('/api/portal/patients/:patientId/anamnesis/submit'", 2800);
  for (const route of [portalDraft, portalSubmit]) {
    assert.match(route, /canPortalSessionAccessPatient/);
    assert.match(route, /statuses:\s*\['SENT', 'IN_PROGRESS'\]/);
    assert.match(route, /templateId:\s*requestCheck\.data\?\.template_id/);
  }

  assert.match(serverCode, /version:\s*existing\.data\?\.id \? undefined : nextVersion/);
  assert.match(serverCode, /const persistAnamnesisFinalFileFallback/);
  assert.match(serverCode, /category:\s*'Anamnese'/);
  assert.match(serverCode, /status:\s*'Revisada'/);
  assert.match(serverCode, /logicalDocument:\s*true/);
  assert.match(serverCode, /source:\s*'anamnesis'/);

  const reviewRoute = sliceFrom(serverCode, "app.post('/api/patients/:patientId/anamnesis/review'", 3600);
  assert.match(reviewRoute, /persistAnamnesisFinalFileFallback/);
  assert.match(reviewRoute, /fetchPatientAnamnesisFlow/);

  for (const label of ['Início', 'Consultas', 'Ficha de anamnese', 'Tarefas', 'Relatórios', 'Documentos', 'Perfil']) {
    assert.match(patientDashboardCode, new RegExp(label));
  }
  assert.match(coordinatorCode, /Ficha de anamnese/);
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

console.log(`${passed}/${tests.length} patient registration/anamnesis checks passed`);
