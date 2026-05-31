import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const serverCode = read('server.ts');
const appCode = read('src/App.tsx');
const dataServiceCode = read('src/services/dataService.ts');
const patientDashboardCode = read('src/components/PatientDashboard.tsx');
const patientDetailCode = read('src/components/PatientDetailView.tsx');
const anamnesisSchemaCode = read('src/lib/anamnesisSchema.ts');
const migrationCode = read('supabase/migrations/20260530120000_anamnesis_relationship_flow.sql');

const tests: Array<{ name: string; fn: () => void }> = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });

function routeSlice(marker: string, chars = 2200) {
  const start = serverCode.indexOf(marker);
  assert.ok(start >= 0, `${marker} nao encontrado.`);
  return serverCode.slice(start, start + chars);
}

function between(startMarker: string, endMarker: string) {
  const start = serverCode.indexOf(startMarker);
  const end = serverCode.indexOf(endMarker, start);
  assert.ok(start >= 0, `${startMarker} nao encontrado.`);
  assert.ok(end > start, `${endMarker} nao encontrado depois de ${startMarker}.`);
  return serverCode.slice(start, end);
}

test('migration adiciona tabelas de anamnese, vinculo e historico compartilhado sem operacoes destrutivas', () => {
  for (const table of [
    'patient_anamnesis_requests',
    'patient_anamnesis_responses',
    'patient_relationship_confirmations',
    'patient_shared_history_snapshots'
  ]) {
    assert.match(migrationCode, new RegExp(`create table if not exists public\\.${table}`, 'i'));
    assert.match(migrationCode, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(migrationCode, new RegExp(`create policy [\\s\\S]*${table}`, 'i'));
  }

  for (const column of [
    'onboarding_status',
    'anamnesis_required',
    'anamnesis_requested_at',
    'anamnesis_submitted_at',
    'anamnesis_reviewed_at',
    'relationship_status'
  ]) {
    assert.match(migrationCode, new RegExp(`add column if not exists ${column}`, 'i'));
  }

  assert.match(migrationCode, /patients_status_check[\s\S]*PENDING_ANAMNESIS/);
  assert.match(migrationCode, /patients_status_check[\s\S]*PENDING_CONFIRMATION/);
  assert.match(migrationCode, /patient_anamnesis_requests_status_check[\s\S]*SENT[\s\S]*SUBMITTED[\s\S]*REVIEWED/);
  assert.match(migrationCode, /patient_relationship_confirmations_status_check[\s\S]*PENDING[\s\S]*CONFIRMED[\s\S]*REJECTED/);
  assert.doesNotMatch(migrationCode, /drop table/i);
  assert.doesNotMatch(migrationCode, /alter table public\.patients\s+drop column/i);
});

test('rotas novas sao autenticadas, escopadas por paciente/portal e sem select estrela', () => {
  assert.doesNotMatch(serverCode, /\.select\(\s*['"`]\*['"`]\s*\)/);

  assert.match(routeSlice("app.post('/api/patients/:patientId/anamnesis/send'"), /portalActionLimiter, checkAuth, checkPatientAccess, requireRoles\('coordinator', 'receptionist', 'therapist', 'admin', 'owner'\)/);
  assert.match(routeSlice("app.get('/api/patients/:patientId/anamnesis'"), /checkAuth, checkPatientAccess, requireRoles\('coordinator', 'receptionist', 'therapist', 'admin', 'owner'\)/);
  assert.match(routeSlice("app.patch('/api/patients/:patientId/anamnesis/draft'"), /portalActionLimiter, checkAuth, checkPatientAccess, requireRoles\('coordinator', 'receptionist', 'therapist', 'admin', 'owner'\)/);
  assert.match(routeSlice("app.post('/api/patients/:patientId/anamnesis/submit'"), /portalActionLimiter, checkAuth, checkPatientAccess, requireRoles\('coordinator', 'receptionist', 'therapist', 'admin', 'owner'\)/);
  assert.match(routeSlice("app.post('/api/patients/:patientId/anamnesis/review'"), /portalActionLimiter, checkAuth, checkPatientAccess, requireRoles\('coordinator', 'therapist', 'admin', 'owner'\)/);

  for (const marker of [
    "app.get('/api/portal/patients/:patientId/anamnesis'",
    "app.patch('/api/portal/patients/:patientId/anamnesis/draft'",
    "app.post('/api/portal/patients/:patientId/anamnesis/submit'"
  ]) {
    const route = routeSlice(marker);
    assert.match(route, /checkAuth/);
    assert.match(route, /canPortalSessionAccessPatient/);
  }

  assert.match(routeSlice("app.post('/api/portal/relationship-confirmations/:token/confirm'"), /portalActionLimiter, checkAuth/);
  assert.match(routeSlice("app.post('/api/portal/relationship-confirmations/:token/reject'"), /portalActionLimiter, checkAuth/);
  assert.match(routeSlice("app.post('/api/portal/shared-history/:confirmationId/authorize'"), /portalActionLimiter, checkAuth/);
  assert.match(routeSlice("app.get('/api/patients/:patientId/shared-history'"), /checkAuth, checkPatientAccess, requireRoles\('coordinator', 'therapist', 'admin', 'owner'\)/);
  assert.match(routeSlice("app.post('/api/patients/:patientId/shared-history/import'"), /portalActionLimiter, checkAuth, checkPatientAccess, requireRoles\('coordinator', 'admin', 'owner'\)/);
});

test('email existente gera confirmacao de vinculo e nao convite de ativacao', () => {
  const existingUserBranch = between('if (existingUser) {', '// 2. Create user in Supabase Auth');
  assert.match(existingUserBranch, /ensurePatientLink\(existingUser\.id, \{ existingAccount: true \}\)/);
  assert.match(existingUserBranch, /sendRelationshipConfirmationForLinkedPatient/);
  assert.match(existingUserBranch, /RELATIONSHIP_CONFIRMATION_SENT/);
  assert.match(existingUserBranch, /activationEmailSent:\s*false/);
  assert.match(existingUserBranch, /portabilityAvailable:\s*true/);
  assert.doesNotMatch(existingUserBranch, /sendPatientInviteInBackground/);

  const authDuplicateBranch = between('if (foundUser?.id) {', 'return res.status(409).json({');
  assert.match(authDuplicateBranch, /ensurePatientLink\(foundUser\.id, \{ existingAccount: true \}\)/);
  assert.match(authDuplicateBranch, /sendRelationshipConfirmationForLinkedPatient/);
  assert.match(authDuplicateBranch, /RELATIONSHIP_CONFIRMATION_SENT/);
  assert.match(authDuplicateBranch, /activationEmailSent:\s*false/);
  assert.doesNotMatch(authDuplicateBranch, /sendPatientInviteInBackground/);
});

test('anamnese obrigatoria impede ativacao clinica antes de revisao', () => {
  assert.match(serverCode, /const PATIENT_STATUS_PENDING_ANAMNESIS = 'PENDING_ANAMNESIS'/);
  assert.match(serverCode, /const ONBOARDING_READY_FOR_CARE = 'READY_FOR_CARE'/);
  assert.match(serverCode, /onboarding_status\.in\.\(READY_FOR_CARE,ANAMNESIS_REVIEWED\)/);
  assert.match(serverCode, /PATIENT_ANAMNESIS_PATIENT_SELECT_COLUMNS/);
  assert.match(serverCode, /const missingColumn = extractMissingColumnName\(error\)/);
  assert.match(serverCode, /columns\.includes\(missingColumn\)/);

  const patientPost = routeSlice("app.post('/api/patients',", 6500);
  assert.match(patientPost, /anamnesisRequired/);
  assert.match(patientPost, /PATIENT_STATUS_PENDING_ANAMNESIS/);
  assert.match(patientPost, /ONBOARDING_NOT_STARTED/);

  const portalSubmit = routeSlice("app.post('/api/portal/patients/:patientId/anamnesis/submit'", 3000);
  assert.match(portalSubmit, /ONBOARDING_ANAMNESIS_SUBMITTED/);
  assert.match(portalSubmit, /PATIENT_STATUS_PENDING_ANAMNESIS/);
  assert.doesNotMatch(portalSubmit, /PATIENT_STATUS_ACTIVE/);

  const clinicalReview = routeSlice("app.post('/api/patients/:patientId/anamnesis/review'", 2600);
  assert.match(clinicalReview, /PATIENT_STATUS_ACTIVE/);
  assert.match(clinicalReview, /ONBOARDING_READY_FOR_CARE/);
});

test('frontend expõe anamnese apenas como ficha solicitada e organizada em menu do portal', () => {
  for (const label of [
    /label: 'In.cio'/,
    /label: isKidsProfile \? 'Calend.rio' : 'Consultas'/,
    /label: 'Anamnese'/,
    /label: 'Anota..es'/,
    /label: 'Tarefas'/,
    /label: 'Relat.rio'/,
    /label: 'Documentos'/,
    /label: 'Perfil'/
  ]) {
    assert.match(patientDashboardCode, label);
  }

  assert.match(patientDashboardCode, /shouldOfferPortalAnamnesis \? \[\{ id: 'anamnesis'/);
  assert.match(patientDashboardCode, /portalSection === 'appointments' && portalAppointmentsPanel/);
  assert.match(patientDashboardCode, /portalSection === 'anamnesis' && portalAnamnesisPanel/);
  assert.match(patientDashboardCode, /prefillAnswers/);
  assert.match(patientDashboardCode, /setPortalAnamnesisDraft\(\{ \.\.\.prefillAnswers, \.\.\.answers \}\)/);
  assert.match(patientDashboardCode, /isPrefilledByClinic/);
  assert.match(patientDashboardCode, /Preenchido pela cl.nica/);
  assert.match(patientDashboardCode, /getPortalPatientAnamnesis/);
  assert.match(patientDashboardCode, /savePortalAnamnesisDraft/);
  assert.match(patientDashboardCode, /submitPortalAnamnesis/);
  assert.match(patientDashboardCode, /portalAnamnesisLocked/);
});

test('ficha enviada ao paciente leva cadastro preenchido e familia submete cadastro junto com respostas clinicas', () => {
  assert.match(serverCode, /function buildPatientRegistrationAnamnesisPrefill\(patient: any, registrationPayload: any = \{\}\)/);
  assert.match(serverCode, /async function fetchPatientRegistrationPayloadForAnamnesis/);
  assert.match(serverCode, /\.from\('patient_records'\)[\s\S]*\.select\(columns\.join\(', '\)\)[\s\S]*\.eq\('patient_id', safePatientId\)/);
  assert.match(serverCode, /payload_encrypted/);
  assert.match(serverCode, /payload_preview/);
  for (const column of [
    'social_name',
    'phone',
    'cpf',
    'birth_date',
    'gender',
    'insurance_type',
    'insurance_name',
    'insurance_card_number',
    'patient_group',
    'lead_source',
    'responsible_name',
    'responsible_phone',
    'responsible_email',
    'responsible_relationship',
    'metadata'
  ]) {
    assert.match(serverCode, new RegExp(`'${column}'`));
  }
  for (const field of ['responsavelEmail', 'responsavelRelacao']) {
    assert.match(anamnesisSchemaCode, new RegExp(`id: '${field}'`));
    assert.match(serverCode, new RegExp(field));
  }
  assert.match(serverCode, /hasResponsibleData/);
  assert.match(serverCode, /explicitMinor === true \|\| hasResponsibleData/);
  assert.match(serverCode, /prefillAnswers,\s*prefilledKeys/);
  assert.match(routeSlice("app.get('/api/portal/patients/:patientId/anamnesis'", 2200), /prefillAnswers: flow\.prefillAnswers \|\| \{\}/);
  assert.match(routeSlice("app.get('/api/patients/:patientId/anamnesis'", 2200), /prefillAnswers: flow\.prefillAnswers \|\| \{\}/);
  assert.match(routeSlice("app.patch('/api/portal/patients/:patientId/anamnesis/draft'", 3800), /const registrationPayload = await fetchPatientRegistrationPayloadForAnamnesis\(patientId, clinicId\)/);
  assert.match(routeSlice("app.patch('/api/portal/patients/:patientId/anamnesis/draft'", 3800), /mergeAnamnesisAnswersWithRegistrationPrefill\(patient, req\.body\?\.answers \|\| \{\}, registrationPayload\)/);
  assert.match(routeSlice("app.post('/api/portal/patients/:patientId/anamnesis/submit'", 3800), /const registrationPayload = await fetchPatientRegistrationPayloadForAnamnesis\(patientId, clinicId\)/);
  assert.match(routeSlice("app.post('/api/portal/patients/:patientId/anamnesis/submit'", 3800), /mergeAnamnesisAnswersWithRegistrationPrefill\(patient, req\.body\?\.answers \|\| \{\}, registrationPayload\)/);
});

test('novo envio de anamnese abre um ciclo novo para familia preencher como primeira vez', () => {
  const sendRoute = routeSlice("app.post('/api/patients/:patientId/anamnesis/send'", 5200);
  assert.match(sendRoute, /statuses: \['SENT', 'IN_PROGRESS'\]/);
  assert.doesNotMatch(sendRoute, /statuses: \['SENT', 'IN_PROGRESS', 'SUBMITTED'\]/);
  assert.match(serverCode, /fetchLatestPatientAnamnesisResponseWithSchemaFallback\(patientId: string, clinicId: string, requestId\?: string \| null\)/);
  assert.match(serverCode, /query = query\.eq\('request_id', safeRequestId\)/);
  assert.match(serverCode, /let responseResult = await fetchLatestPatientAnamnesisResponseWithSchemaFallback\(\s*patientId,\s*clinicId,\s*isUuid\(requestId\) \? requestId : null\s*\)/);
  assert.match(serverCode, /\['SUBMITTED', 'REVIEWED'\]\.includes\(requestStatus\)/);
  assert.match(patientDashboardCode, /hasPendingPortalAnamnesisHint/);
  assert.match(patientDashboardCode, /portalAnamnesisNeedsAction/);
  assert.match(patientDashboardCode, /portalAnamnesisTopNotice/);
});

test('profissional visualiza ficha submetida e pode salvar em Arquivos antes ou depois da revisao', () => {
  assert.match(patientDetailCode, /hasSubmittedAnamnesisFlow/);
  assert.match(patientDetailCode, /buildSubmittedAnamnesisDocumentData/);
  assert.match(patientDetailCode, /openSubmittedAnamnesisForFiles/);
  assert.match(patientDetailCode, /Ver ficha enviada/);
  assert.match(patientDetailCode, /setShowAnamnesisFileModal\(true\)/);
  assert.match(patientDetailCode, /Salvar em Arquivos/);
  assert.match(patientDetailCode, /savePatientAnamnesisSubmission/);
  assert.match(serverCode, /persistAnamnesisFinalFileFallback/);
  assert.match(serverCode, /answers:\s*\{\s*\.\.\.\(params\.flow\?\.prefillAnswers \|\| \{\}\),\s*\.\.\.\(response\?\.answers \|\| \{\}\)/);
});

test('profissional consegue enviar, acompanhar e revisar ficha sem expor detalhes de infraestrutura', () => {
  assert.match(patientDetailCode, /sendPatientAnamnesisRequest/);
  assert.match(patientDetailCode, /reviewPatientAnamnesis/);
  assert.match(patientDetailCode, /Enviar anamnese/);
  assert.match(patientDetailCode, /Marcar revisada/);
  assert.doesNotMatch(patientDetailCode, /confirmation_token_hash|request_id|Application failed to respond/);

  for (const method of [
    'sendPatientAnamnesisRequest',
    'getPatientAnamnesisFlow',
    'savePatientAnamnesisDraft',
    'submitPatientAnamnesis',
    'reviewPatientAnamnesis',
    'getPortalPatientAnamnesis',
    'savePortalAnamnesisDraft',
    'submitPortalAnamnesis',
    'sendPatientRelationshipConfirmation',
    'getPatientSharedHistory'
  ]) {
    assert.match(dataServiceCode, new RegExp(`async ${method}\\(`));
  }

  assert.match(appCode, /RELATIONSHIP_CONFIRMATION_SENT/);
  assert.match(appCode, /Envie a ficha de anamnese para concluir a ativa..o cl.nica/);
  assert.match(appCode, /PENDING_ANAMNESIS/);
});

test('historico compartilhado depende de autorizacao explicita e snapshot limitado', () => {
  assert.match(serverCode, /patient_shared_history_snapshots/);
  assert.match(serverCode, /existingSnapshots/);
  assert.match(serverCode, /idempotent:\s*true[\s\S]*Hist.rico compartilh.vel j. estava autorizado/);
  assert.match(serverCode, /buildPatientPortabilitySnapshot\(\{\s*patient,\s*notes:\s*\[\]/);
  assert.match(serverCode, /authorized_by_user_id/);
  assert.match(serverCode, /relationship_status:\s*RELATIONSHIP_CONFIRMED/);
  assert.match(serverCode, /confirmation_token_hash/);
  assert.match(serverCode, /hashIdentifier\(`relationship-confirmation:/);
  assert.match(migrationCode, /idx_shared_history_snapshots_confirmation/);
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

console.log(`${passed}/${tests.length} anamnesis portal flow checks passed`);
