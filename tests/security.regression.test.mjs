import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const serverPath = path.resolve(process.cwd(), 'server.ts');
const serverCode = fs.readFileSync(serverPath, 'utf8');
const coordinatorPath = path.resolve(process.cwd(), 'src/components/CoordinatorDashboard.tsx');
const coordinatorCode = fs.readFileSync(coordinatorPath, 'utf8');
const appPath = path.resolve(process.cwd(), 'src/App.tsx');
const appCode = fs.readFileSync(appPath, 'utf8');
const dataServicePath = path.resolve(process.cwd(), 'src/services/dataService.ts');
const dataServiceCode = fs.readFileSync(dataServicePath, 'utf8');
const patientDetailPath = path.resolve(process.cwd(), 'src/components/PatientDetailView.tsx');
const patientDetailCode = fs.readFileSync(patientDetailPath, 'utf8');
const sessionModePath = path.resolve(process.cwd(), 'src/components/SessionMode.tsx');
const sessionModeCode = fs.readFileSync(sessionModePath, 'utf8');
const financialRlsPath = path.resolve(process.cwd(), 'supabase/migrations/20260521143000_financial_rls_coordinator_only.sql');
const financialRlsCode = fs.readFileSync(financialRlsPath, 'utf8');
const abaRlsPath = path.resolve(process.cwd(), 'supabase/migrations/20260523120000_aba_clinical_core.sql');
const abaRlsCode = fs.readFileSync(abaRlsPath, 'utf8');

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
    "app.post('/api/aba/trials'",
    "app.get('/api/aba/trials/:patientId'",
    "app.post('/api/aba/behavior-events'",
    "app.get('/api/aba/behavior-events/:patientId'"
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
    /async saveAbaBehaviorEvent\(event: any\)[\s\S]*?saveOfflineFirst\(id, data, 'aba', '\/api\/aba\/behavior-events'\)/m,
    'dataService deve salvar eventos de comportamento ABA na fila offline-first.'
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
    sessionModeCode,
    /const \[collectionType, setCollectionType\] = useState\('dtt'\)/m,
    'SessionMode deve coletar o tipo DTT/NET/probe.'
  );
  assert.match(
    sessionModeCode,
    /const \[promptLevelKey, setPromptLevelKey\] = useState\('independent'\)/m,
    'SessionMode deve coletar hierarquia de prompt.'
  );
  assert.match(
    sessionModeCode,
    /dataService\.saveAbaBehaviorEvent\(/m,
    'SessionMode deve registrar comportamento ABA rapido.'
  );
  assert.match(
    appCode,
    /dataService\.saveAbaTrial\(\{[\s\S]*?collection_type: String\(sessionMeta\?\.collectionType \|\| 'dtt'\)\.toLowerCase\(\)/m,
    'App deve persistir cada registro como aba_trial estruturado.'
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
