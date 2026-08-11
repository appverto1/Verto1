import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const schemaFallbacks = fs.readFileSync('src/utils/routeSchemaFallbacks.ts', 'utf8');

assert.match(
  server,
  /app\.get\('\/api\/patients', checkAuth, requireClinicCapability\('patient\.list'\)/,
  'lista de pacientes deve usar patient.list',
);
assert.match(
  server,
  /fetchPatientsWithSchemaFallback\([\s\S]{0,700}selectColumns: patientListColumnsForCapabilities\(context\.capabilities\)/,
  'lista deve reduzir colunas no banco conforme capabilities',
);
assert.match(
  server,
  /async function resolvePatientListScopedPatientIds[\s\S]*?assigned_patients[\s\S]*?patient_professional_links[\s\S]*?supervised_cases|async function resolvePatientListScopedPatientIds[\s\S]*?clinical_supervision_links/,
  'escopos therapist/supervisor devem ser resolvidos antes de buscar pacientes',
);
assert.match(
  server,
  /app\.post\('\/api\/patients', checkAuth, requireClinicCapability\('patient\.create'\)/,
);
assert.match(
  server,
  /app\.patch\('\/api\/patients\/:id', checkAuth, requireClinicCapability\('patient\.demographics\.edit'\)/,
);
assert.match(
  server,
  /app\.delete\('\/api\/patients\/:id', checkAuth, requireClinicCapability\('patient\.archive'\)/,
);
assert.match(
  server,
  /app\.post\('\/api\/patients\/:id\/reactivate', checkAuth, requireClinicCapability\('patient\.archive'\)/,
);
assert.match(
  server,
  /app\.get\('\/api\/patients\/:patientId\/anamnesis', checkAuth, requireClinicCapability\('clinical\.anamnesis\.view'\), checkPatientAccess/,
);
assert.match(
  server,
  /app\.patch\('\/api\/patients\/:patientId\/anamnesis\/draft',[\s\S]{0,160}requireClinicCapability\('clinical\.anamnesis\.edit'\), checkPatientAccess/,
);
assert.match(
  server,
  /const requiredPermission = requiredPatientLinkPermissionForMethod\(req\.method\)/,
  'escopo do terapeuta deve diferenciar leitura e escrita',
);
assert.match(
  schemaFallbacks,
  /role === 'supervisor' \|\| hasExplicitPatientScope[\s\S]{0,180}return \{ data: \[\], error: null/,
  'supervisor sem escopo explícito deve falhar fechado',
);
assert.doesNotMatch(
  server,
  /app\.get\('\/api\/patients', checkAuth, requireRoles/,
  'lista não deve manter gate legado por role',
);

console.log('patientCapabilityRoutes.test.ts: ok');
