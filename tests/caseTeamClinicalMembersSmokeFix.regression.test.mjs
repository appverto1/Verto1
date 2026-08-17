import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const dashboard = fs.readFileSync('src/components/CoordinatorDashboard.tsx', 'utf8');
const detail = fs.readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const panel = fs.readFileSync('src/components/PatientProfessionalLinksPanel.tsx', 'utf8');
const utility = fs.readFileSync('src/utils/patientProfessionalLinks.ts', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260817213000_case_team_clinical_member_roles_v1.sql',
  'utf8',
);

assert.match(
  utility,
  /PATIENT_CASE_TEAM_MEMBERSHIP_ROLES[\s\S]*?'therapist'[\s\S]*?'supervisor'[\s\S]*?'coordinator'[\s\S]*?'director'/,
  'case team accepts clinically qualified professional and manager memberships',
);
assert.match(
  utility,
  /resolvePatientPrimaryProfessionalId[\s\S]*?professional_links[\s\S]*?relationship_type[\s\S]*?primary/,
  'patient list can resolve the canonical primary link instead of relying only on legacy therapist_id',
);
assert.match(
  dashboard,
  /therapistMembersLoading[\s\S]*?Profissional: carregando responsável/,
  'patient cards do not flash a false missing-professional warning while membership data is loading',
);
assert.match(
  dashboard,
  /clinicProfessionals=\{patientCareProfessionals\}/,
  'already-loaded clinic professionals are reused by the patient record',
);
assert.match(
  detail,
  /clinicProfessionals: preloadedClinicProfessionals[\s\S]*?selectCaseTeamProfessionals[\s\S]*?isPatientCaseTeamMembershipRole/,
  'patient record reuses preloaded members and applies one eligibility rule',
);
assert.match(
  panel,
  /vínculo ativo' : 'vínculos ativos'\} · limite 5/,
  'case-team counter is not presented as if five links already existed',
);
assert.match(
  panel,
  /Nenhum profissional clínico elegível disponível/,
  'empty state no longer implies only therapist base-role memberships are eligible',
);
assert.match(
  panel,
  /\['coordinator', 'director'\]\.includes\(nextMembershipRole\)[\s\S]*?'case_coordinator'/,
  'coordinator/director selections default to case coordination instead of therapist',
);
assert.match(
  panel,
  /nextMembershipRole === 'supervisor'[\s\S]*?'supervisor'/,
  'legacy supervisor selections default to supervision',
);

const postStart = server.indexOf("'/api/patients/:patientId/professional-links',");
const postEnd = server.indexOf("'/api/patients/:patientId/professional-links/:linkId/end'", postStart);
const postRoute = server.slice(postStart, postEnd);
assert.match(postRoute, /user_id,clinic_id,role,status,specialty,can_supervise/);
assert.doesNotMatch(
  postRoute,
  /\.eq\('role', 'therapist'\)/,
  'server must validate the active clinic membership role centrally instead of hard-coding therapist',
);
assert.match(postRoute, /validatePatientProfessionalCandidate/);
assert.match(
  server,
  /onboardingMode !== 'invited_professional'[\s\S]*?'therapist', 'supervisor', 'coordinator', 'director'/,
  'invited clinical coordinators/directors persist their specialty to the canonical profile',
);
assert.match(
  server,
  /const specialty = role === 'therapist'[\s\S]*?\['supervisor', 'coordinator', 'director'\][\s\S]*?authoritativeSpecialty \|\| requestedSpecialty/,
  'coordinator/director onboarding reuses the clinic invitation specialty before accepting free text',
);

assert.match(
  migration,
  /candidate_specialties[\s\S]*?count\(distinct lower\(trim\(membership\.specialty\)\)\) = 1/,
  'backfill only promotes an unambiguous membership specialty',
);
assert.equal(
  (migration.match(/professional_membership\.role in \('therapist', 'supervisor', 'coordinator', 'director'\)/g) || []).length,
  2,
  'both atomic link creation and primary-professional assignment accept qualified case-team membership roles',
);
assert.match(migration, /actor_membership\.role in \('director', 'coordinator'\)/);
assert.doesNotMatch(migration, /actor_membership\.role in \([^)]*therapist/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /grant execute on function public\.upsert_patient_professional_link_v1/);
assert.match(migration, /grant execute on function public\.set_patient_primary_professional_v1/);

console.log('caseTeamClinicalMembersSmokeFix.regression.test.mjs: ok');
