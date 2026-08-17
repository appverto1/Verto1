import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const editor = fs.readFileSync('src/components/MemberPermissionEditor.tsx', 'utf8');
const team = fs.readFileSync('src/components/TeamManagement.tsx', 'utf8');

// Permission editor must present clinic language, not implementation details.
assert.match(editor, /Acessos do profissional/);
assert.match(editor, /Acesso limitado a/);
assert.match(editor, /pacientes vinculados/);
assert.match(editor, /casos sob supervisão/);
assert.match(editor, /somente dados necessários ao faturamento/);
assert.match(editor, /Mostrar indisponíveis/);
assert.match(editor, /Ajuste individual/);
assert.match(editor, /Usar padrão do perfil/);
assert.doesNotMatch(editor, /<p[^>]*font-mono[^>]*>\{item\.key\}<\/p>/);
assert.doesNotMatch(editor, />ALLOW\/DENY</);
assert.doesNotMatch(editor, /authorization\.scopes\.join/);
assert.match(team, /Ajustar acessos/);

// Remaining legacy clinical mutations use capabilities instead of staff role lists.
for (const [route, capability] of [
  ['/api/tasks', 'clinical.evolution.create'],
  ['/api/tasks/:taskId', 'clinical.evolution.create'],
  ['/api/history/:historyId', 'clinical.evolution.create'],
  ['/api/notes/:noteId', 'clinical.notes.create'],
  ['/api/assigned-tasks', 'clinical.evolution.create'],
  ['/api/assigned-tasks/:taskId', 'clinical.evolution.create'],
  ['/api/assigned-tasks/:taskId/review', 'clinical.evolution.create'],
] as const) {
  const routePattern = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const capabilityPattern = capability.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(server, new RegExp(`${routePattern}[^\\n]{0,220}requireClinicCapability\\('${capabilityPattern}'\\)`));
}

assert.match(server, /\/api\/tasks\/:patientId[^\n]*requireClinicCapabilityOrPatientPortal\('clinical\.history\.view'\)[^\n]*checkPatientAccess/);
assert.match(server, /\/api\/assigned-tasks\/:patientId[^\n]*requireClinicCapabilityOrPatientPortal\('clinical\.history\.view'\)[^\n]*checkPatientAccess/);
assert.match(server, /\/api\/patient-logs'[^\n]*requireClinicCapabilityOrPatientPortal\('clinical\.evolution\.create'\)/);
assert.match(server, /canWritePatientLog[\s\S]{0,240}canPortalSessionAccessPatient[\s\S]{0,240}canAccessPatientInCurrentClinic/);
assert.match(server, /app\.post\('\/api\/tasks'[\s\S]{0,4200}canAccessPatientInCurrentClinic\(payload\.patient_id, req\.session\.user, 'write'\)/);
assert.match(server, /app\.post\('\/api\/assigned-tasks'[\s\S]{0,4200}canAccessPatientInCurrentClinic\(payload\.patient_id, req\.session\.user, 'write'\)/);

// Legacy e-mail readers are now capability + patient-scope aware and batched.
assert.match(server, /async function resolveLegacyClinicalEmailReadScope/);
assert.match(server, /context\?\.capabilities\.has\('clinical\.history\.view'\)/);
assert.match(server, /resolvePatientListScopedPatientIds\(context\)/);
assert.doesNotMatch(server, /isPrivileged = \['therapist', 'coordinator', 'receptionist', 'admin', 'owner'\]/);

// Work schedules are capability-gated; a supervision-enabled professional can only view explicitly supervised professionals.
assert.match(server, /\/api\/clinic\/members\/:memberId\/work-schedule'[^\n]*requireAnyClinicCapability\('calendar\.team\.view', 'calendar\.own\.view'\)/);
assert.match(server, /authorizationContext\.canSupervise[\s\S]{0,500}clinical_supervision_links/);
assert.match(server, /\/api\/clinic\/members\/:memberId\/work-schedule'[^\n]*PATCH|app\.patch\('\/api\/clinic\/members\/:memberId\/work-schedule'[^\n]*requireAnyClinicCapability\('team\.edit', 'calendar\.own\.view'\)/);

// Appointment status changes resolve the exact calendar capability instead of a role whitelist.
assert.match(server, /const requiredCapability: CapabilityKey =[\s\S]{0,520}calendar\.attendance\.confirm[\s\S]{0,520}calendar\.appointment\.reschedule[\s\S]{0,520}calendar\.appointment\.cancel[\s\S]{0,520}calendar\.no_show\.record/);
assert.match(server, /professionalAuthorizationContext\?\.capabilities\.has\(requiredCapability\)/);
assert.doesNotMatch(server, /isProfessionalActor = \['coordinator', 'receptionist', 'therapist', 'admin', 'owner'\]/);

console.log('checkpoint8AuthorizationUxAndLegacyClinical.test.ts: ok');
