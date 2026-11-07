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


const portalLoad = dashboard.slice(
  dashboard.indexOf('const loadPortalAnamnesis = async'),
  dashboard.indexOf('const openPortalAppointmentDetail = async'),
);
assert.match(
  portalLoad,
  /if \(!portalAnamnesisDraftDirtyRef\.current\)\s*\{\s*setPortalAnamnesisDraft\(/,
  'GET tardio não pode substituir respostas ainda não salvas',
);
assert.match(
  portalLoad,
  /document\.visibilityState !== 'visible' \|\| !portalPatientId \|\| portalAnamnesisDraftDirtyRef\.current/,
  'focus e visibilitychange não devem refazer GET durante edição não salva',
);
assert.match(
  portalLoad,
  /portalAnamnesisDraftDirtyRef\.current = false;[\s\S]*?portalAnamnesisMutationRef\.current = null;[\s\S]*?setPortalAnamnesisDraft\(\{\}\)/,
  'trocar paciente ou clínica deve descartar somente o estado local do contexto anterior',
);
assert.match(
  dashboard,
  /const fieldDisabled = portalAnamnesisLocked \|\| isPrefilledByClinic \|\| portalAnamnesisState\.saving;/,
  'campos não podem mudar enquanto o Save ou Enviar aguarda ACK',
);
assert.match(
  dashboard,
  /const update = \(nextValue: any\) => \{\s*portalAnamnesisDraftDirtyRef\.current = true;\s*setPortalAnamnesisDraft\(/,
  'digitar marca o rascunho como não confirmado',
);

const portalMutations = dashboard.slice(
  dashboard.indexOf('const savePortalAnamnesisDraft = async'),
  dashboard.indexOf('const portalPlaceholderPanel ='),
);
const submitMutationStart = portalMutations.indexOf('const submitPortalAnamnesis = async');
assert.ok(submitMutationStart > 0, 'ambas as mutações da anamnese devem existir');
for (const [operation, body] of [
  ['savePortalAnamnesisDraft', portalMutations.slice(0, submitMutationStart)],
  ['submitPortalAnamnesis', portalMutations.slice(submitMutationStart)],
]) {
  assert.match(body, /portalAnamnesisMutationRef\.current\) return;/,
    operation + ': envio duplo síncrono deve ser bloqueado');
  assert.match(body, /portalAnamnesisMutationRef\.current !== ticket \|\| portalAnamnesisContextRef\.current !== contextKey/,
    operation + ': resposta tardia não pode atualizar outra clínica ou paciente');
  assert.match(body, /if \(result\?\.success !== true\)/,
    operation + ': apenas ACK positivo é persistência');
  assert.match(body, /portalAnamnesisDraftDirtyRef\.current = false;/,
    operation + ': somente ACK confirmado libera refetch do rascunho');
  assert.match(body, /finally \{[\s\S]*?portalAnamnesisMutationRef\.current = null;/,
    operation + ': lock deve ser liberado após falha ou sucesso');
}

console.log('anamnesisPortalReadOnlyStatus.regression.test.mjs: ok');
