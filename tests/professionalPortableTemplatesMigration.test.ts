import { readModularServerSource } from './helpers/modularServerSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260802170000_professional_portable_templates.sql';
const migration = fs.readFileSync(migrationPath, 'utf8');
const server = readModularServerSource();

assert.match(migration, /^begin;/im);
assert.match(migration, /commit;\s*$/im);
assert.doesNotMatch(migration, /\b(delete from|truncate|drop table)\b/i);
assert.match(migration, /add column if not exists scope text/);
assert.match(migration, /owner_user_id uuid references public\.users\(id\)/);
assert.match(migration, /scope = 'personal' and owner_user_id = auth\.uid\(\)/);
assert.match(migration, /organization_id = auth\.uid\(\)/);
assert.match(migration, /set organization_id = owner_user_id,[\s\S]*clinic_id = null/);
assert.match(migration, /aba_program_template_versions[\s\S]*alter column clinic_id drop not null/);
assert.match(migration, /template\.source_scope = 'PERSONAL'[\s\S]*template\.owner_user_id = auth\.uid\(\)::text/);

assert.match(server, /owner_user_id\.eq\.\$\{actorId\}/);
assert.match(server, /templateOrganizationId = sourceScope === 'PERSONAL' \? actorId : organizationId/);
assert.match(server, /templateClinicId = sourceScope === 'PERSONAL' \? null : clinicId/);
assert.match(server, /scope', 'personal'/);
assert.match(server, /owner_user_id', safeActorId/);
assert.match(server, /allowPersistedPersonalTemplate/);
assert.match(server, /existingScope === 'PERSONAL' \? actorId : organizationId/);
assert.match(server, /existingScope === 'PERSONAL' \? null : clinicId/);
assert.match(server, /compatibleTemplates[\s\S]*id: sanitizeString\(item\?\.id, 120\)/);
assert.match(server, /availableTemplates[\s\S]*id: sanitizeString\(item\?\.id, 120\)/);

console.log('professionalPortableTemplatesMigration.test.ts: ok');
