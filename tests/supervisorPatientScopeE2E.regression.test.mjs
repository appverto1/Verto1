import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync('server.ts', 'utf8');
const access = fs.readFileSync('src/utils/patientClinicalAccess.ts', 'utf8');

const loaderStart = server.indexOf('async function loadPatientProfessionalAccessEvidence');
const loaderEnd = server.indexOf('const checkPatientAccess = async', loaderStart);
assert.ok(loaderStart >= 0 && loaderEnd > loaderStart, 'patient access evidence loader must exist');
const loader = server.slice(loaderStart, loaderEnd);

assert.match(
  loader,
  /patientCaseLinksResult = await supabase[\s\S]*?from\('patient_professional_links'\)[\s\S]*?select\('professional_id'\)[\s\S]*?eq\('organization_id', params\.clinicId\)[\s\S]*?eq\('patient_id', params\.patientId\)[\s\S]*?eq\('status', 'active'\)/,
  'supervision-by-professional must first resolve the active case team for the exact patient',
);

assert.match(
  loader,
  /const professionalIds = Array\.from\(new Set\([\s\S]*?patientCaseLinksResult\.data[\s\S]*?professional_id/,
  'only professionals from the exact patient case team may become supervision candidates',
);

assert.match(
  loader,
  /professionalSupervisionResult[\s\S]*?from\('clinical_supervision_links'\)[\s\S]*?eq\('supervisor_user_id', params\.actorId\)[\s\S]*?in\('supervised_user_id', professionalIds\)[\s\S]*?eq\('status', 'active'\)/,
  'a professional-level supervision link must intersect the patient case team before granting access',
);

const listScopeStart = server.indexOf('async function resolvePatientListScopedPatientIds');
const listScopeEnd = server.indexOf('async function resolveLegacyClinicalEmailReadScope', listScopeStart);
assert.ok(listScopeStart >= 0 && listScopeEnd > listScopeStart, 'patient list scope resolver must exist');
const listScope = server.slice(listScopeStart, listScopeEnd);

assert.match(
  listScope,
  /clinical_supervision_links[\s\S]*?supervised_user_id/,
  'supervised professionals may contribute to the supervisor patient list only through explicit supervision links',
);
assert.match(
  listScope,
  /const caseLinksResult = await supabase[\s\S]*?from\('patient_professional_links'\)[\s\S]*?in\('professional_id', supervisedUserIds\)/,
  'supervised-professional scope must resolve back through canonical patient-professional links',
);
assert.match(
  listScope,
  /const caseLinksResult = await supabase[\s\S]*?eq\('status', 'active'\)/,
  'only active patient-professional links may widen the supervised patient list',
);
assert.doesNotMatch(
  listScope,
  /\.in\('therapist_id', supervisedUserIds\)|\.eq\('therapist_id'/,
  'legacy therapist_id must never broaden supervision scope',
);

assert.match(
  access,
  /server evidence[\s\S]*?supervised_user_id[\s\S]*?active case-team[\s\S]*?exact patient/,
  'the clinical access helper must document the prevalidated evidence invariant for user-scoped supervision',
);

console.log('supervisorPatientScopeE2E.regression.test.mjs: ok');
