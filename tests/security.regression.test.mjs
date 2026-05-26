import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const serverPath = path.resolve(process.cwd(), 'server.ts');
const serverCode = fs.readFileSync(serverPath, 'utf8');
const coordinatorPath = path.resolve(process.cwd(), 'src/components/CoordinatorDashboard.tsx');
const coordinatorCode = fs.readFileSync(coordinatorPath, 'utf8');
const appPath = path.resolve(process.cwd(), 'src/App.tsx');
const appCode = fs.readFileSync(appPath, 'utf8');
const indexPath = path.resolve(process.cwd(), 'index.html');
const indexCode = fs.readFileSync(indexPath, 'utf8');
const mainPath = path.resolve(process.cwd(), 'src/main.tsx');
const mainCode = fs.readFileSync(mainPath, 'utf8');
const clarityPath = path.resolve(process.cwd(), 'src/clarity.ts');
const clarityCode = fs.existsSync(clarityPath) ? fs.readFileSync(clarityPath, 'utf8') : '';
const dataServicePath = path.resolve(process.cwd(), 'src/services/dataService.ts');
const dataServiceCode = fs.readFileSync(dataServicePath, 'utf8');
const patientDetailPath = path.resolve(process.cwd(), 'src/components/PatientDetailView.tsx');
const patientDetailCode = fs.readFileSync(patientDetailPath, 'utf8');
const abaPromptPath = path.resolve(process.cwd(), 'src/utils/abaPromptLevels.ts');
const abaPromptCode = fs.readFileSync(abaPromptPath, 'utf8');
const sessionModePath = path.resolve(process.cwd(), 'src/components/SessionMode.tsx');
const sessionModeCode = fs.readFileSync(sessionModePath, 'utf8');
const featureFlagsPath = path.resolve(process.cwd(), 'src/utils/featureFlags.ts');
const featureFlagsCode = fs.readFileSync(featureFlagsPath, 'utf8');
const financialRlsPath = path.resolve(process.cwd(), 'supabase/migrations/20260521143000_financial_rls_coordinator_only.sql');
const financialRlsCode = fs.readFileSync(financialRlsPath, 'utf8');
const abaRlsPath = path.resolve(process.cwd(), 'supabase/migrations/20260523120000_aba_clinical_core.sql');
const abaRlsCode = fs.readFileSync(abaRlsPath, 'utf8');
const abaMasteryRlsPath = path.resolve(process.cwd(), 'supabase/migrations/20260523123000_aba_mastery_engine.sql');
const abaMasteryRlsCode = fs.readFileSync(abaMasteryRlsPath, 'utf8');
const abaV2RlsPath = path.resolve(process.cwd(), 'supabase/migrations/20260524103000_aba_v2_interval_abc_audit.sql');
const abaV2RlsCode = fs.readFileSync(abaV2RlsPath, 'utf8');

