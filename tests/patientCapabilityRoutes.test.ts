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
  /\(role === 'supervisor' \|\| role === 'therapist'\) && !hasExplicitPatientScope[\s\S]{0,180}return \{ data: \[\], error: null/,
  'supervisor/terapeuta sem escopo explícito devem falhar fechado',
);
assert.doesNotMatch(
  schemaFallbacks,
  /includeProfessionalScope/,
  'lista de pacientes não deve reativar fallback por patients.professional_id/therapist_id',
);
assert.doesNotMatch(
  server,
  /app\.get\('\/api\/patients', checkAuth, requireRoles/,
  'lista não deve manter gate legado por role',
);

// P0: opening the patient's anamnesis is read-only and cannot demote a submitted/reviewed form.
const portal = fs.readFileSync('src/components/PatientDashboard.tsx', 'utf8');
const loadStart = portal.indexOf('const loadPortalAnamnesis = async');
const loadEnd = portal.indexOf('useEffect(() => {\n    portalAnamnesisRequestRef.current += 1;', loadStart);
assert.ok(loadStart > 0 && loadEnd > loadStart, 'leitura de anamnese do portal deve existir');
const portalRead = portal.slice(loadStart, loadEnd);
assert.match(portalRead, /dataService\.getPortalPatientAnamnesis\(portalPatientId\)/);
assert.doesNotMatch(portalRead, /dataService\.(?:save|submit|update|create).*Anamnesis/);
const statusStart = portal.indexOf('const portalAnamnesisLocked =');
const statusEnd = portal.indexOf('const portalAnamnesisNeedsAction =', statusStart);
const statusDisplay = portal.slice(statusStart, statusEnd);
assert.match(statusDisplay, /portalAnamnesisRequestStatus === 'REVIEWED'/);
assert.match(statusDisplay, /portalAnamnesisResponseStatus === 'REVIEWED'/);
assert.match(statusDisplay, /portalAnamnesisRequestStatus === 'SUBMITTED'/);
assert.ok(statusDisplay.indexOf("=== 'REVIEWED'") < statusDisplay.indexOf("=== 'SUBMITTED'") || statusDisplay.includes("? 'Revisada'"), 'estado revisado prevalece no rótulo');

const patientDetail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
assert.match(patientDetail, /const canEditAnamnesis =[\s\S]{0,120}hasCapability\('clinical\.anamnesis\.edit'\)/);

console.log('patientCapabilityRoutes.test.ts: ok');
