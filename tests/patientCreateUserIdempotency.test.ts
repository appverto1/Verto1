import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPatientGlobalIdentityUpdate } from '../src/utils/patientAccountLinking';

const professionalIdentity = Object.freeze({
  id: '00000000-0000-4000-8000-000000000001',
  role: 'therapist',
  clinic_id: '00000000-0000-4000-8000-000000000002',
  status: 'active',
  first_login_completed: true,
  professional_onboarding_status: 'completed',
});

const existingAccountUpdate = buildPatientGlobalIdentityUpdate({
  existingAccount: true,
  portalType: 'responsible',
  clinicId: '00000000-0000-4000-8000-000000000003',
});

assert.equal(existingAccountUpdate, null);
assert.deepEqual(professionalIdentity, {
  id: '00000000-0000-4000-8000-000000000001',
  role: 'therapist',
  clinic_id: '00000000-0000-4000-8000-000000000002',
  status: 'active',
  first_login_completed: true,
  professional_onboarding_status: 'completed',
});

const newPatientUpdate = buildPatientGlobalIdentityUpdate({
  existingAccount: false,
  portalType: 'responsible',
  clinicId: '00000000-0000-4000-8000-000000000003',
});

assert.deepEqual(newPatientUpdate, {
  role: 'patient',
  type: 'responsible',
  clinic_id: '00000000-0000-4000-8000-000000000003',
  status: 'pending_activation',
  first_login_completed: false,
});

const server = fs.readFileSync('server.ts', 'utf8');
const routeStart = server.indexOf("app.post('/api/patients/create-user'");
const routeEnd = server.indexOf("app.post('/api/storage/create-bucket'", routeStart);
assert.notEqual(routeStart, -1, 'rota de criação de paciente ausente');
assert.notEqual(routeEnd, -1, 'fim da rota de criação de paciente ausente');
const route = server.slice(routeStart, routeEnd);
const portabilityMigration = fs.readFileSync(
  'supabase/migrations/20260529170000_patient_portability_foundation.sql',
  'utf8',
);

assert.match(
  portabilityMigration,
  /alter table if exists public\.patients[\s\S]*?add column if not exists responsible_user_id uuid/,
  'responsible_user_id deve permanecer parte do contrato versionado de patients',
);

assert.match(
  route,
  /ensurePatientLink\(existingUser\.id, \{ existingAccount: true \}\)/,
  'conta pública existente deve receber somente o vínculo de paciente',
);
assert.match(
  route,
  /from\('users'\)\s*\.select\('id'\)\s*\.eq\('email', normalizedEmail\)/,
  'a descoberta da identidade existente não deve usar papel ou clínica global como autoridade',
);
assert.match(
  route,
  /const globalIdentityUpdate = buildPatientGlobalIdentityUpdate\(\{[\s\S]*?existingAccount,[\s\S]*?\}\);[\s\S]*?if \(!globalIdentityUpdate\) return linkedPatientId;/,
  'o ramo de conta existente deve terminar antes de atualizar users',
);
assert.match(
  route,
  /const fallbackPatientData = cleanObject\(\{[\s\S]*?responsible_user_id: isUuid\(authUserId\) \? authUserId : undefined[\s\S]*?\}\);/,
  'o fallback de schema ou status deve preservar o responsável canônico',
);
assert.match(
  route,
  /select\('responsible_user_id'\)[\s\S]*?\.eq\('id', linkedPatientId\)[\s\S]*?\.eq\('clinic_id', safeClinicId\)[\s\S]*?PATIENT_RESPONSIBLE_LINK_NOT_PERSISTED[\s\S]*?const globalIdentityUpdate/,
  'a rota deve comprovar a persistência do vínculo antes de concluir ou alterar identidade global',
);
assert.doesNotMatch(
  route,
  /existingRole\s*&&\s*existingRole\s*!==\s*['"]patient['"]/,
  'uma identidade profissional existente não deve ser recusada como contexto de paciente',
);
assert.doesNotMatch(
  route,
  /if \(foundUser\?\.id\) \{\s*await upsertPatientProfile\(foundUser\.id\)/,
  'fallback de Auth existente não pode converter o perfil global em paciente',
);
assert.match(
  route,
  /if \(authUser\?\.user\) \{\s*await upsertPatientProfile\(authUser\.user\.id\);[\s\S]*?existingAccount: false/,
  'a criação de uma nova conta de paciente deve manter o fluxo atual',
);

console.log('patientCreateUserIdempotency.test.ts: ok');
