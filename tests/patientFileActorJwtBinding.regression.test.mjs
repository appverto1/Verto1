import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20261023235500_patient_file_actor_jwt_binding_p0.sql', 'utf8');
const routes = readFileSync('services/patientSharedChartRoutes.ts', 'utf8');

assert.match(migration, /create or replace function public\.patient_file_actor_has_patient_access_v1/);
assert.match(migration, /security definer/);
assert.match(migration, /current_setting\('request\.jwt\.claim\.role', true\) = 'service_role'/);
assert.match(migration, /current_setting\('request\.jwt\.claim\.role', true\) = 'authenticated'/);
assert.match(migration, /p_actor_id = \(select auth\.uid\(\)\)/, 'caller-chosen actor must match JWT subject');
assert.match(migration, /revoke execute on function public\.patient_file_actor_has_patient_access_v1\(uuid,uuid,uuid\) from public, anon;/);
assert.match(migration, /grant execute on function public\.patient_file_actor_has_patient_access_v1\(uuid,uuid,uuid\) to authenticated, service_role;/);
for (const preserved of [
  'c.owner_user_id = p_actor_id',
  "cm.status = 'active'",
  "link.status = 'active'",
  "p.clinic_id = p_clinic_id",
  'p.therapist_id = p_actor_id'
]) assert.ok(migration.includes(preserved), 'baseline authorization branch changed: ' + preserved);
assert.match(routes, /const actorId = sanitizeString\(user\?\.id \|\| user\?\.user_id, 120\)/);
assert.match(routes, /p_actor_id: actorId, p_clinic_id: clinicId, p_patient_id: patientId/);
console.log('patientFileActorJwtBinding.regression.test.mjs: PASS');