function expectPattern(pattern, message) {
  assert.match(serverCode, pattern, message);
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('multi-tenant: checkPatientAccess allows global bypass only for admin/owner', () => {
  expectPattern(
    /function hasGlobalClinicAccess\(user: any\): boolean[\s\S]*?role === 'admin' \|\| role === 'owner'/m,
    'hasGlobalClinicAccess deve restringir bypass global a admin/owner.'
  );
  expectPattern(
    /const checkPatientAccess = async[\s\S]*?if \(hasGlobalClinicAccess\(user\)\) return next\(\);/m,
    'checkPatientAccess deve usar bypass global restrito.'
  );
});

test('multi-tenant: checkPatientAccess canonicalizes snake/camel patient ids', () => {
  expectPattern(
    /const requestPatientIdAliases = \[[\s\S]*?req\.params\?\.patientId[\s\S]*?req\.body\?\.patient_id[\s\S]*?req\.body\?\.patientId[\s\S]*?\]\.filter\(Boolean\);/m,
    'checkPatientAccess deve validar patient_id e patientId como aliases do mesmo paciente.'
  );
  expectPattern(
    /const uniquePatientIdAliases = Array\.from\(new Set\(requestPatientIdAliases\)\);[\s\S]*?if \(uniquePatientIdAliases\.length > 1\)[\s\S]*?return res\.status\(400\)\.json\(\{ success: false, error: 'Identificadores de paciente divergentes\.' \}\);/m,
    'checkPatientAccess deve rejeitar payloads com patient_id e patientId divergentes.'
  );
  expectPattern(
    /const canonicalPatientId = resolvedPatientId \|\| rawPatientId;[\s\S]*?req\.resolvedPatientId = canonicalPatientId;[\s\S]*?req\.body\.patient_id = canonicalPatientId;[\s\S]*?req\.body\.patientId = canonicalPatientId;/m,
    'checkPatientAccess deve canonicalizar ambos os aliases antes de seguir para a rota.'
  );
});

test('multi-tenant: patient record read/write enforces clinic scope for non-global roles', () => {
  expectPattern(
    /app\.post\('\/api\/patient-records\/:patientId'[\s\S]*?if \(!hasGlobalClinicAccess\(req\.session\.user\)\)[\s\S]*?existingQuery = existingQuery\.eq\('clinic_id', clinicId\);/m,
    'POST /api/patient-records deve filtrar clinic_id para perfis não globais.'
  );
  expectPattern(
    /app\.get\('\/api\/patient-records\/:patientId'[\s\S]*?if \(!hasGlobalClinicAccess\(req\.session\.user\)\)[\s\S]*?query = query\.eq\('clinic_id', clinicId\);/m,
    'GET /api/patient-records deve filtrar clinic_id para perfis não globais.'
  );
});

test('multi-tenant: email-based endpoints scope records by clinic patient ids', () => {
  expectPattern(
    /async function getClinicPatientIdsByEmail\(clinicId: string, patientEmail: string\)/m,
    'helper de escopo por clínica/e-mail deve existir.'
  );

  const endpoints = [
    "app.get('/api/notes/email/:email'",
    "app.get('/api/history/email/:email'",
    "app.get('/api/tasks/email/:email'"
  ];

  for (const marker of endpoints) {
    const start = serverCode.indexOf(marker);
    assert.ok(start >= 0, `endpoint ${marker} não encontrado.`);
    const slice = serverCode.slice(start, start + 2600);
    assert.match(
      slice,
      /getClinicPatientIdsByEmail\(clinicId, safeEmail\)/,
      `${marker} deve buscar patient ids por clínica.`
    );
    assert.match(
      slice,
      /query = query\.in\('patient_id', clinicPatientIds\);/,
      `${marker} deve aplicar filtro query.in('patient_id', clinicPatientIds).`
    );
  }
});

test('xss: notes and history write paths escape HTML via sanitizeTextField', () => {
  expectPattern(
    /function sanitizeTextField\(value: unknown, maxLength = 5000\): string \{[\s\S]*?escapeHtml/s,
    'sanitizeTextField deve escapar HTML.'
  );
  expectPattern(
    /app\.post\('\/api\/notes'[\s\S]*?text: sanitizeTextField\(req\.body\?\.text, 12000\)/m,
    'POST /api/notes deve sanitizar campo text com sanitizeTextField.'
  );
  expectPattern(
    /app\.post\('\/api\/notes'[\s\S]*?subject: sanitizeTextField\(req\.body\?\.subject, 100\)/m,
    'POST /api/notes deve sanitizar subject com sanitizeTextField.'
  );
  expectPattern(
    /app\.post\('\/api\/history'[\s\S]*?title: sanitizeTextField\(req\.body\?\.title, 180\)/m,
    'POST /api/history deve sanitizar title com sanitizeTextField.'
  );
  expectPattern(
    /app\.post\('\/api\/history'[\s\S]*?note: sanitizeTextField\(req\.body\?\.note, 12000\)/m,
    'POST /api/history deve sanitizar note com sanitizeTextField.'
  );
});

test('csp: Clarity tracking is loaded from bundled code, not inline HTML', () => {
  assert.doesNotMatch(indexCode, /clarity\.ms\/tag|<script\s+type="text\/javascript"/i);
  assert.match(indexCode, /<meta name="mobile-web-app-capable" content="yes" \/>/);
  assert.match(mainCode, /installClarityTracking\(\)/);
  assert.match(clarityCode, /https:\/\/www\.clarity\.ms\/tag\/\$\{CLARITY_TAG_ID\}/);
  expectPattern(
    /scriptSrc: \["'self'", "https:\/\/www\.clarity\.ms", "https:\/\/\*\.clarity\.ms"\]/,
    'CSP deve permitir script externo do Microsoft Clarity sem unsafe-inline.'
  );
  expectPattern(
    /const connectSrc = \["'self'", "https:\/\/\*\.supabase\.co", "wss:\/\/\*\.supabase\.co", "https:\/\/\*\.clarity\.ms"\]/,
    'CSP deve permitir conexoes do Microsoft Clarity.'
  );
});

test('xss: media and receipt data URLs reject SVG/scriptable payloads', () => {
  expectPattern(
    /const SAFE_IMAGE_DATA_URL_PATTERN = \/\^data:image\\\/\(png\|jpeg\|jpg\|webp\);base64,\[a-z0-9\+\/=\\s\]\+\$\/i/m,
    'data URLs de imagem devem aceitar apenas png/jpeg/webp em base64.'
  );
  expectPattern(
    /const SAFE_PDF_DATA_URL_PATTERN = \/\^data:application\\\/pdf;base64,\[a-z0-9\+\/=\\s\]\+\$\/i/m,
    'data URLs de PDF devem exigir application/pdf em base64.'
  );
  expectPattern(
    /function sanitizeUrl\(value: unknown\): string \| null \{[\s\S]*?SAFE_IMAGE_DATA_URL_PATTERN\.test\(url\) \? url : null;/m,
    'sanitizeUrl deve bloquear image/svg+xml e outros tipos scriptÃ¡veis.'
  );
  expectPattern(
    /function sanitizeReceiptUrl\(value: unknown\): string \| null \{[\s\S]*?SAFE_PDF_DATA_URL_PATTERN\.test\(url\) \? url : null;/m,
    'sanitizeReceiptUrl deve validar recibos PDF data: em base64.'
  );
});

test('dos/input-size: critical endpoints enforce body size limits', () => {
  expectPattern(
    /app\.post\('\/api\/patient-records\/:patientId'[\s\S]*?enforcePayloadLimit\(req, res, 512 \* 1024, 'Payload do prontuário'\)/m,
    'POST /api/patient-records deve impor limite de 512KB.'
  );
  expectPattern(
    /app\.post\('\/api\/notes'[\s\S]*?enforcePayloadLimit\(req, res, 64 \* 1024, 'Payload de anotações'\)/m,
    'POST /api/notes deve impor limite de 64KB.'
  );
  expectPattern(
    /app\.post\('\/api\/history'[\s\S]*?enforcePayloadLimit\(req, res, 96 \* 1024, 'Payload de relatório\/evolução'\)/m,
    'POST /api/history deve impor limite de 96KB.'
  );
});

test('object pollution: clinical payload sanitizer blocks dangerous keys', () => {
  expectPattern(
    /const DANGEROUS_OBJECT_KEYS = new Set\(\['__proto__', 'prototype', 'constructor'\]\)/m,
    'sanitizador deve bloquear chaves perigosas de poluição de objeto.'
  );
  expectPattern(
    /function sanitizeClinicalPayload\(input: any, depth = 0\): any[\s\S]*?if \(!key \|\| DANGEROUS_OBJECT_KEYS\.has\(key\)\) continue;/m,
    'sanitizeClinicalPayload deve pular keys perigosas.'
  );
});

test('tenant drift: patient clinic_id update is restricted to global roles', () => {
  expectPattern(
    /app\.patch\('\/api\/patients\/:id'[\s\S]*?const canChangeClinic = hasGlobalClinicAccess\(req\.session\.user\);[\s\S]*?clinic_id: canChangeClinic && req\.body\?\.clinic_id !== undefined/m,
    'PATCH /api/patients/:id deve permitir clinic_id apenas para admin/owner.'
  );
});

test('finance privacy: API endpoints are coordinator/admin/owner only', () => {
  const financeMarkers = [
    "app.get('/api/payments'",
    "app.post('/api/payments'",
    "app.patch('/api/payments/:paymentId'",
    "app.get('/api/financial/professional-payments'",
    "app.post('/api/financial/professional-payments'",
    "app.patch('/api/financial/professional-payments/:paymentId'",
    "app.get('/api/financial/entries'",
    "app.get('/api/financial/feature-survey'",
    "app.post('/api/financial/feature-survey'"
  ];

  for (const marker of financeMarkers) {
    const start = serverCode.indexOf(marker);
    assert.ok(start >= 0, `endpoint ${marker} nÃ£o encontrado.`);
    const slice = serverCode.slice(start, start + 260);
    assert.match(
      slice,
      /requireRoles\('coordinator', 'admin', 'owner'\)/,
      `${marker} deve aceitar somente coordinator/admin/owner.`
    );
    assert.doesNotMatch(
      slice,
      /receptionist|therapist|patient/,
      `${marker} nÃ£o deve expor dados financeiros a recepcionista, terapeuta ou paciente.`
    );
  }
});

test('finance privacy: patient record payload redacts financial fields for non-finance roles', () => {
  expectPattern(
    /function canAccessClinicFinance\(user: any\): boolean[\s\S]*?role === 'coordinator' \|\| role === 'admin' \|\| role === 'owner'/m,
    'helper de acesso financeiro deve permitir apenas coordinator/admin/owner.'
  );
  expectPattern(
    /const PATIENT_FINANCIAL_PAYLOAD_KEYS = new Set\(\[[\s\S]*?'financialPlans'[\s\S]*?'monthlyTreatmentValue'[\s\S]*?'billingMethod'/m,
    'campos financeiros do prontuÃ¡rio devem estar na lista de redaÃ§Ã£o.'
  );
  expectPattern(
    /const payloadRaw = redactPatientFinancialPayload\(payloadRawBase, req\.session\.user\);/m,
    'POST /api/patient-records deve remover campos financeiros antes de sanitizar para perfis sem permissÃ£o.'
  );
  expectPattern(
    /payload: redactPatientFinancialPayload\(decryptedPayload, req\.session\.user\),/m,
    'GET /api/patient-records deve redigir campos financeiros para perfis sem permissÃ£o.'
  );
});

test('finance privacy: frontend does not fetch or render finance for unauthorized roles', () => {
  assert.match(
    coordinatorCode,
    /const canAccessClinicFinance = \["coordinator", "admin", "owner"\]\.includes\(role\.toLowerCase\(\)\);/,
    'CoordinatorDashboard deve declarar a regra local de acesso financeiro.'
  );
  assert.match(
    coordinatorCode,
    /if \(tabId === "financial"\) return canAccessClinicFinance;/,
    'aba financeira deve depender da regra coordinator/admin/owner.'
  );
  assert.match(
    coordinatorCode,
    /if \(!canAccessClinicFinance\) return;[\s\S]*?dataService\.getPayments\(\)/m,
    'frontend nÃ£o deve buscar pagamentos sem permissÃ£o financeira.'
  );
  assert.match(
    coordinatorCode,
    /\{canAccessClinicFinance && activeTab === "financial" && \(/,
    'frontend nÃ£o deve renderizar a tela financeira sem permissÃ£o.'
  );
  assert.match(
    appCode,
    /const visiblePatients = canAccessClinicFinance\(nextUser\?\.role\)[\s\S]*?: hydratedPatients\.map\(stripPatientFinancialFields\);/m,
    'hidrataÃ§Ã£o do app deve remover campos financeiros para perfis sem permissÃ£o.'
  );
});

test('finance privacy: RLS is enabled and coordinator-scoped for DRE tables', () => {
  for (const tableName of ['payments', 'professional_payments', 'clinic_financial_entries']) {
    assert.match(
      financialRlsCode,
      new RegExp(`alter table public\\.${tableName} enable row level security;`),
      `${tableName} deve ter RLS habilitado.`
    );
  }
  assert.match(
    financialRlsCode,
    /u\.role = 'coordinator'[\s\S]*?u\.clinic_id::text = payments\.clinic_id/m,
    'payments deve permitir somente coordenador da clÃ­nica, admin ou owner.'
  );
  assert.match(
    financialRlsCode,
    /u\.role = 'coordinator'[\s\S]*?u\.clinic_id::text = professional_payments\.clinic_id/m,
    'professional_payments deve permitir somente coordenador da clÃ­nica, admin ou owner.'
  );
  assert.match(
    financialRlsCode,
    /u\.role = 'coordinator'[\s\S]*?u\.clinic_id::text = clinic_financial_entries\.clinic_id/m,
    'clinic_financial_entries deve permitir somente coordenador da clÃ­nica, admin ou owner.'
  );
  assert.doesNotMatch(
    financialRlsCode,
    /receptionist|therapist|patient/,
    'RLS financeiro nÃ£o deve conceder acesso a recepcionista, terapeuta ou paciente.'
  );
});

test('aba privacy: API endpoints are clinic-scoped and exclude patient/receptionist roles', () => {
  const abaMarkers = [
    "app.post('/api/aba/sessions'",
    "app.patch('/api/aba/sessions/:sessionId'",
    "app.get('/api/aba/sessions/:patientId'",
    "app.post('/api/aba/session-summaries'",
    "app.post('/api/aba/trials'",
    "app.get('/api/aba/trials/:patientId'",
    "app.post('/api/aba/behavior-events'",
    "app.get('/api/aba/behavior-events/:patientId'",
    "app.post('/api/aba/interval-records'",
    "app.post('/api/aba/interval-summaries'",
    "app.post('/api/aba/abc-events'",
    "app.post('/api/aba/mastery-evaluations'",
    "app.get('/api/aba/mastery-evaluations/:patientId'"
  ];

  for (const marker of abaMarkers) {
    const start = serverCode.indexOf(marker);
    assert.ok(start >= 0, `endpoint ${marker} nao encontrado.`);
    const slice = serverCode.slice(start, start + 900);
    assert.match(
      slice,
      /requireRoles\('coordinator', 'therapist', 'admin', 'owner'\)/,
      `${marker} deve aceitar somente coordenador, terapeuta vinculado, admin ou owner.`
    );
    assert.match(
      slice,
      /requireAbaV2Feature/,
      `${marker} deve ficar isolado pela feature flag aba_v2.`
    );
    assert.doesNotMatch(
      slice,
      /requireRoles\([^)]*'patient'|requireRoles\([^)]*'receptionist'/,
      `${marker} nao deve expor ABA para paciente ou recepcao.`
    );
  }

  assert.match(
    serverCode,
    /app\.post\('\/api\/aba\/sessions'[\s\S]*?checkPatientAccess/m,
    'POST /api/aba/sessions deve validar acesso ao paciente.'
  );
  assert.match(
    serverCode,
    /app\.post\('\/api\/aba\/trials'[\s\S]*?checkPatientAccess/m,
    'POST /api/aba/trials deve validar acesso ao paciente.'
  );
  assert.match(
    serverCode,
    /app\.get\('\/api\/aba\/trials\/:patientId'[\s\S]*?checkPatientAccess/m,
    'GET /api/aba/trials/:patientId deve validar acesso ao paciente.'
  );
  assert.match(
    serverCode,
    /app\.post\('\/api\/aba\/behavior-events'[\s\S]*?checkPatientAccess/m,
    'POST /api/aba/behavior-events deve validar acesso ao paciente.'
  );
  assert.match(
    serverCode,
    /app\.get\('\/api\/aba\/behavior-events\/:patientId'[\s\S]*?checkPatientAccess/m,
    'GET /api/aba/behavior-events/:patientId deve validar acesso ao paciente.'
  );
  assert.match(
    serverCode,
    /app\.post\('\/api\/aba\/mastery-evaluations'[\s\S]*?checkPatientAccess/m,
    'POST /api/aba/mastery-evaluations deve validar acesso ao paciente.'
  );
  assert.match(
    serverCode,
    /app\.get\('\/api\/aba\/mastery-evaluations\/:patientId'[\s\S]*?checkPatientAccess/m,
    'GET /api/aba/mastery-evaluations/:patientId deve validar acesso ao paciente.'
  );
});

test('aba privacy: RLS is enabled and patient-scoped for clinical ABA tables', () => {
  for (const tableName of ['aba_programs', 'aba_targets', 'aba_behavior_definitions', 'aba_behavior_events', 'aba_sessions', 'aba_trials']) {
    assert.match(
      abaRlsCode,
      new RegExp(`alter table public\\.${tableName} enable row level security;`),
      `${tableName} deve ter RLS habilitado.`
    );
  }
  assert.match(
    abaRlsCode,
    /u\.role = 'coordinator'[\s\S]*?u\.clinic_id::text = aba_trials\.clinic_id/m,
    'aba_trials deve permitir coordenador somente dentro da clinica.'
  );
  assert.match(
    abaRlsCode,
    /u\.role = 'coordinator'[\s\S]*?u\.clinic_id::text = aba_behavior_events\.clinic_id/m,
    'aba_behavior_events deve permitir coordenador somente dentro da clinica.'
  );
  assert.match(
    abaRlsCode,
    /u\.role = 'therapist'[\s\S]*?p\.therapist_id = auth\.uid\(\)[\s\S]*?u\.clinic_id::text = aba_sessions\.clinic_id/m,
    'aba_sessions deve permitir terapeuta somente quando vinculado ao paciente.'
  );
  assert.doesNotMatch(
    abaRlsCode,
    /u\.role = 'patient'|u\.role = 'receptionist'/,
    'RLS ABA nao deve conceder acesso direto a paciente ou recepcao.'
  );
  assert.match(
    abaMasteryRlsCode,
    /alter table public\.aba_mastery_evaluations enable row level security;/,
    'aba_mastery_evaluations deve ter RLS habilitado.'
  );
  assert.match(
    abaMasteryRlsCode,
    /u\.role = 'coordinator'[\s\S]*?u\.clinic_id::text = aba_mastery_evaluations\.clinic_id/m,
    'aba_mastery_evaluations deve permitir coordenador somente dentro da clinica.'
  );
  assert.match(
    abaMasteryRlsCode,
    /u\.role = 'therapist'[\s\S]*?p\.therapist_id = auth\.uid\(\)[\s\S]*?u\.clinic_id::text = aba_mastery_evaluations\.clinic_id/m,
    'aba_mastery_evaluations deve permitir terapeuta somente quando vinculado ao paciente.'
  );
  for (const tableName of ['aba_interval_records', 'aba_interval_summaries', 'aba_abc_events', 'aba_audit_events']) {
    assert.match(
      abaV2RlsCode,
      new RegExp(`alter table public\\.${tableName} enable row level security;`),
      `${tableName} deve ter RLS habilitado.`
    );
  }
  assert.match(
    abaV2RlsCode,
    /u\.role = 'coordinator'[\s\S]*?u\.clinic_id::text = aba_interval_records\.clinic_id/m,
    'aba_interval_records deve permitir coordenador somente dentro da clinica.'
  );
  assert.match(
    abaV2RlsCode,
    /u\.role = 'therapist'[\s\S]*?p\.therapist_id = auth\.uid\(\)[\s\S]*?u\.clinic_id::text = aba_abc_events\.clinic_id/m,
    'aba_abc_events deve permitir terapeuta somente quando vinculado ao paciente.'
  );
  assert.doesNotMatch(
    abaV2RlsCode,
    /u\.role = 'patient'|u\.role = 'receptionist'/,
    'RLS ABA V2 nao deve conceder acesso direto a paciente ou recepcao.'
  );
  assert.doesNotMatch(
    abaMasteryRlsCode,
    /u\.role = 'patient'|u\.role = 'receptionist'/,
    'RLS ABA de maestria nao deve conceder acesso direto a paciente ou recepcao.'
  );
});

test('aba v2 feature flag: frontend and backend can disable isolated ABA V2 flows', () => {
  assert.match(
    featureFlagsCode,
    /export const isAbaV2Enabled[\s\S]*?resolveFeatureFlag\('aba_v2'/m,
    'frontend deve expor feature flag aba_v2.'
  );
  assert.match(
    serverCode,
    /const requireAbaV2Feature[\s\S]*?feature_disabled[\s\S]*?aba_v2/m,
    'backend deve bloquear rotas ABA V2 quando a feature flag estiver desligada.'
  );
  assert.match(
    dataServiceCode,
    /if \(!isAbaV2Enabled\(\)\) return abaV2DisabledResponse/m,
    'dataService deve evitar writes ABA V2 quando aba_v2=false.'
  );
  assert.match(
    patientDetailCode,
    /abaV2Enabled && isSessionModeOpen[\s\S]*?<SessionMode/m,
    'PatientDetailView deve isolar o componente SessionMode por aba_v2.'
  );
  assert.match(
    appCode,
    /if \(isAbaV2Enabled\(\)\) \{[\s\S]*?dataService\.saveAbaTrial/m,
    'App nao deve gravar tentativas estruturadas quando aba_v2=false.'
  );
});

test('aba prompt integrity: dropdown selections are canonical and persistent', () => {
  assert.match(
    abaPromptCode,
    /ABA_PROMPT_LEVEL_OPTIONS[\s\S]*?key: 'gestural', label: 'Gestual'[\s\S]*?key: 'verbal', label: 'Verbal'[\s\S]*?key: 'other', label: 'Outro'/m,
    'A hierarquia de prompt deve incluir Gestual, Verbal e Outro canônicos.'
  );
  assert.match(
    abaPromptCode,
    /export function resolveAbaPromptLevel[\s\S]*?getAbaPromptLevel\(input\.promptLevelKey\)[\s\S]*?getAbaPromptLevel\(input\.promptLevelName\)/m,
    'resolveAbaPromptLevel deve priorizar chave/nome explícitos antes de inferir por pontuação.'
  );
  assert.match(
    sessionModeCode,
    /promptLevelKey: selectedPrompt\.key[\s\S]*?promptLevelName: selectedPrompt\.label[\s\S]*?promptLevel: selectedPrompt\.key/m,
    'SessionMode deve enviar o prompt selecionado no dropdown mesmo sem depender de fallback por score.'
  );
  assert.doesNotMatch(
    sessionModeCode,
    /const sessionMeta = activeSession\s*\?/m,
    'SessionMode nao deve descartar promptLevelKey/promptLevelName quando nao houver sessao ativa.'
  );
  assert.match(
    appCode,
    /const abaPromptLevel = resolveAbaPromptLevel\(\{[\s\S]*?promptLevelKey: sessionMeta\?\.promptLevelKey[\s\S]*?prompt_level_name: abaPromptLevel\.label/m,
    'App deve persistir o rótulo canônico do prompt escolhido.'
  );
  assert.match(
    dataServiceCode,
    /const abaPromptLevel = resolveAbaPromptLevel\(\{[\s\S]*?prompt_level_key: abaPromptLevel\.key[\s\S]*?prompt_level_name: abaPromptLevel\.label/m,
    'dataService deve salvar key/name canônicos no cache offline e no payload.'
  );
  assert.match(
    serverCode,
    /const promptLevel = resolveAbaPromptLevel\(\{[\s\S]*?promptLevelKey: req\.body\?\.prompt_level_key[\s\S]*?prompt_level_name: promptLevel\.label/m,
    'Backend deve normalizar prompt_level_key/prompt_level_name antes do upsert.'
  );
  assert.match(
    patientDetailCode,
    /const prompt = resolveAbaPromptLevel\(\{[\s\S]*?promptLevelKey: trial\?\.prompt_level_key[\s\S]*?\}\)\.label/m,
    'PatientDetailView deve renderizar tentativas pelo prompt canônico persistido.'
  );
});

test('aba session mode: trials and behavior events are one-touch and session-scoped', () => {
  assert.match(
    sessionModeCode,
    /onClick=\{\(\) => handleTrialClick\(goal, 1, 'independent'\)\}[\s\S]*?Independente[\s\S]*?onClick=\{\(\) => handleTrialClick\(goal, 0\.5, 'prompted'(?:, promptLevelKey)?\)\}[\s\S]*?Com ajuda[\s\S]*?onClick=\{\(\) => handleTrialClick\(goal, 0, 'error'\)\}[\s\S]*?Erro/m,
    'SessionMode deve salvar tentativa em um toque com botoes Independente, Com ajuda e Erro.'
  );
  assert.match(
    appCode,
    /dataService\.saveAbaTrial\(\{[\s\S]*?patientId: String\(pid\)[\s\S]*?sessionId: sessionMeta\?\.sessionId[\s\S]*?targetId: abaTargetId[\s\S]*?trialType: abaCollectionType[\s\S]*?score: finalScore[\s\S]*?isCorrect: abaCorrect[\s\S]*?isIndependent: abaIndependent[\s\S]*?promptLevel: promptLevelKey[\s\S]*?timestamp: recordedAt[\s\S]*?therapistId: user\?\.id/m,
    'App deve persistir os campos essenciais do Trial ABA.'
  );
  assert.match(
    sessionModeCode,
    /const behaviorMeasurementOptions = \[[\s\S]*?'frequency'[\s\S]*?'duration'[\s\S]*?'rate'[\s\S]*?'partial_interval'[\s\S]*?'whole_interval'[\s\S]*?'momentary_time_sampling'[\s\S]*?'abc'/m,
    'SessionMode deve oferecer todos os metodos de evento comportamental.'
  );
  assert.match(
    sessionModeCode,
    /const registerFrequency[\s\S]*?const startDuration[\s\S]*?const endDuration[\s\S]*?const startRateWindow[\s\S]*?const startIntervalRun[\s\S]*?const registerInterval[\s\S]*?const saveAbcEvent/m,
    'SessionMode deve implementar frequencia, duracao, taxa, intervalo, amostragem momentanea e ABC.'
  );
  assert.match(
    sessionModeCode,
    /syncLabels[\s\S]*?salvo localmente[\s\S]*?sincronizando[\s\S]*?sincronizado[\s\S]*?erro[\s\S]*?Evento comportamental inteligente[\s\S]*?Histórico da sessão/m,
    'SessionMode deve mostrar histórico da sessão e indicadores de sincronização.'
  );
  assert.match(
    sessionModeCode,
    /canCloseAbaSession\(\{[\s\S]*?openDurations[\s\S]*?intervalRun[\s\S]*?unsavedLocalCount[\s\S]*?Bloqueios de encerramento[\s\S]*?Encerrar agora[\s\S]*?Descartar evento[\s\S]*?Voltar para sessão/m,
    'SessionMode deve bloquear encerramento com duração aberta.'
  );
  assert.match(
    sessionModeCode,
    /intervalResponseActive[\s\S]*?intervalRun\?\.awaitingResponse[\s\S]*?scrollBottomPaddingStyle[\s\S]*?clinicalDock = !sessionCompleted && !intervalResponseActive[\s\S]*?clinicalDockSheetOpen && !intervalResponseActive[\s\S]*?data-aba-interval-response-active[\s\S]*?min-h-\[56px\]/m,
    'SessionMode deve ocultar o dock e priorizar SIM/NÃO durante a resposta de intervalo no mobile.'
  );
  assert.match(
    sessionModeCode,
    /scrollBottomPaddingStyle[\s\S]*?closeAfterAction[\s\S]*?data-aba-dock-duration-active[\s\S]*?animate-pulse[\s\S]*?-top-3 right-2[\s\S]*?data-aba-dock-open-duration-badge[\s\S]*?Local atual[\s\S]*?Severidade atual[\s\S]*?Últimos registros[\s\S]*?style=\{scrollBottomPaddingStyle\}/m,
    'Dock clínico mobile deve reservar espaço, indicar duração ativa, mostrar +1 flutuante e fechar ações rápidas da sheet.'
  );
  assert.match(
    sessionModeCode,
    /const AbaSessionToast = \(\{ toast, compact = false \}[\s\S]*?compactTitle[\s\S]*?compactSubtitle[\s\S]*?data-aba-toast-compact[\s\S]*?intervalToastCompact[\s\S]*?1500[\s\S]*?top-\[calc\(4\.75rem\+env\(safe-area-inset-top\)\)\][\s\S]*?<AbaSessionToast toast=\{actionToast\} compact=\{intervalToastCompact\}/m,
    'Toast clínico deve usar modo compacto durante coleta por intervalo ativa no mobile.'
  );
  assert.match(
    sessionModeCode,
    /buildSessionReport\(\{[\s\S]*?sourceRecords: records[\s\S]*?Relatório da sessão[\s\S]*?Exportação em PDF será implementada em breve[\s\S]*?Gerar PDF/m,
    'SessionMode deve renderizar relatório pós-encerramento baseado no SessionSummary e manter PDF desabilitado.'
  );
});

test('aba persistence: frontend records sessions and structured trials offline-first', () => {
  assert.match(
    dataServiceCode,
    /async saveAbaSession\(session: any\)[\s\S]*?saveOfflineFirst\(id, data, 'aba', '\/api\/aba\/sessions'\)/m,
    'dataService deve salvar sessoes ABA na fila offline-first.'
  );
  assert.match(
    dataServiceCode,
    /async saveAbaTrial\(trial: any\)[\s\S]*?saveOfflineFirst\(id, data, 'aba', '\/api\/aba\/trials'\)/m,
    'dataService deve salvar tentativas ABA na fila offline-first.'
  );
  assert.match(
    dataServiceCode,
    /async getAbaSessions\(patientId: string,[\s\S]*?normalizeListLimit\(options\.pageSize \?\? options\.limit, 20, 50\)[\s\S]*?endpointWithPagination\(`\/api\/aba\/sessions\/\$\{encodeURIComponent\(String\(patientId\)\)\}`/m,
    'dataService deve buscar sessoes ABA paginadas para exibir no prontuario.'
  );
  assert.match(
    dataServiceCode,
    /async getAbaTrials\(patientId: string,[\s\S]*?normalizeListLimit\(options\.pageSize \?\? options\.limit, 20, 50\)[\s\S]*?endpointWithPagination\(`\/api\/aba\/trials\/\$\{encodeURIComponent\(String\(patientId\)\)\}`/m,
    'dataService deve buscar tentativas ABA paginadas para exibir no prontuario.'
  );
  assert.match(
    dataServiceCode,
    /async saveAbaBehaviorEvent\(event: any\)[\s\S]*?saveOfflineFirst\(id, data, 'aba', '\/api\/aba\/behavior-events'\)/m,
    'dataService deve salvar eventos de comportamento ABA na fila offline-first.'
  );
  assert.match(
    dataServiceCode,
    /async saveAbaIntervalRecord\(record: any\)[\s\S]*?saveOfflineFirst\(id, data, 'aba', '\/api\/aba\/interval-records'\)/m,
    'dataService deve salvar respostas de intervalo ABA em tabela propria.'
  );
  assert.match(
    dataServiceCode,
    /async saveAbaIntervalSummary\(summary: any\)[\s\S]*?saveOfflineFirst\(id, data, 'aba', '\/api\/aba\/interval-summaries'\)/m,
    'dataService deve salvar resumo de intervalo ABA em tabela propria.'
  );
  assert.match(
    dataServiceCode,
    /async saveAbaAbcEvent\(event: any\)[\s\S]*?saveOfflineFirst\(id, data, 'aba', '\/api\/aba\/abc-events'\)/m,
    'dataService deve salvar ABC ABA em tabela propria.'
  );
  assert.match(
    dataServiceCode,
    /async getAbaBehaviorEvents\(patientId: string,[\s\S]*?normalizeListLimit\(options\.pageSize \?\? options\.limit, 20, 50\)[\s\S]*?endpointWithPagination\(`\/api\/aba\/behavior-events\/\$\{encodeURIComponent\(String\(patientId\)\)\}`/m,
    'dataService deve buscar eventos de comportamento ABA paginados para exibir no prontuario.'
  );
  assert.match(
    dataServiceCode,
    /async saveAbaMasteryEvaluation\(evaluation: any\)[\s\S]*?saveOfflineFirst\(id, data, 'aba', '\/api\/aba\/mastery-evaluations'\)/m,
    'dataService deve salvar avaliacoes de maestria ABA na fila offline-first.'
  );
  assert.match(
    dataServiceCode,
    /async getAbaMasteryEvaluations\(patientId: string,[\s\S]*?normalizeListLimit\(options\.pageSize \?\? options\.limit, 20, 50\)[\s\S]*?endpointWithPagination\(`\/api\/aba\/mastery-evaluations\/\$\{encodeURIComponent\(String\(patientId\)\)\}`/m,
    'dataService deve buscar avaliacoes de maestria ABA paginadas para exibir no prontuario.'
  );
  assert.match(
    patientDetailCode,
    /dataService\.saveAbaSession\(/m,
    'PatientDetailView deve persistir inicio de sessao ABA.'
  );
  assert.match(
    patientDetailCode,
    /dataService\.updateAbaSession\(String\(endedSession\.id\)/m,
    'PatientDetailView deve persistir encerramento de sessao ABA.'
  );
  assert.match(
    patientDetailCode,
    /recentRecordLimit = 10[\s\S]*?dataService\.getAbaSessions\(String\(patient\.id\), \{ page: 1, pageSize: recentRecordLimit \}\)[\s\S]*?dataService\.getAbaTrials\(String\(patient\.id\), \{ page: 1, pageSize: recentRecordLimit \}\)[\s\S]*?dataService\.getAbaBehaviorEvents\(String\(patient\.id\), \{ page: 1, pageSize: recentRecordLimit \}\)[\s\S]*?dataService\.getAbaMasteryEvaluations\(String\(patient\.id\), \{ page: 1, pageSize: recentRecordLimit \}\)/m,
    'PatientDetailView deve carregar sessoes, tentativas, comportamentos e maestria ABA com limite recente.'
  );
  assert.match(
    patientDetailCode,
    /Central ABA[\s\S]*?aba_trials[\s\S]*?aba_behavior_events[\s\S]*?aba_mastery_evaluations/m,
    'PatientDetailView deve explicar e renderizar onde os dados ABA ficam registrados.'
  );
  assert.match(
    sessionModeCode,
    /const \[collectionType, setCollectionType\] = useState\('dtt'\)/m,
    'SessionMode deve coletar o tipo DTT/NET/probe.'
  );
  assert.match(
    sessionModeCode,
    /const \[promptLevelKey, setPromptLevelKey\] = useState\('verbal'\)/m,
    'SessionMode deve coletar hierarquia de prompt.'
  );
  assert.match(
    sessionModeCode,
    /dataService\.saveAbaBehaviorEvent\(/m,
    'SessionMode deve registrar comportamento ABA rapido.'
  );
  assert.match(
    sessionModeCode,
    /dataService\.saveAbaIntervalRecord\([\s\S]*?dataService\.saveAbaIntervalSummary\([\s\S]*?dataService\.saveAbaAbcEvent\(/m,
    'SessionMode deve persistir intervalo e ABC nas tabelas dedicadas, sem duplicar tudo em behavior_events.'
  );
  assert.match(
    appCode,
    /const abaCollectionType = String\(sessionMeta\?\.collectionType \|\| 'dtt'\)\.toLowerCase\(\);[\s\S]*?dataService\.saveAbaTrial\(\{[\s\S]*?collection_type: abaCollectionType/m,
    'App deve persistir cada registro como aba_trial estruturado.'
  );
  assert.match(
    appCode,
    /dataService\.saveAbaMasteryEvaluation\(\{[\s\S]*?evaluation_status: isMastered \? 'mastered' : 'not_met'/m,
    'App deve persistir a avaliacao de maestria a cada tentativa ABA.'
  );
});

let passed = 0;
for (const entry of tests) {
  try {
    entry.fn();
    passed += 1;
    console.log(`PASS: ${entry.name}`);
  } catch (error) {
    console.error(`FAIL: ${entry.name}`);
    throw error;
  }
}

console.log(`Security regression checks: ${passed}/${tests.length} passed.`);
