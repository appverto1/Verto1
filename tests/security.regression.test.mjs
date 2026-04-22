import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const serverPath = path.resolve(process.cwd(), 'server.ts');
const serverCode = fs.readFileSync(serverPath, 'utf8');

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
