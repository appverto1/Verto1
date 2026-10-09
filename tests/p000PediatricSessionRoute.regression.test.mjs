import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const profileSource = readFileSync('src/utils/patientProfileType.ts', 'utf8');
const detailSource = readFileSync('src/components/PatientDetailView.tsx', 'utf8');
const transpiled = ts.transpileModule(profileSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = { exports: {}, Date };
vm.runInNewContext(transpiled, context, { filename: 'patientProfileType.cjs' });
const { resolvePatientPortalKind } = context.exports;

assert.equal(resolvePatientPortalKind({ patientProfileType: 'KIDS', age: 8 }), 'KIDS');
assert.equal(resolvePatientPortalKind({ panel_type: 'kids_tea', age: 7 }), 'KIDS');
assert.equal(resolvePatientPortalKind({ panelType: 'KIDS', age: 9 }), 'KIDS');
assert.equal(resolvePatientPortalKind({ patientProfileType: 'ADULT', portal_type: 'kids_tea', age: 8 }), 'KIDS',
  'legacy pediatric portal plus stale adult default must not enter adult collection');
assert.equal(resolvePatientPortalKind({ patientProfileType: 'ADULT', group: 'infantil', age: 6 }), 'KIDS',
  'pediatric age and pediatric clinic category defeat stale adult default');
assert.equal(resolvePatientPortalKind({ type: 'adult_conventional', age: 35 }), 'ADULT_CONVENTIONAL');
assert.equal(resolvePatientPortalKind({ patientProfileType: 'ABA', age: 29 }), 'ADULT_ABA');
assert.equal(resolvePatientPortalKind({ panelType: 'ADULT', age: 35, portal_type: 'kids_tea' }), 'ADULT_CONVENTIONAL',
  'adult should not be reclassified by a stale kids alias without pediatric evidence');
assert.equal(resolvePatientPortalKind({ age: null }), 'ADULT_CONVENTIONAL',
  'null age is not a zero-year-old child');
assert.equal(resolvePatientPortalKind({ age: '' }), 'ADULT_CONVENTIONAL',
  'empty age is not a zero-year-old child');
assert.equal(resolvePatientPortalKind({ age: 8 }), 'KIDS');
assert.equal(resolvePatientPortalKind({ age: 14, group: 'adolescente' }), 'KIDS');

assert.match(detailSource, /const hasAbaClinicalProfile = isKidsProfile \|\| isAdultAbaProfile/);
assert.match(detailSource, /const hasConventionalSessionSurface = !hasAbaClinicalProfile/);
assert.match(detailSource, /if \(requestedPlanId \|\| \(scheduledSessionForPatient && \(isKidsProfile \|\| appointmentClinicalSpecialtyKey/);
assert.match(detailSource, /if \(scheduledSessionForPatient && isKidsProfile && !hasServerScopes\)/);
assert.match(detailSource, /if \(candidates.length === 0 && scheduledSessionForPatient && isKidsProfile\)/);
assert.match(detailSource, /activeSpecialtyPlans\.length > 0/);
assert.match(detailSource, /if \(candidates.length === 1\)[\s\S]*?requestedPlanId = String\(candidates\[0\]\?\.id/);
assert.match(detailSource, /confirmedPlanId !== expectedPlanId/);
assert.match(detailSource, /void requestSessionStart\('fullscreen'\);/);
assert.doesNotMatch(detailSource, /void handleConfirmSessionStart\(\{ durationMinutes: scheduledSessionDurationMinutes, openSessionMode: true \}\);/);
assert.match(detailSource, /\{hasAbaSessionSurface && isSessionModeOpen && \([\s\S]*?<SessionMode/);
assert.match(detailSource, /activeTab === 'session' && hasConventionalSessionSurface/);

console.log('p000PediatricSessionRoute.regression.test.mjs: ok (12 profile scenarios + session contracts)');
