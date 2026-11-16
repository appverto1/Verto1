import { readModularServerSource } from './helpers/modularServerSource.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const utility = fs.readFileSync('src/utils/patientProfessionalLinks.ts', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260818101500_patient_case_team_supervision_member_management_v2.sql',
  'utf8',
);
const server = readModularServerSource();

assert.match(
  utility,
  /hasActiveCaseLink && canSupervise/,
  'a supervision-enabled professional already active in the case can manage the case team',
);
assert.doesNotMatch(
  utility,
  /hasActiveCaseLink && caseRole === 'supervisor' && canSupervise/,
  'case-team authority must not depend on the current case-role display label',
);
assert.match(
  utility,
  /canSupervise &&[\s\S]*?supervisionLink[\s\S]*?supervisor_user_id/,
  'explicit supervision remains a separate resource-scoped authority path',
);
assert.match(
  utility,
  /if \(!hasActiveMembership\) return false;/,
  'supervision authority still requires an active clinic membership',
);

assert.match(migration, /create or replace function public\.patient_case_team_actor_can_manage_v1/);
assert.match(migration, /membership\.role in \('director', 'coordinator'\)/);
assert.match(
  migration,
  /join public\.patient_professional_links link[\s\S]*?link\.patient_id = p_patient_id[\s\S]*?link\.status = 'active'[\s\S]*?membership\.can_supervise is true/,
  'database authority requires both active case membership and supervision enablement',
);
assert.doesNotMatch(
  migration,
  /link\.case_role = 'supervisor'/,
  'database authority must not require the case link label to be supervisor',
);
assert.match(
  migration,
  /join public\.clinical_supervision_links supervision[\s\S]*?supervision\.status = 'active'/,
  'explicit clinical supervision remains supported',
);
assert.match(
  migration,
  /revoke all on function public\.patient_case_team_actor_can_manage_v1\(uuid, uuid, uuid\)[\s\S]*?from public, anon, authenticated/,
  'helper stays unavailable to browser roles',
);

assert.equal(
  (server.match(/requireClinicCapability\('team\.case\.manage'\)/g) || []).length >= 2,
  true,
  'case-team mutations keep the capability gate in addition to resource scope checks',
);
assert.equal(
  (server.match(/canSupervise: req\.authorizationContext\?\.canSupervise === true/g) || []).length >= 3,
  true,
  'GET/add/end all use canonical supervision capability from the authorization context',
);

console.log('patientCaseTeamSupervisionMemberManagement.regression.test.mjs: ok');
