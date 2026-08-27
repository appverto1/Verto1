import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const panel = fs.readFileSync('src/components/PatientProfessionalLinksPanel.tsx', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260827163000_case_team_specialty_membership_profile_bridge_v1.sql',
  'utf8',
);

const routeSection = (start, end) => {
  const startIndex = server.indexOf(start);
  const endIndex = server.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `rota ausente: ${start}`);
  assert.notEqual(endIndex, -1, `limite ausente: ${end}`);
  return server.slice(startIndex, endIndex);
};

const specialtyRoute = routeSection(
  "app.patch('/api/clinic/members/:memberId/specialty'",
  "app.patch('/api/clinic/members/:memberId/role'",
);
const roleRoute = routeSection(
  "app.patch('/api/clinic/members/:memberId/role'",
  "app.patch('/api/clinic/members/:memberId/unlink'",
);

for (const route of [specialtyRoute, roleRoute]) {
  assert.match(route, /set_clinic_member_access_and_specialty_v2/);
  assert.match(route, /CLINIC_MEMBER_SPECIALTY_BRIDGE_MIGRATION_REQUIRED/);
  assert.match(route, /CLINICAL_SPECIALTY_CROSS_CLINIC_CONFLICT/);
}

assert.match(
  migration,
  /create or replace function public\.set_clinic_member_access_and_specialty_v2/,
);
assert.match(migration, /update public\.clinic_memberships membership/);
assert.match(migration, /insert into public\.professional_profiles/);
assert.match(migration, /on conflict \(user_id\) do update/);
assert.match(migration, /CLINICAL_SPECIALTY_CROSS_CLINIC_CONFLICT/);
assert.match(migration, /having count\(distinct lower\(trim\(membership\.specialty\)\)\) = 1/);
assert.doesNotMatch(migration, /(?:insert into|update|delete from) public\.patients\b/i);

const professionalOptionSection = panel.slice(
  panel.indexOf('{available.map((professional) => ('),
  panel.indexOf('{available.length === 0 ?', panel.indexOf('{available.map((professional) => (')),
);
assert.match(professionalOptionSection, /professional\.name \|\| professional\.email/);
assert.doesNotMatch(professionalOptionSection, /resolveProfessionalProfileSpecialty\(professional\)/);
assert.doesNotMatch(professionalOptionSection, /especialidade não informada/);

console.log('caseTeamSpecialtyBridgeHotfix.test.mjs: ok');
