import assert from 'node:assert/strict';
import fs from 'node:fs';

const detail = fs.readFileSync(new URL('../src/components/PatientDetailView.tsx', import.meta.url), 'utf8');
const profile = fs.readFileSync(new URL('../src/utils/patientProfileType.ts', import.meta.url), 'utf8');

assert.match(profile, /export type PatientPortalKind = 'KIDS' \| 'ADULT_ABA' \| 'ADULT_CONVENTIONAL'/);
assert.match(profile, /\['adult_tea', 'adulto_tea', 'adulto_aba', 'aba'\]/);

assert.match(detail, /const patientPortalKind = useMemo\(\(\) => resolvePatientPortalKind\(patient\), \[patient\]\)/);
assert.match(detail, /const isKidsProfile = patientPortalKind === 'KIDS'/);
assert.match(detail, /const isAdultAbaProfile = patientPortalKind === 'ADULT_ABA'/);
assert.match(detail, /const hasAbaClinicalProfile = isKidsProfile \|\| isAdultAbaProfile/);
assert.match(detail, /const hasAbaSessionSurface = hasAbaClinicalProfile && \(abaV2Enabled \|\| abaV3UiEnabled\)/);

assert.doesNotMatch(detail, /const isExplicitKidsType/);
assert.doesNotMatch(detail, /const isExplicitAdultType/);
assert.doesNotMatch(detail, /patientAgeYears !== null && patientAgeYears > 12 && \(/);

assert.match(detail, /if \(tab === 'session' \|\| tab === 'aba-charts'\) return hasAbaSessionSurface/);
assert.match(detail, /canAccessTab\('session'\) && hasAbaSessionSurface/);
assert.match(detail, /\{hasAbaSessionSurface && isSessionModeOpen && \(/);
assert.match(detail, /if \(!hasAbaSessionSurface \|\| !scheduledSessionForPatient \|\| !patient\?\.id\) return/);
assert.match(detail, /if \(!hasAbaSessionSurface\) \{\s*setActiveTab\(getSessionFallbackTab\(\)\)/s);

assert.match(detail, /showAbaDetails=\{hasAbaClinicalProfile && abaV2Enabled\}/);
assert.match(detail, /showAbaV3Details=\{hasAbaClinicalProfile && abaV3UiEnabled\}/);
assert.match(detail, /showClinicalMeasurementV3Details=\{hasAbaClinicalProfile && abaV3UiEnabled\}/);
assert.match(detail, /activeTab === 'session' && hasAbaSessionSurface/);

assert.match(detail, /\{hasAbaClinicalProfile \? \(\s*<React\.Fragment>\s*<section[^>]*aria-labelledby="patient-session-reports-heading"/s);
assert.match(detail, /\{isKidsProfile && \(\s*<section className="space-y-4" aria-labelledby="patient-timeline-heading"/s);

// Adult UX remains adult for both ADULT_ABA and ADULT_CONVENTIONAL.
assert.match(detail, /\{!isKidsProfile && \(\s*<div className="space-y-3 mt-4">\s*<h3[^>]*>\s*Revisão Profissional \(Tarefas Adulto\)/s);
assert.match(detail, /\(isKidsProfile \? \(patientTasks \|\| \[\]\) : adultScheduledTasks\)/);

console.log('adultAbaProfessionalProfile.regression: PASS');
