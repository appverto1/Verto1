import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const patientDetail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const coordinator = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260816224500_anamnesis_template_limits_and_snapshots.sql', 'utf8');

assert.match(server, /const maxActiveTemplates = templateScope === 'personal' \? 15 : 10;/);
assert.match(server, /Limite de 15 fichas profissionais salvas atingido/);
assert.match(server, /Limite de 10 fichas da clínica atingido/);
assert.match(server, /personalLimit: 15/);
assert.match(server, /clinicLimit: 10/);
assert.match(server, /\.eq\('scope', 'clinic'\)[\s\S]*?\.limit\(10\)/);
assert.match(server, /\.eq\('scope', 'personal'\)[\s\S]*?\.eq\('owner_user_id', actorId\)[\s\S]*?\.limit\(15\)/);
assert.match(coordinator, /maxSavedTemplates=\{isTherapist \? 15 : 10\}/);
assert.match(coordinator, /slice\(0, isTherapist \? 15 : 10\)/);

assert.match(migration, /v_scope = 'personal'[\s\S]*?v_limit := 15/);
assert.match(migration, /v_scope = 'clinic'[\s\S]*?v_limit := 10/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /old\.is_active is true[\s\S]*?old\.scope is not distinct from new\.scope/);
assert.match(migration, /ANAMNESIS_PERSONAL_TEMPLATE_LIMIT/);
assert.match(migration, /ANAMNESIS_CLINIC_TEMPLATE_LIMIT/);
assert.match(migration, /template_snapshot jsonb/);
assert.match(migration, /template_revision integer/);
assert.match(migration, /template_scope_snapshot text/);
assert.match(migration, /bump_anamnesis_template_revision_v1/);
assert.doesNotMatch(migration, /\b(delete from|truncate|drop table)\b/i);

assert.match(server, /buildAnamnesisTemplateSnapshot/);
assert.match(server, /const responseOwnsTemplateSnapshot = !isUuid\(requestId\)/);
assert.match(server, /template_snapshot: templateSnapshot/);
assert.match(server, /template_revision: templateRevision/);
assert.match(server, /template_scope_snapshot: templateScopeSnapshot/);
assert.match(server, /responseResult\.data\?\.template_snapshot[\s\S]*?requestResult\.data\?\.template_snapshot/);
assert.match(server, /buildPublicAnamnesisTemplate\(frozenSnapshot\)/);
assert.match(server, /fetchPatientAnamnesisFlow\([\s\S]*?sanitizeString\(req\.session\.user\?\.id, 120\)/);
assert.match(server, /templateScope: sanitizeString\(template\?\.templateScope \|\| template\?\.scope, 20\)/);

assert.match(patientDetail, /templateScope: String\(template\?\.templateScope \|\| template\?\.scope/);
assert.match(patientDetail, /Minha ficha/);
assert.match(patientDetail, />\s*Clínica\s*</);

console.log('anamnesisTemplateOwnershipLimitsSnapshots.test.mjs: ok');
