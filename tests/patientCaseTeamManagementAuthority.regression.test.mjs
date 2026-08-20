import assert from 'node:assert/strict';
import fs from 'node:fs';

const authModel = fs.readFileSync('src/constants/authorizationModel.ts', 'utf8');
const utility = fs.readFileSync('src/utils/patientProfessionalLinks.ts', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');
const panel = fs.readFileSync('src/components/PatientProfessionalLinksPanel.tsx', 'utf8');
const detail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260818004000_patient_case_team_management_authority_v1.sql',
  'utf8',
);

assert.match(
  authModel,
  /SUPERVISION_CAPABILITY_OVERLAY = internal\([\s\S]*?'team\.case\.manage'[\s\S]*?'team\.patient_primary\.manage'/,
  'supervision-capable professionals receive the action capabilities, while resource scope is checked separately',
);
assert.match(
  authModel,
  /supervisor: internal\([\s\S]*?'team\.view','team\.case\.manage','team\.patient_primary\.manage'/,
  'supervisor role exposes case-team management actions',
);

assert.match(utility, /hasActiveCaseLink && canSupervise/);
assert.match(utility, /supervisionLink[\s\S]*?supervisor_user_id/);
assert.match(utility, /patient_id \|\| patientLink\?\.patientId/);
assert.doesNotMatch(
  utility,
  /\['director', 'coordinator', 'supervisor', 'therapist'\]\.includes\(membershipRole\)/,
  'ordinary therapist/supervisor membership alone must not become case-management authority',
);

assert.match(server, /professional_id,case_role,status,permissions/);
assert.match(server, /\.\.\.composed,\s*canManage,/);
assert.equal(
  (server.match(/patientLink: req\.patientProfessionalLink/g) || []).length,
  3,
  'GET, add and end flows reuse already-resolved patient access evidence',
);
assert.equal(
  (server.match(/supervisionLink: req\.patientSupervisionLink/g) || []).length,
  3,
  'GET, add and end flows reuse already-resolved supervision evidence',
);

assert.match(panel, /managementResolved && \(serverCanManage \|\| canManage\)/, 'case-team actions remain hidden until server authority is resolved');
assert.match(panel, /onManagementAuthorityChanged\?\.\(nextCanManage\)/);
assert.match(panel, /effectiveCanManage && link\.canBeEnded/);
assert.match(detail, /canManagePrimaryProfessionalForPatient/);
assert.match(detail, /onManagementAuthorityChanged=\{setCaseTeamManagementAllowed\}/);

assert.match(migration, /create or replace function public\.patient_case_team_actor_can_manage_v1/);
assert.match(migration, /membership\.role in \('director', 'coordinator'\)/);
assert.match(migration, /link\.case_role = 'supervisor'/);
assert.match(migration, /membership\.can_supervise is true/);
assert.match(migration, /join public\.clinical_supervision_links supervision/);
assert.match(migration, /supervised_link\.patient_id = p_patient_id/);
assert.equal(
  (migration.match(/patient_case_team_actor_can_manage_v1\(\s*p_actor_id,\s*p_patient_id,\s*patient_clinic_id\s*\)/g) || []).length,
  3,
  'add, end and primary-professional mutations share the same database authority rule',
);
assert.equal(
  (migration.match(/pg_advisory_xact_lock/g) || []).length,
  3,
  'all critical case-team mutations remain serialized per patient',
);
assert.equal(
  (migration.match(/set row_security = off/g) || []).length,
  4,
  'helper and mutation RPCs have explicit definer/RLS behavior',
);
assert.match(
  migration,
  /professional_membership\.role in \('therapist', 'supervisor', 'coordinator', 'director'\)/,
  'ending a qualified non-therapist case role still preserves historical access snapshots',
);
assert.match(
  migration,
  /revoke all on function public\.end_patient_professional_link_v1\(uuid, uuid, uuid, date\)[\s\S]*?from public, anon, authenticated/,
);
assert.match(
  migration,
  /grant execute on function public\.end_patient_professional_link_v1\(uuid, uuid, uuid, date\)[\s\S]*?to service_role/,
);

console.log('patientCaseTeamManagementAuthority.regression.test.mjs: ok');
