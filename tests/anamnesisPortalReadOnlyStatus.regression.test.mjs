import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const dashboard = fs.readFileSync('src/components/PatientDashboard.tsx', 'utf8');

const routeSlice = (startNeedle, endNeedle) => {
  const start = server.indexOf(startNeedle);
  const end = server.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `route slice missing: ${startNeedle}`);
  return server.slice(start, end);
};

const portalGet = routeSlice(
  "app.get('/api/portal/patients/:patientId/anamnesis'",
  "app.patch('/api/portal/patients/:patientId/anamnesis/draft'"
);

assert.match(portalGet, /fetchPatientAnamnesisFlow\(patientId, clinicId\)/);
assert.doesNotMatch(portalGet, /updateRowsWithSchemaFallback|updatePatientOnboardingWithSchemaFallback|upsertAnamnesisResponse/);

const portalDraft = routeSlice(
  "app.patch('/api/portal/patients/:patientId/anamnesis/draft'",
  "app.post('/api/portal/patients/:patientId/anamnesis/submit'"
);
assert.match(
  portalDraft,
  /statuses: \['SENT', 'IN_PROGRESS'\]/,
  'rascunho do portal só pode atuar sobre solicitação ainda editável'
);

const portalSubmit = routeSlice(
  "app.post('/api/portal/patients/:patientId/anamnesis/submit'",
  "app.post('/api/patients/:patientId/relationship-confirmation/send'"
);
assert.match(
  portalSubmit,
  /statuses: \['SENT', 'IN_PROGRESS'\]/,
  'envio do portal não pode reabrir solicitação SUBMITTED ou REVIEWED'
);

assert.match(
  dashboard,
  /portalAnamnesisRequestStatus === 'REVIEWED'[\s\S]*?portalAnamnesisResponseStatus === 'REVIEWED'/,
  'anamnese revisada deve permanecer bloqueada no portal'
);
assert.match(
  dashboard,
  /portalAnamnesisRequestStatus === 'SUBMITTED'[\s\S]*?portalAnamnesisResponseStatus === 'SUBMITTED'/,
  'anamnese enviada deve permanecer bloqueada no portal'
);

console.log('anamnesisPortalReadOnlyStatus.regression.test.mjs: ok');
