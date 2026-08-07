import assert from 'node:assert/strict';
import fs from 'node:fs';

const helper = fs.readFileSync('src/utils/patientProfessionalLinks.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260807110000_patient_professional_specialty_authority.sql', 'utf8');

assert.match(helper, /status === 'active' && membershipBelongsToClinic && profileSpecialty/);
assert.match(migration, /where link\.status = 'active'/);
assert.match(migration, /profile\.user_id::text = link\.professional_id/);
assert.match(migration, /before insert or update of professional_id, specialty, status/);
assert.match(migration, /after update of specialty/);
assert.match(migration, /Ended links keep historical snapshots/);

console.log('patientProfessionalSpecialtyAuthority.regression: ok');
