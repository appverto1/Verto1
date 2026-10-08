import assert from 'node:assert/strict';
import fs from 'node:fs';

const authorization = fs.readFileSync('src/constants/authorizationModel.ts', 'utf8');
const detail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

const therapistStart = authorization.indexOf('therapist: internal(');
const therapistEnd = authorization.indexOf('receptionist: internal(', therapistStart);
assert.ok(therapistStart >= 0 && therapistEnd > therapistStart, 'therapist defaults must exist');
const therapistDefaults = authorization.slice(therapistStart, therapistEnd);
assert.doesNotMatch(therapistDefaults, /'clinical\.anamnesis\.view'/, 'terapeuta comum não recebe leitura de anamnese por padrão');
assert.doesNotMatch(
  therapistDefaults,
  /'clinical\.anamnesis\.edit'/,
  'profissional comum não deve editar anamnese por padrão',
);

const overlayStart = authorization.indexOf('SUPERVISION_CAPABILITY_OVERLAY');
const overlayEnd = authorization.indexOf('const COORDINATOR_DEFAULTS', overlayStart);
assert.ok(overlayStart >= 0 && overlayEnd > overlayStart, 'supervision overlay must exist');
assert.match(
  authorization.slice(overlayStart, overlayEnd),
  /'clinical\.anamnesis\.(?:view|edit)'/,
  'profissional autorizado a supervisionar deve recuperar a capability operacional',
);

assert.match(
  detail,
  /const canViewAnamnesis =[\s\S]*?hasCapability\('clinical\.anamnesis\.view'\)/,
);
assert.match(
  detail,
  /const canEditAnamnesis =[\s\S]*?hasCapability\('clinical\.anamnesis\.edit'\)/,
);
assert.match(
  detail,
  /openAnamnesisOnLoad && canEditAnamnesis/,
  'atalho de abertura não pode contornar a capability de edição',
);
assert.match(
  detail,
  /\{canEditAnamnesis && \([\s\S]{0,500}id="anamnesis-btn"/,
  'editor da anamnese deve exigir edit',
);
assert.match(
  detail,
  /\{canEditAnamnesis && \([\s\S]{0,500}handleSendAnamnesisRequest/,
  'envio de anamnese deve exigir edit',
);
assert.match(
  detail,
  /\{canViewAnamnesis && hasSubmittedAnamnesisFlow/,
  'visualização de ficha enviada deve continuar disponível com view',
);

for (const route of [
  "app.post('/api/patients/:patientId/anamnesis/send'",
  "app.patch('/api/patients/:patientId/anamnesis/draft'",
  "app.post('/api/patients/:patientId/anamnesis/submit'",
  "app.post('/api/patients/:patientId/anamnesis/review'",
]) {
  const index = server.indexOf(route);
  assert.ok(index >= 0, `missing route: ${route}`);
  assert.match(
    server.slice(index, index + 700),
    /requireClinicCapability\('clinical\.anamnesis\.edit'\)/,
    `backend route must require clinical.anamnesis.edit: ${route}`,
  );
}

console.log('anamnesisProfessionalCapability.regression.test.mjs: ok');
