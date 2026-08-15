import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const panel = fs.readFileSync('src/components/PatientProfessionalLinksPanel.tsx', 'utf8');

assert.match(
  server,
  /const PATIENT_ANAMNESIS_PATIENT_SELECT_COLUMNS = PATIENT_MUTATION_SELECT\.split\(','\);/,
  'anamnese deve usar projeção de paciente definida e não uma constante ausente em runtime',
);

assert.match(
  server,
  /const PATIENT_ANAMNESIS_RECORD_SELECT_COLUMNS = \[[\s\S]*?'patient_id'[\s\S]*?'clinic_id'[\s\S]*?'payload_encrypted'[\s\S]*?'payload'[\s\S]*?'payload_preview'[\s\S]*?'updated_at'[\s\S]*?\];/,
  'anamnese deve manter a projeção de patient_records definida antes de fetchPatientRegistrationPayloadForAnamnesis',
);
assert.match(
  server,
  /async function fetchPatientRegistrationPayloadForAnamnesis[\s\S]*?let columns = \[\.\.\.PATIENT_ANAMNESIS_RECORD_SELECT_COLUMNS\];/,
  'leitura de cadastro para anamnese deve usar a projeção definida e não lançar ReferenceError',
);

const linksStart = server.indexOf("'/api/patients/:patientId/professional-links'");
const linksPostStart = server.indexOf("'/api/patients/:patientId/professional-links'", linksStart + 1);
const linksGet = server.slice(linksStart, linksPostStart);
assert.match(linksGet, /const usersSelect = 'id,name,email,profile_picture'/);
assert.doesNotMatch(linksGet, /profile_picture_path/);

const planStart = server.indexOf("app.get('/api/aba/patients/:patientId/therapeutic-plan'");
const planEnd = server.indexOf("app.post('/api/aba/patients/:patientId/therapeutic-plans'", planStart);
const planGet = server.slice(planStart, planEnd);
assert.match(planGet, /\.from\('users'\)[\s\S]*?\.select\('id,name,email,profile_picture'\)/);
assert.doesNotMatch(planGet, /profile_picture_path/);

assert.match(
  server,
  /async function updatePatientPortalUserMirrorWithSchemaFallback[\s\S]*?optionalMirrorColumns = new Set\(\['status', 'updated_at'\]\)/,
  'status de users deve ser espelho opcional; patients permanece fonte canônica',
);
assert.match(
  server,
  /const userMirrorResult = await updatePatientPortalUserMirrorWithSchemaFallback\(/,
  'PATCH de paciente deve usar espelho tolerante a schema legado',
);

assert.match(
  panel,
  /if \(code\.includes\('DUPLICATE'\)\) \{[\s\S]*?await load\(\);[\s\S]*?return;/,
  'retry idempotente de vínculo existente deve recarregar o estado canônico em vez de manter erro falso',
);

console.log('patientCaseTeamSchemaDriftRecovery.test.mjs: ok');
